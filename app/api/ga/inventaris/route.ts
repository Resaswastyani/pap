import type { ResultSetHeader, RowDataPacket } from 'mysql2'
import { NextResponse } from 'next/server'
import { handle, readJson, requireUser, str } from '@/lib/api'
import { db } from '@/lib/db'
import {
  addInventarisLog, assertKodeFree, canManageInventaris, DUE_SQL, INV_KATEGORI, INV_KONDISI, INV_SELECT, loadInventaris, readInventarisInput,
  requireInventaris, requireInventarisManage, serializeInv,
} from '@/lib/inventaris'

// Daftar inventaris: ?q= &kategori= &kondisi= &lokasi= &pemegang=kosong &jatuh_tempo=1 &status=aktif|dihapuskan
export const GET = handle(async (request: Request) => {
  const user = await requireUser()
  requireInventaris(user)
  const params = new URL(request.url).searchParams
  const where = [params.get('status') === 'dihapuskan' ? "i.status = 'dihapuskan'" : "i.status = 'aktif'"]
  const args: unknown[] = []
  const q = str(params.get('q'), 100)
  if (q) where.push('(i.kode LIKE ? OR i.nama LIKE ? OR i.merek LIKE ? OR i.nomor_seri LIKE ? OR i.lokasi LIKE ? OR u.name LIKE ? OR i.pemegang_lain LIKE ?)'), args.push(...Array(7).fill(`%${q}%`))
  const kategori = str(params.get('kategori'), 100)
  if (kategori) where.push('i.kategori = ?'), args.push(kategori)
  const lokasi = str(params.get('lokasi'), 150)
  if (lokasi) where.push('i.lokasi = ?'), args.push(lokasi)
  const kondisi = params.get('kondisi')
  if (kondisi === 'bermasalah') where.push("i.kondisi <> 'baik'")
  else if (kondisi && kondisi in INV_KONDISI) where.push('i.kondisi = ?'), args.push(kondisi)
  if (params.get('pemegang') === 'kosong') where.push('i.pemegang_id IS NULL AND i.pemegang_lain IS NULL')
  if (params.get('jatuh_tempo') === '1') where.push(DUE_SQL)

  const [rows] = await db.query<RowDataPacket[]>(`${INV_SELECT} WHERE ${where.join(' AND ')} ORDER BY i.kategori IS NULL, i.kategori, i.kode LIMIT 2000`, args)
  const [[summary]] = await db.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS total, COALESCE(SUM(i.jumlah), 0) AS unit, COALESCE(SUM(i.harga_beli * i.jumlah), 0) AS nilai, COALESCE(SUM(i.kondisi <> 'baik'), 0) AS bermasalah,
       COALESCE(SUM(i.pemegang_id IS NULL AND i.pemegang_lain IS NULL), 0) AS tanpa_pemegang, COALESCE(SUM(${DUE_SQL}), 0) AS jatuh_tempo
     FROM ga_inventaris i WHERE i.status = 'aktif'`,
  )
  const [kategori_] = await db.query<RowDataPacket[]>("SELECT DISTINCT kategori FROM ga_inventaris WHERE kategori IS NOT NULL ORDER BY kategori")
  const [lokasi_] = await db.query<RowDataPacket[]>("SELECT DISTINCT lokasi FROM ga_inventaris WHERE lokasi IS NOT NULL ORDER BY lokasi")
  const [users] = await db.query<RowDataPacket[]>(
    'SELECT u.id, u.name, d.name AS division_name FROM users u JOIN divisions d ON d.id = u.division_id WHERE u.is_active = 1 ORDER BY u.name',
  )
  return NextResponse.json({
    items: rows.map(serializeInv),
    summary: Object.fromEntries(Object.entries(summary).map(([k, v]) => [k, Number(v ?? 0)])),
    categories: [...new Set([...kategori_.map((r) => String(r.kategori)), ...INV_KATEGORI])],
    locations: lokasi_.map((r) => String(r.lokasi)),
    users,
    can: { manage: canManageInventaris(user) },
  })
})

// Tambah barang inventaris; kode kosong = dibuat otomatis (INV-0001, INV-0002, ...)
export const POST = handle(async (request: Request) => {
  const user = await requireUser()
  requireInventarisManage(user)
  const input = await readInventarisInput(await readJson(request))
  if (input.kode) await assertKodeFree(input.kode)
  const [res] = await db.query<ResultSetHeader>(
    `INSERT INTO ga_inventaris (kode, nama, kategori, merek, nomor_seri, jumlah, lokasi, pemegang_id, pemegang_lain, tanggal_beli, tahun, pajak_tahunan, pajak_lima_tahunan, uji_kir,
       harga_beli, kondisi, catatan, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [input.kode ?? `TMP-${Date.now()}`, input.nama, input.kategori, input.merek, input.nomorSeri, input.jumlah, input.lokasi, input.pemegangId, input.pemegangLain,
      input.tanggalBeli, input.tahun, input.pajakTahunan, input.pajakLimaTahunan, input.ujiKir, input.hargaBeli, input.kondisi, input.catatan, user.id],
  )
  if (!input.kode) await db.query("UPDATE ga_inventaris SET kode = CONCAT('INV-', LPAD(id, 4, '0')) WHERE id = ?", [res.insertId])
  const item = await loadInventaris(res.insertId)
  const tempat = [item.lokasi && `lokasi ${item.lokasi}`, (item.pemegang_nama ?? item.pemegang_lain) && `pemegang ${item.pemegang_nama ?? item.pemegang_lain}`].filter(Boolean).join(', ')
  await addInventarisLog({ itemId: item.id, jenis: 'tambah', keterangan: `Barang didata${tempat ? ` (${tempat})` : ''}`, userId: user.id })
  return NextResponse.json({ item }, { status: 201 })
})
