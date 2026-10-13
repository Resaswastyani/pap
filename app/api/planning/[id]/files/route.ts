import type { ResultSetHeader } from 'mysql2'
import { NextResponse } from 'next/server'
import { fail, handle, int, readJson, requireUser, str } from '@/lib/api'
import { db } from '@/lib/db'
import { FILE_ACCEPT, FILE_MAX_BYTES, PERMISSIONS } from '@/lib/permissions'
import { loadFiles, loadPlanning, planningAbilities } from '@/lib/planning'

type Ctx = { params: Promise<{ id: string }> }

// Tambah lampiran: multipart (field "file") untuk upload, atau JSON { name, url } untuk link
export const POST = handle(async (request: Request, ctx: Ctx) => {
  const user = await requireUser(PERMISSIONS.planningView)
  const row = await loadPlanning(user, int((await ctx.params).id) ?? fail(404, 'Planning tidak ditemukan.'))
  if (!planningAbilities(user, row).attach) fail(403, 'Anda tidak dapat menambah lampiran pada planning ini.')

  if ((request.headers.get('content-type') ?? '').startsWith('multipart/form-data')) {
    const form = await request.formData().catch(() => fail(400, 'Upload tidak valid.'))
    const file = form.get('file')
    if (!(file instanceof File) || !file.size) fail(400, 'File wajib dipilih.')
    const upload = file as File
    if (!(upload.type in FILE_ACCEPT)) fail(400, 'Format file harus gambar (JPG/PNG/WEBP/GIF), PDF, atau Word.')
    if (upload.size > FILE_MAX_BYTES) fail(400, 'Ukuran file maksimal 5 MB.')
    await db.query<ResultSetHeader>(
      "INSERT INTO planning_files (planning_id, type, name, mime, size, data, uploaded_by) VALUES (?, 'file', ?, ?, ?, ?, ?)",
      [row.id, upload.name.slice(0, 255), upload.type, upload.size, Buffer.from(await upload.arrayBuffer()), user.id],
    )
  } else {
    const body = await readJson(request)
    const url = str(body.url, 1000)
    let parsed: URL | null = null
    try {
      parsed = new URL(url)
    } catch {}
    if (!parsed || !['http:', 'https:'].includes(parsed.protocol)) fail(400, 'Link harus diawali http:// atau https://')
    await db.query("INSERT INTO planning_files (planning_id, type, name, url, uploaded_by) VALUES (?, 'link', ?, ?, ?)", [
      row.id,
      str(body.name, 255) || parsed!.hostname,
      url,
      user.id,
    ])
  }
  return NextResponse.json({ files: await loadFiles(row.id) }, { status: 201 })
})
