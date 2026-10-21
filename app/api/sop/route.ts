import type { RowDataPacket } from 'mysql2'
import { NextResponse } from 'next/server'
import { fail, handle, readJson, requireUser, str } from '@/lib/api'
import { db } from '@/lib/db'
import { loadSopFolderUrl, loadSyncInfo, recordSyncError, saveSopFolderUrl, SOP_KATEGORI, SOP_STALE_HOURS, syncSop } from '@/lib/sop'
import { canManageTeknik, requireTeknikMenu } from '@/lib/teknik'

const SELECT = 'SELECT id, drive_file_id, judul, nama_file, folder, mime, ukuran, diubah_drive, kategori, lini, kategori_manual, synced_at FROM sop_videos ORDER BY urut, judul'
const isStale = (at: string | null) => !at || Date.now() - new Date(`${at.replace(' ', 'T')}+07:00`).getTime() > SOP_STALE_HOURS * 3600e3

// Daftar video SOP. Data disinkron otomatis bila sudah lebih dari SOP_STALE_HOURS jam.
export const GET = handle(async () => {
  const user = await requireUser()
  requireTeknikMenu(user, 'sop-mesin', 'SOP Mesin')
  let warning: string | null = null
  if (isStale((await loadSyncInfo()).at)) {
    try {
      await syncSop()
    } catch (error) {
      warning = `Sinkron otomatis gagal: ${(error as Error).message}`
      await recordSyncError(warning)
    }
  }
  const [rows] = await db.query<RowDataPacket[]>(SELECT)
  return NextResponse.json({
    items: rows.map((r) => ({ ...r, kategori_manual: !!r.kategori_manual, ukuran: r.ukuran === null ? null : Number(r.ukuran) })),
    folderUrl: await loadSopFolderUrl(),
    sync: await loadSyncInfo(),
    warning,
    kategori: SOP_KATEGORI,
    can: { manage: canManageTeknik(user) },
  })
})

// Sinkron sekarang (Teknik)
export const POST = handle(async () => {
  const user = await requireUser()
  requireTeknikMenu(user, 'sop-mesin', 'SOP Mesin')
  if (!canManageTeknik(user)) fail(403, 'Sinkron SOP dilakukan oleh divisi Teknik.')
  return NextResponse.json({ sync: await syncSop() })
})

// Ganti link folder SOP lalu sinkron: { folder_url }
export const PATCH = handle(async (request: Request) => {
  const user = await requireUser()
  requireTeknikMenu(user, 'sop-mesin', 'SOP Mesin')
  if (!canManageTeknik(user)) fail(403, 'Folder SOP diatur oleh divisi Teknik.')
  const url = str((await readJson(request)).folder_url, 1000)
  await saveSopFolderUrl(url, user.id)
  return NextResponse.json({ folderUrl: url, sync: await syncSop() })
})
