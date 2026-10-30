import type { ResultSetHeader, RowDataPacket } from 'mysql2'
import { NextResponse } from 'next/server'
import { fail, handle, readJson, requireUser, str } from '@/lib/api'
import { db } from '@/lib/db'
import {
  canManageTraining, loadTrainingFolderUrl, readModuleInput, loadTrainingSync, recordTrainingSyncError, requireTraining, saveTrainingFolderUrl, syncTraining, TRAINING_STALE_HOURS,
} from '@/lib/training'

type Row = RowDataPacket & Record<string, unknown>
const isStale = (at: string | null) => !at || Date.now() - new Date(`${at.replace(' ', 'T')}+07:00`).getTime() > TRAINING_STALE_HOURS * 3600e3


// Daftar modul training. Materi Drive disinkron otomatis bila sudah lebih dari TRAINING_STALE_HOURS jam.
export const GET = handle(async () => {
  const user = await requireUser()
  requireTraining(user)
  const manage = canManageTraining(user)
  const folderUrl = await loadTrainingFolderUrl()
  let warning: string | null = null
  if (folderUrl && isStale((await loadTrainingSync()).at)) {
    try {
      await syncTraining()
    } catch (error) {
      warning = `Sinkron otomatis gagal: ${(error as Error).message}`
      await recordTrainingSyncError(warning)
    }
  }
  const [rows] = await db.query<Row[]>(
    `SELECT m.id, m.drive_folder_id IS NOT NULL AS dari_drive, m.judul, m.kategori, m.deskripsi, m.sasaran, m.wajib, m.durasi_menit, m.aktif, m.urut,
       (SELECT COUNT(*) FROM training_materials x WHERE x.module_id = m.id AND x.jenis = 'video') AS video,
       (SELECT COUNT(*) FROM training_materials x WHERE x.module_id = m.id AND x.jenis IN ('dokumen', 'link')) AS dokumen,
       (SELECT x.id FROM training_materials x WHERE x.module_id = m.id AND x.drive_file_id IS NOT NULL ORDER BY x.jenis = 'video' DESC, x.urut LIMIT 1) AS thumb_id,
       (SELECT COUNT(*) FROM training_participants p WHERE p.module_id = m.id) AS peserta,
       (SELECT COUNT(*) FROM training_participants p WHERE p.module_id = m.id AND p.status = 'selesai') AS selesai
     FROM training_modules m ${manage ? '' : 'WHERE m.aktif = 1'} ORDER BY m.aktif DESC, m.wajib DESC, m.urut, m.judul`,
  )
  const [divisi] = await db.query<Row[]>('SELECT DISTINCT divisi FROM employees WHERE divisi IS NOT NULL AND tgl_berhenti IS NULL ORDER BY divisi')
  return NextResponse.json({
    items: rows.map((r) => ({ ...r, dari_drive: !!r.dari_drive, wajib: !!r.wajib, aktif: !!r.aktif, video: Number(r.video), dokumen: Number(r.dokumen), peserta: Number(r.peserta), selesai: Number(r.selesai) })),
    divisi: divisi.map((d) => d.divisi),
    folderUrl: manage ? folderUrl : null,
    sync: await loadTrainingSync(),
    warning,
    can: { manage },
  })
})

// Modul manual (tanpa folder Drive), mis. training eksternal dengan link video saja
export const POST = handle(async (request: Request) => {
  const user = await requireUser()
  requireTraining(user)
  if (!canManageTraining(user)) fail(403, 'Modul training dikelola HRD.')
  const v = readModuleInput(await readJson(request))
  const [res] = await db.query<ResultSetHeader>(
    'INSERT INTO training_modules (judul, kategori, deskripsi, sasaran, wajib, durasi_menit, urut, created_by) VALUES (?, ?, ?, ?, ?, ?, 999, ?)',
    [v.judul, v.kategori, v.deskripsi, v.sasaran, v.wajib, v.durasi_menit, user.id],
  )
  return NextResponse.json({ id: res.insertId }, { status: 201 })
})

// Sinkron materi dari Drive sekarang
export const PUT = handle(async () => {
  const user = await requireUser()
  requireTraining(user)
  if (!canManageTraining(user)) fail(403, 'Sinkron training dilakukan HRD.')
  return NextResponse.json({ sync: await syncTraining() })
})

// Ganti link folder Drive Training lalu sinkron: { folder_url }
export const PATCH = handle(async (request: Request) => {
  const user = await requireUser()
  requireTraining(user)
  if (!canManageTraining(user)) fail(403, 'Folder training diatur HRD.')
  const url = str((await readJson(request)).folder_url, 1000)
  await saveTrainingFolderUrl(url, user.id)
  return NextResponse.json({ folderUrl: url, sync: url ? await syncTraining() : await loadTrainingSync() })
})
