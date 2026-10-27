import type { RowDataPacket } from 'mysql2'
import { ACCOUNTING_MENUS, AGING, bsSummary, bsAmounts, cashAccounts, forecast, isDate, payables, plAmounts, plSummary, plTrend, receivables, todayWib } from '@/lib/accounting'
import { fail } from '@/lib/api'
import { CRM_CASE, CRM_INACTIVE_DAYS, CRM_STATUS } from '@/lib/customers'
import { db } from '@/lib/db'
import { prospectScope } from '@/lib/marketing'
import { SECTORS, sectorSql } from '@/lib/sectors'
import type { UserProfile } from '@/lib/users'

// PAP AI: asisten analisis data SIMPAP memakai Gemini (function calling).
// Model tidak pernah menyentuh database langsung: ia hanya memanggil alat analisis di bawah ini (semuanya baca saja),
// dan setiap alat hanya tersedia bila user punya menu yang sesuai.

export type ChatMessage = { role: 'user' | 'model'; text: string }
export type AiChart = { jenis: 'bar' | 'line' | 'hbar'; judul: string; label: string[]; seri: { nama: string; data: number[] }[]; format: 'rupiah' | 'angka' | 'persen'; catatan?: string }
export type AiReply = { reply: string; charts: AiChart[]; sources: string[] }

type Row = RowDataPacket & Record<string, unknown>
type Args = Record<string, unknown>
type Schema = { type: string; description?: string; enum?: string[]; items?: Schema; properties?: Record<string, Schema>; required?: string[] }
type Tool = { name: string; label: string; description: string; parameters?: Schema; allowed: (u: UserProfile) => boolean; run: (args: Args, u: UserProfile) => Promise<unknown> }

const has = (u: UserProfile, ...menus: string[]) => menus.some((m) => (u.menus as string[]).includes(m))
const SALES_MENUS = ['customer', 'repeat-order', 'order-bulanan', 'keuangan', 'laporan-keuangan']
const num = (v: unknown) => Math.round(Number(v ?? 0))
const SECTOR_KEYS = SECTORS.map((s) => s.key)
const sectorArg: Schema = { type: 'STRING', enum: [...SECTOR_KEYS], description: 'Sektor customer: laundry, beras, umum (Sektor Umum), lainnya. Kosongkan untuk semua sektor.' }
const sectorFilter = (args: Args, col = 'c.category') => {
  const s = String(args.sektor ?? '')
  return SECTOR_KEYS.includes(s as never) ? { sql: ` AND ${sectorSql(col)} = ?`, params: [s] } : { sql: '', params: [] as string[] }
}
const clampInt = (v: unknown, def: number, min: number, max: number) => Math.min(max, Math.max(min, Math.round(Number(v) || def)))
const dateArg = (v: unknown, def: string) => (isDate(String(v ?? '')) ? String(v) : def)

