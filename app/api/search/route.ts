import { NextResponse } from 'next/server'
import { handle, requireUser } from '@/lib/api'
import { globalSearch } from '@/lib/global-search'

// Pencarian global header: ?q= (min. 2 huruf), hanya dari menu yang boleh dibuka user
export const GET = handle(async (request: Request) => {
  const user = await requireUser()
  const q = (new URL(request.url).searchParams.get('q') ?? '').trim().slice(0, 80)
  if (q.length < 2) return NextResponse.json({ items: [] })
  return NextResponse.json({ items: await globalSearch(user, q) })
})
