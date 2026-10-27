import type { RowDataPacket } from 'mysql2'
import { NextResponse } from 'next/server'
import { fail, handle, requireUser } from '@/lib/api'
import { accurateEnabled } from '@/lib/accurate'
import { syncStatus } from '@/lib/accurate-sync'
import { db } from '@/lib/db'
import { driveAccount, oauthConfigured } from '@/lib/drive'
import { isManagement } from '@/lib/users'

type Row = RowDataPacket & Record<string, unknown>

// Sumber data Google Drive per modul. sync = endpoint POST tanpa isi untuk sinkron dari Pengaturan;
// tanpa sync = diatur & disinkron dari menunya (punya pilihan tambahan di sana).
const SOURCES = [
  { key: 'konten.sheet_url', label: 'Kalender Konten', menu: 'Kalender Konten', jenis: 'sheet', sync: '/api/content/sheet', synced: null },
  { key: 'jadwal_shift.sheet_url', label: 'Jadwal Shift', menu: 'Jadwal Shift', jenis: 'sheet', sync: '/api/shift-schedule/sheet', synced: null },
  { key: 'teknis.sheet_url', label: 'Mapping Teknis Mesin (Data Mesin)', menu: 'Data Mesin', jenis: 'sheet', sync: '/api/machines/sheet', synced: null },
  { key: 'kerusakan_mesin.sheet_url', label: 'Laporan Kerusakan Mesin', menu: 'Kerusakan Mesin', jenis: 'sheet', sync: '/api/repairs/log/sheet', synced: 'kerusakan_mesin.synced_at' },
  { key: 'perawatan.sheet_url', label: 'Lembar Perawatan Mesin', menu: 'Perawatan Mesin', jenis: 'sheet', sync: '/api/maintenance/sheet', synced: 'perawatan.synced_at' },
  { key: 'teknis.sop_folder_url', label: 'Folder SOP Mesin', menu: 'SOP Mesin', jenis: 'folder', sync: null, synced: 'teknis.sop_synced' },
  { key: 'hrd.karyawan_sheet_url', label: 'Data Karyawan (HRD)', menu: 'Karyawan', jenis: 'sheet', sync: null, synced: null },
  { key: 'hrd.grade_sheet_url', label: 'Grade & Gaji (HRD)', menu: 'Karyawan › Grade & gaji', jenis: 'sheet', sync: null, synced: null },
  { key: 'hrd.absensi_sheet_url', label: 'Laporan Absensi', menu: 'Absensi', jenis: 'sheet', sync: null, synced: null },
  { key: 'hrd.training_folder_url', label: 'Folder Training Karyawan', menu: 'Training', jenis: 'folder', sync: null, synced: 'hrd.training_synced' },
] as const

// Pengaturan > Integrasi & Info sistem (Admin / GM)
export const GET = handle(async () => {
  const user = await requireUser()
  if (!isManagement(user)) fail(403, 'Pengaturan sistem hanya untuk Admin / GM.')

  const keys = SOURCES.flatMap((s) => [s.key, s.synced].filter(Boolean)) as string[]
  const [settings] = await db.query<Row[]>('SELECT `key`, value, updated_at FROM app_settings WHERE `key` IN (?)', [keys])
  const byKey = new Map(settings.map((s) => [String(s.key), s]))
  // Nilai "synced" bisa berupa tanggal atau JSON { at, ... }
  const syncedAt = (key: string | null) => {
    const raw = key ? (byKey.get(key)?.value as string | null) : null
    if (!raw) return null
    try {
      const j = JSON.parse(raw)
      return typeof j === 'object' && j ? (j.at ?? j.synced_at ?? null) : raw
    } catch {
      return raw
    }
  }
  const sources = SOURCES.map((s) => ({
    key: s.key, label: s.label, menu: s.menu, jenis: s.jenis, sync: s.sync,
    url: (byKey.get(s.key)?.value as string | null) ?? null,
    synced_at: syncedAt(s.synced),
  }))

  const [account, accurate] = await Promise.all([driveAccount().catch(() => null), accurateEnabled() ? syncStatus() : Promise.resolve([])])

  const [[counts]] = await db.query<Row[]>(
    `SELECT (SELECT COUNT(*) FROM users WHERE is_active = 1) AS user_aktif, (SELECT COUNT(*) FROM users) AS user_total,
       (SELECT COUNT(*) FROM roles) AS role, (SELECT COUNT(*) FROM divisions) AS divisi,
       (SELECT COUNT(*) FROM schema_migrations) AS migrasi, (SELECT MAX(name) FROM schema_migrations) AS migrasi_terakhir,
       (SELECT MAX(applied_at) FROM schema_migrations) AS migrasi_at, NOW() AS waktu_db, @@time_zone AS zona_db`,
  )
  // Konfigurasi environment (hanya ada/tidak, nilai rahasia tidak pernah dikirim)
  const env = (name: string) => !!process.env[name]?.trim()
  const config = [
    { label: 'Accurate Online', ok: accurateEnabled() },
    { label: 'Google OAuth (akun Google)', ok: oauthConfigured() },
    { label: 'Google service account', ok: env('GOOGLE_SERVICE_ACCOUNT_JSON') },
    { label: 'reCAPTCHA login', ok: env('RECAPTCHA_V2_SITE_KEY') || env('RECAPTCHA_SITE_KEY') },
    { label: 'Notifikasi push (VAPID)', ok: env('VAPID_PUBLIC_KEY') && env('VAPID_PRIVATE_KEY') },
    { label: 'Cron (CRON_SECRET)', ok: env('CRON_SECRET') },
    { label: 'PAP AI (Gemini)', ok: env('GEMINI_API_KEY') },
  ]

  return NextResponse.json({
    sources,
    drive: account ? { email: account.email, mode: account.mode, connected_at: account.connectedAt ?? null, connected_by: account.connectedBy ?? null } : null,
    accurate: { enabled: accurateEnabled(), status: accurate },
    info: {
      ...counts,
      user_aktif: Number(counts.user_aktif), user_total: Number(counts.user_total), role: Number(counts.role), divisi: Number(counts.divisi), migrasi: Number(counts.migrasi),
      versi: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
      lingkungan: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? null,
    },
    config,
  })
})