const TOOLS: Tool[] = [
  // ---------- Penjualan & marketing ----------
  {
    name: 'penjualan_bulanan', label: 'Penjualan bulanan',
    description: 'Omzet faktur penjualan (Accurate) per bulan per sektor customer: omzet, jumlah faktur, jumlah customer. Untuk tren penjualan dan perbandingan sektor.',
    parameters: { type: 'OBJECT', properties: { bulan: { type: 'INTEGER', description: 'Jumlah bulan terakhir (1-36), default 12' }, sektor: sectorArg } },
    allowed: (u) => has(u, ...SALES_MENUS),
    run: async (args) => {
      const months = clampInt(args.bulan, 12, 1, 36)
      const f = sectorFilter(args)
      const [rows] = await db.query<Row[]>(
        `SELECT DATE_FORMAT(i.trans_date, '%Y-%m') AS bulan, ${sectorSql('c.category')} AS sektor, SUM(i.total_amount) AS omzet, COUNT(*) AS faktur, COUNT(DISTINCT i.customer_accurate_id) AS customer
         FROM accurate_sales_invoices i LEFT JOIN customers c ON c.accurate_id = i.customer_accurate_id
         WHERE i.trans_date >= DATE_FORMAT(CURDATE() - INTERVAL ? MONTH, '%Y-%m-01')${f.sql} GROUP BY bulan, sektor ORDER BY bulan, sektor`,
        [months - 1, ...f.params],
      )
      return { catatan: 'Bulan berjalan belum penuh.', baris: rows.map((r) => ({ bulan: r.bulan, sektor: r.sektor, omzet: num(r.omzet), faktur: num(r.faktur), customer: num(r.customer) })) }
    },
  },
  {
    name: 'top_customer', label: 'Top customer',
    description: 'Peringkat customer berdasarkan omzet atau frekuensi order dalam rentang tanggal, bisa difilter sektor.',
    parameters: {
      type: 'OBJECT', properties: {
        sektor: sectorArg, dari: { type: 'STRING', description: 'YYYY-MM-DD, default 12 bulan lalu' }, sampai: { type: 'STRING', description: 'YYYY-MM-DD, default hari ini' },
        urut: { type: 'STRING', enum: ['omzet', 'frekuensi'] }, limit: { type: 'INTEGER', description: '1-30, default 10' },
      },
    },
    allowed: (u) => has(u, ...SALES_MENUS),
    run: async (args) => {
      const today = todayWib()
      const dari = dateArg(args.dari, new Date(Date.parse(today) - 365 * 86400e3).toISOString().slice(0, 10))
      const sampai = dateArg(args.sampai, today)
      const f = sectorFilter(args)
      const [rows] = await db.query<Row[]>(
        `SELECT COALESCE(MAX(c.name), i.customer_accurate_id) AS nama, MAX(c.bill_city) AS kota, ${sectorSql('MAX(c.category)')} AS sektor,
           SUM(i.total_amount) AS omzet, COUNT(*) AS faktur, MAX(i.trans_date) AS order_terakhir
         FROM accurate_sales_invoices i LEFT JOIN customers c ON c.accurate_id = i.customer_accurate_id
         WHERE i.trans_date BETWEEN ? AND ?${f.sql} GROUP BY i.customer_accurate_id ORDER BY ${args.urut === 'frekuensi' ? 'faktur' : 'omzet'} DESC LIMIT ?`,
        [dari, sampai, ...f.params, clampInt(args.limit, 10, 1, 30)],
      )
      return { dari, sampai, customer: rows.map((r) => ({ nama: r.nama, kota: r.kota, sektor: r.sektor, omzet: num(r.omzet), faktur: num(r.faktur), order_terakhir: r.order_terakhir })) }
    },
  },
  {
    name: 'analisis_customer', label: 'Analisis customer',
    description: `Analisis basis customer per sektor: jumlah per status CRM (pelanggan = >=2 faktur, pembeli = 1 faktur, pasif = tidak order > ${CRM_INACTIVE_DAYS} hari), sebaran per kota (peluang wilayah), customer baru per bulan, nilai faktur rata-rata, dan kandidat reaktivasi (customer pasif bernilai besar). Untuk mencari peluang customer di laundry, beras, sektor umum.`,
    parameters: { type: 'OBJECT', properties: { sektor: sectorArg } },
    allowed: (u) => has(u, 'customer', 'repeat-order', 'order-bulanan'),
    run: async (args) => {
      const f = sectorFilter(args)
      const base = `FROM customers c LEFT JOIN (
          SELECT customer_accurate_id, COUNT(*) AS order_count, MIN(trans_date) AS first_order, MAX(trans_date) AS last_order, SUM(total_amount) AS total_amount,
            SUM(IF(trans_date >= CURDATE() - INTERVAL 12 MONTH, total_amount, 0)) AS omzet_12
          FROM accurate_sales_invoices GROUP BY customer_accurate_id
        ) s ON s.customer_accurate_id = c.accurate_id WHERE c.suspended = 0${f.sql}`
      const [status] = await db.query<Row[]>(`SELECT ${CRM_CASE} AS status, COUNT(*) AS jumlah, SUM(COALESCE(s.omzet_12, 0)) AS omzet_12_bulan ${base} GROUP BY status`, f.params)
      const [kota] = await db.query<Row[]>(
        `SELECT COALESCE(NULLIF(TRIM(c.bill_city), ''), '(tanpa kota)') AS kota, COUNT(*) AS customer,
           SUM(s.last_order >= CURDATE() - INTERVAL ${CRM_INACTIVE_DAYS} DAY) AS aktif, SUM(COALESCE(s.omzet_12, 0)) AS omzet_12_bulan
         ${base} GROUP BY kota ORDER BY customer DESC LIMIT 12`, f.params,
      )
      const [baru] = await db.query<Row[]>(
        `SELECT DATE_FORMAT(s.first_order, '%Y-%m') AS bulan, COUNT(*) AS customer_baru ${base} AND s.first_order >= DATE_FORMAT(CURDATE() - INTERVAL 11 MONTH, '%Y-%m-01') GROUP BY bulan ORDER BY bulan`, f.params,
      )
      const [reaktivasi] = await db.query<Row[]>(
        `SELECT c.name AS nama, c.bill_city AS kota, ${sectorSql('c.category')} AS sektor, s.order_count AS faktur, s.total_amount AS total_omzet, s.last_order AS order_terakhir,
           DATEDIFF(CURDATE(), s.last_order) AS hari_tidak_order
         ${base} AND s.last_order < CURDATE() - INTERVAL ${CRM_INACTIVE_DAYS} DAY ORDER BY s.total_amount DESC LIMIT 12`, f.params,
      )
      const [[avg]] = await db.query<Row[]>(
        `SELECT AVG(i.total_amount) AS rata, COUNT(*) AS faktur FROM accurate_sales_invoices i LEFT JOIN customers c ON c.accurate_id = i.customer_accurate_id
         WHERE i.trans_date >= CURDATE() - INTERVAL 12 MONTH${f.sql}`, f.params,
      )
      return {
        sektor: args.sektor || 'semua',
        status: status.map((r) => ({ status: CRM_STATUS[r.status as keyof typeof CRM_STATUS] ?? r.status, jumlah: num(r.jumlah), omzet_12_bulan: num(r.omzet_12_bulan) })),
        nilai_faktur_rata_12_bulan: num(avg?.rata), faktur_12_bulan: num(avg?.faktur),
        per_kota: kota.map((r) => ({ kota: r.kota, customer: num(r.customer), aktif: num(r.aktif), omzet_12_bulan: num(r.omzet_12_bulan) })),
        customer_baru_per_bulan: baru.map((r) => ({ bulan: r.bulan, jumlah: num(r.customer_baru) })),
        kandidat_reaktivasi: reaktivasi.map((r) => ({ nama: r.nama, kota: r.kota, sektor: r.sektor, faktur: num(r.faktur), total_omzet: num(r.total_omzet), order_terakhir: r.order_terakhir, hari_tidak_order: num(r.hari_tidak_order) })),
      }
    },
  },
  {
    name: 'pipeline_prospek', label: 'Pipeline prospek',
    description: 'Prospek (calon customer) di modul Prospek: jumlah per status & sektor usaha, dan daftar prospek terbaru dengan estimasi order & jadwal follow-up.',
    parameters: { type: 'OBJECT', properties: { sektor: { type: 'STRING', description: 'Kata kunci sektor usaha prospek, mis. Laundry, Beras, F&B. Kosongkan untuk semua.' } } },
    allowed: (u) => has(u, 'prospek'),
    run: async (args, u) => {
      const scope = prospectScope(u)
      const where = [scope.sql]
      const params: unknown[] = [...scope.params]
      if (args.sektor) where.push('p.sektor LIKE ?'), params.push(`%${String(args.sektor).slice(0, 40)}%`)
      const w = where.join(' AND ')
      const [rekap] = await db.query<Row[]>(`SELECT COALESCE(p.sektor, '(kosong)') AS sektor, p.status, COUNT(*) AS jumlah, SUM(COALESCE(p.estimasi_order, 0)) AS estimasi FROM prospects p WHERE ${w} GROUP BY sektor, p.status`, params)
      const [list] = await db.query<Row[]>(
        `SELECT p.nama_usaha, p.sektor, p.kota, p.status, p.estimasi_order, p.sumber, p.next_followup_at, p.kebutuhan FROM prospects p WHERE ${w} ORDER BY p.updated_at DESC LIMIT 20`, params,
      )
      return { rekap: rekap.map((r) => ({ sektor: r.sektor, status: r.status, jumlah: num(r.jumlah), estimasi_order: num(r.estimasi) })), prospek: list }
    },
  },
  // ---------- Keuangan (Accurate) ----------
  {
    name: 'laba_rugi', label: 'Laba rugi',
    description: 'Laporan laba rugi Accurate untuk rentang tanggal: pendapatan, HPP, laba kotor, beban, laba bersih, margin, dan 8 akun beban terbesar.',
    parameters: { type: 'OBJECT', properties: { dari: { type: 'STRING', description: 'YYYY-MM-DD, default awal bulan ini' }, sampai: { type: 'STRING', description: 'YYYY-MM-DD, default hari ini' } } },
    allowed: (u) => has(u, ...ACCOUNTING_MENUS),
    run: async (args) => {
      const today = todayWib()
      const dari = dateArg(args.dari, `${today.slice(0, 7)}-01`)
      const sampai = dateArg(args.sampai, today)
      const rows = await plAmounts(dari, sampai)
      const beban = rows.filter((r) => ['EXPENSE', 'OTHER_EXPENSE'].includes(r.type)).sort((a, b) => b.amount - a.amount).slice(0, 8).map((r) => ({ akun: r.name, nominal: num(r.amount) }))
      return { dari, sampai, ...plSummary(rows), beban_terbesar: beban }
    },
  },
  {
    name: 'tren_keuangan', label: 'Tren keuangan',
    description: 'Tren bulanan pendapatan, HPP, biaya, dan laba bersih (Accurate) beberapa bulan terakhir.',
    parameters: { type: 'OBJECT', properties: { bulan: { type: 'INTEGER', description: '3-12, default 6' } } },
    allowed: (u) => has(u, ...ACCOUNTING_MENUS),
    run: async (args) => ({ bulan: await plTrend(todayWib().slice(0, 7), clampInt(args.bulan, 6, 3, 12)) }),
  },
  {
    name: 'neraca', label: 'Neraca',
    description: 'Ringkasan neraca per tanggal: aset, kas & bank, piutang, persediaan, liabilitas, ekuitas, current ratio, debt to equity.',
    parameters: { type: 'OBJECT', properties: { tanggal: { type: 'STRING', description: 'YYYY-MM-DD, default hari ini' } } },
    allowed: (u) => has(u, ...ACCOUNTING_MENUS),
    run: async (args) => {
      const tanggal = dateArg(args.tanggal, todayWib())
      return { tanggal, ...bsSummary(await bsAmounts(tanggal)) }
    },
  },
  {
    name: 'kas_bank', label: 'Kas & bank',
    description: 'Saldo terkini setiap akun kas & bank di Accurate dan totalnya.',
    allowed: (u) => has(u, ...ACCOUNTING_MENUS),
    run: async () => {
      const accounts = (await cashAccounts()).filter((a) => !a.is_parent)
      return { total: num(accounts.reduce((s, a) => s + a.balance, 0)), akun: accounts.map((a) => ({ akun: a.name, saldo: num(a.balance) })) }
    },
  },
  {
    name: 'piutang', label: 'Piutang customer',
    description: 'Piutang customer yang belum lunas: total, umur piutang (aging), dan 10 customer dengan piutang terbesar / paling lama.',
    allowed: (u) => has(u, ...ACCOUNTING_MENUS),
    run: async () => {
      const rows = await receivables()
      const byCustomer = new Map<string, { customer: string; sisa: number; faktur: number; umur_maks: number }>()
      for (const r of rows) {
        const key = r.customer ?? '(tanpa nama)'
        const c = byCustomer.get(key) ?? { customer: key, sisa: 0, faktur: 0, umur_maks: 0 }
        c.sisa += r.sisa
        c.faktur += 1
        c.umur_maks = Math.max(c.umur_maks, r.umur)
        byCustomer.set(key, c)
      }
      return {
        total: num(rows.reduce((s, r) => s + r.sisa, 0)), faktur: rows.length,
        aging: AGING.map((a) => ({ umur: a.label, nominal: num(rows.filter((r) => a.test(r.umur)).reduce((s, r) => s + r.sisa, 0)) })),
        customer_terbesar: [...byCustomer.values()].sort((a, b) => b.sisa - a.sisa).slice(0, 10).map((c) => ({ ...c, sisa: num(c.sisa) })),
      }
    },
  },
  {
    name: 'hutang_supplier', label: 'Hutang supplier',
    description: 'Hutang ke supplier yang belum lunas: total, umur hutang, dan supplier dengan hutang terbesar.',
    allowed: (u) => has(u, ...ACCOUNTING_MENUS, 'hutang-supplier'),
    run: async () => {
      const today = todayWib()
      const rows = (await payables()).map((r) => ({ ...r, umur: r.jatuh_tempo ? Math.round((Date.parse(today) - Date.parse(String(r.jatuh_tempo).slice(0, 10))) / 86400e3) : 0 }))
      const byVendor = new Map<string, number>()
      for (const r of rows) byVendor.set(r.vendor ?? '(tanpa nama)', (byVendor.get(r.vendor ?? '(tanpa nama)') ?? 0) + r.sisa)
      return {
        total: num(rows.reduce((s, r) => s + r.sisa, 0)), faktur: rows.length,
        aging: AGING.map((a) => ({ umur: a.label, nominal: num(rows.filter((r) => a.test(r.umur)).reduce((s, r) => s + r.sisa, 0)) })),
        supplier_terbesar: [...byVendor.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([vendor, sisa]) => ({ vendor, sisa: num(sisa) })),
      }
    },
  },
  {
    name: 'forecast_kas', label: 'Forecast arus kas',
    description: 'Proyeksi arus kas 13 minggu ke depan: saldo awal, kas masuk (piutang jatuh tempo + rencana), kas keluar (hutang + rencana), saldo akhir per minggu, saldo terendah.',
    allowed: (u) => has(u, ...ACCOUNTING_MENUS),
    run: async () => {
      const f = await forecast(13)
      return { saldo_awal: f.saldo_awal, saldo_terendah: num(f.terendah), minggu: f.minggu.map(({ rincian: _r, ...w }) => w) }
    },
  },
]

