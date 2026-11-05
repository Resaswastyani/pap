import type { RowDataPacket } from 'mysql2'
import { NextResponse } from 'next/server'
import { fail, handle, requireUser } from '@/lib/api'
import { db } from '@/lib/db'
import { requireBelanjaManage, saveBelanja } from '@/lib/belanja'
import { parseBelanjaWorkbook } from '@/lib/belanja-parse'
import { readXlsx } from '@/lib/xlsx-lite'

const MAX_BYTES = 10 * 1024 * 1024

// Impor catatan belanja dari Excel (tiap sheet / tabel = satu nota).
// form-data: file, mode = "preview" | "import", keys = JSON array sumber nota yang dipilih (mode import)
export const POST = handle(async (request: Request) => {
  const user = await requireUser()
  requireBelanjaManage(user)
  const form = await request.formData().catch(() => fail(400, 'Data upload tidak valid.'))
  const upload = form.get('file')
  if (!(upload instanceof File) || !upload.size) fail(400, 'Pilih file Excel terlebih dahulu.')
  const file = upload as File
  if (/\.xls$/i.test(file.name)) fail(400, 'File Excel 97-2003 (.xls) belum didukung. Buka di Excel lalu Simpan Sebagai "Excel Workbook (.xlsx)".')
  if (file.size > MAX_BYTES) fail(400, 'Ukuran file Excel maksimal 10 MB.')
  let notas: ReturnType<typeof parseBelanjaWorkbook>
  try {
    notas = parseBelanjaWorkbook(readXlsx(Buffer.from(await file.arrayBuffer())), file.name)
  } catch {
    return fail(400, 'File tidak bisa dibaca. Pastikan formatnya Excel .xlsx.')
  }
  if (!notas.length) fail(400, 'Tidak ada tabel belanja yang dikenali. Pastikan tiap tabel punya kolom Nama Barang dan Qty / Jumlah.')
  // Nota yang pernah diimpor (sumber sama) ditandai agar tidak dobel
  const [done] = await db.query<RowDataPacket[]>('SELECT sumber FROM ga_belanja WHERE sumber IN (?)', [notas.map((n) => n.key)])
  const imported = new Set(done.map((r) => String(r.sumber)))

  if (form.get('mode') === 'import') {
    let keys: string[] = []
    try { keys = JSON.parse(String(form.get('keys') ?? '[]')) } catch { fail(400, 'Pilihan sheet tidak valid.') }
    const chosen = notas.filter((n) => keys.includes(n.key) && !imported.has(n.key))
    const noDate = chosen.filter((n) => !n.tanggal)
    if (noDate.length) fail(400, `Tanggal tidak dikenali untuk: ${noDate.map((n) => n.sheet).join(', ')}. Hapus centangnya atau ubah nama sheet di Excel.`)
    let added = 0
    const conn = await db.getConnection()
    try {
      await conn.beginTransaction()
      for (const n of chosen) {
        await saveBelanja({
          tanggal: n.tanggal!, kategori: n.kategori, toko: n.toko,
          catatan: [n.catatan, n.catatanImpor.length ? `Catatan impor: ${n.catatanImpor.join('; ')}` : null, `Sumber: ${n.sheet} (${file.name})`].filter(Boolean).join('\n'),
          items: n.items.map((i) => ({ nama: i.nama.slice(0, 255), qty: i.qty, satuan: i.satuan?.slice(0, 40) ?? null, harga: i.harga, total: i.total })),
          total: n.total,
        }, user.id, undefined, n.key.slice(0, 255), conn)
        added++
      }
      await conn.commit()
    } catch (e) {
      await conn.rollback()
      throw e
    } finally {
      conn.release()
    }
    return NextResponse.json({ added, skipped: keys.length - added, total: chosen.reduce((s, n) => s + n.total, 0) })
  }

  return NextResponse.json({
    file: file.name,
    notas: notas.map((n) => ({
      key: n.key, sheet: n.sheet, tanggal: n.tanggal, kategori: n.kategori, toko: n.toko, total: n.total, jumlahItem: n.items.length,
      contoh: n.items.slice(0, 4).map((i) => i.nama).join(', '), rekap: n.rekap, sudahDiimpor: imported.has(n.key), catatanImpor: n.catatanImpor,
    })),
  })
})
