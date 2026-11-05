// Parser catatan belanja GA dari Excel (format bebas "Pembelian ATK / RTK GENERAL AFFAIR"):
// tiap sheet berisi satu atau beberapa tabel; tiap tabel = satu nota belanja. Tanggal diambil dari nama sheet
// ("PEMBELIAN 14 SEPTEMBER 2026", "19102026", "RTK 1102026") atau sel "Tanggal" di sheet.
// Modul ini murni (tanpa database) supaya bisa diuji langsung dengan file aslinya.

export type Sheet = { title: string; rows: string[][] }
export type ParsedItem = { nama: string; qty: number | null; satuan: string | null; harga: number | null; total: number | null }
export type ParsedNota = {
  key: string // sumber unik: "<file>|<sheet>|<tabel ke->" (dipakai agar impor ulang tidak dobel)
  sheet: string
  tanggal: string | null
  kategori: string
  toko: string | null
  catatan: string | null
  items: ParsedItem[]
  total: number // jumlah total item; bila tidak ada harga item, total dari baris TOTAL
  totalExcel: number | null // nilai baris TOTAL di Excel (untuk dicocokkan)
  rekap: boolean // sheet rekap / daftar harga / rencana keperluan -> default tidak diimpor
  catatanImpor: string[]
}

const BULAN: Record<string, number> = {
  januari: 1, februari: 2, maret: 3, april: 4, mei: 5, juni: 6, juli: 7, agustus: 8, september: 9, oktober: 10, november: 11, desember: 12,
  jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, agu: 8, agt: 8, sep: 9, okt: 10, nov: 11, des: 12,
}
const clean = (v: string | undefined) => (v ?? '').replace(/\s+/g, ' ').trim()
const low = (v: string | undefined) => clean(v).toLowerCase()
const pad = (n: number) => String(n).padStart(2, '0')
const validDate = (y: number, m: number, d: number) => y > 2000 && y < 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31
const iso = (y: number, m: number, d: number) => (validDate(y, m, d) ? `${y}-${pad(m)}-${pad(d)}` : null)

export function num(v: string | undefined): number | null {
  const s = clean(v)
  if (!s || s === '-') return null
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s)
  const m = s.replace(/rp\.?/i, '').match(/-?[\d.,]+/)
  if (!m) return null
  // "1.234.567" / "1,234,567" (ribuan) atau "12,5" (desimal)
  const t = m[0]
  const n = /^\d{1,3}([.,]\d{3})+$/.test(t) ? Number(t.replace(/[.,]/g, '')) : Number(t.replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

// Tanggal dari teks: nomor seri Excel, "2026-09-03", "12 September 2026", "14 SEPTEMBER", "19102026", "1102026"
export function parseTanggal(text: string, tahunDefault: number): string | null {
  const s = low(text)
  if (/^\d{5}(\.\d+)?$/.test(s) && Number(s) > 20000 && Number(s) < 80000) {
    const d = new Date(Math.round((Number(s) - 25569) * 86400e3))
    return iso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate())
  }
  let m = s.match(/(\d{4})-(\d{2})-(\d{2})/)
  if (m) return iso(Number(m[1]), Number(m[2]), Number(m[3]))
  m = s.match(/(\d{1,2})\s+([a-z]+)(?:\s+(\d{4}))?/)
  if (m && BULAN[m[2]]) return iso(m[3] ? Number(m[3]) : tahunDefault, BULAN[m[2]], Number(m[1]))
  // ddmmyyyy (8 digit) atau dmmyyyy (7 digit, mis. 1102026 = 1 Okt 2026)
  m = s.match(/(?:^|\D)(\d{7,8})(?:\D|$)/)
  if (m) {
    const t = m[1]
    const d = Number(t.slice(0, t.length - 6)), mo = Number(t.slice(-6, -4)), y = Number(t.slice(-4))
    return iso(y, mo, d)
  }
  return null
}

