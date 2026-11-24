// Analisa Aspek Teknik atas Rencana Order Baru / Spec Baru (Marketing -> Teknik -> Direksi).
// Bagian Marketing diisi Marketing; analisa proses & kesimpulan diisi Dept Teknik; rekomendasi oleh Direksi (GM / admin).
import type { RowDataPacket } from 'mysql2'
import { fail, str } from '@/lib/api'
import { db } from '@/lib/db'
import { notify } from '@/lib/notifications'
import { pushToUsers } from '@/lib/push'
import { isManagement, type UserProfile } from '@/lib/users'

export const TA_STATUS = { draft: 'Draft (pengaju)', diserahkan: 'Diserahkan ke Teknik', dianalisa: 'Dianalisa Teknik', selesai: 'Selesai (Direksi)' } as const
export type TaStatus = keyof typeof TA_STATUS

// Urutan mesin / proses sesuai formulir Dept Teknik
export const MACHINES: { mesin: string; kec_label: string }[] = [
  { mesin: 'Inline Blow-Roto', kec_label: 'Kec Inverter Blow' },
  { mesin: 'Inline Blow Roto Gusset', kec_label: 'Kec Inverter Blow' },
  { mesin: 'Inline Blow Roto Slitting', kec_label: 'Kec Inverter Blow' },
  { mesin: 'Inline Blow-Roto-Pillow Case', kec_label: 'Kec Inverter Blow' },
  { mesin: 'Cutseal POLOS', kec_label: 'Kec' },
  { mesin: 'CutSeal SENSOR GAMBAR', kec_label: 'Kec' },
  { mesin: 'Cutting dng Mesin Cutseal POLOS', kec_label: 'Kec' },
  { mesin: 'Cutting dng Mesin Cutseal SENSOR GAMBAR', kec_label: '' },
  { mesin: 'Cutseal Hanger POLOS', kec_label: '' },
  { mesin: 'Cutseal Hanger SENSOR GAMBAR', kec_label: '' },
  { mesin: 'Slitting', kec_label: 'Kec Inverter' },
  { mesin: 'Hanger Manual', kec_label: 'Kec' },
  { mesin: 'Las Plat Manual', kec_label: 'Kec' },
  { mesin: 'Mesin Penggulung Plastik', kec_label: 'Kec Inverter' },
  { mesin: 'Sideseal Manual', kec_label: '' },
  { mesin: 'Mesin Cutting Mika', kec_label: '' },
]
// kec_roto_max: kecepatan roto maksimum; jalur: jumlah jalur; tumpuk: jumlah tumpuk
export type ProsesRow = { mesin: string; kec_label: string; dipakai: boolean; kecepatan: string; kec_roto_max: string; jalur: string; tumpuk: string; keterangan: string; produktivitas: number | null }
export const defaultProses = (): ProsesRow[] => MACHINES.map((m) => ({ ...m, dipakai: false, kecepatan: '', kec_roto_max: '', jalur: '', tumpuk: '', keterangan: '', produktivitas: null }))

const MARKETING = (u: UserProfile) => u.division.code === 'marketing' || u.division.code.startsWith('marketing_')
export function requireTechAnalysis(user: UserProfile) {
  if (!user.role.isAdmin && !TA_MENUS.some((m) => user.menus.includes(m as never))) fail(403, 'Anda tidak punya akses ke Analisa Teknik Order.')
}
// Menu yang membuka Analisa Teknik Order (termasuk desain Master Data & lampiran gambarnya)
export const TA_MENUS = ['prospek', 'analisa-teknik', 'analisa-teknik-mkt', 'analisa-teknik-ppic', 'produk']
export const hasTechAnalysisMenu = (user: UserProfile) => user.role.isAdmin || TA_MENUS.some((m) => user.menus.includes(m as never))
export const canPpicSection = (u: UserProfile) => u.role.isAdmin || isManagement(u) || u.division.code === 'ppic'
// Pengaju (isi spek order & serahkan ke Teknik): Marketing atau PPIC
export const canSubmitSection = (u: UserProfile) => canMarketingSection(u) || canPpicSection(u)
export const canMarketingSection = (u: UserProfile) => u.role.isAdmin || isManagement(u) || MARKETING(u)
export const canTeknikSection = (u: UserProfile) => u.role.isAdmin || u.division.code === 'teknik'
export const canDireksiSection = (u: UserProfile) => isManagement(u)

