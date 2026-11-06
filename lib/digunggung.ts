// PPN digunggung: faktur diinput manual Accounting per masa pajak, mengikuti template Coretax "Retail XML"
// (RetailInvoiceBulk untuk lampiran SPT Masa PPN I.A.5 / I.A.9 / I.B).
// Nomor otomatis DG.YYYY.MM.0001; nomor faktur pajak opsional. DPP nilai lain = 11/12 x DPP, PPN = 12% x DPP nilai lain.
import type { RowDataPacket } from 'mysql2'
import { fail, str } from '@/lib/api'
import { db } from '@/lib/db'

// Kode transaksi template Retail XML
export const TRX_CODES = { Normal: 'Normal · Lampiran I.A.5', '07': '07 · Lampiran I.A.9 (tidak dipungut)', '08': '08 · Lampiran I.A.9 (dibebaskan)', NoVAT: 'NoVAT · Lampiran I.B (bukan objek PPN)' } as const
export type TrxCode = keyof typeof TRX_CODES
export const BUYER_ID_OPTS = { NIK: 'NIK', TIN: 'NPWP (TIN)' } as const
export const GOOD_SERVICE = { A: 'Barang', B: 'Jasa' } as const
export const NIK_KOSONG = '0000000000000000'
export const NPWP_SETTING = 'pajak.npwp'

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
const digits = (v: unknown) => String(v ?? '').replace(/\D/g, '')

export function readDigunggung(body: Record<string, unknown>) {
  const tanggal = date(body.tanggal, 'Tanggal transaksi', true)!
  const customer = str(body.customer, 200) || fail(400, 'Nama pembeli wajib diisi.')
  const trx = (str(body.trx_code, 10) || 'Normal') as TrxCode
  if (!(trx in TRX_CODES)) fail(400, 'Kode transaksi tidak valid (Normal, 07, 08, NoVAT).')
  const idOpt = (str(body.buyer_id_opt, 5).toUpperCase() === 'NPWP' ? 'TIN' : str(body.buyer_id_opt, 5).toUpperCase() || 'NIK') as keyof typeof BUYER_ID_OPTS
  if (!(idOpt in BUYER_ID_OPTS)) fail(400, 'Jenis ID pembeli harus NIK atau NPWP.')
  const idNumber = digits(body.buyer_id_number) || NIK_KOSONG
  if (idNumber.length !== 16 && !(idOpt === 'TIN' && idNumber.length === 15)) fail(400, `${idOpt === 'TIN' ? 'NPWP' : 'NIK'} pembeli harus 16 digit${idOpt === 'TIN' ? ' (atau 15 digit format lama)' : ''}; isi 0000000000000000 bila tidak ada.`)
  const gs = (str(body.good_service_opt, 1).toUpperCase() || 'A') as keyof typeof GOOD_SERVICE
  if (!(gs in GOOD_SERVICE)) fail(400, 'Barang/Jasa harus A (Barang) atau B (Jasa).')
  const dpp = money(body.dpp, 'DPP') ?? fail(400, 'DPP wajib diisi.')
  // Nilai turunan dihitung bila dikosongkan, tetapi boleh diisi sendiri (pembulatan dari dokumen). NoVAT (I.B): PPN 0.
  const dppNilaiLain = money(body.dpp_nilai_lain, 'DPP nilai lain') ?? Math.round((dpp * 11) / 12)
  const ppn = money(body.ppn, 'PPN') ?? (trx === 'NoVAT' ? 0 : Math.round(dppNilaiLain * 0.12))
  const stlg = money(body.stlg, 'PPnBM') ?? 0
  const total = money(body.total, 'Total') ?? dpp + ppn
  return {
    masa: tanggal.slice(0, 7), tanggal, customer, dpp, dpp_nilai_lain: dppNilaiLain, ppn, total,
    trx_code: trx, buyer_id_opt: idOpt, buyer_id_number: idNumber, good_service_opt: gs, serial_no: str(body.serial_no, 60) || null, stlg, info: str(body.info, 255) || null,
    no_faktur_pajak: str(body.no_faktur_pajak, 60) || null, jatuh_tempo: date(body.jatuh_tempo, 'Jatuh tempo', false), catatan: str(body.catatan, 500) || null,
  }
}
export type DigunggungInput = ReturnType<typeof readDigunggung>

