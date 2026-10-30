import type { RowDataPacket } from 'mysql2'
import { NextResponse } from 'next/server'
import { fail, handle, int, readJson, requireUser, str } from '@/lib/api'
import { db } from '@/lib/db'
import { canManageTraining, isVideoLink, kindOf, readTrainingFile, requireTraining } from '@/lib/training'

type Ctx = { params: Promise<{ mid: string }> }
type Material = RowDataPacket & { sumber: 'drive' | 'manual' | 'upload'; judul: string }

async function guard(ctx: Ctx) {
  const user = await requireUser()
  requireTraining(user)
  if (!canManageTraining(user)) fail(403, 'Materi training dikelola HRD.')
  const id = int((await ctx.params).mid) ?? fail(404, 'Materi tidak ditemukan.')
  const [[row]] = await db.query<Material[]>('SELECT sumber, judul FROM training_materials WHERE id = ?', [id])
  if (!row) fail(404, 'Materi tidak ditemukan.')
  return { id, row: row! }
}

// Ubah materi. File unggahan: judul dan/atau ganti file (multipart). Link: judul & url.
// Materi Drive: judul (tidak ditimpa sinkron) dan { tersembunyi }; isi file-nya tetap diubah di Google Drive.
export const PATCH = handle(async (request: Request, ctx: Ctx) => {
  const { id, row } = await guard(ctx)
  if ((request.headers.get('content-type') ?? '').includes('multipart/form-data')) {
    if (row.sumber !== 'upload') fail(400, 'Hanya materi berupa file unggahan yang bisa diganti filenya.')
    const form = await request.formData()
    const judul = str(form.get('judul'), 255)
    if (!judul) fail(400, 'Judul materi wajib diisi.')
    const file = form.get('file')
    if (file instanceof File && file.size) {
      const f = await readTrainingFile(file)
      await db.query('UPDATE training_materials SET judul = ?, jenis = ?, mime = ?, ukuran = ? WHERE id = ?', [judul, kindOf(f.name, f.mime), f.mime, f.size, id])
      await db.query('UPDATE training_material_files SET nama_file = ?, data = ? WHERE material_id = ?', [f.name, f.data, id])
    } else await db.query('UPDATE training_materials SET judul = ? WHERE id = ?', [judul, id])
    return NextResponse.json({ ok: true })
  }
  const body = await readJson(request)
  if ('tersembunyi' in body) {
    await db.query('UPDATE training_materials SET tersembunyi = ? WHERE id = ?', [body.tersembunyi ? 1 : 0, id])
    return NextResponse.json({ ok: true })
  }
  const judul = str(body.judul, 255)
  if (!judul) fail(400, 'Judul materi wajib diisi.')
  if (row.sumber === 'manual') {
    const url = str(body.url, 1000)
    if (!/^https?:\/\/\S+$/i.test(url)) fail(400, 'Isi link yang diawali http:// atau https://')
    await db.query('UPDATE training_materials SET judul = ?, url = ?, jenis = ? WHERE id = ?', [judul, url, isVideoLink(url) ? 'video' : 'link', id])
  } else await db.query('UPDATE training_materials SET judul = ?, judul_edited = 1 WHERE id = ?', [judul, id])
  return NextResponse.json({ ok: true })
})

// Hapus link / file unggahan (materi dari Drive disembunyikan, atau dihapus di folder Drive)
export const DELETE = handle(async (_request: Request, ctx: Ctx) => {
  const { id, row } = await guard(ctx)
  if (row.sumber === 'drive') fail(400, 'Materi ini dari folder Google Drive. Sembunyikan materinya, atau hapus file-nya di Drive lalu sinkron.')
  await db.query('DELETE FROM training_materials WHERE id = ?', [id])
  return NextResponse.json({ ok: true })
})
