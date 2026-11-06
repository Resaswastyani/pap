import type { ResultSetHeader, RowDataPacket } from 'mysql2'
import { NextResponse } from 'next/server'
import { fail, handle, int, readJson, requireUser, str } from '@/lib/api'
import { canManageAccounting, isPeriode, requireAccounting } from '@/lib/accounting'
import { logActivity } from '@/lib/activity'
import { db } from '@/lib/db'
import { softDelete } from '@/lib/recycle-bin'

// Koreksi faktur PPN keluaran / masukan khusus menu Pajak (faktur di Accurate tidak diubah)
async function manager() {
  const user = await requireUser()
  requireAccounting(user, 'pajak')
  if (!canManageAccounting(user)) fail(403, 'Faktur pajak dikelola oleh divisi Accounting.')
  return user
}
const jenisOf = (v: unknown) => (v === 'keluaran' || v === 'masukan' ? v : fail(400, 'Jenis faktur tidak valid.'))
const money = (v: unknown, label: string) => {
  if (v === '' || v === null || v === undefined) return null
  const n = Number(String(v).replace(/\./g, '').replace(',', '.'))
  return Number.isFinite(n) && Math.abs(n) < 1e14 ? Math.round(n * 100) / 100 : fail(400, `${label} tidak valid.`)
}
const date = (v: unknown) => {
  const s = str(v, 10)
  if (!s) return null
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : fail(400, 'Tanggal tidak valid.')
}
function readFields(body: Record<string, unknown>) {
  return { tanggal: date(body.tanggal), pihak: str(body.pihak, 200) || null, faktur_pajak: str(body.faktur_pajak, 60) || null, dpp: money(body.dpp, 'DPP'), ppn: money(body.ppn, 'PPN'), catatan: str(body.catatan, 500) || null }
}

// Tambah faktur manual: { jenis, masa, nomor, tanggal, pihak, faktur_pajak, dpp, ppn, catatan }
export const POST = handle(async (request: Request) => {
  const user = await manager()
  const body = await readJson(request)
  const jenis = jenisOf(body.jenis)
  const v = readFields(body)
  const masa = v.tanggal ? v.tanggal.slice(0, 7) : str(body.masa, 7)
  if (!isPeriode(masa)) fail(400, 'Masa pajak tidak valid.')
  const nomor = str(body.nomor, 80) || fail(400, 'Nomor faktur wajib diisi.')
  if (v.dpp === null || v.ppn === null) fail(400, 'DPP dan PPN wajib diisi.')
  const [res] = await db.query<ResultSetHeader>(
    'INSERT INTO tax_vat_entries (jenis, sumber, masa, nomor, tanggal, pihak, faktur_pajak, dpp, ppn, catatan, updated_by) VALUES (?, \'manual\', ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [jenis, masa, nomor, v.tanggal, v.pihak, v.faktur_pajak, v.dpp, v.ppn, v.catatan, user.id],
  )
  await logActivity(request, user, { module: 'Pajak', action: 'create', entity: null, description: `Faktur PPN ${jenis} manual ${nomor}` })
  return NextResponse.json({ id: res.insertId }, { status: 201 })
})

// Ubah: faktur manual { id, ... } atau koreksi faktur Accurate { jenis, accurate_id, masa, nomor, ... } (kosong = ikut Accurate)
export const PUT = handle(async (request: Request) => {
  const user = await manager()
  const body = await readJson(request)
  const v = readFields(body)
  const id = int(body.id)
  if (id) {
    const [[row]] = await db.query<RowDataPacket[]>("SELECT id, nomor FROM tax_vat_entries WHERE id = ? AND sumber = 'manual'", [id])
    if (!row) fail(404, 'Faktur tidak ditemukan.')
    const nomor = str(body.nomor, 80) || row.nomor
    await db.query('UPDATE tax_vat_entries SET nomor = ?, tanggal = ?, masa = COALESCE(?, masa), pihak = ?, faktur_pajak = ?, dpp = COALESCE(?, dpp), ppn = COALESCE(?, ppn), catatan = ?, updated_by = ? WHERE id = ?',
      [nomor, v.tanggal, v.tanggal?.slice(0, 7) ?? null, v.pihak, v.faktur_pajak, v.dpp, v.ppn, v.catatan, user.id, id])
    return NextResponse.json({ ok: true })
  }
  const jenis = jenisOf(body.jenis)
  const accurateId = int(body.accurate_id) ?? fail(400, 'Faktur tidak dikenal.')
  const masa = str(body.masa, 7)
  if (!isPeriode(masa)) fail(400, 'Masa pajak tidak valid.')
  await db.query(
    `INSERT INTO tax_vat_entries (jenis, sumber, accurate_id, masa, nomor, tanggal, pihak, faktur_pajak, dpp, ppn, catatan, updated_by) VALUES (?, 'accurate', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE tanggal = VALUES(tanggal), pihak = VALUES(pihak), faktur_pajak = VALUES(faktur_pajak), dpp = VALUES(dpp), ppn = VALUES(ppn), catatan = VALUES(catatan), updated_by = VALUES(updated_by)`,
    [jenis, accurateId, masa, str(body.nomor, 80) || null, v.tanggal, v.pihak, v.faktur_pajak, v.dpp, v.ppn, v.catatan, user.id],
  )
  await logActivity(request, user, { module: 'Pajak', action: 'update', entity: null, description: `Koreksi faktur PPN ${jenis} ${str(body.nomor, 80)}` })
  return NextResponse.json({ ok: true })
})

// Hapus dari laporan pajak: faktur manual ?id= (masuk Data Terhapus) atau faktur Accurate ?jenis=&accurate_id=&masa=&nomor= (dikecualikan)
// Pulihkan faktur Accurate: ?jenis=&accurate_id=&pulihkan=1 (koreksi & pengecualian dihapus, kembali ke data Accurate)
export const DELETE = handle(async (request: Request) => {
  const user = await manager()
  const p = new URL(request.url).searchParams
  const id = int(p.get('id'))
  if (id) {
    await softDelete({ table: 'tax_vat_entries', id, modul: 'Pajak', user })
    return NextResponse.json({ ok: true })
  }
  const jenis = jenisOf(p.get('jenis'))
  const accurateId = int(p.get('accurate_id')) ?? fail(400, 'Faktur tidak dikenal.')
  if (p.get('pulihkan') === '1') {
    await db.query("DELETE FROM tax_vat_entries WHERE jenis = ? AND accurate_id = ? AND sumber = 'accurate'", [jenis, accurateId])
    return NextResponse.json({ ok: true })
  }
  const masa = p.get('masa')
  if (!isPeriode(masa)) fail(400, 'Masa pajak tidak valid.')
  await db.query(
    `INSERT INTO tax_vat_entries (jenis, sumber, accurate_id, masa, nomor, dikecualikan, updated_by) VALUES (?, 'accurate', ?, ?, ?, 1, ?)
     ON DUPLICATE KEY UPDATE dikecualikan = 1, updated_by = VALUES(updated_by)`,
    [jenis, accurateId, masa, str(p.get('nomor'), 80) || null, user.id],
  )
  await logActivity(request, user, { module: 'Pajak', action: 'delete', entity: null, description: `Faktur PPN ${jenis} ${p.get('nomor') ?? ''} dikecualikan dari laporan pajak` })
  return NextResponse.json({ ok: true })
})
