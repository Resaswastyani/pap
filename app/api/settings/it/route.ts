import { NextResponse } from 'next/server'
import { fail, handle, readJson, requireUser } from '@/lib/api'
import { logActivity } from '@/lib/activity'
import { CRON_JOBS } from '@/lib/cron-log'
import { canSeeIt, itStatus, runCron, testAi, testDatabase, testGoogle, testRecaptcha } from '@/lib/it-status'
import { saveAiKey, type AiProvider } from '@/lib/ai-providers'

export const maxDuration = 120

// Pengaturan › IT: status server, cron, Google Cloud, reCAPTCHA (Super Admin / admin / Staff IT)
export const GET = handle(async () => {
  const user = await requireUser()
  if (!canSeeIt(user)) fail(403, 'Halaman IT hanya untuk Super Admin / Staff IT.')
  return NextResponse.json(await itStatus())
})

// Aksi: { action: 'cron', name } | { action: 'test', target: 'google' | 'recaptcha' | 'database' }
export const POST = handle(async (request: Request) => {
  const user = await requireUser()
  if (!canSeeIt(user)) fail(403, 'Halaman IT hanya untuk Super Admin / Staff IT.')
  const body = await readJson(request)
  let result: { ok: boolean; message: string }
  if (body.action === 'cron') {
    const job = CRON_JOBS.find((j) => j.name === body.name) ?? fail(400, 'Cron tidak dikenal.')
    result = await runCron(job.name)
    await logActivity(request, user, { module: 'Pengaturan IT', action: 'update', entity: null, description: `Menjalankan cron ${job.label} secara manual: ${result.message}` })
  } else if (body.action === 'ai') {
    // Simpan / hapus kunci API dan model AI (nilai kunci tidak pernah dikembalikan ke browser)
    const p = String(body.provider) as AiProvider
    await saveAiKey(p, typeof body.key === 'string' ? body.key : null, typeof body.model === 'string' ? body.model : null, user.id)
    await logActivity(request, user, { module: 'Pengaturan IT', action: 'update', entity: null, description: `Mengubah pengaturan PAP AI (${p})` })
    result = { ok: true, message: 'Pengaturan PAP AI tersimpan.' }
  } else if (body.action === 'test' && String(body.target).startsWith('ai-')) {
    result = await testAi(String(body.target).slice(3) as AiProvider)
  } else if (body.action === 'test') {
    const run = { google: testGoogle, recaptcha: testRecaptcha, database: testDatabase }[String(body.target) as 'google' | 'recaptcha' | 'database'] ?? fail(400, 'Uji tidak dikenal.')
    result = await run().catch((e: Error) => ({ ok: false, message: e.message }))
  } else fail(400, 'Aksi tidak dikenal.')
  return NextResponse.json(result!)
})
