import type { PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise'
import { fail } from '@/lib/api'
import { db } from '@/lib/db'
import { refreshStageProgress } from '@/lib/production-results'
import type { UserProfile } from '@/lib/users'

// Tempat sampah (soft delete) untuk semua modul.
// softDelete() menyalin baris + seluruh turunannya (FK ON DELETE CASCADE, rekursif) beserta daftar referensi yang akan
// di-NULL-kan (FK ON DELETE SET NULL) ke tabel deleted_records, lalu menghapus baris asli dalam satu transaksi.
// restoreDeleted() menyisipkan kembali salinan dengan id yang sama dan menyambungkan ulang referensi tersebut.
// Daftar & laporan tidak perlu diubah: data terhapus memang tidak ada lagi di tabel aslinya.

type Row = RowDataPacket & Record<string, unknown>
type Fk = { table: string; column: string; refTable: string; refColumn: string; rule: string }
type Link = { table: string; column: string; pk: Record<string, unknown>; value: unknown }
type Snapshot = { v: 1; rows: { table: string; data: Record<string, unknown> }[]; links: Link[] }
// Tabel turunan yang tidak perlu disimpan (ikut terhapus tanpa dipulihkan)
const SKIP_TABLES = new Set(['notifications', 'activity_logs', 'push_subscriptions'])
const MAX_DEPTH = 6

let schemaCache: { at: number; fks: Fk[]; pks: Map<string, string[]>; generated: Map<string, Set<string>> } | null = null
async function schema(conn: PoolConnection) {
  if (schemaCache && Date.now() - schemaCache.at < 10 * 60e3) return schemaCache
  const [fkRows] = await conn.query<Row[]>(
    `SELECT k.TABLE_NAME AS t, k.COLUMN_NAME AS c, k.REFERENCED_TABLE_NAME AS rt, k.REFERENCED_COLUMN_NAME AS rc, r.DELETE_RULE AS rule
     FROM information_schema.KEY_COLUMN_USAGE k
     JOIN information_schema.REFERENTIAL_CONSTRAINTS r ON r.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA AND r.CONSTRAINT_NAME = k.CONSTRAINT_NAME AND r.TABLE_NAME = k.TABLE_NAME
     WHERE k.CONSTRAINT_SCHEMA = DATABASE() AND k.REFERENCED_TABLE_NAME IS NOT NULL`,
  )
  const [pkRows] = await conn.query<Row[]>(
    `SELECT TABLE_NAME AS t, COLUMN_NAME AS c FROM information_schema.KEY_COLUMN_USAGE
     WHERE CONSTRAINT_SCHEMA = DATABASE() AND CONSTRAINT_NAME = 'PRIMARY' ORDER BY TABLE_NAME, ORDINAL_POSITION`,
  )
  const [genRows] = await conn.query<Row[]>(
    `SELECT TABLE_NAME AS t, COLUMN_NAME AS c FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND (EXTRA LIKE '%GENERATED%' OR EXTRA LIKE '%VIRTUAL%' OR EXTRA LIKE '%PERSISTENT%' OR EXTRA LIKE '%STORED%')`,
  )
  const pks = new Map<string, string[]>()
  for (const r of pkRows) pks.set(String(r.t), [...(pks.get(String(r.t)) ?? []), String(r.c)])
  const generated = new Map<string, Set<string>>()
  for (const r of genRows) generated.set(String(r.t), (generated.get(String(r.t)) ?? new Set()).add(String(r.c)))
  schemaCache = {
    at: Date.now(), pks, generated,
    fks: fkRows.map((r) => ({ table: String(r.t), column: String(r.c), refTable: String(r.rt), refColumn: String(r.rc), rule: String(r.rule) })),
  }
  return schemaCache
}

// Buffer (lampiran / foto) disimpan sebagai base64 agar JSON tetap ringkas
const encode = (row: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(row).map(([k, v]) => [k, Buffer.isBuffer(v) ? { __b64: v.toString('base64') } : v]))
const decode = (v: unknown) => (v && typeof v === 'object' && '__b64' in (v as object) ? Buffer.from(String((v as { __b64: string }).__b64), 'base64') : v)

async function collect(conn: PoolConnection, table: string, column: string, values: unknown[], snap: Snapshot, seen: Set<string>, depth: number) {
  const vals = [...new Set(values.filter((v) => v !== null && v !== undefined))]
  if (!vals.length || depth > MAX_DEPTH || SKIP_TABLES.has(table)) return
  const s = await schema(conn)
  const [rows] = await conn.query<Row[]>(`SELECT * FROM \`${table}\` WHERE \`${column}\` IN (?)`, [vals])
  const pk = s.pks.get(table) ?? []
  const fresh = rows.filter((r) => {
    const key = `${table}:${pk.length ? pk.map((c) => String(r[c])).join('|') : JSON.stringify(r)}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  if (!fresh.length) return
  for (const r of fresh) snap.rows.push({ table, data: encode({ ...r }) })
  for (const fk of s.fks.filter((f) => f.refTable === table)) {
    const parentVals = fresh.map((r) => r[fk.refColumn])
    if (fk.rule === 'CASCADE') await collect(conn, fk.table, fk.column, parentVals, snap, seen, depth + 1)
    else if (fk.rule === 'SET NULL' && !SKIP_TABLES.has(fk.table)) {
      const cols = s.pks.get(fk.table)
      if (!cols?.length) continue
      const [linked] = await conn.query<Row[]>(
        `SELECT ${[...new Set([...cols, fk.column])].map((c) => `\`${c}\``).join(', ')} FROM \`${fk.table}\` WHERE \`${fk.column}\` IN (?)`, [[...new Set(parentVals)]],
      )
      for (const l of linked) snap.links.push({ table: fk.table, column: fk.column, pk: Object.fromEntries(cols.map((c) => [c, l[c]])), value: l[fk.column] })
    }
  }
}

