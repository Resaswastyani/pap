import Anthropic from '@anthropic-ai/sdk'
import type { RowDataPacket } from 'mysql2'
import { ACCOUNTING_MENUS, AGING, bsSummary, bsAmounts, cashAccounts, forecast, isDate, payables, plAmounts, plSummary, plTrend, receivables, todayWib } from '@/lib/accounting'
import { fail } from '@/lib/api'
import { CRM_CASE, CRM_INACTIVE_DAYS, CRM_STATUS, CYCLE_PASSIVE_FACTOR, CYCLE_PASSIVE_MIN_DAYS, PASSIVE_DAYS_SQL } from '@/lib/customers'
import { aiKey, aiModel, PROVIDERS, providerOrder, type AiProvider } from '@/lib/ai-providers'
import { db } from '@/lib/db'
import { prospectScope } from '@/lib/marketing'
import { SECTORS, sectorSql } from '@/lib/sectors'
import type { UserProfile } from '@/lib/users'

// PAP AI: asisten analisis data SIMPAP memakai Gemini, Claude, atau ChatGPT (function calling), dipilih otomatis per pertanyaan.
// Model tidak pernah menyentuh database langsung: ia hanya memanggil alat analisis di bawah ini (semuanya baca saja),
// dan setiap alat hanya tersedia bila user punya menu yang sesuai.

export type ChatMessage = { role: 'user' | 'model'; text: string }
export type AiChart = { jenis: 'bar' | 'line' | 'hbar'; judul: string; label: string[]; seri: { nama: string; data: number[] }[]; format: 'rupiah' | 'angka' | 'persen'; catatan?: string }
export type AiReply = { reply: string; charts: AiChart[]; sources: string[]; model?: string }

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
    description: `Analisis basis customer per sektor: jumlah per status CRM (pelanggan = >=2 faktur, pembeli = 1 faktur, pasif = tidak order > ${CYCLE_PASSIVE_FACTOR}x cycle order customer itu, min. ${CYCLE_PASSIVE_MIN_DAYS} hari; cycle belum diketahui: ${CRM_INACTIVE_DAYS} hari), sebaran per kota (peluang wilayah), customer baru per bulan, nilai faktur rata-rata, dan kandidat reaktivasi (customer pasif bernilai besar). Untuk mencari peluang customer di laundry, beras, sektor umum.`,
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
           SUM(DATEDIFF(CURDATE(), s.last_order) <= ${PASSIVE_DAYS_SQL}) AS aktif, SUM(COALESCE(s.omzet_12, 0)) AS omzet_12_bulan
         ${base} GROUP BY kota ORDER BY customer DESC LIMIT 12`, f.params,
      )
      const [baru] = await db.query<Row[]>(
        `SELECT DATE_FORMAT(s.first_order, '%Y-%m') AS bulan, COUNT(*) AS customer_baru ${base} AND s.first_order >= DATE_FORMAT(CURDATE() - INTERVAL 11 MONTH, '%Y-%m-01') GROUP BY bulan ORDER BY bulan`, f.params,
      )
      const [reaktivasi] = await db.query<Row[]>(
        `SELECT c.name AS nama, c.bill_city AS kota, ${sectorSql('c.category')} AS sektor, s.order_count AS faktur, s.total_amount AS total_omzet, s.last_order AS order_terakhir,
           DATEDIFF(CURDATE(), s.last_order) AS hari_tidak_order
         ${base} AND DATEDIFF(CURDATE(), s.last_order) > ${PASSIVE_DAYS_SQL} ORDER BY s.total_amount DESC LIMIT 12`, f.params,
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
- Sektor customer berasal dari kategori Accurate: (LAU) = Laundry, (BRS) = Beras, (SU) = Sektor Umum, tanpa kode = Lainnya. Pelanggan = sudah >= 2 faktur; Pembeli = 1 faktur; pasif = tidak order lebih dari ${CYCLE_PASSIVE_FACTOR}x cycle order customer itu (min. ${CYCLE_PASSIVE_MIN_DAYS} hari; cycle = median jarak order atau diisi manual; belum diketahui: ${CRM_INACTIVE_DAYS} hari).
- Tulis Rupiah ringkas: Rp 1,25 M (miliar), Rp 830 jt (juta), Rp 45 rb. Pakai koma sebagai desimal.
- Bila tren, perbandingan, atau peringkat lebih jelas dengan grafik, panggil buat_grafik (maks 3 grafik per jawaban). Nilai grafik dalam angka penuh (bukan juta).
- Struktur jawaban analisis data: ringkasan 1-2 kalimat, lalu poin-poin temuan penting (pakai **tebal** untuk angka kunci), lalu "Rekomendasi" berupa langkah konkret (mis. customer yang perlu dihubungi, wilayah potensial, biaya yang perlu ditekan).
- Pertanyaan umum: jawab langsung dengan struktur yang sesuai pertanyaan (tidak perlu bagian Rekomendasi bila tidak relevan).
- Boleh memakai tabel markdown sederhana (maks 10 baris). Jangan menulis JSON; rumus Excel atau contoh teks boleh bila diminta.`
}