type Row = RowDataPacket & Record<string, unknown>
const num = (v: unknown) => (v === null || v === undefined || v === '' ? null : Number(v))
const parse = <T>(v: unknown, fallback: T): T => { try { return v ? (JSON.parse(String(v)) as T) : fallback } catch { return fallback } }

const SELECT = `SELECT a.*, DATE_FORMAT(a.tanggal_serah, '%Y-%m-%d') AS tanggal_serah, p.nama_usaha AS prospect_name,
    uc.name AS created_name, ut.name AS teknik_name, ud.name AS direksi_name
  FROM prospect_tech_analyses a LEFT JOIN prospects p ON p.id = a.prospect_id
  LEFT JOIN users uc ON uc.id = a.created_by LEFT JOIN users ut ON ut.id = a.teknik_oleh LEFT JOIN users ud ON ud.id = a.direksi_oleh`

export function serializeAnalysis(r: Row) {
  const proses = parse<ProsesRow[]>(r.proses, [])
  return {
    id: Number(r.id), nomor: String(r.nomor), prospect_id: num(r.prospect_id), prospect_name: (r.prospect_name as string) ?? null, status: String(r.status) as TaStatus,
    product_id: num(r.product_id), sumber: (r.sumber as string) ?? null, customer_id: num(r.customer_id),
    so_accurate_id: num(r.so_accurate_id), so_number: (r.so_number as string) ?? null,
    jumlah_gambar: num(r.jumlah_gambar), desain: parse<Desain[]>(r.desain, []), roto: (r.roto as 'dengan' | 'tanpa') ?? null,
    tanggal_serah: (r.tanggal_serah as string) ?? null,
    nama_produk: String(r.nama_produk), nama_customer: String(r.nama_customer), jenis_plastik: (r.jenis_plastik as string) ?? null,
    panjang_cm: num(r.panjang_cm), lebar_cm: num(r.lebar_cm), tebal_mm: num(r.tebal_mm), print_jenis: (r.print_jenis as 'polos' | 'print') ?? null,
    jumlah_warna: num(r.jumlah_warna), kesulitan_print: (r.kesulitan_print as string) ?? null, spec_lainnya: (r.spec_lainnya as string) ?? null,
    qty_order: num(r.qty_order), qty_satuan: (r.qty_satuan as string) ?? null, frekuensi: (r.frekuensi as 'sekali' | 'rutin') ?? null, rutin_bulan: num(r.rutin_bulan),
    critical_to_quality: (r.critical_to_quality as string) ?? null,
    // Data lama: tanpa Kec Roto Max / Tumpuk; isian "Tumpuk 2" di kolom Jalur dulu (gabungan) dipindah ke kolom Tumpuk
    proses: proses.length ? proses.map((p) => {
      const lama = p.tumpuk === undefined && /tumpuk/i.test(p.jalur ?? '')
      return { ...p, kec_roto_max: p.kec_roto_max ?? '', jalur: lama ? '' : p.jalur ?? '', tumpuk: lama ? p.jalur.replace(/tumpuk\s*/i, '').trim() : p.tumpuk ?? '' }
    }) : defaultProses(),
    bisa_produksi: (r.bisa_produksi as 'bisa' | 'bersyarat' | 'tidak') ?? null, penjelasan_produksi: (r.penjelasan_produksi as string) ?? null,
    kesulitan_kualitas: (r.kesulitan_kualitas as 'mudah' | 'sedang' | 'sulit') ?? null, penjelasan_kualitas: (r.penjelasan_kualitas as string) ?? null,
    catatan_lain: (r.catatan_lain as string) ?? null,
    teknik_oleh: num(r.teknik_oleh), teknik_name: (r.teknik_name as string) ?? null, teknik_at: r.teknik_at ? String(r.teknik_at) : null,
    rekomendasi_direksi: (r.rekomendasi_direksi as string) ?? null, direksi_oleh: num(r.direksi_oleh), direksi_name: (r.direksi_name as string) ?? null, direksi_at: r.direksi_at ? String(r.direksi_at) : null,
    created_by: num(r.created_by), created_name: (r.created_name as string) ?? null, created_at: String(r.created_at), updated_at: String(r.updated_at),
  }
}
export type TechAnalysis = ReturnType<typeof serializeAnalysis>

