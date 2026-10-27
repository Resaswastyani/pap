import type { RowDataPacket } from 'mysql2'
import { NextResponse } from 'next/server'
import { handle, readJson, requireUser } from '@/lib/api'
import { db } from '@/lib/db'
import { canManageGa, gaCreate, gaJenis, loadGaUrl, requireGaManage, requireGaView, syncGaIfStale } from '@/lib/ga'
import { gaGuard } from '@/lib/ga-guard'

export const maxDuration = 60

type Row = RowDataPacket & Record<string, unknown>
const json = (v: unknown) => (typeof v === 'string' ? JSON.parse(v) : v ?? {})

// Data GA: nomor HP, langganan, WiFi. Sinkron otomatis dari spreadsheet bila terakhir > 10 menit
export const GET = handle(async () => {
  const user = await requireUser()
  requireGaView(user)
  const syncError = await syncGaIfStale()
  const [phones] = await db.query<Row[]>('SELECT * FROM ga_phones ORDER BY COALESCE(no, 9999), sheet_row')
  const [subs] = await db.query<Row[]>('SELECT * FROM ga_subscriptions ORDER BY COALESCE(no, 9999), sheet_row')
  const [wifi] = await db.query<Row[]>('SELECT * FROM ga_wifi ORDER BY COALESCE(no, 9999), sheet_row')
  const [settings] = await db.query<Row[]>("SELECT `key`, value FROM app_settings WHERE `key` IN ('ga.synced_at', 'ga.meta')")
  const setting = (k: string) => settings.find((s) => s.key === k)?.value as string | undefined
  const num = (v: unknown) => (v === null || v === undefined ? null : Number(v))
  return NextResponse.json({
    hp: phones.map((p) => ({ ...p, pembayaran: json(p.pembayaran) })),
    langganan: subs.map((s) => ({ ...s, biaya: num(s.biaya) })),
    wifi: wifi.map((w) => ({ ...w, biaya: num(w.biaya), pembayaran: json(w.pembayaran) })),
    synced_at: setting('ga.synced_at') ?? null,
    tabs: setting('ga.meta') ? JSON.parse(setting('ga.meta')!).tabs : null,
    url: await loadGaUrl(),
    sync_error: syncError,
    can: { manage: canManageGa(user) },
  })
})

// Tambah: { jenis, ...isian } -> ditulis ke sheet lalu sinkron ulang
export const POST = handle(async (request: Request) => {
  const user = await requireUser()
  requireGaManage(user)
  const body = await readJson(request)
  const res = await gaGuard(() => gaCreate(gaJenis(body.jenis), body))
  return NextResponse.json({ ok: true, ...res })
})
