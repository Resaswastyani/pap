import { NextResponse } from 'next/server'
import { fail, handle, requireUser } from '@/lib/api'
import { requireMarketing } from '@/lib/marketing'
import { readXlsx } from '@/lib/xlsx-lite'
import { writeXlsx, type XlsxCell } from '@/lib/xlsx-write'

const MAX_BYTES = 5 * 1024 * 1024
const MAX_ROWS = 501 // judul + 500 baris (batas impor prospek)

// Kolom template (judul sama dengan template CSV, dibaca lewat alias yang sama di form impor)
const COLUMNS: [string, number, string][] = [
  ['Nama usaha', 28, 'Laundry Bersih Jaya'], ['Nama kontak', 18, 'Budi'], ['No WA', 16, '081234567890'], ['Email', 22, ''], ['Sektor', 14, 'Laundry'],
  ['Alamat', 30, 'Jl. Melati 5'], ['Kota', 14, 'Sidoarjo'], ['Sumber', 14, 'Instagram'], ['Kebutuhan', 28, 'Kantong laundry HD 40x60'], ['Estimasi order', 16, '200 kg/bulan'], ['Kompetitor / supplier lain', 30, 'Toko Plastik Maju, Rp 28.000/kg'], ['Catatan', 24, ''],
]

// Template Excel impor prospek
export const GET = handle(async () => {
  const user = await requireUser()
  requireMarketing(user, 'prospek')
  const head: XlsxCell[] = COLUMNS.map(([label]) => ({ v: label, s: 'head' }))
  const example: XlsxCell[] = COLUMNS.map(([, , v]) => ({ v, s: 'example' }))
  const xlsx = writeXlsx([
    { title: 'Prospek', rows: [head, example], widths: COLUMNS.map(([, w]) => w), freeze: { row: 1, col: 1 } },
    {
      title: 'Petunjuk', widths: [100], rows: [
        [{ v: 'Cara mengisi template impor prospek', s: 'title' }],
        ['1. Isi data di sheet "Prospek", satu prospek per baris, mulai baris ke-2. Baris contoh boleh dihapus atau ditimpa.'],
        ['2. Kolom wajib: Nama usaha. Kolom lain boleh dikosongkan. Urutan kolom boleh berbeda, asalkan judul kolomnya sama.'],
        ['3. No WA boleh ditulis 0812..., 62812..., atau +62 812...; otomatis disamakan. Nomor yang sudah terdaftar di SIMPAP dilewati.'],
        ['4. Satu prospek dengan beberapa produk: tulis produk pertama di baris prospek, produk berikutnya di baris bawahnya dengan Nama usaha dikosongkan (isi Kebutuhan & Estimasi order per produk).'],
        ['5. Maksimal 500 baris per impor. Simpan sebagai Excel Workbook (.xlsx), lalu unggah di menu Prospek › Impor Excel / CSV.'],
      ],
    },
  ])
  return new Response(new Uint8Array(xlsx), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="Template Impor Prospek.xlsx"',
      'Cache-Control': 'no-store',
    },
  })
})

// Baca file Excel (.xlsx) prospek: form-data file -> { sheet, rows: string[][] } dari sheet pertama yang berisi data.
// Pemetaan kolom & pratinjau dikerjakan di form impor (sama dengan CSV), lalu disimpan lewat POST /api/prospects/import.
export const POST = handle(async (request: Request) => {
  const user = await requireUser()
  requireMarketing(user, 'prospek')
  const form = await request.formData().catch(() => fail(400, 'Data upload tidak valid.'))
  const upload = form.get('file')
  if (!(upload instanceof File) || !upload.size) fail(400, 'Pilih file Excel terlebih dahulu.')
  const file = upload as File
  if (/\.xls$/i.test(file.name)) fail(400, 'File Excel 97-2003 (.xls) belum didukung. Buka di Excel lalu Simpan Sebagai "Excel Workbook (.xlsx)".')
  if (file.size > MAX_BYTES) fail(400, 'Ukuran file Excel maksimal 5 MB.')
  let sheets: { title: string; rows: string[][] }[]
  try {
    sheets = readXlsx(Buffer.from(await file.arrayBuffer()))
  } catch {
    fail(400, 'File tidak bisa dibaca sebagai Excel (.xlsx).')
  }
  const filled = (rows: string[][]) => rows.filter((r) => r.some((c) => String(c ?? '').trim()))
  const sheet = sheets!.find((s) => !/^petunjuk$/i.test(s.title.trim()) && filled(s.rows).length >= 2) ?? sheets!.find((s) => filled(s.rows).length)
  if (!sheet) fail(400, 'File Excel kosong.')
  const rows = filled(sheet!.rows).map((r) => r.map((c) => String(c ?? '').trim()))
  if (rows.length > MAX_ROWS) fail(400, `Maksimal 500 baris per impor (file berisi ${rows.length - 1} baris). Bagi menjadi beberapa file.`)
  return NextResponse.json({ sheet: sheet!.title, rows })
})
