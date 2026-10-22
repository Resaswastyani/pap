// Validasi isian Accounting (rencana kas & pelaporan pajak)
import { fail, str } from '@/lib/api'
import { isDate, isPeriode, TAX_TYPES } from '@/lib/accounting'

const money = (v: unknown, label: string, required = true) => {
  if (v === '' || v === null || v === undefined) return required ? fail(400, `${label} wajib diisi.`) : null
  const n = Number(String(v).replace(',', '.'))
  if (!Number.isFinite(n) || n < 0 || n > 1e14) fail(400, `${label} tidak valid.`)
  return n
}
const optDate = (v: unknown, label: string) => {
  const s = str(v, 10)
  if (!s) return null
  if (!isDate(s)) fail(400, `${label} tidak valid.`)
  return s
}

export function readPlan(body: Record<string, unknown>) {
  const jenis = body.jenis === 'masuk' ? 'masuk' : body.jenis === 'keluar' ? 'keluar' : fail(400, 'Pilih jenis rencana (masuk / keluar).')
  const kategori = str(body.kategori, 100) || fail(400, 'Kategori wajib diisi.')
  const tanggal = optDate(body.tanggal, 'Tanggal') ?? fail(400, 'Tanggal wajib diisi.')
  const berulang = ['sekali', 'mingguan', 'bulanan'].includes(String(body.berulang)) ? (body.berulang as 'sekali' | 'mingguan' | 'bulanan') : 'sekali'
  const sampai = berulang === 'sekali' ? null : optDate(body.sampai, 'Tanggal akhir')
  if (sampai && sampai < tanggal) fail(400, 'Tanggal akhir harus setelah tanggal mulai.')
  return { jenis, kategori, keterangan: str(body.keterangan, 500) || null, tanggal, nominal: money(body.nominal, 'Nominal') as number, berulang, sampai, aktif: body.aktif === false ? 0 : 1 }
}

export function readFiling(body: Record<string, unknown>) {
  const masa = str(body.masa, 7)
  if (!isPeriode(masa)) fail(400, 'Masa pajak tidak valid.')
  const jenis = str(body.jenis, 30)
  if (!jenis || (!(jenis in TAX_TYPES) && !/^lainnya/.test(jenis))) fail(400, 'Jenis pajak tidak valid.')
  return {
    masa, jenis, nominal: money(body.nominal, 'Nominal', false), tgl_setor: optDate(body.tgl_setor, 'Tanggal setor'), ntpn: str(body.ntpn, 40) || null,
    tgl_lapor: optDate(body.tgl_lapor, 'Tanggal lapor'), no_bukti: str(body.no_bukti, 80) || null, catatan: str(body.catatan, 1000) || null,
  }
}
