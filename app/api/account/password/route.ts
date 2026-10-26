import bcrypt from 'bcryptjs'
import type { RowDataPacket } from 'mysql2'
import { NextResponse } from 'next/server'
import { logUserActivity } from '@/lib/activity'
import { validPassword } from '@/lib/admin'
import { fail, handle, readJson, requireUser } from '@/lib/api'
import { db } from '@/lib/db'

// Ganti sandi akun sendiri (Pengaturan > Akun saya): wajib sandi lama. Lupa sandi tetap lewat Staff IT.
export const POST = handle(async (request: Request) => {
  const user = await requireUser()
  const body = await readJson(request)
  const current = typeof body.current === 'string' ? body.current : ''
  const password = validPassword(body.password)
  if (body.confirm !== password) fail(400, 'Konfirmasi sandi baru tidak sama.')
  if (!current) fail(400, 'Sandi lama wajib diisi.')
  if (current === password) fail(400, 'Sandi baru harus berbeda dari sandi lama.')
  const [[row]] = await db.query<(RowDataPacket & { password_hash: string; name: string; email: string })[]>('SELECT password_hash, name, email FROM users WHERE id = ?', [user.id])
  if (!row || !(await bcrypt.compare(current, row.password_hash))) fail(400, 'Sandi lama salah. Lupa sandi? Hubungi Staff IT.')
  await db.query('UPDATE users SET password_hash = ? WHERE id = ?', [await bcrypt.hash(password, 10), user.id])
  await logUserActivity(request, user, { action: 'password', target: { id: user.id, name: row.name, email: row.email }, description: 'Mengganti password akun sendiri (Pengaturan)' })
  return NextResponse.json({ ok: true })
})