const NAME_HEAD = /^(nama barang|nama item|deskripsi|nama aset|barang|item|nama)/
const QTY_HEAD = /^(qty|kuantitas|jml|jumlah \(qty\)|jumlah)$/
const UNIT_HEAD = /^satuan$/
const PRICE_HEAD = /^(harga satuan|hrg jual|harga \(rp\)|harga satuan \(rp\)|harga)/
const TOTAL_HEAD = /^(total harga|total netto|harga total|total)/
const SKIP_NAME = /^(total|jumlah|grand total|sub ?total|uang|kembalian|tunai|cash|pembulatan|rp\s?\d)/

type Cols = { name: number; qty: number; unit: number; price: number; total: number }
type Block = { cols: Cols; items: ParsedItem[]; totalExcel: number | null; date: string | null; notes: string[] }

// Kenali baris header tabel; kembalikan posisi kolom
function headerCols(row: string[]): Cols | null {
  const cells = row.map(low)
  let name = cells.findIndex((c) => NAME_HEAD.test(c))
  const qtyAll = cells.map((c, i) => (QTY_HEAD.test(c) ? i : -1)).filter((i) => i >= 0)
  // Header tanpa judul kolom nama ("  | Jumlah | Harga Satuan | Harga Total"): nama di kolom sebelum Jumlah
  if (name < 0 && qtyAll.length && cells[qtyAll[0] - 1] === '') name = qtyAll[0] - 1
  if (name < 0 || !qtyAll.length) return null
  // "Kuantitas" lebih diutamakan daripada "Jumlah" (di sheet 3 September, "Jumlah" berisi subtotal kelompok)
  const qty = qtyAll.find((i) => /qty|kuantitas|jml/.test(cells[i])) ?? qtyAll[0]
  const unit = cells.findIndex((c) => UNIT_HEAD.test(c))
  const prices = cells.map((c, i) => (i !== qty && PRICE_HEAD.test(c) ? i : -1)).filter((i) => i >= 0)
  const totals = cells.map((c, i) => (i !== qty && TOTAL_HEAD.test(c) && !prices.includes(i) ? i : -1)).filter((i) => i >= 0)
  let price = -1, total = -1
  if (totals.length) { total = totals[0]; price = prices.find((p) => p < total) ?? -1 }
  else if (prices.length >= 2) { price = prices[0]; total = prices[prices.length - 1] }
  else if (prices.length === 1) {
    // Satu kolom harga: "Harga Satuan" = harga satuan, "Harga (Rp)" = total baris
    if (/satuan|jual/.test(cells[prices[0]])) price = prices[0]
    else total = prices[0]
  }
  return { name, qty, unit, price, total }
}

// "18 ROLL" -> 18 + satuan ROLL
function qtyUnit(v: string | undefined): { qty: number | null; unit: string | null } {
  const s = clean(v)
  const m = s.match(/^(\d+(?:[.,]\d+)?)\s*([a-zA-Z].*)?$/)
  if (m) return { qty: Number(m[1].replace(',', '.')), unit: m[2] ? m[2].trim() : null }
  return { qty: num(s), unit: null }
}

function kategoriOf(fileKind: string, sheet: string, items: ParsedItem[]) {
  const t = `${sheet} ${items.map((i) => i.nama).join(' ')}`.toLowerCase()
  // Obat bila sebagian besar item berupa obat (sheet campuran RTK & obat tetap RTK)
  const obat = items.filter((i) => /hansaplast|handsaplast|insto|degirol|anastan|opistan|ultraflu|bioplacenton|kapas|ibuprofen|intunal|decolgen|caplang|betadine|neozep|bodrex|antangin/i.test(i.nama)).length
  if (items.length && obat * 2 >= items.length) return 'Obat'
  if (/air minum|air mineral/.test(t)) return 'Konsumsi'
  if (/monitor|ssd|kabel sata|headset|sticker keyboard/.test(t) && !/lakban|hvs|amplop/.test(t)) return 'Perlengkapan IT'
  if (/sampah/.test(t)) return 'Operasional'
  return fileKind
}