// Alat khusus: model meminta grafik; server menyimpannya untuk ditampilkan di chat
const CHART_TOOL = {
  name: 'buat_grafik',
  description: 'Tampilkan grafik di chat. Pakai setelah mendapat data dari alat lain. bar = perbandingan antar kategori / bulan (maks 4 seri), line = tren waktu (maks 4 seri), hbar = peringkat / komposisi (1 seri, maks 12 item). Jangan pakai dua skala berbeda dalam satu grafik.',
  parameters: {
    type: 'OBJECT', required: ['jenis', 'judul', 'label', 'seri', 'format'],
    properties: {
      jenis: { type: 'STRING', enum: ['bar', 'line', 'hbar'] },
      judul: { type: 'STRING' },
      label: { type: 'ARRAY', items: { type: 'STRING' }, description: 'Label sumbu X / nama item' },
      seri: { type: 'ARRAY', items: { type: 'OBJECT', required: ['nama', 'data'], properties: { nama: { type: 'STRING' }, data: { type: 'ARRAY', items: { type: 'NUMBER' } } } } },
      format: { type: 'STRING', enum: ['rupiah', 'angka', 'persen'] },
      catatan: { type: 'STRING', description: 'Keterangan singkat di bawah grafik (opsional)' },
    },
  } satisfies Schema,
}