// ---------- Mesin percakapan: alat dipakai bersama oleh Gemini, Claude, dan ChatGPT ----------
type Run = { user: UserProfile; tools: Tool[]; charts: AiChart[]; sources: Set<string> }
const toolCache = globalThis as unknown as { papAiToolCache?: Map<string, { at: number; value: unknown }> }
const TOOL_TTL = 120_000
async function runTool(tool: Tool, args: Args, user: UserProfile) {
  const cache = (toolCache.papAiToolCache ??= new Map())
  const key = `${user.id}:${tool.name}:${JSON.stringify(args)}`
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < TOOL_TTL) return hit.value
  const value = await tool.run(args, user)
  cache.set(key, { at: Date.now(), value })
  if (cache.size > 300) cache.delete(cache.keys().next().value!)
  return value
}
// Jalankan satu panggilan alat (atau buat_grafik) dan kembalikan hasilnya untuk model
async function execCall(run: Run, name: string, args: Args): Promise<unknown> {
  if (name === CHART_TOOL.name) {
    const chart = run.charts.length < 3 ? readChart(args) : null
    if (chart) run.charts.push(chart)
    return chart ? { ok: true, info: 'Grafik ditampilkan ke pengguna.' } : { ok: false, error: 'Data grafik tidak valid atau sudah 3 grafik.' }
  }
  const tool = run.tools.find((t) => t.name === name)
  if (!tool) return { error: 'Alat tidak tersedia untuk pengguna ini.' }
  try {
    const result = await runTool(tool, args ?? {}, run.user)
    run.sources.add(tool.label)
    return result
  } catch (e) {
    return { error: `Data gagal diambil: ${(e as Error).message}`.slice(0, 300) }
  }
}
// Skema alat gaya Gemini (OBJECT/STRING) -> JSON Schema standar (object/string) untuk Claude & ChatGPT
function jsonSchema(s?: Schema): Record<string, unknown> {
  if (!s) return { type: 'object', properties: {} }
  const out: Record<string, unknown> = { type: s.type.toLowerCase() }
  if (s.description) out.description = s.description
  if (s.enum) out.enum = s.enum
  if (s.items) out.items = jsonSchema(s.items)
  if (s.properties) out.properties = Object.fromEntries(Object.entries(s.properties).map(([k, v]) => [k, jsonSchema(v)]))
  if (s.required) out.required = s.required
  return out
}
const allDeclarations = (tools: Tool[]) => [...tools.map((t) => ({ name: t.name, description: t.description, parameters: t.parameters })), CHART_TOOL as { name: string; description: string; parameters?: Schema }]
const TOO_LONG = 'Analisis terlalu panjang untuk diselesaikan sekaligus. Coba persempit pertanyaannya (mis. satu sektor atau satu periode).'
const EMPTY = 'Maaf, PAP AI belum bisa menjawab pertanyaan itu. Coba tanyakan dengan kalimat lain.'
// Kesalahan penyedia: router mencoba penyedia berikutnya
class ProviderError extends Error {}

// ---------- Gemini ----------
type Part = { text?: string; functionCall?: { id?: string; name: string; args?: Args }; functionResponse?: unknown; thought?: boolean; thoughtSignature?: string }
type Content = { role: 'user' | 'model'; parts: Part[] }
const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models'
type GeminiJson = { candidates?: { content?: Content; finishReason?: string }[]; error?: { message?: string; code?: number } }

