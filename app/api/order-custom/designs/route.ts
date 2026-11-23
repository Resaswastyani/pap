import type { RowDataPacket } from 'mysql2'
import { NextResponse } from 'next/server'
import { handle, int, requireUser, str } from '@/lib/api'
import { db } from '@/lib/db'
import { requireOrderCustom } from '@/lib/order-custom'

// Pilih desain dari Master Data (Logo & Desain hasil sinkron Google Drive) untuk checklist order custom.
// ?customer= desain milik customer (folder brand yang cocok); ?q= cari nama file / brand / customer. Hanya yang bisa dipreview.
export const GET = handle(async (request: Request) => {
  const user = await requireUser()
  requireOrderCustom(user)
  const p = new URL(request.url).searchParams
  const where = ["(f.mime LIKE 'image/%' OR f.mime = 'application/pdf' OR f.has_thumbnail = 1)"]
  const args: unknown[] = []
  const customer = int(p.get('customer'))
  if (customer) where.push('f.customer_id = ?'), args.push(customer)
  const q = str(p.get('q'), 100)
  if (q) where.push('(f.name LIKE ? OR f.brand LIKE ? OR c.name LIKE ?)'), args.push(`%${q}%`, `%${q}%`, `%${q}%`)
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT f.id, f.name, f.mime, f.web_link, f.brand, f.bulan, f.modified_at, r.label AS root_label, c.name AS customer_name
     FROM drive_files f JOIN drive_roots r ON r.id = f.root_id LEFT JOIN customers c ON c.id = f.customer_id
     WHERE ${where.join(' AND ')} ORDER BY f.modified_at DESC, f.name LIMIT 60`,
    args,
  )
  return NextResponse.json({ items: rows })
})
