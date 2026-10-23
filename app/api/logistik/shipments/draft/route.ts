import { NextResponse } from 'next/server'
import { handle, requireUser } from '@/lib/api'
import { draftFromSo, requireLogistik } from '@/lib/logistik'

// Isi awal pengiriman dari SO Accurate: ?so=1,2,3 (customer yang sama)
export const GET = handle(async (request: Request) => {
  const user = await requireUser()
  requireLogistik(user, 'pengiriman')
  const ids = (new URL(request.url).searchParams.get('so') ?? '').split(',').map(Number).filter((x) => Number.isInteger(x) && x > 0)
  return NextResponse.json({ draft: await draftFromSo(ids) })
})
