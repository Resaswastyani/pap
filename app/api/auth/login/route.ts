import bcrypt from 'bcryptjs'
import { NextResponse } from 'next/server'
import { createSession } from '@/lib/auth'
import { db } from '@/lib/db'
import { findUserByEmail, toProfile } from '@/lib/users'

export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : ''
  const password = typeof body?.password === 'string' ? body.password : ''
  if (!email || !password) return NextResponse.json({ error: 'Email dan password wajib diisi.' }, { status: 400 })

  try {
    const user = await findUserByEmail(email)
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return NextResponse.json({ error: 'Email atau password salah.' }, { status: 401 })
    }
    if (!user.is_active) return NextResponse.json({ error: 'Akun dinonaktifkan. Hubungi admin.' }, { status: 403 })

    await db.query('UPDATE users SET last_login_at = NOW() WHERE id = ?', [user.id])
    await createSession({ id: user.id })
    return NextResponse.json({ user: await toProfile(user) })
  } catch (error) {
    console.error('[auth/login]', error)
    return NextResponse.json({ error: dbErrorMessage(error) }, { status: 500 })
  }
}

// Pesan yang menjelaskan penyebab umum gagal koneksi ke MySQL Hostinger
function dbErrorMessage(error: unknown) {
  const code = (error as { code?: string })?.code
  switch (code) {
    case 'ENOTFOUND':
    case 'EAI_AGAIN':
      return 'Host database tidak ditemukan. Periksa DB_HOST di .env.local.'
    case 'ETIMEDOUT':
    case 'ECONNREFUSED':
      return 'Koneksi ke database ditolak/timeout. Pastikan Remote MySQL di hPanel sudah mengizinkan IP ini.'
    case 'ER_ACCESS_DENIED_ERROR':
    case 'ER_DBACCESS_DENIED_ERROR':
      return 'Akses database ditolak. Periksa DB_USER, DB_PASSWORD, dan izin Remote MySQL.'
    case 'ER_BAD_DB_ERROR':
      return 'Database tidak ditemukan. Periksa DB_NAME.'
    case 'ER_NO_SUCH_TABLE':
      return 'Tabel users belum ada. Import db/schema.sql lewat phpMyAdmin.'
    default:
      return 'Tidak dapat terhubung ke database.'
  }
}
