import { NextResponse } from 'next/server'
import { fail, handle, int, readJson, requireUser, str } from '@/lib/api'
import { accurateEnabled } from '@/lib/accurate'
import { canManageFormulations, canViewFormulations, loadFormulation, loadFormulations, PLASTIC_TYPES, readBomInput, readExtras, requireFormulations, saveBomToAccurate, saveExtras } from '@/lib/formulations'
import { canManageProduction } from '@/lib/production'
import type { RowDataPacket } from 'mysql2'
import { db } from '@/lib/db'

// Daftar formulasi (BOM Accurate): ?q= &status=aktif|arsip|semua &item=<accurate_id barang jadi, dicocokkan dulu> ; dipakai juga pilihan formulasi di SPK
export const GET = handle(async (request: Request) => {
  const user = await requireUser()
  if (!canViewFormulations(user) && !canManageProduction(user)) fail(403, 'Anda tidak punya akses ke menu Formulasi Produk.')
  const params = new URL(request.url).searchParams
  const items = await loadFormulations({ q: str(params.get('q'), 100), status: params.get('status') ?? 'aktif', itemAccurateId: int(params.get('item')) })
  const [[count]] = await db.query<(RowDataPacket & { total: number; synced: number })[]>(
    "SELECT COUNT(*) AS total, SUM(detail_synced_update IS NOT NULL) AS synced FROM accurate_boms",
  )
  return NextResponse.json({
    items, plasticTypes: PLASTIC_TYPES,
    bom: { total: Number(count.total), synced: Number(count.synced ?? 0) },
    can: { manage: canManageFormulations(user) && accurateEnabled() },
  })
})

// Formulasi baru: dibuat sebagai Bill of Material di Accurate, lalu data tambahan PPIC disimpan di PAP-MS
export const POST = handle(async (request: Request) => {
  const user = await requireUser()
  requireFormulations(user)
  if (!canManageFormulations(user)) fail(403, 'Formulasi produk dikelola PPIC.')
  const body = await readJson(request)
  const bomId = await saveBomToAccurate(await readBomInput(body))
  await saveExtras(bomId, readExtras(body), user.id)
  return NextResponse.json({ item: await loadFormulation(bomId) }, { status: 201 })
})
