// Template surat penawaran / surat order / proforma invoice sebagai HTML (server-only).
// Satu template dipakai halaman cetak (/cetak/quotation/[id] -> PDF lewat dialog cetak)
// dan ekspor Word (/api/quotations/[id]/word). Tata letak memakai tabel agar tampil sama di browser dan Microsoft Word.
import { loadSettings } from '@/lib/hpp'
import { loadQuotation, loadQuotationItems, requireQuotation } from '@/lib/quotations'
import type { UserProfile } from '@/lib/users'

export type DocJenis = 'penawaran' | 'order' | 'proforma'
const JUDUL: Record<DocJenis, string> = { penawaran: 'SURAT PENAWARAN HARGA', order: 'SURAT ORDER (KONFIRMASI PESANAN)', proforma: 'PROFORMA INVOICE' }
export const readJenis = (raw: string | null | undefined): DocJenis => (raw === 'order' || raw === 'proforma' ? raw : 'penawaran')

const MONTHS = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember']
const tanggal = (value: string) => {
  const [y, m, d] = value.slice(0, 10).split('-').map(Number)
  return `${d} ${MONTHS[m - 1]} ${y}`
}
const rp = (v: number, digits = 0) => `Rp ${v.toLocaleString('id-ID', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`
const esc = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

type Quotation = Awaited<ReturnType<typeof loadQuotation>>

// Data dokumen; melempar ApiError bila tidak berhak. missingOrder: surat order / proforma belum dibuat.
export async function loadQuotationDocument(id: number, user: UserProfile, jenis: DocJenis) {
  requireQuotation(user)
  const q = await loadQuotation(id, user)
  if (jenis !== 'penawaran' && !q.order_nomor) return { q, items: [], doc: {} as Record<string, string>, missingOrder: true }
  const [items, doc] = await Promise.all([loadQuotationItems(q.id), loadSettings('doc.')])
  return { q, items, doc, missingOrder: false }
}

export const documentNomor = (q: Quotation, jenis: DocJenis) => String(jenis === 'order' ? q.order_nomor : jenis === 'proforma' ? q.proforma_nomor : q.nomor)

export function quotationDocumentHtml({ q, items, doc }: Awaited<ReturnType<typeof loadQuotationDocument>>, jenis: DocJenis, logoSrc: string) {
  const penandatangan = doc.penandatangan || q.created_name
  const perusahaan = doc.nama || 'PT. Pandawa Amerta Packindo'
  const tanggalDok = jenis === 'penawaran' ? q.tanggal : String(q.order_at ?? q.tanggal)
  const ongkir = jenis === 'penawaran' ? 0 : Number(q.ongkir ?? 0)
  const grand = q.total + ongkir
  const dp = q.dp_persen ? Math.round((grand * q.dp_persen) / 100) : null
  const tagihan = jenis === 'proforma' ? (q.terbayar > 0 ? Math.max(0, grand - q.terbayar) : dp ?? grand) : null
  const sign = (title: string, name: string, org: string) => `<td><p>${esc(title)}</p><div class="space">&nbsp;</div><p><b>${esc(name)}</b></p><p>${esc(org)}</p></td>`
  const total = (label: string, value: string, grandRow = false) => `<tr${grandRow ? ' class="grand"' : ''}><td colspan="4" class="r">${esc(label)}</td><td class="r">${esc(value)}</td></tr>`
  const pembuka = {
    penawaran: 'Bersama ini kami sampaikan penawaran harga produk kemasan plastik sebagai berikut:',
    order: 'Terima kasih atas kepercayaan Anda. Berikut konfirmasi pesanan yang akan kami produksi:',
    proforma: 'Berikut tagihan sementara (proforma) atas pesanan Anda:',
  }[jenis]
  const syarat = String(q.syarat ?? '').split(/\r?\n/).filter((l) => l.trim()).map((l) => `<li>${esc(l.replace(/^\s*[-•\d.]+\s*/, ''))}</li>`).join('')

  return `<article class="pap-sheet">
<table class="pap-sheet-head"><tbody><tr>
  <td class="logo"><img src="${esc(logoSrc)}" alt="" width="120"></td>
  <td><h1>${esc(perusahaan)}</h1><p>Flexible Plastic Packaging Manufacture</p>${doc.alamat ? `<p>${esc(doc.alamat)}</p>` : ''}<p>${esc([doc.telepon && `Telp/WA ${doc.telepon}`, doc.email].filter(Boolean).join(' · '))}</p></td>
</tr></tbody></table>
<h2 class="pap-sheet-title">${JUDUL[jenis]}</h2>
${jenis === 'penawaran' && q.status === 'draft' && q.approval !== 'disetujui' ? '<p class="pap-sheet-draft">DRAFT — belum disetujui Kepala Marketing / GM, jangan dikirim ke customer</p>' : ''}
<table class="pap-sheet-meta"><tbody>
  <tr><td>Nomor</td><td>: ${esc(documentNomor(q, jenis))}</td><td>Tanggal</td><td>: ${tanggal(tanggalDok)}</td></tr>
  <tr><td>Kepada</td><td>: <b>${esc(q.kepada)}</b></td>${jenis === 'penawaran' ? `<td>Berlaku s/d</td><td>: ${tanggal(q.berlaku_sampai)}</td>` : `<td>Ref. penawaran</td><td>: ${esc(q.nomor)}</td>`}</tr>
  ${q.kontak || q.telepon ? `<tr><td>Up.</td><td colspan="3">: ${esc([q.kontak, q.telepon].filter(Boolean).join(' · '))}</td></tr>` : ''}
  ${q.alamat ? `<tr><td>Alamat</td><td colspan="3">: ${esc(q.alamat)}</td></tr>` : ''}
  ${jenis !== 'penawaran' && q.tanggal_kirim ? `<tr><td>Rencana kirim</td><td colspan="3">: ${tanggal(q.tanggal_kirim)}${q.expedition_name ? ` · via ${esc(q.expedition_name)}` : ''}</td></tr>` : ''}
</tbody></table>
<p>Dengan hormat,<br>${pembuka}</p>
<table class="pap-sheet-items">
  <thead><tr><th>No</th><th>Produk &amp; spesifikasi</th><th>Jumlah</th><th>Harga satuan</th><th>Jumlah harga</th></tr></thead>
  <tbody>${items.map((it, i) => `<tr><td class="c">${i + 1}</td><td><b>${esc(it.nama_produk)}</b>${it.spesifikasi ? `<div class="spec">${esc(it.spesifikasi)}</div>` : ''}</td><td class="r">${it.qty.toLocaleString('id-ID')} ${esc(it.satuan)}</td><td class="r">${rp(it.harga_satuan, it.harga_satuan % 1 ? 2 : 0)}</td><td class="r">${rp(it.subtotal)}</td></tr>`).join('')}</tbody>
  <tfoot>
    ${total('Subtotal', rp(q.subtotal))}
    ${q.pakai_ppn ? total(`PPN ${q.ppn_persen}%`, rp(q.ppn)) : ''}
    ${ongkir > 0 ? total('Ongkos kirim', rp(ongkir)) : ''}
    ${total('TOTAL', rp(grand), true)}
    ${jenis !== 'penawaran' && q.terbayar > 0 ? total('Sudah dibayar', `- ${rp(q.terbayar)}`) : ''}
    ${jenis === 'proforma' && tagihan !== null ? total(q.terbayar > 0 ? 'SISA TAGIHAN' : dp ? `DP ${q.dp_persen}% YANG HARUS DIBAYAR` : 'TAGIHAN', rp(tagihan), true) : ''}
  </tfoot>
</table>
${!q.pakai_ppn ? '<p class="pap-sheet-note">Harga belum termasuk PPN.</p>' : ''}
${jenis !== 'penawaran' && q.catatan_order ? `<h3>Catatan pesanan</h3><p class="pre">${esc(q.catatan_order)}</p>` : ''}
${jenis === 'order' && dp ? `<p>Pembayaran: DP ${q.dp_persen}% sebesar <b>${rp(dp)}</b> sebelum produksi dimulai, pelunasan sebelum barang dikirim.</p>` : ''}
${syarat && jenis !== 'proforma' ? `<h3>Syarat &amp; ketentuan</h3><ol>${syarat}</ol>` : ''}
${doc.rekening ? `<h3>Pembayaran ke</h3><p class="pre">${esc(doc.rekening)}</p>` : ''}
${jenis === 'penawaran' ? '<p>Demikian penawaran ini kami sampaikan. Atas perhatian dan kerja samanya kami ucapkan terima kasih.</p>' : ''}
${jenis === 'proforma' ? '<p>Mohon lakukan pembayaran ke rekening di atas dan kirimkan bukti transfer kepada kami.</p>' : ''}
<table class="pap-sheet-sign"><tbody><tr>
  ${jenis === 'order' ? sign('Disetujui pemesan,', q.kontak || '(.........................)', q.kepada) : '<td>&nbsp;</td>'}
  ${sign('Hormat kami,', penandatangan, perusahaan)}
</tr></tbody></table>
</article>`
}

