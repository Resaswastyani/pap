import { NextResponse } from 'next/server'
import { fail, handle, int, requireUser } from '@/lib/api'
import { canManageProduct } from '@/lib/customers'
import { db } from '@/lib/db'
import { loadProduct, loadProductFiles, validProductFile } from '@/lib/products'

type Ctx = { params: Promise<{ id: string }> }

// Upload desain produk (multipart, field "files", bisa lebih dari satu)
export const POST = handle(async (request: Request, ctx: Ctx) => {
  const user = await requireUser()
  if (!canManageProduct(user)) fail(403, 'Anda tidak punya akses untuk mengunggah desain.')
  const item = await loadProduct(int((await ctx.params).id) ?? fail(404, 'Produk tidak ditemukan.'))
  const form = await request.formData().catch(() => fail(400, 'Data upload tidak valid.'))
  const files = form.getAll('files').filter((value) => value instanceof File && value.size).map(validProductFile)
  if (!files.length) fail(400, 'Pilih minimal satu file.')
  for (const file of files) {
    await db.query('INSERT INTO customer_product_files (product_id, name, mime, size, data, uploaded_by) VALUES (?, ?, ?, ?, ?, ?)', [
      item.id,
      file.name.slice(0, 255),
      file.type,
      file.size,
      Buffer.from(await file.arrayBuffer()),
      user.id,
    ])
  }
  await db.query('UPDATE customer_products SET updated_by = ?, updated_at = NOW() WHERE id = ?', [user.id, item.id])
  return NextResponse.json({ files: await loadProductFiles(item.id) }, { status: 201 })
})