export async function loadAnalysis(id: number) {
  const [[r]] = await db.query<Row[]>(`${SELECT} WHERE a.id = ?`, [id])
  if (!r) fail(404, 'Analisa teknik tidak ditemukan.')
  return serializeAnalysis(r!)
}

export async function listAnalyses(params: URLSearchParams) {
  const where: string[] = []
  const args: unknown[] = []
  const prospect = Number(params.get('prospect_id'))
  if (Number.isInteger(prospect) && prospect > 0) where.push('a.prospect_id = ?'), args.push(prospect)
  const product = Number(params.get('product_id'))
  if (Number.isInteger(product) && product > 0) where.push('a.product_id = ?'), args.push(product)
  // sumber=produk: diajukan dari Data Produk; ppic: dari menu PPIC (Sales Order); marketing: semua selain PPIC
  const sumber = params.get('sumber')
  const sumberSql = sumber === 'produk' ? 'a.product_id IS NOT NULL' : sumber === 'ppic' ? "a.sumber = 'ppic'" : sumber === 'marketing' ? "COALESCE(a.sumber, '') <> 'ppic'" : ''
  if (sumberSql) where.push(sumberSql)
  // asal=prospek | so | produk: pembagian data di daftar (Sales Order = diajukan dari SO Accurate / PPIC)
  const asal = params.get('asal')
  if (asal && asal in ASAL_SQL) where.push(ASAL_SQL[asal as keyof typeof ASAL_SQL])
  const status = params.get('status')
  if (status && status in TA_STATUS) where.push('a.status = ?'), args.push(status)
  const q = str(params.get('q'), 100)
  if (q) where.push('(a.nomor LIKE ? OR a.nama_produk LIKE ? OR a.nama_customer LIKE ? OR a.jenis_plastik LIKE ?)'), args.push(...Array(4).fill(`%${q}%`))
  const [rows] = await db.query<Row[]>(
    `${SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY FIELD(a.status, 'diserahkan', 'dianalisa', 'draft', 'selesai'), a.updated_at DESC, a.id DESC LIMIT 500`,
    args,
  )
  const [counts] = await db.query<Row[]>(`SELECT a.status, COUNT(*) AS n FROM prospect_tech_analyses a${sumberSql ? ` WHERE ${sumberSql}` : ''} GROUP BY a.status`)
  // Jumlah per asal data (untuk tab Semua / Prospek / Sales Order / Data Produk)
  const [[asalRow]] = await db.query<Row[]>(
    `SELECT ${Object.entries(ASAL_SQL).map(([k, sql]) => `SUM(${sql}) AS ${k}`).join(', ')}, COUNT(*) AS semua FROM prospect_tech_analyses a${sumberSql ? ` WHERE ${sumberSql}` : ''}`,
  )
  const asalCounts = Object.fromEntries(['semua', ...Object.keys(ASAL_SQL)].map((k) => [k, Number(asalRow?.[k]) || 0]))
  return { items: rows.map(serializeAnalysis), counts: Object.fromEntries(counts.map((c) => [String(c.status), Number(c.n)])), asalCounts }
}

// Asal data analisa: Sales Order (SO Accurate / PPIC) didahulukan; selain itu dari Data Produk atau Prospek
const SO_SQL = "(a.so_accurate_id IS NOT NULL OR a.so_number IS NOT NULL OR a.sumber = 'ppic')"
export const ASAL_SQL = {
  prospek: `(NOT ${SO_SQL} AND a.product_id IS NULL)`,
  so: SO_SQL,
  produk: `(NOT ${SO_SQL} AND a.product_id IS NOT NULL)`,
} as const

export async function nextAnalysisNumber() {
  const year = new Date(Date.now() + 7 * 3600e3).getUTCFullYear()
  const prefix = `AT-${year}-`
  const [[r]] = await db.query<Row[]>('SELECT MAX(CAST(SUBSTRING(nomor, ?) AS UNSIGNED)) AS n FROM prospect_tech_analyses WHERE nomor LIKE ?', [prefix.length + 1, `${prefix}%`])
  return `${prefix}${String((Number(r?.n) || 0) + 1).padStart(4, '0')}`
}

