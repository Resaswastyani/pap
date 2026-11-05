import { NextResponse } from 'next/server'
import { fail, handle, requireUser } from '@/lib/api'
import { requireInventarisManage } from '@/lib/inventaris'
import { importAssetWorkbook, parseAssetWorkbook } from '@/lib/inventaris-import'
import { readXlsx } from '@/lib/xlsx-lite'

const MAX_BYTES = 10 * 1024 * 1024

// Impor inventaris dari Excel (.xlsx, format "Data Asset PAP"). form-data: file, mode = "preview" | "import"
export const POST = handle(async (request: Request) => {
  const user = await requireUser()
  requireInventarisManage(user)
  const form = await request.formData().catch(() => fail(400, 'Data upload tidak valid.'))
  const upload = form.get('file')
  if (!(upload instanceof File) || !upload.size) fail(400, 'Pilih file Excel terlebih dahulu.')
  const file = upload as File
  if (/\.xls$/i.test(file.name)) fail(400, 'File Excel 97-2003 (.xls) belum didukung. Buka di Excel lalu Simpan Sebagai "Excel Workbook (.xlsx)".')
  if (file.size > MAX_BYTES) fail(400, 'Ukuran file Excel maksimal 10 MB.')
  let parsed: ReturnType<typeof parseAssetWorkbook>
  try {
    parsed = parseAssetWorkbook(readXlsx(Buffer.from(await file.arrayBuffer())))
  } catch {
    return fail(400, 'File tidak bisa dibaca. Pastikan formatnya Excel .xlsx.')
  }
  if (!parsed.items.length) fail(400, 'Tidak ada data inventaris yang dikenali. Pastikan ada sheet "Asset" / "Kendaraan" dengan kolom Kode, Nama, Kategori, Lokasi, Jumlah, Kondisi, Penanggung Jawab.')

  if (form.get('mode') === 'import') return NextResponse.json({ ...(await importAssetWorkbook(parsed, user.id, file.name)), report: parsed.report, file: file.name })

  const byKategori: Record<string, number> = {}
  for (const it of parsed.items) byKategori[it.kategori ?? 'Tanpa kategori'] = (byKategori[it.kategori ?? 'Tanpa kategori'] ?? 0) + 1
  return NextResponse.json({
    file: file.name,
    barang: parsed.items.length,
    unit: parsed.items.reduce((s, i) => s + i.jumlah, 0),
    kategori: byKategori,
    riwayat: parsed.logs.length,
    riwayatTanpaTanggal: parsed.logs.filter((l) => !l.tanggal).length,
    contoh: parsed.items.slice(0, 6).map((i) => `${i.kode} · ${i.nama} · ${i.lokasi ?? i.nomorSeri ?? '—'} · ${i.jumlah} unit`),
    report: parsed.report,
  })
})
