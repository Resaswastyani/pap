import { NextResponse } from 'next/server'
import { fail, handle, int, readJson, requireUser } from '@/lib/api'
import { db } from '@/lib/db'
import { loadSetting, readSettingInput } from '@/lib/machine-settings'
import { canManageTeknik, requireTeknikMenu } from '@/lib/teknik'

type Ctx = { params: Promise<{ id: string }> }

async function editable(ctx: Ctx) {
  const user = await requireUser()
  requireTeknikMenu(user, 'standar-setting', 'Standar Setting')
  if (!canManageTeknik(user)) fail(403, 'Standar setting mesin diubah oleh divisi Teknik.')
  const setting = await loadSetting(int((await ctx.params).id) ?? fail(404, 'Parameter tidak ditemukan.'))
  return { user, setting }
}

export const PATCH = handle(async (request: Request, ctx: Ctx) => {
  const { user, setting } = await editable(ctx)
  const input = await readSettingInput({ ...(await readJson(request)), machine_id: setting.machine_id })
  await db.query(
    'UPDATE machine_settings SET produk = ?, parameter = ?, nilai = ?, satuan = ?, toleransi = ?, catatan = ?, updated_by = ? WHERE id = ?',
    [input.produk, input.parameter, input.nilai, input.satuan, input.toleransi, input.catatan, user.id, setting.id],
  )
  return NextResponse.json({ item: await loadSetting(setting.id) })
})

export const DELETE = handle(async (_request: Request, ctx: Ctx) => {
  const { setting } = await editable(ctx)
  await db.query('DELETE FROM machine_settings WHERE id = ?', [setting.id])
  return NextResponse.json({ ok: true })
})
