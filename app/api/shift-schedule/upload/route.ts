import type { RowDataPacket } from 'mysql2'
import { NextResponse } from 'next/server'
import { fail, handle, requireUser } from '@/lib/api'
import { db } from '@/lib/db'
import { canSyncShift, importShiftSchedules, readShiftFile, requireShift, shiftSheetWrite } from '@/lib/shift-schedule'
import { trySheet } from '@/lib/sheet-write'

const MAX_BYTES = 4 * 1024 * 1024

// Unggah jadwal shift dari file Excel (mis. jadwal bulan depan dari template).
// form-data: file, mode = "preview" (cek isi) | "import" (simpan; jadwal bulan yang sama diganti seluruhnya)
export const POST = handle(async (request: Request) => {
  const user = await requireUser()
  requireShift(user)
  if (!canSyncShift(user)) fail(403, 'Jadwal shift dikelola PPIC, HRD, dan kepala Produksi.')
  const form = await request.formData().catch(() => fail(400, 'Kirim file jadwal sebagai form-data.'))
  const file = form.get('file')
  if (!(file instanceof File) || !file.size) fail(400, 'Pilih file Excel jadwal shift.')
  const upload = file as File
  if (upload.size > MAX_BYTES) fail(400, 'Ukuran file maksimal 4 MB.')
  const { schedules, tabs } = readShiftFile(Buffer.from(await upload.arrayBuffer()), upload.name)
  if (!schedules.length) fail(400, 'Tidak ada jadwal yang dikenali. Pastikan ada judul bulan (mis. "BULAN NOVEMBER 2026"), kolom NAMA, dan kolom tanggal 1 sampai akhir bulan.')

  if (form.get('mode') === 'import') {
    const saved = await importShiftSchedules(schedules, user.id)
    // Jadwal yang diunggah ikut ditulis ke spreadsheet Jadwal Shift di Google Drive
    const warning = await trySheet('jadwal shift', () => shiftSheetWrite(schedules))
    return NextResponse.json({ ...saved, file: upload.name, warning })
  }
  const [existing] = await db.query<(RowDataPacket & { periode: string })[]>('SELECT periode FROM shift_schedules WHERE periode IN (?)', [schedules.map((s) => s.periode)])
  const ada = new Set(existing.map((e) => e.periode))
  return NextResponse.json({
    file: upload.name,
    tabs,
    schedules: schedules.map((s) => ({
      periode: s.periode, judul: s.judul, tab: s.tab, karyawan: s.rows.length, sudah_ada: ada.has(s.periode),
      // Hari terisi (bukan libur / kosong) untuk cek cepat apakah jadwal sudah diisi
      terisi: s.rows.reduce((n, r) => n + r.jadwal.filter((k) => k !== '' && k !== '_').length, 0),
      contoh: s.rows.slice(0, 3).map((r) => r.nama),
    })),
  })
})
