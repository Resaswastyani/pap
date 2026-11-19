import { NextResponse } from 'next/server'
import { handle, requireUser, str } from '@/lib/api'
import { requireMenu } from '@/lib/customers'
import { searchMaterials } from '@/lib/material-projection'
import { canViewProduction } from '@/lib/production'

// Pilihan bahan komposisi (biji plastik & bahan BOM Accurate) dengan harga terkini: ?q=
export const GET = handle(async (request: Request) => {
  const user = await requireUser()
  requireMenu(user, canViewProduction(user))
  return NextResponse.json({ items: await searchMaterials(str(new URL(request.url).searchParams.get('q'), 100)) })
})
