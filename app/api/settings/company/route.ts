import { NextResponse } from 'next/server'
import { fail, handle, readJson, requireUser } from '@/lib/api'
import { DOC_KEYS, loadSettings, saveSettings } from '@/lib/hpp'
import { isManagement } from '@/lib/users'

// Profil perusahaan & data dokumen (kop surat penawaran, SO, proforma, cetak): Pengaturan, khusus Admin / GM
export const GET = handle(async () => {
  const user = await requireUser()
  if (!isManagement(user)) fail(403, 'Pengaturan perusahaan hanya untuk Admin / GM.')
  return NextResponse.json({ doc: await loadSettings('doc.') })
})

export const PATCH = handle(async (request: Request) => {
  const user = await requireUser()
  if (!isManagement(user)) fail(403, 'Pengaturan perusahaan hanya untuk Admin / GM.')
  const body = await readJson(request)
  await saveSettings('doc.', body, DOC_KEYS, user.id)
  return NextResponse.json({ doc: await loadSettings('doc.') })
})
