// PPN digunggung: faktur diinput manual Accounting per masa pajak.
// Nomor otomatis DG.YYYY.MM.0001; nomor faktur pajak opsional. DPP nilai lain = 11/12 x DPP, PPN = 12% x DPP nilai lain.
import type { RowDataPacket } from 'mysql2'
import { fail, str } from '@/lib/api'
import { db } from '@/lib/db'

const money = (v: unknown, label: string) => {
  if (v === '' || v === null || v === undefined) return null
  const n = Number(String(v).replace(/\./g, '').replace(',', '.'))
  if (!Number.isFinite(n) || n < 0 || n > 1e14) fail(400, `${label} tidak valid.`)
  return Math.round(n * 100) / 100
}
const date = (v: unknown, label: string, required: boolean) => {
  const s = str(v, 10)
  if (!s) return required ? fail(400, `${label} wajib diisi.`) : null
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : fail(400, `${label} tidak valid.`)
}

export function readDigunggung(body: Record<string, unknown>) {
  const tanggal = date(body.tanggal, 'Tanggal faktur', true)!
  const customer = str(body.customer, 200) || fail(400, 'Customer wajib diisi.')
  const dpp = money(body.dpp, 'DPP') ?? fail(400, 'DPP wajib diisi.')
  // Nilai turunan dihitung bila dikosongkan, tetapi boleh diisi sendiri (pembulatan dari dokumen)
  const dppNilaiLain = money(body.dpp_nilai_lain, 'DPP nilai lain') ?? Math.round((dpp * 11) / 12)
  const ppn = money(body.ppn, 'PPN') ?? Math.round(dppNilaiLain * 0.12)
  const total = money(body.total, 'Total') ?? dpp + ppn
  return {
    masa: tanggal.slice(0, 7), tanggal, customer, dpp, dpp_nilai_lain: dppNilaiLain, ppn, total,
    no_faktur_pajak: str(body.no_faktur_pajak, 60) || null, jatuh_tempo: date(body.jatuh_tempo, 'Jatuh tempo', false), catatan: str(body.catatan, 500) || null,
  }
}

// Nomor berikutnya untuk masa itu
export async function nextDigunggungNumber(masa: string) {
  const prefix = `DG.${masa.slice(0, 4)}.${masa.slice(5, 7)}.`
  const [[r]] = await db.query<RowDataPacket[]>('SELECT MAX(CAST(SUBSTRING(nomor, ?) AS UNSIGNED)) AS n FROM tax_digunggung WHERE nomor LIKE ?', [prefix.length + 1, `${prefix}%`])
  return `${prefix}${String(Number(r?.n ?? 0) + 1).padStart(4, '0')}`
}