const dec = (v: unknown, label: string, max = 1e9) => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(String(v).replace(',', '.'))
  if (!Number.isFinite(n) || n < 0 || n > max) fail(400, `${label} tidak valid.`)
  return n
}

// Bagian Marketing
export async function readMarketingSection(body: Record<string, unknown>) {
  const nama_produk = str(body.nama_produk, 255) || fail(400, 'Isi nama produk.')
  const nama_customer = str(body.nama_customer, 255) || fail(400, 'Isi nama customer.')
  let prospectId = num(body.prospect_id)
  if (prospectId) {
    const [[p]] = await db.query<Row[]>('SELECT id FROM prospects WHERE id = ?', [prospectId])
    prospectId = p ? Number(p.id) : null
  }
  const print = body.print_jenis === 'print' ? 'print' : body.print_jenis === 'polos' ? 'polos' : null
  const frek = body.frekuensi === 'rutin' ? 'rutin' : body.frekuensi === 'sekali' ? 'sekali' : null
  // Kolom opsional: hanya diubah bila dikirim (form lama / sinkron prospek tidak menimpa data Sales Order)
  const extra: Record<string, unknown> = {}
  if ('desain' in body) extra.desain = JSON.stringify(await readDesain(body.desain))
  if ('customer_id' in body) {
    const cid = num(body.customer_id)
    const [[c]] = cid ? await db.query<Row[]>('SELECT id FROM customers WHERE id = ?', [cid]) : [[undefined]]
    extra.customer_id = c ? Number(c.id) : null
  }
  if ('so_accurate_id' in body) { extra.so_accurate_id = num(body.so_accurate_id); extra.so_number = str(body.so_number, 80) || null }
  return {
    ...extra,
    jumlah_gambar: dec(body.jumlah_gambar, 'Jumlah gambar per kantong', 100),
    prospect_id: prospectId, nama_produk: nama_produk!, nama_customer: nama_customer!, jenis_plastik: str(body.jenis_plastik, 80) || null,
    panjang_cm: dec(body.panjang_cm, 'Panjang', 100000), lebar_cm: dec(body.lebar_cm, 'Lebar', 100000), tebal_mm: dec(body.tebal_mm, 'Tebal', 1000),
    print_jenis: print, jumlah_warna: print === 'print' ? dec(body.jumlah_warna, 'Jumlah warna print', 20) : null, kesulitan_print: str(body.kesulitan_print, 255) || null,
    spec_lainnya: str(body.spec_lainnya, 5000) || null, qty_order: dec(body.qty_order, 'Qty order', 1e12), qty_satuan: str(body.qty_satuan, 20) || 'kg',
    frekuensi: frek, rutin_bulan: frek === 'rutin' ? dec(body.rutin_bulan, 'Rutin per bulan', 120) : null, critical_to_quality: str(body.critical_to_quality, 5000) || null,
  }
}

// File gambar yang diunggah pada analisa (lampiran note_attachments, hanya gambar) untuk lembar cetak
export async function analysisImages(id: number) {
  const [rows] = await db.query<Row[]>("SELECT id, name FROM note_attachments WHERE owner_type = 'tech_analysis' AND owner_id = ? AND kind = 'file' AND mime LIKE 'image/%' ORDER BY id LIMIT 12", [id])
  return rows.map((r) => ({ name: String(r.name), src: `/api/notes/attachments/${Number(r.id)}` }))
}

// Desain dari Master Data (Logo & Desain hasil sinkron Google Drive): hanya id yang ada di drive_files, maks 12
export type Desain = { id: string; name: string; mime: string; web_link: string | null }
export async function readDesain(v: unknown): Promise<Desain[]> {
  const list = (Array.isArray(v) ? v : []).slice(0, 12).map((x) => String((x as Record<string, unknown>)?.id ?? '')).filter(Boolean)
  if (!list.length) return []
  const [rows] = await db.query<Row[]>('SELECT id, name, mime, web_link FROM drive_files WHERE id IN (?)', [list])
  const byId = new Map<string, Desain>(rows.map((r) => [String(r.id), { id: String(r.id), name: String(r.name), mime: String(r.mime ?? ''), web_link: (r.web_link as string | null) ?? null }]))
  return list.map((id) => byId.get(id)).filter((d): d is Desain => !!d)
}

