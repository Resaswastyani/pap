import { NextResponse } from 'next/server'
import { fail, handle, readJson, requireUser } from '@/lib/api'
import { canEditHppParams, canEditPrices, DOC_KEYS, loadHppParams, loadMaterials, loadSettings, requireHpp, saveSettings } from '@/lib/hpp'
import { HPP_PARAM_KEYS } from '@/lib/hpp-calc'

// Tabel HPP: harga bahan baku, parameter biaya, dan data perusahaan untuk dokumen penawaran
export const GET = handle(async () => {
  const user = await requireUser()
  requireHpp(user)
  const [materials, params, doc] = await Promise.all([loadMaterials(), loadHppParams(), loadSettings('doc.')])
  return NextResponse.json({ materials, params, doc, canEditPrices: canEditPrices(user), canEditParams: canEditHppParams(user) })
})

// Simpan parameter biaya (hpp) dan/atau data dokumen (doc): Admin / GM
export const PATCH = handle(async (request: Request) => {
  const user = await requireUser()
  requireHpp(user)
  if (!canEditHppParams(user)) fail(403, 'Hanya Admin / GM yang dapat mengubah parameter HPP & data dokumen.')
  const body = await readJson(request)
  if (body.params && typeof body.params === 'object') await saveSettings('hpp.', body.params as Record<string, unknown>, HPP_PARAM_KEYS, user.id)
  if (body.doc && typeof body.doc === 'object') await saveSettings('doc.', body.doc as Record<string, unknown>, DOC_KEYS, user.id)
  return NextResponse.json({ ok: true })
})
