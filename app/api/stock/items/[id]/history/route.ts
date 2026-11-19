import { NextResponse } from 'next/server'
import { fail, handle, int, requireUser } from '@/lib/api'
import { requireMenu } from '@/lib/customers'
import { itemHistory } from '@/lib/stock-history'

type Ctx = { params: Promise<{ id: string }> }

// Riwayat stok satu barang per tanggal (60 hari terakhir yang tercatat)
export const GET = handle(async (_request: Request, ctx: Ctx) => {
  const user = await requireUser()
  requireMenu(user, user.menus.includes('stok'))
  const id = int((await ctx.params).id) ?? fail(404, 'Barang tidak ditemukan.')
  return NextResponse.json({ items: await itemHistory(id) })
})
