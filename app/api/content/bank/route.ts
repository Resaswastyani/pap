import type { RowDataPacket } from 'mysql2'
import { NextResponse } from 'next/server'
import { handle, requireUser, str } from '@/lib/api'
import { requireContent } from '@/lib/content'
import { db } from '@/lib/db'

// Bank konten: desain final dari request konten yang sudah disetujui (gambar / video / carousel)
export const GET = handle(async (request: Request) => {
  const user = await requireUser()
  requireContent(user)
  const q = str(new URL(request.url).searchParams.get('q'), 100)
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT f.id, f.name, f.mime, f.size, f.created_at, d.id AS design_id, d.nomor, d.judul, d.jenis_konten, d.updated_at AS approved_at,
       c.id AS content_id, c.platform, c.jadwal_tayang, c.status AS content_status
     FROM design_requests d
     JOIN design_request_files f ON f.design_id = d.id AND f.kind = 'desain' AND f.versi = d.revisi_ke + 1
     LEFT JOIN content_plans c ON c.design_request_id = d.id
     WHERE d.kategori = 'konten' AND d.status = 'disetujui' ${q ? 'AND (d.judul LIKE ? OR f.name LIKE ?)' : ''}
     ORDER BY d.updated_at DESC, f.id LIMIT 200`,
    q ? [`%${q}%`, `%${q}%`] : [],
  )
  return NextResponse.json({ items: rows })
})
