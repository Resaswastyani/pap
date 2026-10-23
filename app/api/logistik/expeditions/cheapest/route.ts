import type { RowDataPacket } from 'mysql2'
import { NextResponse } from 'next/server'
import { fail, handle, requireUser, str } from '@/lib/api'
import { db } from '@/lib/db'
import { cheapestFor } from '@/lib/logistik'

// Ekspedisi termurah ke tujuan: ?tujuan=Surabaya (kota / provinsi); juga daftar tujuan yang pernah dikirim
export const GET = handle(async (request: Request) => {
  const user = await requireUser()
  if (!user.menus.includes('ekspedisi' as never) && !user.menus.includes('pengiriman' as never)) fail(403, 'Anda tidak punya akses ke menu ini.')
  const tujuan = str(new URL(request.url).searchParams.get('tujuan'), 100)
  const [dests] = await db.query<RowDataPacket[]>(
    `SELECT kota, MAX(provinsi) AS provinsi, COUNT(*) AS n FROM expedition_rates
     WHERE kota IS NOT NULL AND (tanggal IS NULL OR tanggal >= CURDATE() - INTERVAL 12 MONTH) GROUP BY kota ORDER BY n DESC LIMIT 300`,
  )
  return NextResponse.json({ tujuan, items: tujuan ? await cheapestFor(tujuan) : [], destinations: dests.map((d) => ({ kota: d.kota, provinsi: d.provinsi, n: Number(d.n) })) })
})
