import type { ResultSetHeader, RowDataPacket } from 'mysql2'
import { NextResponse } from 'next/server'
import { fail, handle, int, readJson, requireUser, str } from '@/lib/api'
import { db } from '@/lib/db'
import { canManageTraining, isVideoLink, kindOf, readTrainingFile, requireTraining } from '@/lib/training'

type Ctx = { params: Promise<{ id: string }> }

// Tambah materi: link { judul, url } (YouTube / Google Drive / Vimeo diputar di SIMPAP; link lain dibuka di tab baru)
// atau file (multipart: file, judul) yang disimpan di SIMPAP
export const POST = handle(async (request: Request, ctx: Ctx) => {
  const user = await requireUser()
  requireTraining(user)
  if (!canManageTraining(user)) fail(403, 'Materi training dikelola HRD.')
  const id = int((await ctx.params).id) ?? fail(404, 'Modul training tidak ditemukan.')
  const [[mod]] = await db.query<RowDataPacket[]>('SELECT id FROM training_modules WHERE id = ?', [id])
  if (!mod) fail(404, 'Modul training tidak ditemukan.')
  if ((request.headers.get('content-type') ?? '').includes('multipart/form-data')) {
    const form = await request.formData()
    const f = await readTrainingFile(form.get('file'))
    const judul = str(form.get('judul'), 255) || f.name.replace(/\.[a-z0-9]{2,5}$/i, '').slice(0, 255)
    const conn = await db.getConnection()
    try {
      await conn.beginTransaction()
      const [res] = await conn.query<ResultSetHeader>(
        "INSERT INTO training_materials (module_id, sumber, judul, jenis, mime, ukuran, urut, created_by) VALUES (?, 'upload', ?, ?, ?, ?, 999, ?)",
        [id, judul, kindOf(f.name, f.mime), f.mime, f.size, user.id],
      )
      await conn.query('INSERT INTO training_material_files (material_id, nama_file, data) VALUES (?, ?, ?)', [res.insertId, f.name, f.data])
      await conn.commit()
      return NextResponse.json({ ok: true, id: res.insertId }, { status: 201 })
    } catch (error) {
      await conn.rollback()
      throw error
    } finally {
      conn.release()
    }
  }
  const body = await readJson(request)
  const url = str(body.url, 1000)
  if (!/^https?:\/\/\S+$/i.test(url)) fail(400, 'Isi link yang diawali http:// atau https://')
  const judul = str(body.judul, 255) || url.replace(/^https?:\/\/(www\.)?/, '').slice(0, 80)
  await db.query(
    "INSERT INTO training_materials (module_id, sumber, judul, jenis, url, urut, created_by) VALUES (?, 'manual', ?, ?, ?, 999, ?)",
    [id, judul, isVideoLink(url) ? 'video' : 'link', url, user.id],
  )
  return NextResponse.json({ ok: true }, { status: 201 })
})
