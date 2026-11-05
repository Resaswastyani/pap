import type { RowDataPacket } from 'mysql2'
import { NextResponse } from 'next/server'
import { handle, readJson, requireUser, str } from '@/lib/api'
import { db } from '@/lib/db'
import { BELANJA_KATEGORI, BELANJA_SELECT, canManageBelanja, loadBelanja, readBelanjaInput, requireBelanja, requireBelanjaManage, saveBelanja, serializeBelanja } from '@/lib/belanja'

// Daftar nota belanja: ?bulan=YYYY-MM (kosong = semua) &kategori= &q= (cari nama item / toko / catatan)
export const GET = handle(async (request: Request) => {
  const user = await requireUser()
  requireBelanja(user)
  const params = new URL(request.url).searchParams
  const where: string[] = []
  const args: unknown[] = []
  const bulan = str(params.get('bulan'), 7)
  if (/^\d{4}-\d{2}$/.test(bulan)) where.push("DATE_FORMAT(b.tanggal, '%Y-%m') = ?"), args.push(bulan)
  const kategori = str(params.get('kategori'), 50)
  if (kategori) where.push('b.kategori = ?'), args.push(kategori)
  const q = str(params.get('q'), 100)
  if (q) {
    where.push('(b.toko LIKE ? OR b.catatan LIKE ? OR EXISTS (SELECT 1 FROM ga_belanja_items i WHERE i.belanja_id = b.id AND i.nama LIKE ?))')
    args.push(`%${q}%`, `%${q}%`, `%${q}%`)
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''
  const [rows] = await db.query<RowDataPacket[]>(`${BELANJA_SELECT} ${whereSql} ORDER BY b.tanggal DESC, b.id DESC LIMIT 1000`, args)
  // Ringkasan per kategori untuk filter yang sama, dan total per bulan (semua kategori, 12 bulan terakhir yang ada datanya)
  const [perKategori] = await db.query<RowDataPacket[]>(`SELECT b.kategori, COUNT(*) AS nota, SUM(b.total) AS total FROM ga_belanja b ${whereSql} GROUP BY b.kategori ORDER BY total DESC`, args)
  const [perBulan] = await db.query<RowDataPacket[]>(
    "SELECT DATE_FORMAT(tanggal, '%Y-%m') AS bulan, COUNT(*) AS nota, SUM(total) AS total FROM ga_belanja GROUP BY bulan ORDER BY bulan DESC LIMIT 12",
  )
  const [kategoriAda] = await db.query<RowDataPacket[]>('SELECT DISTINCT kategori FROM ga_belanja ORDER BY kategori')
  return NextResponse.json({
    items: rows.map(serializeBelanja),
    perKategori: perKategori.map((r) => ({ kategori: r.kategori, nota: Number(r.nota), total: Number(r.total ?? 0) })),
    perBulan: perBulan.map((r) => ({ bulan: r.bulan, nota: Number(r.nota), total: Number(r.total ?? 0) })),
    categories: [...new Set([...BELANJA_KATEGORI, ...kategoriAda.map((r) => String(r.kategori))])],
    can: { manage: canManageBelanja(user) },
  })
})

// Tambah nota belanja
export const POST = handle(async (request: Request) => {
  const user = await requireUser()
  requireBelanjaManage(user)
  const id = await saveBelanja(readBelanjaInput(await readJson(request)), user.id)
  return NextResponse.json({ item: await loadBelanja(id) }, { status: 201 })
})
