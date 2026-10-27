import { NextResponse } from 'next/server'
import { fail, handle, int, readJson, requireUser, str } from '@/lib/api'
import { gaDelete, gaJenis, gaSetPayment, gaUpdate, loadGaRow, requireGaManage } from '@/lib/ga'
import { gaGuard } from '@/lib/ga-guard'

export const maxDuration = 60

type Ctx = { params: Promise<{ id: string }> }

async function load(request: Request, ctx: Ctx) {
  const user = await requireUser()
  requireGaManage(user)
  const jenis = gaJenis(new URL(request.url).searchParams.get('jenis'))
  const id = int((await ctx.params).id) ?? fail(404, 'Data tidak ditemukan.')
  return { jenis, old: await loadGaRow(jenis, id) }
}

// Ubah isian, atau { bayar: { bulan: 'YYYY-MM', lunas: true } } untuk status bayar bulanan (HP & WiFi)
export const PATCH = handle(async (request: Request, ctx: Ctx) => {
  const { jenis, old } = await load(request, ctx)
  const body = await readJson(request)
  const bayar = body.bayar as { bulan?: unknown; lunas?: unknown } | undefined
  if (bayar) {
    if (jenis === 'langganan') fail(400, 'Status bayar bulanan hanya untuk Nomor HP dan WiFi.')
    const res = await gaGuard(() => gaSetPayment(jenis as 'hp' | 'wifi', old, str(bayar.bulan, 7), !!bayar.lunas))
    return NextResponse.json({ ok: true, ...res })
  }
  const res = await gaGuard(() => gaUpdate(jenis, old, body))
  return NextResponse.json({ ok: true, ...res })
})

export const DELETE = handle(async (request: Request, ctx: Ctx) => {
  const { jenis, old } = await load(request, ctx)
  const res = await gaGuard(() => gaDelete(jenis, old))
  return NextResponse.json({ ok: true, ...res })
})