// Model penuh -> langsung pindah ke model cadangan
async function gemini(apiKey: string, models: string[], body: unknown) {
  for (const model of [...new Set(models)]) {
    const started = Date.now()
    const res = await fetch(`${GEMINI_URL}/${model}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(40_000),
    }).catch((e: Error) => { throw new ProviderError(e.name === 'TimeoutError' ? 'Gemini terlalu lama menjawab.' : 'Gemini tidak bisa dihubungi.') })
    const json = (await res.json().catch(() => ({}))) as GeminiJson
    if (res.ok) {
      console.log(`[ai] gemini ${model} ${Date.now() - started} ms`)
      return json.candidates?.[0]?.content ?? { role: 'model' as const, parts: [] }
    }
    console.error('Gemini error', model, res.status, json.error?.message)
    if (![429, 500, 503].includes(res.status)) break
  }
  throw new ProviderError('Gemini sedang padat atau menolak permintaan.')
}

async function askGemini(run: Run, history: ChatMessage[], system: string) {
  const apiKey = (await aiKey('gemini'))!
  const models = [await aiModel('gemini'), process.env.GEMINI_FALLBACK_MODEL || 'gemini-3-flash-preview']
  const contents: Content[] = history.map((m) => ({ role: m.role, parts: [{ text: m.text }] }))
  const declarations = allDeclarations(run.tools).map((d) => ({ name: d.name, description: d.description, ...(d.parameters ? { parameters: d.parameters } : {}) }))
  for (let round = 0; round < 6; round++) {
    const content = await gemini(apiKey, models, {
      systemInstruction: { parts: [{ text: system }] },
      contents,
      tools: [{ functionDeclarations: declarations }],
      generationConfig: { temperature: 0.3, maxOutputTokens: 4096, thinkingConfig: { thinkingLevel: 'low' } },
    })
    const parts = content.parts ?? []
    const calls = parts.filter((p) => p.functionCall)
    if (!calls.length) return parts.filter((p) => p.text && !p.thought).map((p) => p.text).join('').trim() || EMPTY
    // Kembalikan isi model apa adanya (termasuk thoughtSignature), lalu hasil semua alat (paralel)
    contents.push({ role: 'model', parts })
    const responses: Part[] = await Promise.all(calls.map(async ({ functionCall: call }) => ({
      functionResponse: { ...(call!.id ? { id: call!.id } : {}), name: call!.name, response: { result: await execCall(run, call!.name, call!.args ?? {}) } },
    })))
    contents.push({ role: 'user', parts: responses })
  }
  return TOO_LONG
}

// ---------- Claude (Anthropic SDK, manual loop: alat SIMPAP dipakai bersama penyedia lain) ----------
async function askClaude(run: Run, history: ChatMessage[], system: string) {
  const client = new Anthropic({ apiKey: (await aiKey('claude'))!, timeout: 90_000, maxRetries: 1 })
  const model = await aiModel('claude')
  const tools: Anthropic.Beta.BetaTool[] = allDeclarations(run.tools).map((d) => ({ name: d.name, description: d.description, input_schema: jsonSchema(d.parameters) as Anthropic.Beta.BetaTool.InputSchema }))
  const messages: Anthropic.Beta.BetaMessageParam[] = history.map((m) => ({ role: m.role === 'model' ? 'assistant' : 'user', content: m.text }))
  for (let round = 0; round < 8; round++) {
    const started = Date.now()
    let res: Anthropic.Beta.BetaMessage
    try {
      res = await client.beta.messages.create({
        model,
        max_tokens: 16000,
        // Prompt sistem stabil per hari -> di-cache (lebih cepat & murah untuk pertanyaan berikutnya)
        system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
        tools,
        messages,
        output_config: { effort: 'medium' },
        // Bila Claude menolak karena kebijakan keamanan, server langsung meneruskan ke model cadangan
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
      })
    } catch (error) {
      if (error instanceof Anthropic.AuthenticationError) throw new ProviderError('Kunci API Claude ditolak.')
      if (error instanceof Anthropic.RateLimitError) throw new ProviderError('Claude sedang sibuk (batas pemakaian).')
      if (error instanceof Anthropic.APIError) throw new ProviderError(`Claude error ${error.status ?? ''}`.trim())
      throw new ProviderError('Claude tidak bisa dihubungi.')
    }
    console.log(`[ai] claude ${res.model} ${Date.now() - started} ms (${res.stop_reason})`)
    if (res.stop_reason === 'refusal') throw new ProviderError('Claude tidak menjawab pertanyaan ini.')
    const calls = res.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use')
    if (res.stop_reason !== 'tool_use' || !calls.length) {
      if (res.stop_reason === 'pause_turn') { messages.push({ role: 'assistant', content: res.content }); continue }
      return res.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text').map((b) => b.text).join('').trim() || EMPTY
    }
    // Isi jawaban dikembalikan utuh (termasuk blok thinking), lalu semua hasil alat dalam SATU pesan user
    messages.push({ role: 'assistant', content: res.content })
    const results: Anthropic.Beta.BetaToolResultBlockParam[] = await Promise.all(calls.map(async (c) => ({
      type: 'tool_result' as const, tool_use_id: c.id, content: JSON.stringify(await execCall(run, c.name, (c.input ?? {}) as Args)),
    })))
    messages.push({ role: 'user', content: results })
  }
  return TOO_LONG
}

// ---------- ChatGPT (OpenAI Chat Completions, REST) ----------
type OaiMessage = { role: 'system' | 'user' | 'assistant' | 'tool'; content: string | null; tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[]; tool_call_id?: string }
async function askOpenAI(run: Run, history: ChatMessage[], system: string) {
  const apiKey = (await aiKey('openai'))!
  const model = await aiModel('openai')
  const tools = allDeclarations(run.tools).map((d) => ({ type: 'function', function: { name: d.name, description: d.description, parameters: jsonSchema(d.parameters) } }))
  const messages: OaiMessage[] = [{ role: 'system', content: system }, ...history.map((m) => ({ role: m.role === 'model' ? 'assistant' as const : 'user' as const, content: m.text }))]
  for (let round = 0; round < 8; round++) {
    const started = Date.now()
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, messages, tools }),
      signal: AbortSignal.timeout(90_000),
    }).catch(() => { throw new ProviderError('ChatGPT tidak bisa dihubungi.') })
    const json = (await res.json().catch(() => ({}))) as { choices?: { message?: OaiMessage; finish_reason?: string }[]; error?: { message?: string } }
    if (!res.ok) {
      console.error('OpenAI error', model, res.status, json.error?.message)
      throw new ProviderError(res.status === 401 ? 'Kunci API ChatGPT ditolak.' : `ChatGPT error ${res.status}`)
    }
    console.log(`[ai] openai ${model} ${Date.now() - started} ms`)
    const msg = json.choices?.[0]?.message
    if (!msg) throw new ProviderError('ChatGPT tidak mengembalikan jawaban.')
    if (!msg.tool_calls?.length) return (msg.content ?? '').trim() || EMPTY
    messages.push({ role: 'assistant', content: msg.content ?? null, tool_calls: msg.tool_calls })
    const results = await Promise.all(msg.tool_calls.map(async (c) => {
      let args: Args = {}
      try { args = JSON.parse(c.function.arguments || '{}') } catch { /* argumen rusak: jalankan dengan default */ }
      return { role: 'tool' as const, tool_call_id: c.id, content: JSON.stringify(await execCall(run, c.function.name, args)) }
    }))
    messages.push(...results)
  }
  return TOO_LONG
}

// ---------- Router: pilih model otomatis, pindah ke penyedia lain bila gagal ----------
const ASK: Record<AiProvider, (run: Run, history: ChatMessage[], system: string) => Promise<string>> = { gemini: askGemini, claude: askClaude, openai: askOpenAI }

export async function aiEnabled() {
  return (await Promise.all((['gemini', 'claude', 'openai'] as AiProvider[]).map((p) => aiKey(p)))).some(Boolean)
}

export async function askAssistant(user: UserProfile, history: ChatMessage[]): Promise<AiReply> {
  const question = history[history.length - 1]?.text ?? ''
  const order = await providerOrder(question)
  if (!order.length) fail(503, 'PAP AI belum dikonfigurasi. Isi kunci API Gemini / Claude / ChatGPT di Pengaturan > IT.')
  const tools = TOOLS.filter((t) => t.allowed(user))
  const system = systemPrompt(user, tools)
  const errors: string[] = []
  for (const provider of order) {
    // Grafik & sumber dimulai bersih untuk tiap penyedia agar tidak tercampur saat pindah
    const run: Run = { user, tools, charts: [], sources: new Set() }
    const started = Date.now()
    try {
      const reply = await ASK[provider](run, history, system)
      console.log(`[ai] dijawab ${provider} dalam ${Date.now() - started} ms`)
      return { reply, charts: run.charts, sources: [...run.sources], model: `${PROVIDERS[provider].label} · ${await aiModel(provider)}` }
    } catch (error) {
      if (!(error instanceof ProviderError)) throw error
      console.error(`[ai] ${provider} gagal, coba penyedia berikutnya:`, error.message)
      errors.push(`${PROVIDERS[provider].label}: ${error.message}`)
    }
  }
  return fail(502, `PAP AI sedang tidak bisa menjawab (${errors.join('; ')}). Coba lagi beberapa saat lagi.`)
}

// Menu yang memberi akses data untuk saran pertanyaan di panel
export function assistantCapabilities(user: UserProfile) {
  return { sales: has(user, ...SALES_MENUS), customer: has(user, 'customer', 'repeat-order', 'order-bulanan'), prospek: has(user, 'prospek'), keuangan: has(user, ...ACCOUNTING_MENUS) }
}

