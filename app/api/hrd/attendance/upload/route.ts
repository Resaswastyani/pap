import { NextResponse } from 'next/server'
import { fail, handle, requireUser } from '@/lib/api'
import { importAttendance, parseAttendanceTabs } from '@/lib/attendance'
import { canManageHr } from '@/lib/hrd'
import { readXlsx } from '@/lib/xlsx-lite'

export const maxDuration = 60
const MAX_BYTES = 8 * 1024 * 1024

// Unggah laporan kehadiran Altius (Excel .xlsx). form-data: file, mode = "preview" | "import"
export const POST = handle(async (request: Request) => {
  const user = await requireUser()
  if (!user.menus.includes('absensi' as never) || !canManageHr(user)) fail(403, 'Data absensi diunggah oleh HRD.')
  const form = await request.formData().catch(() => fail(400, 'Kirim file laporan kehadiran sebagai form-data.'))
  const file = form.get('file')
  if (!(file instanceof File) || !file.size) fail(400, 'Pilih file Excel laporan kehadiran.')
  const upload = file as File
  if (upload.size > MAX_BYTES) fail(400, 'Ukuran file maksimal 8 MB.')
  const buf = Buffer.from(await upload.arrayBuffer())
  if (/\.xls$/i.test(upload.name) || buf.subarray(0, 4).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0]))) {
    fail(400, 'File Excel 97-2003 (.xls) belum didukung. Buka di Excel lalu Simpan Sebagai "Excel Workbook (.xlsx)".')
  }
  let parsed: ReturnType<typeof parseAttendanceTabs>
  try {
    parsed = parseAttendanceTabs(readXlsx(buf))
  } catch {
    return fail(400, 'File tidak bisa dibaca. Pastikan formatnya Excel .xlsx.')
  }
  if (!parsed.days.length) fail(400, 'Tidak ada data kehadiran yang dikenali. Pastikan ada kolom NIP / Nama, Tanggal, dan Jam Masuk / Jam scan atau Status.')
  if (form.get('mode') === 'import') return NextResponse.json({ ...(await importAttendance(parsed.days, 'upload')), file: upload.name })
  const dates = parsed.days.map((d) => d.tanggal).sort()
  return NextResponse.json({
    file: upload.name, tabs: parsed.tabs, baris: parsed.days.length, karyawan: new Set(parsed.days.map((d) => d.nip)).size, dari: dates[0], sampai: dates.at(-1),
    contoh: parsed.days.slice(0, 5).map((d) => `${d.tanggal} · ${d.nama} · ${d.jam_masuk?.slice(0, 5) ?? '—'}–${d.jam_pulang?.slice(0, 5) ?? '—'}${d.status_asli ? ` · ${d.status_asli}` : ''}`),
  })
})
