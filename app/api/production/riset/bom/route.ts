import { NextResponse } from 'next/server'
import { fail, handle, int, requireUser } from '@/lib/api'
import { requireMenu } from '@/lib/customers'
import { bomComposition } from '@/lib/material-projection'
import { canViewProduction } from '@/lib/production'

// Komposisi bahan dari BOM Accurate terbaru sebuah produk: ?item=<accurate id>
export const GET = handle(async (request: Request) => {
  const user = await requireUser()
  requireMenu(user, canViewProduction(user))
  const item = int(new URL(request.url).searchParams.get('item')) ?? fail(400, 'Pilih produk Accurate.')
  return NextResponse.json(await bomComposition(item))
})
