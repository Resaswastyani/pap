import type { RowDataPacket } from 'mysql2'
import { NextResponse } from 'next/server'
import { handle, int, requireUser, str } from '@/lib/api'
import { db } from '@/lib/db'
import { driveEnabled, driveServiceEmail, driveStatus } from '@/lib/drive'
import { canManageMaster, DESIGN_KIND_SQL, requireMaster } from '@/lib/master'

const PAGE_SIZE = 60

// Galeri logo & desain hasil sinkron Google Drive
export const GET = handle(async (request: Request) => {
  const user = await requireUser()
  requireMaster(user)
  const url = new URL(request.url)
  const where: string[] = []
  const params: (string | number)[] = []
  const root = int(url.searchParams.get('root'))
  if (root) {
    where.push('f.root_id = ?')
    params.push(root)
  }
  const bulan = str(url.searchParams.get('bulan'), 60)
  if (bulan) {
    where.push('f.bulan = ?')
    params.push(bulan)
  }
  const q = str(url.searchParams.get('q'), 100)
  if (q) {
    where.push('(f.name LIKE ? OR f.brand LIKE ? OR c.name LIKE ?)')
    params.push(`%${q}%`, `%${q}%`, `%${q}%`)
  }
  const customer = int(url.searchParams.get('customer'))
  if (customer) {
    where.push('f.customer_id = ?')
    params.push(customer)
  }
  const kind = url.searchParams.get('kind') as keyof typeof DESIGN_KIND_SQL | 'preview' | null
  if (kind === 'preview') where.push(`(${DESIGN_KIND_SQL.gambar} OR ${DESIGN_KIND_SQL.pdf} OR f.has_thumbnail = 1)`)
  else if (kind && kind in DESIGN_KIND_SQL) where.push(DESIGN_KIND_SQL[kind])
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''
  const page = Math.max(1, int(url.searchParams.get('page')) ?? 1)

  const [items] = await db.query<RowDataPacket[]>(
    `SELECT f.id, f.root_id, f.name, f.mime, f.size, f.modified_at, f.has_thumbnail, f.web_link, f.bulan, f.brand, f.customer_id, f.customer_manual,
       r.label AS root_label, r.tahun, c.name AS customer_name, c.customer_no
     FROM drive_files f JOIN drive_roots r ON r.id = f.root_id LEFT JOIN customers c ON c.id = f.customer_id
     ${whereSql} ORDER BY f.modified_at DESC, f.name LIMIT ? OFFSET ?`,
    [...params, PAGE_SIZE, (page - 1) * PAGE_SIZE],
  )
  const [[{ total }]] = await db.query<(RowDataPacket & { total: number })[]>(
    `SELECT COUNT(*) AS total FROM drive_files f LEFT JOIN customers c ON c.id = f.customer_id ${whereSql}`,
    params,
  )
  // Pilihan bulan mengikuti sumber yang dipilih (urut kalender)
  const [months] = await db.query<(RowDataPacket & { bulan: string })[]>(
    `SELECT DISTINCT bulan FROM drive_files WHERE bulan IS NOT NULL ${root ? 'AND root_id = ?' : ''}`,
    root ? [root] : [],
  )
  return NextResponse.json({
    items: items.map((f) => ({ ...f, has_thumbnail: !!f.has_thumbnail, size: f.size === null ? null : Number(f.size) })),
    total: Number(total),
    pageSize: PAGE_SIZE,
    months: sortMonths(months.map((m) => m.bulan)),
    roots: await driveStatus(),
    drive: { enabled: driveEnabled(), serviceEmail: canManageMaster(user) ? driveServiceEmail() : null },
    canManage: canManageMaster(user),
  })
})

const MONTH_ORDER = ['jan', 'feb', 'mar', 'apr', 'mei', 'may', 'jun', 'jul', 'agu', 'aug', 'sep', 'okt', 'oct', 'nov', 'des', 'dec']
const monthIndex = (name: string) => {
  const key = name.trim().toLowerCase().slice(0, 3)
  const i = MONTH_ORDER.indexOf(key)
  return i < 0 ? 99 : [0, 1, 2, 3, 4, 4, 5, 6, 7, 7, 8, 9, 9, 10, 11, 11][i]
}
const sortMonths = (list: string[]) => [...list].sort((a, b) => monthIndex(a) - monthIndex(b) || a.localeCompare(b))
