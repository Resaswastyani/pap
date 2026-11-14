import type { ResultSetHeader, RowDataPacket } from 'mysql2'
import { NextResponse } from 'next/server'
import { fail, handle, readJson, requireUser, str } from '@/lib/api'
import { db } from '@/lib/db'
import { canSupervise, readProspectInput, readProspectProducts, requireMarketing, requireMarketingUser, saveProspectProducts } from '@/lib/marketing'
import { notify } from '@/lib/notifications'
import { pushToUsers } from '@/lib/push'
import { softDelete } from '@/lib/recycle-bin'

const MAX_ROWS = 500
type Row = RowDataPacket & Record<string, unknown>

// Impor banyak prospek sekaligus: { rows: [...], assigned_to? }.
// File dibaca di browser; rows[i].products = [{ label, jenis_plastik, qty_kg, harga, satuan_harga, gpf }] (beberapa produk per prospek).
// Nomor WA yang sudah terdaftar di SIMPAP dilewati; nomor yang sama di dalam satu file tetap diimpor.
// Setiap impor diberi kode (import_batch) agar bisa dibatalkan dari form impor.
export const POST = handle(async (request: Request) => {
  const user = await requireUser()
  requireMarketing(user, 'prospek')
  const body = await readJson(request)
  if (!Array.isArray(body.rows) || !body.rows.length) fail(400, 'Tidak ada baris untuk diimpor.')
  const rows = body.rows as Record<string, unknown>[]
  if (rows.length > MAX_ROWS) fail(400, `Maksimal ${MAX_ROWS} prospek per impor.`)
  const assigned = canSupervise(user) ? (await requireMarketingUser(body.assigned_to, 'Sales'))?.id ?? null : user.division.code === 'marketing_digital' ? null : user.id

  const inputs = rows.map((row, i) => {
    try {
      const input = readProspectInput(row)
      const products = readProspectProducts(row)
      if (products?.length) input.kebutuhan = products.map((p) => p.label).join('; ').slice(0, 500)
      return { ...input, products }
    } catch (error) {
      fail(400, `Prospek ke-${i + 1}: ${(error as Error).message}`)
    }
  })!
  const phones = inputs.map((p) => p!.telepon).filter(Boolean) as string[]
  const existing = new Set<string>()
  if (phones.length) {
    const [found] = await db.query<(RowDataPacket & { telepon: string })[]>('SELECT telepon FROM prospects WHERE telepon IN (?)', [phones])
    for (const f of found) existing.add(f.telepon)
  }
  const fresh = inputs.filter((p) => !p!.telepon || !existing.has(p!.telepon))
  const batch = `imp-${user.id}-${Date.now()}`
  const now = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 19).replace('T', ' ')
  // Satu per satu: id prospek dibutuhkan untuk baris produknya
  for (const p of fresh) {
    const [res] = await db.query<ResultSetHeader>(
      `INSERT INTO prospects (nama_usaha, sektor, kontak_nama, kontak_jabatan, telepon, email, alamat, kota, sumber, kebutuhan, estimasi_order, kompetitor, payment, catatan,
         assigned_to, created_by, last_activity_at, import_batch) VALUES (?)`,
      [[p!.nama_usaha, p!.sektor, p!.kontak_nama, p!.kontak_jabatan, p!.telepon, p!.email, p!.alamat, p!.kota, p!.sumber, p!.kebutuhan,
        p!.estimasi_order, p!.kompetitor, p!.payment, p!.catatan, assigned, user.id, now, batch]],
    )
    if (p!.products?.length) await saveProspectProducts(res.insertId, p!.products)
  }
  if (assigned && assigned !== user.id && fresh.length) {
    await pushToUsers(await notify([assigned], {
      type: 'prospek_baru',
      title: `${fresh.length} prospek baru untuk Anda`,
      body: `Diimpor oleh ${user.name}`,
      refKey: `prospek-import:${user.id}:${Date.now()}`,
    }))
  }
  return NextResponse.json({ imported: fresh.length, skipped: inputs.length - fresh.length, batch })
})

// Riwayat impor (30 hari): milik sendiri, atau semua untuk Lead/management
export const GET = handle(async () => {
  const user = await requireUser()
  requireMarketing(user, 'prospek')
  const all = canSupervise(user)
  const [rows] = await db.query<Row[]>(
    `SELECT p.import_batch AS batch, MIN(p.created_at) AS waktu, COUNT(*) AS jumlah, MAX(u.name) AS oleh, MAX(p.created_by) AS created_by,
       SUBSTRING_INDEX(GROUP_CONCAT(p.nama_usaha ORDER BY p.id SEPARATOR '; '), '; ', 3) AS contoh,
       SUM((SELECT COUNT(*) FROM marketing_activities a WHERE a.prospect_id = p.id) + (SELECT COUNT(*) FROM visits v WHERE v.prospect_id = p.id)) AS aktivitas
     FROM prospects p JOIN users u ON u.id = p.created_by
     WHERE p.import_batch IS NOT NULL AND p.created_at >= NOW() - INTERVAL 30 DAY ${all ? '' : 'AND p.created_by = ?'}
     GROUP BY p.import_batch ORDER BY waktu DESC LIMIT 20`,
    all ? [] : [user.id],
  )
  return NextResponse.json({ items: rows.map((r) => ({ ...r, jumlah: Number(r.jumlah), aktivitas: Number(r.aktivitas ?? 0) })) })
})

// Batalkan impor: ?batch=... -> semua prospek hasil impor itu dipindah ke Data Terhapus (masih bisa dipulihkan)
export const DELETE = handle(async (request: Request) => {
  const user = await requireUser()
  requireMarketing(user, 'prospek')
  const batch = str(new URL(request.url).searchParams.get('batch'), 40)
  if (!batch) fail(400, 'Kode impor wajib diisi.')
  const [rows] = await db.query<(RowDataPacket & { id: number; created_by: number })[]>('SELECT id, created_by FROM prospects WHERE import_batch = ?', [batch])
  if (!rows.length) fail(404, 'Data impor tidak ditemukan atau sudah dibatalkan.')
  if (!canSupervise(user) && rows.some((r) => r.created_by !== user.id)) fail(403, 'Hanya pengimpor atau Lead yang dapat membatalkan impor ini.')
  for (const r of rows) {
    await softDelete({
      table: 'prospects', id: r.id, modul: 'Prospek', user,
      extra: [{ table: 'note_attachments', where: "owner_type = 'activity' AND owner_id IN (SELECT id FROM marketing_activities WHERE prospect_id = ?)", params: [r.id] }],
    })
  }
  return NextResponse.json({ deleted: rows.length })
})