export type SoftDeleteOptions = {
  table: string
  id: number | string
  modul: string
  label?: string // default: dari kolom nomor / nama / judul baris yang dihapus
  user: UserProfile
  column?: string // kolom kunci (default id)
  guard?: { sql: string; params: unknown[]; message: string } // syarat tambahan saat menghapus (mis. status), gagal -> 409
  extra?: { table: string; where: string; params: unknown[] }[] // baris non-FK yang ikut dihapus & dipulihkan (mis. lampiran polimorfik)
}

export async function softDelete(o: SoftDeleteOptions) {
  const column = o.column ?? 'id'
  const conn = await db.getConnection()
  try {
    await conn.beginTransaction()
    const snap: Snapshot = { v: 1, rows: [], links: [] }
    const seen = new Set<string>()
    await collect(conn, o.table, column, [o.id], snap, seen, 0)
    if (!snap.rows.length) fail(404, 'Data tidak ditemukan atau sudah dihapus.')
    for (const x of o.extra ?? []) {
      const [rows] = await conn.query<Row[]>(`SELECT * FROM \`${x.table}\` WHERE ${x.where}`, x.params)
      for (const r of rows) {
        const pk = (await schema(conn)).pks.get(x.table) ?? []
        const key = `${x.table}:${pk.map((c) => String(r[c])).join('|')}`
        if (seen.has(key)) continue
        seen.add(key)
        snap.rows.push({ table: x.table, data: encode({ ...r }) })
      }
    }
    const main = snap.rows[0].data
    const label = o.label || [main.nomor, main.nama_usaha ?? main.nama ?? main.judul ?? main.name ?? main.kategori ?? main.jenis_plastik ?? main.keperluan ?? main.keterangan]
      .filter((v) => v !== null && v !== undefined && v !== '').map(String).join(' · ')
    const json = JSON.stringify(snap)
    if (json.length > 200 * 1024 * 1024) fail(413, 'Data terlalu besar untuk disimpan di Data Terhapus.')
    await conn.query(
      'INSERT INTO deleted_records (modul, label, table_name, record_id, row_count, size_bytes, snapshot, deleted_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [o.modul.slice(0, 60), label.slice(0, 255) || `#${o.id}`, o.table, String(o.id), snap.rows.length, json.length, json, o.user.id],
    )
    for (const x of o.extra ?? []) await conn.query(`DELETE FROM \`${x.table}\` WHERE ${x.where}`, x.params)
    const [res] = await conn.query<ResultSetHeader>(
      `DELETE FROM \`${o.table}\` WHERE \`${column}\` = ?${o.guard ? ` AND (${o.guard.sql})` : ''}`, [o.id, ...(o.guard?.params ?? [])],
    )
    if (!res.affectedRows) fail(409, o.guard?.message ?? 'Data baru saja berubah. Muat ulang lalu coba lagi.')
    await conn.commit()
  } catch (error) {
    await conn.rollback()
    throw error
  } finally {
    conn.release()
  }
}

