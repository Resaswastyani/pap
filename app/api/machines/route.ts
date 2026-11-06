import type { ResultSetHeader, RowDataPacket } from 'mysql2'
import { NextResponse } from 'next/server'
import { fail, handle, readJson, requireUser, str } from '@/lib/api'
import { requireMenu } from '@/lib/customers'
import { db } from '@/lib/db'
import { machineSheetCreate } from '@/lib/machine-sheet'
import { canManageMachines, PRODUCTION_STAGES, readMachineInput } from '@/lib/production'
import { sheetStrict } from '@/lib/sheet-write'

const canViewMachines = (menus: string[]) => menus.includes('data-mesin') || menus.includes('jadwal-produksi')

// Daftar mesin + beban jadwal (tahap belum selesai yang memakai mesin)
export const GET = handle(async () => {
  const user = await requireUser()
  requireMenu(user, canViewMachines(user.menus))
  const [items] = await db.query<RowDataPacket[]>(
    `SELECT m.*, (SELECT COUNT(*) FROM production_stages s JOIN production_jobs j ON j.id = s.job_id AND j.status <> 'batal'
       WHERE s.machine_id = m.id AND s.status IN ('belum', 'berjalan')) AS antrian,
       (SELECT CONCAT(j.nomor, ' · ', j.item_name) FROM production_stages s JOIN production_jobs j ON j.id = s.job_id
       WHERE s.machine_id = m.id AND s.status = 'berjalan' ORDER BY s.actual_start DESC LIMIT 1) AS sedang_dikerjakan,
       (SELECT COUNT(*) FROM machine_checkpoints c WHERE c.machine_id = m.id AND c.jenis = 'langkah') AS critical_point,
       (SELECT COUNT(*) FROM machine_repairs r WHERE r.machine_id = m.id AND r.status IN ('baru', 'dikerjakan', 'menunggu_part')) AS perbaikan_terbuka
     FROM machines m ORDER BY FIELD(m.status, 'aktif', 'maintenance', 'nonaktif'), m.lini IS NULL, m.lini, FIELD(m.tahap, 'Blow', 'Cetak', 'Bag making'), m.kode`,
  )
  return NextResponse.json({ items: items.map((m) => ({ ...m, antrian: Number(m.antrian), critical_point: Number(m.critical_point), perbaikan_terbuka: Number(m.perbaikan_terbuka) })), tahap: PRODUCTION_STAGES, canManage: canManageMachines(user) })
})

export const POST = handle(async (request: Request) => {
  const user = await requireUser()
  if (!canManageMachines(user)) fail(403, 'Hanya PPIC / Teknik yang dapat menambah mesin.')
  const body = await readJson(request)
  // Tulis ke spreadsheet Mapping Teknis Mesin: blok mesin (lini, komponen, langkah) dibuat di sheet lalu disinkron
  if (body.ke_sheet) {
    const nama = str(body.nama, 150) || fail(400, 'Nama mesin wajib diisi.')
    const lini = str(body.lini, 60) || fail(400, 'Pilih lini mesin (mis. INLINE PP).')
    const komponen = (Array.isArray(body.komponen) ? body.komponen : []).slice(0, 40).map((k: Record<string, unknown>) => ({
      nama: str(k?.nama, 150), langkah: (Array.isArray(k?.langkah) ? k.langkah : []).slice(0, 60).map((x: unknown) => str(x, 2000)),
    })).filter((k: { nama: string }) => k.nama)
    const key = await sheetStrict(() => machineSheetCreate({ lini, nama, komponen }))
    const [[m]] = await db.query<(RowDataPacket & { id: number })[]>('SELECT id FROM machines WHERE sheet_key = ?', [key])
    if (!m) fail(502, 'Mesin sudah ditulis ke spreadsheet tetapi belum terbaca saat sinkron. Klik Google Sheet lalu Sinkron.')
    const kode = str(body.kode, 30)
    const tahap = str(body.tahap, 40)
    const status = ['aktif', 'maintenance', 'nonaktif'].includes(String(body.status)) ? String(body.status) : 'aktif'
    await db.query('UPDATE machines SET kode = COALESCE(?, kode), tahap = COALESCE(?, tahap), status = ?, kapasitas = ?, keterangan = ? WHERE id = ?',
      [kode || null, tahap || null, status, str(body.kapasitas, 150) || null, str(body.keterangan, 5000) || null, m!.id]).catch((e) => {
      if ((e as { code?: string }).code === 'ER_DUP_ENTRY') fail(409, `Kode mesin ${kode} sudah dipakai mesin lain.`)
      throw e
    })
    return NextResponse.json({ id: m!.id, sheet: true }, { status: 201 })
  }
  const input = readMachineInput(body)
  const [result] = await db.query<ResultSetHeader>(
    'INSERT INTO machines (kode, nama, tahap, kapasitas, status, keterangan) VALUES (?, ?, ?, ?, ?, ?)',
    [input.kode, input.nama, input.tahap, input.kapasitas, input.status, input.keterangan],
  )
  return NextResponse.json({ id: result.insertId }, { status: 201 })
})
