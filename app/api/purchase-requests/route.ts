import type { ResultSetHeader, RowDataPacket } from 'mysql2'
import { NextResponse } from 'next/server'
import { fail, handle, readJson, requireUser, str } from '@/lib/api'
import { db } from '@/lib/db'
import { notifyPr, PR_SELECT, readPrInput, serializePr } from '@/lib/purchase-requests'
import { OPEN_STATUSES } from '@/lib/repairs'
import { canProcessPurchase, canRequestPurchase, PR_STATUS, requireTeknikMenu } from '@/lib/teknik'

// Daftar pengajuan: ?status=terbuka|<status>|semua &q=
export const GET = handle(async (request: Request) => {
  const user = await requireUser()
  requireTeknikMenu(user, 'pengajuan-pembelian', 'Pengajuan Pembelian')
  const params = new URL(request.url).searchParams
  const where: string[] = []
  const args: unknown[] = []
  const status = params.get('status') || 'terbuka'
  if (status === 'terbuka') where.push("p.status IN ('diajukan', 'disetujui', 'dipesan')")
  else if (status in PR_STATUS) where.push('p.status = ?'), args.push(status)
  const q = str(params.get('q'), 100)
  if (q) {
    where.push('(p.nomor LIKE ? OR p.keperluan LIKE ? OR p.po_number LIKE ? OR EXISTS (SELECT 1 FROM purchase_request_items i WHERE i.request_id = p.id AND i.nama LIKE ?))')
    args.push(...Array(4).fill(`%${q}%`))
  }
  const [rows] = await db.query<RowDataPacket[]>(
    `${PR_SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY FIELD(p.status, 'diajukan', 'disetujui', 'dipesan', 'diterima', 'ditolak', 'batal'), FIELD(p.prioritas, 'darurat', 'tinggi', 'normal'), p.id DESC LIMIT 500`,
    args,
  )
  const [counts] = await db.query<RowDataPacket[]>('SELECT status, COUNT(*) AS n FROM purchase_requests GROUP BY status')
  const [items] = await db.query<RowDataPacket[]>('SELECT id, kode, nama, satuan, stok, stok_minimum FROM tech_items WHERE aktif = 1 ORDER BY nama')
  const [repairs] = await db.query<RowDataPacket[]>(
    `SELECT r.id, r.nomor, m.nama AS mesin FROM machine_repairs r JOIN machines m ON m.id = r.machine_id WHERE r.status IN (?) ORDER BY r.id DESC LIMIT 100`,
    [OPEN_STATUSES],
  )
  return NextResponse.json({
    items: rows.map(serializePr),
    counts: Object.fromEntries(counts.map((c) => [c.status, Number(c.n)])),
    techItems: items.map((i) => ({ ...i, stok: Number(i.stok), stok_minimum: Number(i.stok_minimum) })),
    repairs,
    can: { create: canRequestPurchase(user), process: canProcessPurchase(user) },
  })
})

// Ajukan pembelian (Teknik / PPIC / Purchasing) -> notifikasi Purchasing
export const POST = handle(async (request: Request) => {
  const user = await requireUser()
  requireTeknikMenu(user, 'pengajuan-pembelian', 'Pengajuan Pembelian')
  if (!canRequestPurchase(user)) fail(403, 'Pengajuan pembelian dibuat oleh divisi Teknik, PPIC, atau Purchasing.')
  const input = await readPrInput(await readJson(request))
  const conn = await db.getConnection()
  let id: number
  try {
    await conn.beginTransaction()
    const [res] = await conn.query<ResultSetHeader>(
      'INSERT INTO purchase_requests (keperluan, prioritas, dibutuhkan, repair_id, requested_by) VALUES (?, ?, ?, ?, ?)',
      [input.keperluan, input.prioritas, input.dibutuhkan, input.repairId, user.id],
    )
    id = res.insertId
    await conn.query("UPDATE purchase_requests SET nomor = CONCAT('PP-', DATE_FORMAT(created_at, '%Y%m'), '-', LPAD(id, 5, '0')) WHERE id = ?", [id])
    await conn.query(
      'INSERT INTO purchase_request_items (request_id, item_id, nama, spesifikasi, jumlah, satuan, urut) VALUES ?',
      [input.items.map((it, i) => [id, it.itemId, it.nama, it.spesifikasi, it.jumlah, it.satuan, i + 1])],
    )
    await conn.commit()
  } catch (error) {
    await conn.rollback()
    throw error
  } finally {
    conn.release()
  }
  await notifyPr(id!, user, true)
  return NextResponse.json({ id: id! }, { status: 201 })
})