// Bagian Teknik: tabel proses + kesimpulan
export function readTeknikSection(body: Record<string, unknown>) {
  const raw = Array.isArray(body.proses) ? (body.proses as unknown[]).slice(0, 40) : []
  const proses: ProsesRow[] = raw.map((x) => {
    const r = (x ?? {}) as Record<string, unknown>
    return {
      mesin: str(r.mesin, 120), kec_label: str(r.kec_label, 60), dipakai: r.dipakai === true, kecepatan: str(r.kecepatan, 120),
      kec_roto_max: str(r.kec_roto_max, 120), jalur: str(r.jalur, 120), tumpuk: str(r.tumpuk, 120), keterangan: str(r.keterangan, 500),
      produktivitas: dec(r.produktivitas, `Produktivitas ${str(r.mesin, 60)}`, 1e7),
    }
  }).filter((r) => r.mesin)
  return {
    proses: JSON.stringify(proses),
    roto: body.roto === 'dengan' || body.roto === 'tanpa' ? String(body.roto) : null,
    // Tingkat kesulitan print juga bisa diisi / dikoreksi Dept Teknik (kolom sama dengan isian Marketing)
    kesulitan_print: str(body.kesulitan_print, 255) || null,
    bisa_produksi: ['bisa', 'bersyarat', 'tidak'].includes(String(body.bisa_produksi)) ? String(body.bisa_produksi) : null,
    penjelasan_produksi: str(body.penjelasan_produksi, 5000) || null,
    kesulitan_kualitas: ['mudah', 'sedang', 'sulit'].includes(String(body.kesulitan_kualitas)) ? String(body.kesulitan_kualitas) : null,
    penjelasan_kualitas: str(body.penjelasan_kualitas, 5000) || null, catatan_lain: str(body.catatan_lain, 5000) || null,
  }
}

async function usersOf(where: string) {
  const [rows] = await db.query<Row[]>(`SELECT u.id FROM users u JOIN divisions d ON d.id = u.division_id JOIN roles r ON r.id = u.role_id WHERE u.is_active = 1 AND (${where})`)
  return rows.map((r) => Number(r.id))
}
export const teknikUsers = () => usersOf("d.code = 'teknik'")
export const direksiUsers = () => usersOf("d.code = 'general_manager'")

// Teknik / Direksi dibuka ke menu Analisa Teknik Order; Marketing (pembuat) ke prospeknya di menu Prospek
export async function notifyAnalysis(userIds: (number | null)[], a: { id: number; nomor: string; nama_produk: string; nama_customer: string; prospect_id: number | null; sumber?: string | null }, title: string, key: string, exclude?: number, toProspect = false) {
  const users = [...new Set(userIds.filter((x): x is number => !!x && x !== exclude))]
  if (!users.length) return
  // Pengaju dibuka ke menunya sendiri: prospek, menu PPIC, atau menu Pengajuan Analisa Teknik (Marketing)
  const target = toProspect && a.prospect_id ? { page: 'Prospek', pageId: a.prospect_id, prospectId: a.prospect_id }
    : toProspect && a.sumber === 'ppic' ? { page: 'Analisa Teknik PPIC', pageId: a.id }
    : toProspect && a.sumber === 'marketing' ? { page: 'Pengajuan Analisa Teknik', pageId: a.id }
    : { page: 'Analisa Teknik Order', pageId: a.id }
  await pushToUsers(await notify(users, {
    type: 'analisa_teknik', title, body: `${a.nomor} · ${a.nama_produk} · ${a.nama_customer}`, ...target, refKey: `at:${a.id}:${key}`,
  }))
}

