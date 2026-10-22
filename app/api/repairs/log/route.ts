import type { ResultSetHeader, RowDataPacket } from 'mysql2'
import { NextResponse } from 'next/server'
import { handle, readJson, requireUser } from '@/lib/api'
import { db } from '@/lib/db'
import { canSyncDamageLog, DAMAGE_SELECT, damageFilter, machineLabel, readDamageInput, requireDamageLog, damageSheetCreate, syncDamageSheet } from '@/lib/damage-log'
import { canHandleRepair } from '@/lib/repairs'
import { trySheet } from '@/lib/sheet-write'

type Row = RowDataPacket & Record<string, unknown>

// Rekap kerusakan mesin (dari Google Drive + form aplikasi): daftar, ringkasan per mesin/komponen/bulan
export const GET = handle(async (request: Request) => {
  const user = await requireUser()
  requireDamageLog(user)
  const params = new URL(request.url).searchParams
  const filter = damageFilter(params)
  const [items] = await db.query<Row[]>(`${DAMAGE_SELECT} ${filter.sql} ORDER BY d.tanggal DESC, d.no_laporan DESC, d.sheet_row DESC, d.id DESC LIMIT 400`, filter.args)
  const [[total]] = await db.query<Row[]>(
    `SELECT COUNT(*) AS baris, COUNT(DISTINCT CONCAT(d.source, ':', COALESCE(d.no_laporan, d.id))) AS laporan,
       COALESCE(SUM(YEAR(d.tanggal) = YEAR(CURDATE())), 0) AS tahun_ini,
       COALESCE(SUM(d.tanggal >= DATE_FORMAT(CURDATE(), '%Y-%m-01')), 0) AS bulan_ini,
       COUNT(DISTINCT d.mesin_key) AS mesin, MAX(d.tanggal) AS terakhir
     FROM machine_damage_logs d ${filter.sql}`,
    filter.args,
  )
  const [perMesin] = await db.query<Row[]>(
    `SELECT d.mesin_key, COUNT(*) AS jumlah, MAX(d.tanggal) AS terakhir FROM machine_damage_logs d ${filter.sql}
     ${filter.sql ? 'AND' : 'WHERE'} d.mesin_key IS NOT NULL GROUP BY d.mesin_key ORDER BY jumlah DESC LIMIT 10`,
    filter.args,
  )
  const [perKomponen] = await db.query<Row[]>(
    `SELECT d.komponen, COUNT(*) AS jumlah FROM machine_damage_logs d ${filter.sql}
     ${filter.sql ? 'AND' : 'WHERE'} d.komponen IS NOT NULL GROUP BY d.komponen ORDER BY jumlah DESC LIMIT 8`,
    filter.args,
  )
  // 12 bulan terakhir (tanpa filter tanggal agar tren tetap terlihat)
  const [perBulan] = await db.query<Row[]>(
    `SELECT DATE_FORMAT(d.tanggal, '%Y-%m') AS bulan, COUNT(*) AS jumlah FROM machine_damage_logs d
     WHERE d.tanggal >= DATE_FORMAT(CURDATE() - INTERVAL 11 MONTH, '%Y-%m-01') GROUP BY bulan ORDER BY bulan`,
  )
  // Pilihan filter
  const [machines] = await db.query<Row[]>('SELECT mesin_key, COUNT(*) AS jumlah FROM machine_damage_logs WHERE mesin_key IS NOT NULL GROUP BY mesin_key ORDER BY mesin_key')
  const [components] = await db.query<Row[]>('SELECT komponen FROM machine_damage_logs WHERE komponen IS NOT NULL GROUP BY komponen ORDER BY komponen')
  // Pilihan komponen di form laporan: daftar part per mesin dari Lembar Perawatan Mesin
  const [parts] = await db.query<Row[]>(
    'SELECT mesin, part FROM maintenance_sheet_items GROUP BY mesin, part ORDER BY MIN(mesin_urut), MIN(part_no), part',
  )
  const [years] = await db.query<Row[]>('SELECT DISTINCT YEAR(tanggal) AS tahun FROM machine_damage_logs WHERE tanggal IS NOT NULL ORDER BY tahun DESC')
  const [[synced]] = await db.query<Row[]>("SELECT value FROM app_settings WHERE `key` = 'kerusakan_mesin.synced_at'")

  return NextResponse.json({
    items: items.map((r) => ({ ...r, mesin_label: r.mesin_key ? machineLabel(String(r.mesin_key)) : r.mesin, editable: r.source === 'app' ? r.created_by === user.id || canHandleRepair(user) : canSyncDamageLog(user) })),
    stats: {
      baris: Number(total.baris), laporan: Number(total.laporan), tahun_ini: Number(total.tahun_ini), bulan_ini: Number(total.bulan_ini), mesin: Number(total.mesin), terakhir: total.terakhir,
      per_mesin: perMesin.map((m) => ({ key: m.mesin_key, label: machineLabel(String(m.mesin_key)), jumlah: Number(m.jumlah), terakhir: m.terakhir })),
      per_komponen: perKomponen.map((k) => ({ komponen: k.komponen, jumlah: Number(k.jumlah) })),
      per_bulan: perBulan.map((b) => ({ bulan: b.bulan, jumlah: Number(b.jumlah) })),
    },
    options: {
      machines: machines.map((m) => ({ key: m.mesin_key, label: machineLabel(String(m.mesin_key)), jumlah: Number(m.jumlah) })),
      components: components.map((c) => c.komponen),
      parts: parts.map((p) => ({ mesin: String(p.mesin), part: String(p.part) })),
      years: years.map((y) => Number(y.tahun)),
    },
    synced_at: synced?.value ?? null,
    can: { create: true, sync: canSyncDamageLog(user) },
  })
})

// Form Laporan Kerusakan Mesin (isian aplikasi)
export const POST = handle(async (request: Request) => {
  const user = await requireUser()
  requireDamageLog(user)
  const v = readDamageInput(await readJson(request))
  const [res] = await db.query<ResultSetHeader>(
    `INSERT INTO machine_damage_logs (source, tanggal, mesin, mesin_key, komponen, kerusakan, tindakan, keterangan, created_by) VALUES ('app', ?, ?, ?, ?, ?, ?, ?, ?)`,
    [v.tanggal, v.mesin, v.mesin_key, v.komponen, v.kerusakan, v.tindakan, v.keterangan, user.id],
  )
  // Laporan ikut ditambahkan ke tab REKAP spreadsheet; setelah sinkron ulang laporan ini menjadi baris spreadsheet
  const warning = await trySheet('rekap kerusakan', async () => {
    await damageSheetCreate(v)
    await db.query('DELETE FROM machine_damage_logs WHERE id = ?', [res.insertId])
    await syncDamageSheet()
  })
  return NextResponse.json({ id: res.insertId, warning }, { status: 201 })
})
