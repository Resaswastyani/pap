import type { ResultSetHeader, RowDataPacket } from 'mysql2'
import { NextResponse } from 'next/server'
import { fail, handle, int, readJson, requireUser, str } from '@/lib/api'
import { db } from '@/lib/db'
import { OPEN_STATUSES } from '@/lib/repairs'
import { ITEM_SELECT, loadItem, readItemInput, serializeItem } from '@/lib/tech-items'
import { canManageTeknik, canProcessPurchase, decimal, ITEM_JENIS, moveStock, requireTeknikMenu, todayWib } from '@/lib/teknik'

// Daftar peralatan & sparepart: ?jenis= &machine= &stok=menipis &q= &nonaktif=1
export const GET = handle(async (request: Request) => {
  const user = await requireUser()
  requireTeknikMenu(user, 'sparepart', 'Sparepart & Peralatan')
  const params = new URL(request.url).searchParams
  const where = [params.get('nonaktif') === '1' ? 'i.aktif = 0' : 'i.aktif = 1']
  const args: unknown[] = []
  const jenis = params.get('jenis')
  if (jenis && jenis in ITEM_JENIS) where.push('i.jenis = ?'), args.push(jenis)
  const machine = int(params.get('machine'))
  if (machine) where.push('i.machine_id = ?'), args.push(machine)
  if (params.get('stok') === 'menipis') where.push('i.stok_minimum > 0 AND i.stok <= i.stok_minimum')
  if (params.get('stok') === 'rusak') where.push("i.kondisi <> 'baik'")
  const q = str(params.get('q'), 100)
  if (q) where.push('(i.kode LIKE ? OR i.nama LIKE ? OR i.kategori LIKE ? OR i.lokasi LIKE ?)'), args.push(...Array(4).fill(`%${q}%`))
  const [rows] = await db.query<RowDataPacket[]>(`${ITEM_SELECT} WHERE ${where.join(' AND ')} ORDER BY i.stok_minimum > 0 AND i.stok <= i.stok_minimum DESC, i.nama LIMIT 1000`, args)
  const [[summary]] = await db.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS total, COALESCE(SUM(jenis = 'sparepart'), 0) AS sparepart, COALESCE(SUM(jenis = 'peralatan'), 0) AS peralatan,
       COALESCE(SUM(stok_minimum > 0 AND stok <= stok_minimum), 0) AS menipis, COALESCE(SUM(kondisi <> 'baik'), 0) AS rusak
     FROM tech_items WHERE aktif = 1`,
  )
  const [machines] = await db.query<RowDataPacket[]>('SELECT id, kode, nama FROM machines ORDER BY nama')
  // Perbaikan mesin yang masih terbuka: pilihan "dipakai untuk perbaikan" saat sparepart keluar
  const [repairs] = await db.query<RowDataPacket[]>(
    `SELECT r.id, r.nomor, m.nama AS mesin, r.keluhan FROM machine_repairs r JOIN machines m ON m.id = r.machine_id
     WHERE r.status IN (?) ORDER BY r.id DESC LIMIT 100`,
    [OPEN_STATUSES],
  )
  return NextResponse.json({
    items: rows.map(serializeItem),
    summary: Object.fromEntries(Object.entries(summary).map(([k, v]) => [k, Number(v ?? 0)])),
    machines,
    repairs,
    can: { manage: canManageTeknik(user), receive: canManageTeknik(user) || canProcessPurchase(user) },
  })
})

// Tambah barang: data barang + { stok_awal }
export const POST = handle(async (request: Request) => {
  const user = await requireUser()
  requireTeknikMenu(user, 'sparepart', 'Sparepart & Peralatan')
  if (!canManageTeknik(user)) fail(403, 'Data peralatan & sparepart diatur oleh divisi Teknik.')
  const body = await readJson(request)
  const input = await readItemInput(body)
  const stokAwal = decimal(body.stok_awal, 'Stok awal', { required: false })
  const [res] = await db.query<ResultSetHeader>(
    `INSERT INTO tech_items (kode, nama, jenis, kategori, machine_id, satuan, stok_minimum, lokasi, kondisi, catatan, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [input.kode, input.nama, input.jenis, input.kategori, input.machineId, input.satuan, input.stokMinimum, input.lokasi, input.kondisi, input.catatan, user.id],
  )
  if (stokAwal > 0) await moveStock({ itemId: res.insertId, jenis: 'masuk', jumlah: stokAwal, tanggal: todayWib(), keterangan: 'Stok awal', userId: user.id })
  return NextResponse.json({ item: await loadItem(res.insertId) }, { status: 201 })
})
