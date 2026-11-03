import { NextResponse } from 'next/server'
import { logUserActivity } from '@/lib/activity'
import { fail, handle, requireUser } from '@/lib/api'
import { db } from '@/lib/db'

// Foto profil akun sendiri: semua user boleh mengganti / menghapus. Gambar sudah dipotong & dikompres di browser.
const AVATAR_MAX_BYTES = 1024 * 1024
const AVATAR_TYPES = ['image/jpeg', 'image/png', 'image/webp']

export const POST = handle(async (request: Request) => {
  const user = await requireUser()
  const form = await request.formData().catch(() => fail(400, 'Data upload tidak valid.'))
  const file = form.get('file')
  if (!(file instanceof File) || !file.size) fail(400, 'Pilih foto terlebih dahulu.')
  const photo = file as File
  if (!AVATAR_TYPES.includes(photo.type)) fail(400, 'Foto profil harus berupa gambar JPG, PNG, atau WEBP.')
  if (photo.size > AVATAR_MAX_BYTES) fail(400, 'Ukuran foto profil maksimal 1 MB.')
  await db.query(
    'INSERT INTO user_avatars (user_id, data, mime) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE data = VALUES(data), mime = VALUES(mime), updated_at = CURRENT_TIMESTAMP',
    [user.id, Buffer.from(await photo.arrayBuffer()), photo.type],
  )
  await logUserActivity(request, user, { action: 'update', target: { id: user.id, name: user.name, email: user.email }, description: 'Mengganti foto profil (Pengaturan)' })
  return NextResponse.json({ ok: true })
})

export const DELETE = handle(async (request: Request) => {
  const user = await requireUser()
  await db.query('DELETE FROM user_avatars WHERE user_id = ?', [user.id])
  await logUserActivity(request, user, { action: 'delete', target: { id: user.id, name: user.name, email: user.email }, description: 'Menghapus foto profil (Pengaturan)' })
  return NextResponse.json({ ok: true })
})
