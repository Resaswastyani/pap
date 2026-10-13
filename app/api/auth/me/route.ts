import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/users'

export async function GET() {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ user: null }, { status: 401 })
    return NextResponse.json({ user })
  } catch (error) {
    console.error('[auth/me]', error)
    return NextResponse.json({ user: null, error: 'Tidak dapat terhubung ke database.' }, { status: 500 })
  }
}