export const canSeeAllDeleted = (user: UserProfile) => user.role.isAdmin

export async function restoreDeleted(id: number, user: UserProfile) {
  const [[rec]] = await db.query<Row[]>('SELECT * FROM deleted_records WHERE id = ?', [id])
  if (!rec) fail(404, 'Data terhapus tidak ditemukan.')
  if (!canSeeAllDeleted(user) && Number(rec.deleted_by) !== user.id) fail(403, 'Hanya penghapus data atau Admin yang dapat memulihkan.')
  if (rec.restored_at) fail(409, 'Data ini sudah dipulihkan.')
  const snap = JSON.parse(String(rec.snapshot)) as Snapshot
  const conn = await db.getConnection()
  try {
    await conn.beginTransaction()
    const s = await schema(conn)
    // Sisipkan bertahap: baris yang induknya belum masuk (urutan turunan berbeda) dicoba lagi di putaran berikutnya
    let pending = snap.rows
    while (pending.length) {
      const next: typeof pending = []
      let lastRef = ''
      for (const { table, data } of pending) {
        const skip = s.generated.get(table)
        const cols = Object.keys(data).filter((c) => !skip?.has(c))
        await conn.query('SAVEPOINT rb_row')
        try {
          await conn.query(`INSERT INTO \`${table}\` (${cols.map((c) => `\`${c}\``).join(', ')}) VALUES (?)`, [cols.map((c) => decode(data[c]))])
        } catch (e) {
          await conn.query('ROLLBACK TO SAVEPOINT rb_row')
          const code = (e as { code?: string }).code
          if (code === 'ER_DUP_ENTRY') fail(409, `Gagal memulihkan: data dengan kunci yang sama sudah ada lagi (${table}). Ubah / hapus data penggantinya dulu.`)
          if (code !== 'ER_NO_REFERENCED_ROW_2' && code !== 'ER_NO_REFERENCED_ROW') throw e
          next.push({ table, data })
          lastRef = table
        }
      }
      if (next.length === pending.length) fail(409, `Gagal memulihkan: data induk yang dirujuk (${lastRef}) sudah tidak ada.`)
      pending = next
    }
    // Sambungkan ulang referensi yang tadi di-NULL-kan (hanya bila masih kosong)
    for (const l of snap.links) {
      const where = Object.keys(l.pk).map((c) => `\`${c}\` = ?`).join(' AND ')
      await conn.query(`UPDATE \`${l.table}\` SET \`${l.column}\` = ? WHERE ${where} AND \`${l.column}\` IS NULL`, [l.value, ...Object.values(l.pk)])
    }
    await conn.query('UPDATE deleted_records SET restored_at = NOW(), restored_by = ? WHERE id = ?', [user.id, id])
    await conn.commit()
  } catch (error) {
    await conn.rollback()
    throw error
  } finally {
    conn.release()
  }
  // Setelah dipulihkan, beberapa data perlu menghitung ulang turunannya
  const main = snap.rows[0]
  if (main.table === 'production_results' && main.data.stage_id) await refreshStageProgress(Number(main.data.stage_id)).catch((e) => console.error('[recycle-bin]', e))
  return { modul: String(rec.modul), label: String(rec.label) }
}