export function parseBelanjaWorkbook(sheets: Sheet[], fileName: string, tahunDefault = new Date().getFullYear()): ParsedNota[] {
  const fileKind = /rtk/i.test(fileName) && !/atk/i.test(fileName) ? 'RTK' : 'ATK'
  const yearInName = fileName.match(/20\d{2}/)
  const year = yearInName ? Number(yearInName[0]) : tahunDefault
  const out: ParsedNota[] = []
  for (const sheet of sheets) {
    const title = clean(sheet.title)
    const rekap = /keperluan|^list |harga obat|rekap/i.test(title)
    const sheetDate = parseTanggal(title, year)
    let toko: string | null = null
    let headerDate: string | null = null
    const notes: string[] = []
    // Info di luar tabel: "Toko: ...", "Tanggal | | 2026-09-03", "APOTEK KARTASURA"
    for (const row of sheet.rows.slice(0, 4)) {
      for (const [i, c] of (row ?? []).entries()) {
        const s = clean(c)
        const toko_ = s.match(/^toko\s*:\s*([^|]+)/i)
        if (toko_) toko = toko_[1].trim()
        const tgl = s.match(/tanggal\s*:?\s*(.*)$/i)
        if (tgl) headerDate = parseTanggal(tgl[1] || (row ?? []).slice(i + 1).map(clean).find(Boolean) || '', year) ?? headerDate
        if (/^apotek /i.test(s)) toko = s
      }
    }
    let block: Block | null = null
    const blocks: Block[] = []
    let pendingDate: string | null = null
    const flush = () => { const cur = block as Block | null; if (cur && (cur.items.length || cur.totalExcel)) blocks.push(cur); block = null }
    for (const raw of sheet.rows) {
      const row = raw ?? []
      if (!row.some((c) => clean(c))) continue
      const cols = headerCols(row)
      if (cols) { flush(); block = { cols, items: [], totalExcel: null, date: pendingDate, notes: [] }; pendingDate = null; continue }
      const first = clean(row.find((c) => clean(c)) ?? '')
      // Judul tanggal di tengah sheet ("02 OKTOBER 2026") -> tabel berikutnya bertanggal itu
      if (row.filter((c) => clean(c)).length === 1 && parseTanggal(first, year) && !/total/i.test(first)) { flush(); pendingDate = parseTanggal(first, year); continue }
      if (!block) continue
      const b: Block = block
      const name = clean(row[b.cols.name])
      const rowText = row.map(clean).filter(Boolean).join(' ')
      // Baris uang diberikan / kembalian (bukan baris item) -> catatan nota
      if (/\b(uang|kembalian|pembulatan)\b/i.test(rowText) && (!name || SKIP_NAME.test(low(name)) || /\b(uang|kembalian)\b/i.test(name))) {
        b.notes.push(rowText)
        if (/kembalian akhir|uang dibayarkan|total pengeluaran/i.test(rowText)) continue
      }
      const label = low(name) || low(row.find((c) => clean(c)) ?? '')
      if (!name || SKIP_NAME.test(label) || /total/.test(low(row[0]))) {
        const t = b.cols.total >= 0 ? num(row[b.cols.total]) : null
        const any = [...row].reverse().map(num).find((n) => n !== null && n > 100)
        if (/total|^-$|^$/.test(label) || !name) b.totalExcel = t ?? any ?? b.totalExcel
        // Catatan di kolom kanan baris item (mis. "Pembulatan dari Luwes ...") sudah ditangkap di atas
        continue
      }
      if (/^\d+(\.0)?$/.test(name)) continue // kolom nomor ikut terbaca sebagai nama
      const { qty, unit } = qtyUnit(row[b.cols.qty])
      const satuan = (b.cols.unit >= 0 ? clean(row[b.cols.unit]) : '') || unit
      let harga = b.cols.price >= 0 ? num(row[b.cols.price]) : null
      let total = b.cols.total >= 0 ? num(row[b.cols.total]) : null
      if (total === null && harga !== null && qty !== null) total = Math.round(harga * qty)
      if (harga === null && total !== null && qty) harga = Math.round(total / qty)
      // Baris koreksi setelah TOTAL dengan nama sama (mis. "Buku Kas bon" yang harganya baru diisi) -> ganti baris lama
      const same = b.items.findIndex((i) => i.nama.toLowerCase() === name.toLowerCase() && (i.total === null || i.total === 0))
      const item = { nama: name, qty, satuan: satuan || null, harga, total }
      if (same >= 0) b.items[same] = item
      else b.items.push(item)
      // Catatan di kolom paling kanan (di luar kolom tabel)
      const extra = row.slice(Math.max(b.cols.name, b.cols.qty, b.cols.unit, b.cols.price, b.cols.total) + 1).map(clean).filter((c) => c && !/^\d/.test(c))
      b.notes.push(...extra)
    }
    flush()
    // Tabel ringkas yang isinya sudah ada di tabel lain pada sheet yang sama (mis. 16 September) -> dibuang
    const kept = blocks.filter((b, i) => !blocks.some((o, j) => j !== i && o.items.length > b.items.length && b.items.every((it) => o.items.some((x) => x.nama.toLowerCase() === it.nama.toLowerCase() && x.total === it.total))))
    // Baris total keseluruhan sheet (jumlah semua tabel) bukan total tabel terakhir
    const sheetSum = kept.reduce((s, b) => s + b.items.reduce((t, i) => t + (i.total ?? 0), 0), 0)
    kept.forEach((b, idx) => {
      if (kept.length > 1 && b.totalExcel !== null && Math.abs(b.totalExcel - sheetSum) <= 1) b.totalExcel = null
      const items = b.items
      const sum = items.reduce((s, i) => s + (i.total ?? 0), 0)
      const total = sum > 0 ? sum : b.totalExcel ?? 0
      const catatanImpor: string[] = []
      if (b.totalExcel !== null && sum > 0 && Math.abs(b.totalExcel - sum) > 1) catatanImpor.push(`Total di Excel Rp${b.totalExcel.toLocaleString('id-ID')}, jumlah item Rp${sum.toLocaleString('id-ID')}`)
      const missing = items.filter((i) => i.total === null)
      if (missing.length && sum > 0) catatanImpor.push(`${missing.length} item tanpa harga: ${missing.map((i) => i.nama).join(', ')}`)
      let tanggal = b.date ?? headerDate ?? sheetDate
      if (!tanggal) {
        // Nama sheet hanya bulan ("KEPERLUAN ATK OKTOBER 2026") -> tanggal 1
        const m = [...low(title).matchAll(/\b([a-z]+)\b(?:\s+(\d{4}))?/g)].find((x) => BULAN[x[1]] && x[1].length > 3)
        if (m) { tanggal = iso(m[2] ? Number(m[2]) : year, BULAN[m[1]], 1); catatanImpor.push('Nama sheet hanya bulan, dipakai tanggal 1') }
        else catatanImpor.push('Tanggal tidak dikenali dari nama sheet; isi tanggal setelah impor')
      }
      out.push({
        key: `${fileName}|${title}|${idx + 1}`,
        sheet: kept.length > 1 ? `${title} (tabel ${idx + 1})` : title,
        tanggal,
        kategori: kategoriOf(fileKind, title, items),
        toko,
        catatan: [...new Set([...notes, ...b.notes])].join('; ') || null,
        items, total, totalExcel: b.totalExcel, rekap, catatanImpor,
      })
    })
  }
  return out
}
