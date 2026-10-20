import { NextResponse } from 'next/server'
import { handle, requireUser, str } from '@/lib/api'
import { requireFormulations, searchItems } from '@/lib/formulations'

// Barang Accurate untuk form formulasi: ?kind=bahan (bertanda Bahan Baku) | jadi (bertanda Diproduksi) &q=
export const GET = handle(async (request: Request) => {
  const user = await requireUser()
  requireFormulations(user)
  const params = new URL(request.url).searchParams
  const kind = params.get('kind') === 'jadi' ? 'jadi' : 'bahan'
  const q = str(params.get('q'), 100)
  if (kind === 'jadi' && q.length < 2) return NextResponse.json({ items: [] })
  return NextResponse.json({ items: await searchItems(kind, q) })
})
