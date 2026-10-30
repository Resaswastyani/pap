import { NextResponse } from 'next/server'
import { fail, handle, readJson, requireUser } from '@/lib/api'
import { canManageHr } from '@/lib/hrd'
import { assignJobdesk } from '@/lib/jobdesk'

// Pasang jobdesk ke karyawan: { nip, job_description_id } (kosong = lepas)
export const POST = handle(async (request: Request) => {
  const user = await requireUser()
  if (!canManageHr(user)) fail(403, 'Jobdesk dikelola HRD.')
  await assignJobdesk(await readJson(request), user.id)
  return NextResponse.json({ ok: true })
})