function readChart(args: Args): AiChart | null {
  const jenis = ['bar', 'line', 'hbar'].includes(String(args.jenis)) ? (args.jenis as AiChart['jenis']) : 'bar'
  const label = Array.isArray(args.label) ? args.label.map((l) => String(l).slice(0, 40)).slice(0, 36) : []
  const seri = (Array.isArray(args.seri) ? args.seri : []).slice(0, jenis === 'hbar' ? 1 : 4).map((s) => {
    const o = (s ?? {}) as Args
    return { nama: String(o.nama ?? '').slice(0, 40), data: (Array.isArray(o.data) ? o.data : []).slice(0, label.length).map((v) => Number(v) || 0) }
  }).filter((s) => s.data.length)
  if (!label.length || !seri.length) return null
  const format = ['rupiah', 'angka', 'persen'].includes(String(args.format)) ? (args.format as AiChart['format']) : 'angka'
  return { jenis, judul: String(args.judul ?? '').slice(0, 100), label, seri, format, catatan: args.catatan ? String(args.catatan).slice(0, 200) : undefined }
}

const MONTHS = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember']
function systemPrompt(user: UserProfile, tools: Tool[]) {
  const today = todayWib()
  return `Kamu adalah PAP AI, asisten di SIMPAP (sistem manajemen PT Pandawa Amerta Packindo, produsen kantong plastik HD/PP/PE untuk laundry, beras, dan sektor umum).
Hari ini ${Number(today.slice(8, 10))} ${MONTHS[Number(today.slice(5, 7)) - 1]} ${today.slice(0, 4)}. Pengguna: ${user.name} (${user.role.name}, divisi ${user.division.name}).

Dua jenis pertanyaan:
1. Pertanyaan tentang data perusahaan (penjualan, customer, prospek, produksi, stok, keuangan, karyawan, dsb.): pakai alat (function) dan analisis hasilnya.
2. Pertanyaan umum (pengetahuan umum, istilah bisnis, tips marketing / penjualan / produksi, bahan & proses plastik, cara menulis pesan atau email,
   rumus Excel, matematika, saran kerja, dll.): jawab langsung dari pengetahuanmu tanpa memanggil alat, dan jangan menolak hanya karena tidak ada di data SIMPAP.
   Bila relevan, kaitkan dengan konteks PT Pandawa Amerta Packindo.

Aturan:
- Jawab dalam Bahasa Indonesia yang ringkas, jelas, dan profesional (ikuti bahasa pengguna bila ia memakai bahasa lain).
- Angka tentang data perusahaan WAJIB berasal dari alat (function); jangan mengarang data internal. Bila data tidak tersedia atau alat gagal, katakan terus terang.
  Untuk pertanyaan umum boleh memakai pengetahuan umum; bila informasinya bisa berubah (harga pasar, regulasi, kurs), sebutkan bahwa itu perkiraan umum dan sarankan dicek ulang.
- Alat yang tersedia untuk pengguna ini: ${tools.map((t) => t.label).join(', ') || '(tidak ada)'}. Bila pertanyaan butuh data perusahaan di luar itu, jelaskan bahwa pengguna tidak punya akses ke menu terkait.
- Sektor customer berasal dari kategori Accurate: (LAU) = Laundry, (BRS) = Beras, (SU) = Sektor Umum, tanpa kode = Lainnya. Pelanggan = sudah >= 2 faktur; Pembeli = 1 faktur; pasif = tidak order lebih dari ${CRM_INACTIVE_DAYS} hari.
- Tulis Rupiah ringkas: Rp 1,25 M (miliar), Rp 830 jt (juta), Rp 45 rb. Pakai koma sebagai desimal.
- Bila tren, perbandingan, atau peringkat lebih jelas dengan grafik, panggil buat_grafik (maks 3 grafik per jawaban). Nilai grafik dalam angka penuh (bukan juta).
- Struktur jawaban analisis data: ringkasan 1-2 kalimat, lalu poin-poin temuan penting (pakai **tebal** untuk angka kunci), lalu "Rekomendasi" berupa langkah konkret (mis. customer yang perlu dihubungi, wilayah potensial, biaya yang perlu ditekan).
- Pertanyaan umum: jawab langsung dengan struktur yang sesuai pertanyaan (tidak perlu bagian Rekomendasi bila tidak relevan).
- Boleh memakai tabel markdown sederhana (maks 10 baris). Jangan menulis JSON; rumus Excel atau contoh teks boleh bila diminta.`
}

