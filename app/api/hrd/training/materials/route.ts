import type { RowDataPacket } from 'mysql2'
import { NextResponse } from 'next/server'
import { handle, requireUser } from '@/lib/api'
import { db } from '@/lib/db'
import { embedUrl, requireTraining } from '@/lib/training'

type Row = RowDataPacket & Record<string, unknown>

// Semua materi training (modul aktif) untuk tab Materi
export const GET = handle(async () => {
  const user = await requireUser()
  requireTraining(user)
  const [rows] = await db.query<Row[]>(
    `SELECT x.id, x.module_id, m.judul AS modul, x.sumber, x.drive_file_id, x.judul, x.jenis, x.url, x.mime, x.ukuran, x.folder
     FROM training_materials x JOIN training_modules m ON m.id = x.module_id
     WHERE m.aktif = 1 ORDER BY m.urut, m.judul, x.sumber, x.urut, x.id`,
  )
  return NextResponse.json({
    items: rows.map((x) => ({
      ...x, ukuran: x.ukuran === null ? null : Number(x.ukuran),
      link: x.drive_file_id ? `https://drive.google.com/file/d/${x.drive_file_id}/view` : x.url,
      embed: x.drive_file_id ? `https://drive.google.com/file/d/${x.drive_file_id}/preview` : embedUrl(x.url as string | null),
    })),
  })
})