// ---- Dari form Prospek: spek teknik per produk -> analisa otomatis dibuat / diperbarui & diserahkan ke Teknik ----
// products: body.products dari form prospek; tiap produk boleh punya { teknik: { minta: true, panjang_cm, ... } }.
// Analisa dicocokkan per nama produk dalam prospek. Yang sudah dianalisa Teknik / selesai tidak diubah lagi dari form.
export async function syncProspectAnalyses(prospectId: number, products: unknown, user: UserProfile) {
  if (!Array.isArray(products) || !canMarketingSection(user)) return { dibuat: 0, diperbarui: 0, dikunci: 0 }
  const [[prospect]] = await db.query<Row[]>('SELECT id, nama_usaha FROM prospects WHERE id = ?', [prospectId])
  if (!prospect) return { dibuat: 0, diperbarui: 0, dikunci: 0 }
  const [rows] = await db.query<Row[]>('SELECT id, nomor, nama_produk, status FROM prospect_tech_analyses WHERE prospect_id = ?', [prospectId])
  const existing = new Map(rows.map((r) => [String(r.nama_produk).trim().toLowerCase(), r]))
  const out = { dibuat: 0, diperbarui: 0, dikunci: 0 }
  const created: { id: number; nomor: string; nama_produk: string }[] = []
  for (const raw of products as Record<string, unknown>[]) {
    const t = (raw?.teknik ?? null) as Record<string, unknown> | null
    const label = str(raw?.label, 255)
    if (!t || t.minta !== true || !label) continue
    const cycle = Number(raw?.cycle_nilai) || null
    const v = await readMarketingSection({
      ...t, prospect_id: prospectId, nama_produk: label, nama_customer: String(prospect.nama_usaha),
      jenis_plastik: raw?.jenis_plastik || t.jenis_plastik, qty_order: t.qty_order || raw?.qty_kg, qty_satuan: t.qty_satuan || 'kg',
      frekuensi: t.frekuensi || (cycle && String(raw?.cycle_satuan ?? 'Bulan') === 'Bulan' ? 'rutin' : null), rutin_bulan: t.rutin_bulan || cycle,
      spec_lainnya: t.spec_lainnya || raw?.catatan,
    })
    const cur = existing.get(label.toLowerCase())
    if (cur) {
      if (cur.status === 'dianalisa' || cur.status === 'selesai') { out.dikunci++; continue }
      await db.query(
        `UPDATE prospect_tech_analyses SET ?, updated_by = ?${cur.status === 'draft' ? ", status = 'diserahkan', tanggal_serah = CURDATE()" : ''} WHERE id = ?`,
        [v, user.id, cur.id],
      )
      if (cur.status === 'draft') created.push({ id: Number(cur.id), nomor: String(cur.nomor), nama_produk: label })
      out.diperbarui++
    } else {
      const nomor = await nextAnalysisNumber()
      const [res] = await db.query<import('mysql2').ResultSetHeader>('INSERT INTO prospect_tech_analyses SET ?', [{
        ...v, nomor, sumber: 'prospek', status: 'diserahkan', tanggal_serah: new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10),
        proses: JSON.stringify(defaultProses()), created_by: user.id, updated_by: user.id,
      }])
      existing.set(label.toLowerCase(), { id: res.insertId, nomor, nama_produk: label, status: 'diserahkan' } as unknown as Row)
      created.push({ id: res.insertId, nomor, nama_produk: label })
      out.dibuat++
    }
  }
  const teknik = created.length ? await teknikUsers() : []
  for (const c of created) {
    await notifyAnalysis(teknik, { ...c, nama_customer: String(prospect.nama_usaha), prospect_id: prospectId }, 'Analisa teknik order baru dari Marketing', 'serah', user.id)
  }
  return out
}

