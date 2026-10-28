import type { RowDataPacket } from 'mysql2'
import { NextResponse } from 'next/server'
import { fail, handle, int, readJson, requireUser } from '@/lib/api'
import { db } from '@/lib/db'
import { canManageTraining, embedUrl, readModuleInput, requireTraining } from '@/lib/training'
import { softDelete } from '@/lib/recycle-bin'

type Row = RowDataPacket & Record<string, unknown>
type Ctx = { params: Promise<{ id: string }> }
const moduleId = async (ctx: Ctx) => int((await ctx.params).id) ?? fail(404, 'Modul training tidak ditemukan.')

// Detail modul: materi (video dapat diputar), peserta & pilihan karyawan (untuk HRD)
export const GET = handle(async (_request: Request, ctx: Ctx) => {
  const user = await requireUser()
  requireTraining(user)
  const manage = canManageTraining(user)
  const id = await moduleId(ctx)
  const [[m]] = await db.query<Row[]>('SELECT *, drive_folder_id IS NOT NULL AS dari_drive FROM training_modules WHERE id = ?', [id])
  if (!m || (!m.aktif && !manage)) fail(404, 'Modul training tidak ditemukan.')
  const [materials] = await db.query<Row[]>(
    'SELECT id, sumber, drive_file_id, judul, jenis, url, mime, ukuran, folder FROM training_materials WHERE module_id = ? ORDER BY sumber, urut, id', [id],
  )
  const [participants] = await db.query<Row[]>(
    `SELECT p.id, p.employee_id, e.nama, e.nip, e.divisi, e.jabatan, p.status, p.tanggal, p.nilai, p.catatan, p.updated_at, u.name AS updated_name
     FROM training_participants p JOIN employees e ON e.id = p.employee_id LEFT JOIN users u ON u.id = p.updated_by
     WHERE p.module_id = ? ORDER BY FIELD(p.status, 'terdaftar', 'tidak_lulus', 'selesai'), e.nama`,
    [id],
  )
  const [employees] = manage
    ? await db.query<Row[]>('SELECT id, nama, nip, divisi, jabatan FROM employees WHERE tgl_berhenti IS NULL AND status_karyawan NOT LIKE "%resign%" ORDER BY nama')
    : [[] as Row[]]
  return NextResponse.json({
    item: { ...m, dari_drive: !!m.dari_drive, wajib: !!m.wajib, aktif: !!m.aktif },
    materials: materials.map((x) => {
      const link = x.drive_file_id ? `https://drive.google.com/file/d/${x.drive_file_id}/view` : (x.url as string | null)
      const embed = x.jenis === 'dokumen' ? null : x.drive_file_id ? `https://drive.google.com/file/d/${x.drive_file_id}/preview` : embedUrl(x.url as string | null)
      return { ...x, ukuran: x.ukuran === null ? null : Number(x.ukuran), link, embed }
    }),
    // Peserta: HRD melihat semua; selain HRD hanya ringkasan
    participants: manage ? participants.map((p) => ({ ...p, nilai: p.nilai === null ? null : Number(p.nilai) })) : [],
    summary: { peserta: participants.length, selesai: participants.filter((p) => p.status === 'selesai').length },
    employees,
    can: { manage },
  })
})

export const PATCH = handle(async (request: Request, ctx: Ctx) => {
  const user = await requireUser()
  requireTraining(user)
  if (!canManageTraining(user)) fail(403, 'Modul training dikelola HRD.')
  const id = await moduleId(ctx)
  const body = await readJson(request)
  // { aktif } saja: tampilkan / sembunyikan modul
  if (Object.keys(body).length === 1 && 'aktif' in body) {
    await db.query('UPDATE training_modules SET aktif = ? WHERE id = ?', [body.aktif ? 1 : 0, id])
    return NextResponse.json({ ok: true })
  }
  const v = readModuleInput(body)
  // Judul modul dari Drive mengikuti nama subfolder (diubah di Drive)
  await db.query(
    'UPDATE training_modules SET judul = IF(drive_folder_id IS NULL, ?, judul), kategori = ?, deskripsi = ?, sasaran = ?, wajib = ?, durasi_menit = ? WHERE id = ?',
    [v.judul, v.kategori, v.deskripsi, v.sasaran, v.wajib, v.durasi_menit, id],
  )
  return NextResponse.json({ ok: true })
})

// Modul manual dihapus; modul dari Drive disembunyikan (muncul lagi bila subfolder masih ada saat sinkron)
export const DELETE = handle(async (_request: Request, ctx: Ctx) => {
  const user = await requireUser()
  requireTraining(user)
  if (!canManageTraining(user)) fail(403, 'Modul training dikelola HRD.')
  const id = await moduleId(ctx)
  const [[m]] = await db.query<Row[]>('SELECT drive_folder_id FROM training_modules WHERE id = ?', [id])
  if (!m) fail(404, 'Modul training tidak ditemukan.')
  if (m.drive_folder_id) fail(400, 'Modul ini dari folder Google Drive. Hapus / pindahkan subfoldernya di Drive, atau sembunyikan modul.')
  await softDelete({ table: 'training_modules', id, modul: 'Training', user })
  return NextResponse.json({ ok: true })
})
