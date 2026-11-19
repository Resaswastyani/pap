import { db } from '@/lib/db'

// Catatan eksekusi cron (dipanggil cron-job.org / penjadwal) untuk dipantau di Pengaturan › IT.
// Disimpan di app_settings: cron.<nama>.last = { at, ok, status, ms, detail }
export const CRON_JOBS = [
  { name: 'reminders', label: 'Reminder meeting & jadwal', every: 1, note: 'Setiap 1 menit: reminder 15 menit sebelum meeting ke HP.' },
  { name: 'accurate-sync', label: 'Sinkron Accurate', every: 15, note: 'Setiap 15 menit: customer, faktur, SO, produk, stok.' },
  { name: 'drive-sync', label: 'Sinkron Google Drive & Sheets', every: 30, note: 'Setiap 30 menit: folder desain, kerusakan & perawatan mesin, HRD, GA.' },
] as const
export type CronName = (typeof CRON_JOBS)[number]['name']

export type CronRun = { at: string; ok: boolean; status: number; ms: number; detail: string | null; manual?: boolean }

export async function recordCron(name: CronName, run: Omit<CronRun, 'at'>) {
  const value: CronRun = { ...run, at: new Date().toISOString(), detail: run.detail ? run.detail.slice(0, 300) : null }
  await db.query('INSERT INTO app_settings (`key`, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)', [`cron.${name}.last`, JSON.stringify(value)]).catch(() => {})
  // Riwayat: 10 panggilan terakhir (terbaru di depan)
  try {
    const [[row]] = await db.query<import('mysql2').RowDataPacket[]>('SELECT value FROM app_settings WHERE `key` = ?', [`cron.${name}.history`])
    const list = [value, ...((row?.value ? JSON.parse(String(row.value)) : []) as CronRun[])].slice(0, 10)
    await db.query('INSERT INTO app_settings (`key`, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)', [`cron.${name}.history`, JSON.stringify(list)])
  } catch {}
}

// Bungkus handler cron: catat hasil (termasuk ditolak 401) tanpa mengubah respons
export async function withCronLog(name: CronName, request: Request, run: () => Promise<Response>) {
  const started = Date.now()
  const manual = request.headers.get('x-pap-manual') === '1'
  let res: Response
  try {
    res = await run()
  } catch (error) {
    await recordCron(name, { ok: false, status: 500, ms: Date.now() - started, detail: (error as Error).message, manual })
    throw error
  }
  let detail: string | null = null
  let ok = res.ok
  try {
    const body = await res.clone().json()
    if (body && body.ok === false) ok = false
    detail = body?.error ? String(body.error) : res.status === 200 ? summarize(body) : null
  } catch {}
  await recordCron(name, { ok, status: res.status, ms: Date.now() - started, detail, manual })
  return res
}

const summarize = (body: Record<string, unknown>) => {
  if (typeof body?.reminders === 'number') return `${body.reminders} reminder dibuat`
  return null
}

export async function cronStatus() {
  const [rows] = await db.query<import('mysql2').RowDataPacket[]>('SELECT `key`, value FROM app_settings WHERE `key` LIKE ? OR `key` LIKE ?', ['cron.%.last', 'cron.%.history'])
  const byName = new Map(rows.filter((r) => String(r.key).endsWith('.last')).map((r) => [String(r.key).slice(5, -5), r.value as string]))
  const historyOf = (name: string) => {
    try { return JSON.parse(String(rows.find((r) => r.key === `cron.${name}.history`)?.value ?? '[]')) as CronRun[] } catch { return [] }
  }
  return CRON_JOBS.map((job) => {
    let last: CronRun | null = null
    try { last = byName.get(job.name) ? JSON.parse(byName.get(job.name)!) : null } catch {}
    const ageMin = last ? (Date.now() - Date.parse(last.at)) / 60_000 : null
    // Sehat bila panggilan terakhir sukses dan tidak lebih lama dari 3x jadwalnya (min. 5 menit)
    const health = !last ? 'unknown' : !last.ok ? 'error' : ageMin! > Math.max(job.every * 3, 5) ? 'stale' : 'ok'
    return { ...job, last, health, history: historyOf(job.name) }
  })
}