// ---------- Gemini ----------
type Part = { text?: string; functionCall?: { id?: string; name: string; args?: Args }; functionResponse?: unknown; thought?: boolean; thoughtSignature?: string }
type Content = { role: 'user' | 'model'; parts: Part[] }
const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models'
export const aiEnabled = () => !!process.env.GEMINI_API_KEY

type GeminiJson = { candidates?: { content?: Content; finishReason?: string }[]; error?: { message?: string; code?: number } }
// Model utama sesekali penuh (503 "high demand"): coba ulang sekali, lalu pakai model cadangan
async function gemini(models: string[], body: unknown) {
  const attempts = [models[0], models[0], ...models.slice(1)]
  let status = 0
  for (const [i, model] of attempts.entries()) {
    if (i === 1) await new Promise((r) => setTimeout(r, 1200))
    const res = await fetch(`${GEMINI_URL}/${model}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY! },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(40_000),
    }).catch((e: Error) => fail(504, e.name === 'TimeoutError' ? 'PAP AI terlalu lama menjawab. Coba lagi atau persempit pertanyaannya.' : 'PAP AI gagal menghubungi layanan AI. Coba lagi.'))
    const json = (await res.json().catch(() => ({}))) as GeminiJson
    if (res.ok) return json.candidates?.[0]?.content ?? { role: 'model' as const, parts: [] }
    status = res.status
    console.error('Gemini error', model, res.status, json.error?.message)
    if (![429, 500, 503].includes(res.status)) break
  }
  return fail(status === 429 ? 429 : 502, status === 429 ? 'PAP AI sedang sibuk (batas pemakaian tercapai). Coba lagi sebentar lagi.' : 'Layanan AI sedang padat. Coba lagi beberapa saat lagi.')
}

export async function askAssistant(user: UserProfile, history: ChatMessage[]): Promise<AiReply> {
  if (!aiEnabled()) fail(503, 'PAP AI belum dikonfigurasi (GEMINI_API_KEY belum diset).')
  const tools = TOOLS.filter((t) => t.allowed(user))
  const models = [process.env.GEMINI_MODEL || 'gemini-3.5-flash', process.env.GEMINI_FALLBACK_MODEL || 'gemini-3-flash-preview']
  const contents: Content[] = history.map((m) => ({ role: m.role, parts: [{ text: m.text }] }))
  const charts: AiChart[] = []
  const sources = new Set<string>()
  const declarations = [...tools.map((t) => ({ name: t.name, description: t.description, ...(t.parameters ? { parameters: t.parameters } : {}) })), CHART_TOOL]

  for (let round = 0; round < 6; round++) {
    const content = await gemini(models, {
      systemInstruction: { parts: [{ text: systemPrompt(user, tools) }] },
      contents,
      tools: [{ functionDeclarations: declarations }],
      generationConfig: { temperature: 0.3, maxOutputTokens: 4096, thinkingConfig: { thinkingLevel: 'low' } },
    })
    const parts = content.parts ?? []
    const calls = parts.filter((p) => p.functionCall)
    if (!calls.length) {
      const reply = parts.filter((p) => p.text && !p.thought).map((p) => p.text).join('').trim()
      return { reply: reply || 'Maaf, PAP AI belum bisa menjawab pertanyaan itu. Coba tanyakan dengan kalimat lain.', charts, sources: [...sources] }
    }
    // Kembalikan isi model apa adanya (termasuk thoughtSignature) lalu kirim hasil setiap alat
    contents.push({ role: 'model', parts })
    const responses: Part[] = []
    for (const { functionCall: call } of calls) {
      const name = call!.name
      const args = call!.args ?? {}
      let result: unknown
      if (name === CHART_TOOL.name) {
        const chart = charts.length < 3 ? readChart(args) : null
        if (chart) charts.push(chart)
        result = chart ? { ok: true, info: 'Grafik ditampilkan ke pengguna.' } : { ok: false, error: 'Data grafik tidak valid atau sudah 3 grafik.' }
      } else {
        const tool = tools.find((t) => t.name === name)
        if (!tool) result = { error: 'Alat tidak tersedia untuk pengguna ini.' }
        else {
          try {
            result = await tool.run(args, user)
            sources.add(tool.label)
          } catch (e) {
            result = { error: `Data gagal diambil: ${(e as Error).message}`.slice(0, 300) }
          }
        }
      }
      responses.push({ functionResponse: { ...(call!.id ? { id: call!.id } : {}), name, response: { result } } })
    }
    contents.push({ role: 'user', parts: responses })
  }
  return { reply: 'Analisis terlalu panjang untuk diselesaikan sekaligus. Coba persempit pertanyaannya (mis. satu sektor atau satu periode).', charts, sources: [...sources] }
}

// Menu yang memberi akses data untuk saran pertanyaan di panel
export function assistantCapabilities(user: UserProfile) {
  return { sales: has(user, ...SALES_MENUS), customer: has(user, 'customer', 'repeat-order', 'order-bulanan'), prospek: has(user, 'prospek'), keuangan: has(user, ...ACCOUNTING_MENUS) }
}

