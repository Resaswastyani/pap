import { fail, handle, requireUser } from '@/lib/api'
import { isPeriode, requireAccounting } from '@/lib/accounting'
import { GOOD_SERVICE, loadDigunggungMasa, loadNpwp, retailXml, TRX_CODES } from '@/lib/digunggung'
import { writeXlsx, type XlsxCell } from '@/lib/xlsx-write'

// Unduh laporan PPN digunggung satu masa: ?masa=YYYY-MM &format=xml (Coretax RetailInvoiceBulk) | xlsx (format template "Retail_XML")
// PDF: halaman cetak /cetak/ppn-digunggung?masa=
export const GET = handle(async (request: Request) => {
  const user = await requireUser()
  requireAccounting(user, 'pajak')
  const params = new URL(request.url).searchParams
  const masa = params.get('masa')
  if (!isPeriode(masa)) fail(400, 'Masa pajak tidak valid.')
  const rows = await loadDigunggungMasa(masa!)
  if (!rows.length) fail(404, 'Belum ada PPN digunggung pada masa ini.')
  const npwp = await loadNpwp()
  const name = `PPN Digunggung ${masa}`
  const headers = (type: string, file: string) => ({
    'Content-Type': type, 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(file)}`, 'Cache-Control': 'no-store',
  })

  if (params.get('format') === 'xml') {
    if (!npwp) fail(400, 'Isi NPWP penjual (TIN) terlebih dahulu di bagian PPN digunggung.')
    return new Response(retailXml(npwp, masa!, rows), { headers: headers('application/xml; charset=utf-8', `${name}.xml`) })
  }

  // Excel dengan susunan sama seperti sheet DATA template, jadi bisa diunggah kembali / dibuka di template Coretax
  const head = ['', 'TrxCode', 'BuyerName', 'BuyerIdOpt', 'BuyerIdNumber', 'GoodServiceOpt', 'SerialNo', 'TransactionDate', 'TaxBaseSellingPrice', 'OtherTaxBaseSellingPrice', 'VAT', 'STLG', 'Info']
  const data: XlsxCell[][] = [
    [{ v: 'NPWP', s: 'head' }, npwp || ''],
    [{ v: 'Masa Pajak', s: 'head' }, masa!.slice(5, 7)],
    [{ v: 'Tahun Pajak', s: 'head' }, masa!.slice(0, 4)],
    head.map((h) => (h ? { v: h, s: 'head' as const } : '')),
    ...rows.map((r) => ['', r.trx_code, r.customer, r.buyer_id_opt, r.buyer_id_number, r.good_service_opt, r.serial_no || r.nomor, String(r.tanggal).slice(0, 10),
      { v: Math.round(r.dpp), s: 'num' as const }, { v: Math.round(r.dpp_nilai_lain), s: 'num' as const }, { v: Math.round(r.ppn), s: 'num' as const }, { v: Math.round(r.stlg), s: 'num' as const }, r.info ?? '']),
    ['', { v: `Total ${rows.length} transaksi`, s: 'total' }, '', '', '', '', '', '',
      ...(['dpp', 'dpp_nilai_lain', 'ppn', 'stlg'] as const).map((k) => ({ v: Math.round(rows.reduce((s, r) => s + r[k], 0)), s: 'total' as const })), ''],
  ]
  const xlsx = writeXlsx([
    { title: 'DATA', rows: data, widths: [14, 9, 26, 11, 19, 14, 14, 15, 18, 22, 13, 9, 14], freeze: { row: 4, col: 0 } },
    { title: 'TrxCode', rows: [[{ v: 'Kode', s: 'head' }, { v: 'DESCRIPTION', s: 'head' }], ...Object.entries(TRX_CODES).map(([k, l]) => [k, l.split(' · ')[1] ?? l])], widths: [10, 40] },
    { title: 'GoodsService', rows: [[{ v: 'Code', s: 'head' }, { v: 'Name', s: 'head' }], ...Object.entries(GOOD_SERVICE)], widths: [8, 14] },
    { title: 'Buyer ID', rows: [[{ v: 'Code', s: 'head' }, { v: 'Name', s: 'head' }], ['TIN', 'NPWP'], ['NIK', 'NIK']], widths: [8, 14] },
  ])
  return new Response(new Uint8Array(xlsx), { headers: headers('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', `${name}.xlsx`) })
})