// CSS untuk file Word (Word tidak membaca globals.css; hanya subset CSS sederhana yang didukung)
export const WORD_CSS = `
@page { size: 21cm 29.7cm; margin: 1.6cm 1.6cm; }
body { font-family: Arial, sans-serif; font-size: 10.5pt; color: #111; }
.pap-sheet-head { width: 100%; border-collapse: collapse; border-bottom: 3px double #1f2a5a; }
.pap-sheet-head td { vertical-align: middle; padding: 0 12pt 8pt 0; }
.pap-sheet-head td.logo { width: 100pt; }
.pap-sheet-head h1 { margin: 0; font-size: 16pt; color: #1f2a5a; }
.pap-sheet-head p { margin: 0; color: #444; font-size: 9.5pt; }
.pap-sheet-title { margin: 16pt 0 10pt; text-align: center; font-size: 12.5pt; text-decoration: underline; }
.pap-sheet-draft { padding: 4pt; border: 2px dashed #b42318; color: #b42318; text-align: center; font-weight: bold; }
.pap-sheet-meta { border-collapse: collapse; margin-bottom: 10pt; }
.pap-sheet-meta td { padding: 1pt 10pt 1pt 0; vertical-align: top; }
.pap-sheet-items { width: 100%; border-collapse: collapse; margin: 8pt 0; }
.pap-sheet-items th, .pap-sheet-items td { padding: 5pt 6pt; border: 1px solid #9aa0b4; vertical-align: top; }
.pap-sheet-items th { background: #eef0f7; font-size: 9.5pt; }
.pap-sheet-items .r { text-align: right; }
.pap-sheet-items .c { text-align: center; }
.pap-sheet-items .spec { color: #444; font-size: 9.5pt; }
.pap-sheet-items tfoot td { font-weight: bold; }
.pap-sheet-items tr.grand td { background: #eef0f7; font-size: 11pt; }
.pap-sheet-note { color: #444; font-style: italic; }
h3 { margin: 10pt 0 2pt; font-size: 10.5pt; }
.pre { white-space: pre-wrap; margin: 0; }
.pap-sheet-sign { width: 100%; margin-top: 20pt; border-collapse: collapse; }
.pap-sheet-sign td { width: 50%; text-align: center; vertical-align: top; }
.pap-sheet-sign p { margin: 0; }
.pap-sheet-sign .space { height: 60pt; }
`