// ---- Dari form Data Produk: centang "Minta analisa ke Dept Teknik" + spek teknik -> analisa per produk ----
// Satu analisa aktif per produk; yang sudah dianalisa Teknik / selesai tidak diubah dari form produk.
export async function syncProductAnalysis(productId: number, teknik: unknown, user: UserProfile) {
  const t = (teknik ?? null) as Record<string, unknown> | null
  if (!t || t.minta !== true) return null
  const [[p]] = await db.query<Row[]>(
    `SELECT cp.id, cp.nama, cp.jenis, cp.spesifikasi, c.name AS customer FROM customer_products cp LEFT JOIN customers c ON c.id = cp.customer_id WHERE cp.id = ?`, [productId],
  )
  if (!p) return null
  const v = await readMarketingSection({
    ...t, prospect_id: null, nama_produk: String(p.nama), nama_customer: String(p.customer ?? '-'),
    jenis_plastik: t.jenis_plastik || p.jenis, spec_lainnya: t.spec_lainnya || p.spesifikasi, qty_satuan: t.qty_satuan || 'kg',
  })
  const [[cur]] = await db.query<Row[]>('SELECT id, nomor, status FROM prospect_tech_analyses WHERE product_id = ? ORDER BY id DESC LIMIT 1', [productId])
  if (cur && (cur.status === 'dianalisa' || cur.status === 'selesai')) return { status: 'dikunci' as const, nomor: String(cur.nomor) }
  let created: { id: number; nomor: string } | null = null
  if (cur) {
    await db.query(
      `UPDATE prospect_tech_analyses SET ?, updated_by = ?${cur.status === 'draft' ? ", status = 'diserahkan', tanggal_serah = CURDATE()" : ''} WHERE id = ?`,
      [v, user.id, cur.id],
    )
    if (cur.status === 'draft') created = { id: Number(cur.id), nomor: String(cur.nomor) }
  } else {
    const nomor = await nextAnalysisNumber()
    const [res] = await db.query<import('mysql2').ResultSetHeader>('INSERT INTO prospect_tech_analyses SET ?', [{
      ...v, product_id: productId, sumber: 'produk', nomor, status: 'diserahkan', tanggal_serah: new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10),
      proses: JSON.stringify(defaultProses()), created_by: user.id, updated_by: user.id,
    }])
    created = { id: res.insertId, nomor }
  }
  if (created) {
    await notifyAnalysis(await teknikUsers(), { ...created, nama_produk: String(p.nama), nama_customer: String(p.customer ?? '-'), prospect_id: null }, 'Analisa teknik order baru (Data Produk)', 'serah', user.id)
    return { status: 'diajukan' as const, nomor: created.nomor }
  }
  return { status: 'diperbarui' as const, nomor: String(cur!.nomor) }
}

// ---- Cetak formulir langsung dari prospek: satu lembar per produk ----
// Produk yang sudah punya analisa memakai isi analisanya; yang belum memakai data prospek (bagian Teknik kosong,
// bisa diisi tangan). Prospek tanpa produk menghasilkan satu formulir kosong bernama customer.
export async function prospectAnalysisSheets(prospectId: number, user: UserProfile) {
  const { loadProspect, loadProspectProducts } = await import('@/lib/marketing')
  const p = await loadProspect(prospectId, user)
  const [products, { items }] = await Promise.all([loadProspectProducts(prospectId), listAnalyses(new URLSearchParams({ prospect_id: String(prospectId) }))])
  const byName = new Map(items.map((a) => [a.nama_produk.trim().toLowerCase(), a]))
  const blank = (nama_produk: string, extra: Record<string, unknown> = {}): TechAnalysis => ({
    id: 0, nomor: 'Belum diajukan', prospect_id: prospectId, prospect_name: String(p.nama_usaha), status: 'draft', tanggal_serah: null,
    nama_produk, nama_customer: String(p.nama_usaha), jenis_plastik: null, panjang_cm: null, lebar_cm: null, tebal_mm: null, print_jenis: null, jumlah_warna: null,
    kesulitan_print: null, spec_lainnya: null, qty_order: null, qty_satuan: 'kg', frekuensi: null, rutin_bulan: null, critical_to_quality: null,
    proses: defaultProses(), bisa_produksi: null, penjelasan_produksi: null, kesulitan_kualitas: null, penjelasan_kualitas: null, catatan_lain: null,
    teknik_oleh: null, teknik_name: null, teknik_at: null, rekomendasi_direksi: null, direksi_oleh: null, direksi_name: null, direksi_at: null,
    created_by: user.id, created_name: user.name, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...extra,
  }) as unknown as TechAnalysis
  const sheets: TechAnalysis[] = (products as unknown as Record<string, unknown>[]).map((x) => {
    const found = byName.get(String(x.label).trim().toLowerCase())
    if (found) return found
    const cycle = x.cycle_nilai ? Number(x.cycle_nilai) : null
    return blank(String(x.label), {
      jenis_plastik: (x.jenis_plastik as string) ?? null, qty_order: num(x.qty_kg),
      spec_lainnya: (x.catatan as string) ?? null, frekuensi: cycle && (x.cycle_satuan ?? 'Bulan') === 'Bulan' ? 'rutin' : null, rutin_bulan: cycle,
    })
  })
  // Analisa milik prospek yang namanya tidak cocok dengan produk saat ini tetap ikut
  for (const a of items) if (!sheets.includes(a)) sheets.push(a)
  if (!sheets.length) sheets.push(blank(''))
  return { prospect: { id: prospectId, nama_usaha: String(p.nama_usaha) }, sheets }
}
