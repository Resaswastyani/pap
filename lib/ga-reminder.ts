// Pengingat General Affair di dashboard: tagihan & langganan yang harus dibayar bulan ini (dari Data GA) dan
// pengajuan pembelian GA yang perlu disetujui / dibeli. Status bayar mengikuti centang "Sudah" per bulan di
// spreadsheet GA (nomor HP & WiFi); langganan dihitung dari tanggal jatuh tempo dan siklusnya.
import type { RowDataPacket } from 'mysql2'
import { db } from '@/lib/db'

type Row = RowDataPacket & Record<string, unknown>
export type GaTagihan = {
  jenis: 'langganan' | 'wifi' | 'hp'; id: number; nama: string; detail: string | null; biaya: number | null
  jatuh_tempo: string | null; status: 'lunas' | 'belum' | 'lewat'
}
export type GaPembelian = { id: number; nomor: string | null; judul: string; kategori: string; prioritas: string; status: 'diajukan' | 'disetujui'; dibutuhkan: string | null; estimasi: number }

const pad = (n: number) => String(n).padStart(2, '0')
const json = (v: unknown): Record<string, boolean> => {
  if (!v) return {}
  if (typeof v !== 'string') return v as Record<string, boolean>
  try { return JSON.parse(v) } catch { return {} }
}
const aktif = (status: unknown) => !/tidak|non|berhenti|mati/i.test(String(status ?? ''))

export async function gaReminder() {
  const today = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10)
  const bulan = today.slice(0, 7)
  const [y, m] = bulan.split('-').map(Number)
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate()
  const akhirBulan = `${bulan}-${pad(lastDay)}`
  const tanggalIni = (day: number) => `${bulan}-${pad(Math.min(Math.max(day, 1), lastDay))}`
  const status = (due: string | null, lunas: boolean): GaTagihan['status'] => (lunas ? 'lunas' : due && due < today ? 'lewat' : 'belum')

  const [[subs], [wifi], [phones], [requests]] = await Promise.all([
    db.query<Row[]>("SELECT id, nama, kategori, vendor, biaya, siklus, DATE_FORMAT(jatuh_tempo, '%Y-%m-%d') AS jatuh_tempo, metode_bayar, status FROM ga_subscriptions"),
    db.query<Row[]>('SELECT id, nama, provider, id_pelanggan, biaya, tgl_tagihan, pembayaran FROM ga_wifi'),
    db.query<Row[]>("SELECT id, nomor, ket, provider, DATE_FORMAT(masa_aktif, '%Y-%m-%d') AS masa_aktif, pembayaran FROM ga_phones"),
    db.query<Row[]>(
      `SELECT r.id, r.nomor, r.judul, r.kategori, r.prioritas, r.status, DATE_FORMAT(r.dibutuhkan, '%Y-%m-%d') AS dibutuhkan,
         COALESCE((SELECT SUM(i.jumlah * COALESCE(i.harga_estimasi, 0)) FROM ga_purchase_request_items i WHERE i.request_id = r.id), 0) AS estimasi
       FROM ga_purchase_requests r WHERE r.status IN ('diajukan', 'disetujui')
       ORDER BY r.status = 'disetujui' DESC, FIELD(r.prioritas, 'darurat', 'tinggi', 'normal'), r.dibutuhkan IS NULL, r.dibutuhkan, r.id`,
    ),
  ])

  const tagihan: GaTagihan[] = []
  // Langganan aktif: bulanan jatuh tempo tiap bulan pada tanggal yang sama; tahunan / lainnya pada tanggalnya.
  // Tanggal jatuh tempo sudah lewat bulan ini berarti sudah diperpanjang (dianggap lunas bulan ini).
  for (const s of subs) {
    if (!aktif(s.status) || !s.jatuh_tempo) continue
    const due = String(s.jatuh_tempo)
    const detail = [s.vendor, s.siklus, s.metode_bayar].filter(Boolean).join(' · ') || null
    const base = { jenis: 'langganan' as const, id: Number(s.id), nama: String(s.nama), detail, biaya: s.biaya == null ? null : Number(s.biaya) }
    if (/bulan/i.test(String(s.siklus ?? '')) || !s.siklus) {
      if (due > akhirBulan) tagihan.push({ ...base, jatuh_tempo: tanggalIni(Number(due.slice(8, 10))), status: 'lunas' })
      // Tanggal di bulan lalu yang belum dimajukan = belum dibayar / belum dicatat (lewat)
      else tagihan.push({ ...base, jatuh_tempo: due, status: status(due, false) })
    } else if (due <= akhirBulan) {
      tagihan.push({ ...base, jatuh_tempo: due, status: status(due, false) })
    }
  }
  // WiFi: tagihan tiap bulan pada tanggal tagihan, lunas bila bulan ini dicentang "Sudah"
  for (const w of wifi) {
    const pay = json(w.pembayaran)
    const due = w.tgl_tagihan ? tanggalIni(Number(w.tgl_tagihan)) : null
    tagihan.push({
      jenis: 'wifi', id: Number(w.id), nama: String(w.nama), detail: [w.provider, w.id_pelanggan ? `ID ${w.id_pelanggan}` : null].filter(Boolean).join(' · ') || null,
      biaya: w.biaya == null ? null : Number(w.biaya), jatuh_tempo: due, status: status(due, !!pay[bulan]),
    })
  }
  // Nomor HP: pulsa / paket bulan ini (bila sheet punya kolom bulan ini) dan masa aktif yang habis bulan ini atau sudah lewat
  for (const p of phones) {
    const pay = json(p.pembayaran)
    const masa = p.masa_aktif ? String(p.masa_aktif) : null
    const detail = [p.ket, p.provider].filter(Boolean).join(' · ') || null
    const habis = masa !== null && masa <= akhirBulan
    if (bulan in pay || habis) {
      tagihan.push({ jenis: 'hp', id: Number(p.id), nama: String(p.nomor), detail: habis ? `${detail ? `${detail} · ` : ''}masa aktif ${masa}` : detail, biaya: null, jatuh_tempo: habis ? masa : null, status: pay[bulan] ? 'lunas' : status(habis ? masa : null, false) })
    }
  }
  const ORDER = { lewat: 0, belum: 1, lunas: 2 }
  tagihan.sort((a, b) => ORDER[a.status] - ORDER[b.status] || (a.jatuh_tempo ?? '9999').localeCompare(b.jatuh_tempo ?? '9999') || a.nama.localeCompare(b.nama))

  const belum = tagihan.filter((t) => t.status !== 'lunas')
  const pembelian: GaPembelian[] = requests.map((r) => ({
    id: Number(r.id), nomor: (r.nomor as string) ?? null, judul: String(r.judul), kategori: String(r.kategori), prioritas: String(r.prioritas),
    status: r.status as GaPembelian['status'], dibutuhkan: (r.dibutuhkan as string) ?? null, estimasi: Number(r.estimasi ?? 0),
  }))
  return {
    bulan, tagihan, pembelian,
    ringkasan: {
      belum: belum.length, lewat: belum.filter((t) => t.status === 'lewat').length, lunas: tagihan.length - belum.length,
      nominal_belum: belum.reduce((s, t) => s + (t.biaya ?? 0), 0),
      perlu_dibeli: pembelian.filter((p) => p.status === 'disetujui').length, perlu_disetujui: pembelian.filter((p) => p.status === 'diajukan').length,
    },
  }
}