export const DG_COLUMNS = 'masa, nomor, trx_code, tanggal, no_faktur_pajak, customer, buyer_id_opt, buyer_id_number, good_service_opt, serial_no, jatuh_tempo, dpp, dpp_nilai_lain, ppn, stlg, info, total, catatan'
export const dgValues = (v: DigunggungInput, nomor: string) => [
  v.masa, nomor, v.trx_code, v.tanggal, v.no_faktur_pajak, v.customer, v.buyer_id_opt, v.buyer_id_number, v.good_service_opt, v.serial_no, v.jatuh_tempo,
  v.dpp, v.dpp_nilai_lain, v.ppn, v.stlg, v.info, v.total, v.catatan,
]

// Nomor berikutnya untuk masa itu
export async function nextDigunggungNumber(masa: string) {
  const prefix = `DG.${masa.slice(0, 4)}.${masa.slice(5, 7)}.`
  const [[r]] = await db.query<RowDataPacket[]>('SELECT MAX(CAST(SUBSTRING(nomor, ?) AS UNSIGNED)) AS n FROM tax_digunggung WHERE nomor LIKE ?', [prefix.length + 1, `${prefix}%`])
  return `${prefix}${String(Number(r?.n ?? 0) + 1).padStart(4, '0')}`
}

export async function loadNpwp() {
  const [[r]] = await db.query<RowDataPacket[]>('SELECT value FROM app_settings WHERE `key` = ?', [NPWP_SETTING])
  return r?.value ? String(r.value) : ''
}
export function readNpwp(v: unknown) {
  const n = digits(v)
  if (n.length !== 16 && n.length !== 15) fail(400, 'NPWP penjual harus 16 digit (atau 15 digit format lama).')
  return n
}
export async function saveNpwp(npwp: string) {
  await db.query('INSERT INTO app_settings (`key`, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)', [NPWP_SETTING, npwp])
}

// Faktur digunggung satu masa, urut tanggal (untuk tabel, unduhan XML / Excel / PDF)
export async function loadDigunggungMasa(masa: string) {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT d.*, u.name AS updated_name FROM tax_digunggung d LEFT JOIN users u ON u.id = COALESCE(d.updated_by, d.created_by)
     WHERE d.masa = ? ORDER BY d.tanggal, d.nomor`, [masa],
  )
  const num = (v: unknown) => Number(v ?? 0)
  return rows.map((r) => ({
    ...(r as RowDataPacket & { id: number; nomor: string; trx_code: TrxCode; tanggal: string; customer: string; buyer_id_opt: string; buyer_id_number: string; good_service_opt: string; serial_no: string | null; info: string | null }),
    dpp: num(r.dpp), dpp_nilai_lain: num(r.dpp_nilai_lain), ppn: num(r.ppn), stlg: num(r.stlg), total: num(r.total),
  }))
}
export type DigunggungRow = Awaited<ReturnType<typeof loadDigunggungMasa>>[number]

// ---- XML Coretax (RetailInvoiceBulk) ----
const x = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')
const amount = (n: number) => String(Math.round(n))
export function retailXml(npwp: string, masa: string, rows: DigunggungRow[]) {
  const list = rows.map((r) => `		<RetailInvoice>
			<TrxCode>${x(r.trx_code)}</TrxCode>
			<BuyerName>${x(r.customer)}</BuyerName>
			<BuyerIdOpt>${x(r.buyer_id_opt)}</BuyerIdOpt>
			<BuyerIdNumber>${x(r.buyer_id_number)}</BuyerIdNumber>
			<GoodServiceOpt>${x(r.good_service_opt)}</GoodServiceOpt>
			<SerialNo>${x(r.serial_no || r.nomor)}</SerialNo>
			<TransactionDate>${String(r.tanggal).slice(0, 10)}</TransactionDate>
			<TaxBaseSellingPrice>${amount(r.dpp)}</TaxBaseSellingPrice>
			<OtherTaxBaseSellingPrice>${amount(r.dpp_nilai_lain || r.dpp)}</OtherTaxBaseSellingPrice>
			<VAT>${amount(r.ppn)}</VAT>
			<STLG>${amount(r.stlg)}</STLG>
			${r.info ? `<Info>${x(r.info)}</Info>` : '<Info/>'}
		</RetailInvoice>`).join('\n')
  return `<?xml version="1.0" encoding="utf-8" ?>
<RetailInvoiceBulk xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="schema.xsd">
	<TIN>${x(npwp)}</TIN>
	<TaxPeriodMonth>${Number(masa.slice(5, 7))}</TaxPeriodMonth>
	<TaxPeriodYear>${masa.slice(0, 4)}</TaxPeriodYear>
	<ListOfRetailInvoice>
${list}
	</ListOfRetailInvoice>
</RetailInvoiceBulk>
`
}
