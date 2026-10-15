import type { RowDataPacket } from 'mysql2'
import { NextResponse } from 'next/server'
import { fail, handle, readJson, requireUser } from '@/lib/api'
import { db } from '@/lib/db'
import { canSupervise, readProspectInput, requireMarketing, requireMarketingUser } from '@/lib/marketing'
import { notify } from '@/lib/notifications'
import { pushToUsers } from '@/lib/push'

const MAX_ROWS = 500

// Impor banyak lead sekaligus (Marketing Digital): { rows: [...], assigned_to? }.
// CSV dibaca di browser; baris dengan nomor WA yang sudah terdaftar dilewati.
export const POST = handle(async (request: Request) => {
  const user = await requireUser()
  requireMarketing(user, 'prospek')
  const body = await readJson(request)
  if (!Array.isArray(body.rows) || !body.rows.length) fail(400, 'Tidak ada baris untuk diimpor.')
  const rows = body.rows as Record<string, unknown>[]
  if (rows.length > MAX_ROWS) fail(400, `Maksimal ${MAX_ROWS} baris per impor.`)
  const assigned = canSupervise(user) ? (await requireMarketingUser(body.assigned_to, 'Sales'))?.id ?? null : user.division.code === 'marketing_digital' ? null : user.id

  const inputs = rows.map((row, i) => {
    try {
      return readProspectInput(row)
    } catch (error) {
      fail(400, `Baris ${i + 2}: ${(error as Error).message}`)
    }
  })!
  const phones = inputs.map((p) => p!.telepon).filter(Boolean) as string[]
  const existing = new Set<string>()
  if (phones.length) {
    const [found] = await db.query<(RowDataPacket & { telepon: string })[]>('SELECT telepon FROM prospects WHERE telepon IN (?)', [phones])
    for (const f of found) existing.add(f.telepon)
  }
  const fresh = inputs.filter((p) => {
    if (!p!.telepon) return true
    if (existing.has(p!.telepon)) return false
    existing.add(p!.telepon)
    return true
  })
  if (fresh.length) {
    await db.query(
      `INSERT INTO prospects (nama_usaha, sektor, kontak_nama, kontak_jabatan, telepon, email, alamat, kota, sumber, kebutuhan, estimasi_order, catatan,
         assigned_to, created_by, last_activity_at) VALUES ?`,
      [fresh.map((p) => [p!.nama_usaha, p!.sektor, p!.kontak_nama, p!.kontak_jabatan, p!.telepon, p!.email, p!.alamat, p!.kota, p!.sumber, p!.kebutuhan,
        p!.estimasi_order, p!.catatan, assigned, user.id, new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 19).replace('T', ' ')])],
    )
  }
  if (assigned && assigned !== user.id && fresh.length) {
    await pushToUsers(await notify([assigned], {
      type: 'prospek_baru',
      title: `${fresh.length} prospek baru untuk Anda`,
      body: `Diimpor oleh ${user.name}`,
      refKey: `prospek-import:${user.id}:${Date.now()}`,
    }))
  }
  return NextResponse.json({ imported: fresh.length, skipped: inputs.length - fresh.length })
})
