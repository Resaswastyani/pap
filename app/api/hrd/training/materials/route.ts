import type { RowDataPacket } from 'mysql2'
import { NextResponse } from 'next/server'
import { handle, requireUser } from '@/lib/api'
import { db } from '@/lib/db'
import { canManageTraining, embedUrl, materialLink, requireTraining } from '@/lib/training'

type Row = RowDataPacket & Record<string, unknown>

// Semua materi training (modul aktif) untuk tab Materi; materi tersembunyi hanya terlihat oleh HRD
export const GET = handle(async () => {
  const user = await requireUser()
  requireTraining(user)
  const manage = canManageTraining(user)
  const [rows] = await db.query<Row[]>(
    `SELECT x.id, x.module_id, m.judul AS modul, x.sumber, x.drive_file_id, x.judul, x.jenis, x.url, x.mime, x.ukuran, x.folder, x.tersembunyi
     FROM training_materials x JOIN training_modules m ON m.id = x.module_id
     WHERE m.aktif = 1 ${manage ? '' : 'AND x.tersembunyi = 0'} ORDER BY m.urut, m.judul, x.sumber, x.urut, x.id`,
  )
  const [modules] = manage ? await db.query<Row[]>('SELECT id, judul FROM training_modules WHERE aktif = 1 ORDER BY urut, judul') : [[] as Row[]]
  return NextResponse.json({
    items: rows.map((x) => ({
      ...x, ukuran: x.ukuran === null ? null : Number(x.ukuran), tersembunyi: !!x.tersembunyi,
      link: materialLink(x),
      embed: x.drive_file_id ? `https://drive.google.com/file/d/${x.drive_file_id}/preview` : embedUrl(x.url as string | null),
    })),
    modules,
    can: { manage },
  })
})
