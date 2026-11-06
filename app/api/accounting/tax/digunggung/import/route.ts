import type { RowDataPacket } from 'mysql2'
import { NextResponse } from 'next/server'
import { ApiError, fail, handle, requireUser } from '@/lib/api'
import { canManageAccounting, isClosed, requireAccounting } from '@/lib/accounting'
import { db } from '@/lib/db'
import { DG_COLUMNS, dgValues, nextDigunggungNumber, readDigunggung, readNpwp, saveNpwp, type DigunggungInput } from '@/lib/digunggung'
import { readXlsx } from '@/lib/xlsx-lite'

const MAX_BYTES = 10 * 1024 * 1024
const clean = (v: string | undefined) => (v ?? '').replace(/\s+/g, ' ').trim()
// Tanggal sel Excel: nomor seri atau teks "2026-09-01" / "01/09/2026"
function cellDate(v: string | undefined) {
  const s = clean(v)
  if (/^\d{5}(\.\d+)?$/.test(s)) {
    const d = new Date(Math.round((Number(s) - 25569) * 86400e3))
    return d.toISOString().slice(0, 10)
  }
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`
  const dmy = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/)
  return dmy ? `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}` : s
}

// Unggah laporan PPN digunggung (Excel format template Coretax "Retail_XML": sheet DATA berisi NPWP, Masa Pajak, Tahun Pajak,
// lalu kolom TrxCode, BuyerName, BuyerIdOpt, BuyerIdNumber, GoodServiceOpt, SerialNo, TransactionDate, TaxBaseSellingPrice,
// OtherTaxBaseSellingPrice, VAT, STLG, Info). form-data: file, mode = "preview" | "import"
export const POST = handle(async (request: Request) => {
  const user = await requireUser()
  requireAccounting(user, 'pajak')
  if (!canManageAccounting(user)) fail(403, 'PPN digunggung dicatat oleh divisi Accounting.')
  const form = await request.formData().catch(() => fail(400, 'Data upload tidak valid.'))
  const upload = form.get('file')
  if (!(upload instanceof File) || !upload.size) fail(400, 'Pilih file Excel terlebih dahulu.')
  const file = upload as File
  if (/\.xls$/i.test(file.name)) fail(400, 'File Excel 97-2003 (.xls) belum didukung. Buka di Excel lalu Simpan Sebagai "Excel Workbook (.xlsx)".')
  if (file.size > MAX_BYTES) fail(400, 'Ukuran file Excel maksimal 10 MB.')
  let sheets: ReturnType<typeof readXlsx>
  try {
    sheets = readXlsx(Buffer.from(await file.arrayBuffer()))
  } catch {
    return fail(400, 'File tidak bisa dibaca. Pastikan formatnya Excel .xlsx.')
  }

  // Sheet & baris header yang memuat TrxCode dan BuyerName
  let found: { rows: string[][]; head: number; col: Record<string, number> } | null = null
  for (const s of sheets) {
    const head = s.rows.findIndex((r) => (r ?? []).some((c) => clean(c).toLowerCase() === 'trxcode') && (r ?? []).some((c) => clean(c).toLowerCase() === 'buyername'))
    if (head >= 0) {
      const col = Object.fromEntries((s.rows[head] ?? []).map((c, i) => [clean(c).toLowerCase(), i]).filter(([k]) => k))
      found = { rows: s.rows, head, col }
      break
    }
  }
  if (!found) fail(400, 'Kolom template tidak ditemukan. Gunakan format "Retail_XML": sheet DATA dengan kolom TrxCode, BuyerName, BuyerIdOpt, BuyerIdNumber, ... , VAT, STLG, Info.')
  const { rows, head, col } = found!
  // NPWP / Masa / Tahun di atas tabel
  const meta = (label: RegExp) => {
    for (const r of rows.slice(0, head)) {
      const i = (r ?? []).findIndex((c) => label.test(clean(c).toLowerCase()))
      if (i >= 0) return (r ?? []).slice(i + 1).map(clean).find(Boolean) ?? ''
    }
    return ''
  }
  const npwpFile = meta(/^npwp/).replace(/\D/g, '')
  const masaBulan = Number(meta(/^masa/)) || null
  const tahun = Number(meta(/^tahun/)) || null
  const masaFile = masaBulan && tahun ? `${tahun}-${String(masaBulan).padStart(2, '0')}` : null

  const get = (r: string[], k: string) => (col[k] === undefined ? '' : clean(r[col[k]]))
  const items: { baris: number; v: DigunggungInput | null; error: string | null; duplikat: boolean }[] = []
  for (let i = head + 1; i < rows.length; i++) {
    const r = rows[i] ?? []
    if (!get(r, 'buyername') && !get(r, 'taxbasesellingprice')) continue
    if (/^total/i.test(get(r, 'buyername'))) continue
    try {
      const v = readDigunggung({
        trx_code: get(r, 'trxcode'), customer: get(r, 'buyername'), buyer_id_opt: get(r, 'buyeridopt'), buyer_id_number: get(r, 'buyeridnumber'),
        good_service_opt: get(r, 'goodserviceopt'), serial_no: get(r, 'serialno'), tanggal: cellDate(r[col.transactiondate]),
        dpp: get(r, 'taxbasesellingprice'), dpp_nilai_lain: get(r, 'othertaxbasesellingprice'), ppn: get(r, 'vat'), stlg: get(r, 'stlg'), info: get(r, 'info'),
      })
      items.push({ baris: i + 1, v, error: null, duplikat: false })
    } catch (e) {
      items.push({ baris: i + 1, v: null, error: e instanceof ApiError ? e.message : 'Baris tidak valid.', duplikat: false })
    }
  }
  if (!items.length) fail(400, 'Tidak ada baris transaksi di bawah header template.')

  // Sudah ada (masa + nomor transaksi + DPP sama) -> dilewati agar unggah ulang tidak dobel
  const valid = items.filter((it) => it.v)
  if (valid.length) {
    const [existing] = await db.query<RowDataPacket[]>('SELECT masa, serial_no, dpp FROM tax_digunggung WHERE masa IN (?)', [[...new Set(valid.map((it) => it.v!.masa))]])
    const key = (m: string, s: string | null, d: number) => `${m}|${s ?? ''}|${Math.round(d)}`
    const have = new Set(existing.map((e) => key(String(e.masa), e.serial_no, Number(e.dpp))))
    for (const it of valid) if (have.has(key(it.v!.masa, it.v!.serial_no, it.v!.dpp))) it.duplikat = true
  }
  const masas = [...new Set(valid.map((it) => it.v!.masa))].sort()
  const closed: string[] = []
  for (const m of masas) if (await isClosed(m)) closed.push(m)
  const baru = valid.filter((it) => !it.duplikat && !closed.includes(it.v!.masa))
  const sum = (list: typeof items, k: 'dpp' | 'dpp_nilai_lain' | 'ppn') => list.reduce((s, it) => s + (it.v?.[k] ?? 0), 0)

  if (form.get('mode') === 'import') {
    if (items.some((it) => it.error)) fail(400, 'Masih ada baris yang tidak valid. Perbaiki di Excel lalu unggah lagi.')
    const conn = await db.getConnection()
    try {
      await conn.beginTransaction()
      // Nomor DG.YYYY.MM.nnnn berurutan per masa (dihitung sekali, lalu dinaikkan di dalam transaksi)
      const next = new Map<string, number>()
      for (const m of new Set(baru.map((it) => it.v!.masa))) next.set(m, Number((await nextDigunggungNumber(m)).slice(-4)))
      for (const it of baru) {
        const m = it.v!.masa
        const n = next.get(m)!
        next.set(m, n + 1)
        const nomor = `DG.${m.slice(0, 4)}.${m.slice(5, 7)}.${String(n).padStart(4, '0')}`
        await conn.query(`INSERT INTO tax_digunggung (${DG_COLUMNS}, created_by, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [...dgValues(it.v!, nomor), user.id, user.id])
      }
      await conn.commit()
    } catch (e) {
      await conn.rollback()
      throw e
    } finally {
      conn.release()
    }
    if (npwpFile) await saveNpwp(readNpwp(npwpFile))
    return NextResponse.json({ added: baru.length, skipped: valid.length - baru.length, masa: masas, ppn: sum(baru, 'ppn') })
  }

  return NextResponse.json({
    file: file.name,
    npwp: npwpFile || null,
    masaFile,
    masa: masas,
    closed,
    total: { baris: items.length, baru: baru.length, duplikat: valid.filter((it) => it.duplikat).length, error: items.filter((it) => it.error).length, dpp: sum(baru, 'dpp'), dpp_nilai_lain: sum(baru, 'dpp_nilai_lain'), ppn: sum(baru, 'ppn') },
    beda_masa: masaFile ? valid.filter((it) => it.v!.masa !== masaFile).length : 0,
    rows: items.slice(0, 300).map((it) => ({
      baris: it.baris, error: it.error, duplikat: it.duplikat, ditutup: !!it.v && closed.includes(it.v.masa),
      ...(it.v ? { trx_code: it.v.trx_code, customer: it.v.customer, serial_no: it.v.serial_no, tanggal: it.v.tanggal, dpp: it.v.dpp, dpp_nilai_lain: it.v.dpp_nilai_lain, ppn: it.v.ppn } : {}),
    })),
  })
})
