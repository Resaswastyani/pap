// "Form Checklist Order Custom" sebagai HTML (server-only), dipakai halaman cetak (/cetak/order-custom/[id] -> PDF lewat
// dialog cetak) dan ekspor Word (/api/order-custom/[id]/word). id 'kosong' = formulir kosong untuk dicentang manual dengan pena.
// Tata letak memakai tabel agar sama di browser, PDF, dan Microsoft Word.
import { loadSettings } from '@/lib/hpp'
import { OC_AKHIR, OC_CETAKAN, OC_KELENGKAPAN, OC_PLASTIK, type OcLineKey, type OrderChecklist } from '@/lib/order-custom'

const MONTHS = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember']
const tgl = (v: string | null) => {
  if (!v) return ''
  const [y, m, d] = v.slice(0, 10).split('-').map(Number)
  return `${d} ${MONTHS[m - 1]} ${y}`
}
const esc = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
// Kotak centang (Unicode, tampil sama di PDF & Word)
const box = (on: boolean) => `<span class="oc-box${on ? ' on' : ''}">${on ? '&#10004;' : '&nbsp;'}</span>`

export const orderCustomSettings = () => loadSettings('doc.')

export function orderCustomHtml(c: OrderChecklist, doc: Record<string, string>, logoSrc: string) {
  const perusahaan = doc.nama || 'PT. Pandawa Amerta Packindo'
  const i = c.isian
  const blank = !c.id
  // Polos saja: bagian Desain Cetakan tidak berlaku (tetap dicetak agar susunan formulir sama)
  const naCetak = !blank && i.order_polos && !i.order_print
  const line = (key: OcLineKey, label: string) => {
    const l = i.lines[key]
    return `<tr class="ln${naCetak && OC_CETAKAN.some((x) => x.key === key) ? ' na' : ''}"><td class="lbl">${esc(label)}</td><td class="dots">${l.ket ? `<span class="val">${esc(l.ket)}</span>` : '&nbsp;'}</td><td class="ck">${box(l.cek)}</td></tr>`
  }
  const fill = (v: string, cls = '') => `<span class="oc-fill${cls ? ` ${cls}` : ''}">${v ? esc(v) : '&nbsp;'}</span>`
  const sign = (role: string, name: string | null, at: string | null) => `<td>
      <div class="role">${esc(role)}</div>
      <div class="space">${name ? '<span class="oc-stamp">&#10004; Diparaf digital</span>' : '&nbsp;'}</div>
      <div class="name">${name ? `<b>${esc(name)}</b>` : '( ................................ )'}</div>
      <div class="date">Tgl: ${at ? tgl(at) : '.......................'}</div>
    </td>`

  return `<div class="pap-sheet pap-oc">
<table class="pap-sheet-head"><tbody><tr>
  <td class="logo"><img src="${esc(logoSrc)}" alt="" width="110"></td>
  <td><h1>${esc(perusahaan)}</h1><p>Flexible Plastic Packaging Manufacture</p>${doc.alamat ? `<p>${esc(doc.alamat)}</p>` : ''}</td>
</tr></tbody></table>

<h2 class="oc-title">FORM CHECKLIST ORDER CUSTOM</h2>

<table class="oc-meta"><tbody>
  <tr><td class="k">No. Checklist</td><td class="v">${fill(c.nomor, 'b')}</td><td class="k">Tanggal</td><td class="v">${fill(tgl(c.tanggal))}</td></tr>
  <tr><td class="k">Customer</td><td class="v">${fill(c.nama_customer, 'b')}</td><td class="k">Ref. SO / PO</td><td class="v">${fill(c.referensi ?? '')}</td></tr>
  <tr><td class="k">Produk</td><td class="v" colspan="3">${fill(c.nama_produk, 'b')}</td></tr>
</tbody></table>

<div class="oc-frame">
<table class="oc-list"><tbody>
  <tr class="hd"><td colspan="3">Keterangan Order Custom <span class="req">(Wajib Ada)</span></td></tr>
  <tr class="opt"><td colspan="3"><b>Spek Plastik :</b> Baru ${box(i.spek === 'baru')} &nbsp;/&nbsp; Repeat Order ${box(i.spek === 'repeat')}</td></tr>
  <tr class="opt"><td colspan="3"><b>Orderan :</b> Print ${box(i.order_print)} &nbsp;/&nbsp; Polos ${box(i.order_polos)} <span class="hint">(Centang dua-duanya bila ada)</span></td></tr>

  <tr class="sec"><td colspan="3"><u>Desain Plastik (Lampiran)</u></td></tr>
  <tr class="ln"><td class="lbl">Jumlah Ukuran &amp; Jenis Plastik</td><td class="line" colspan="2">${i.jumlah_ukuran ? `<span class="val">${esc(i.jumlah_ukuran)}</span>` : '&nbsp;'}</td></tr>
  ${OC_PLASTIK.map((x) => line(x.key, x.label)).join('')}
  <tr class="opt"><td colspan="3"><b>Aksesoris :</b> Ada ${box(i.aksesoris === 'ada')} &nbsp;/&nbsp; Tidak Ada ${box(i.aksesoris === 'tidak')} &nbsp;, Lampiran ${box(i.aksesoris_lampiran)}${i.aksesoris_ket ? ` <span class="val">&nbsp;${esc(i.aksesoris_ket)}</span>` : ''}</td></tr>

  <tr class="sec"><td colspan="3"><u>Desain Cetakan (Lampiran)</u>${naCetak ? ' <span class="hint">— tidak berlaku (orderan polos)</span>' : ''}</td></tr>
  <tr class="ln${naCetak ? ' na' : ''}"><td class="lbl">Jumlah Tabung Cetak</td><td class="line short" colspan="2">${i.jumlah_tabung ? `<span class="val">${esc(i.jumlah_tabung)}</span>` : '&nbsp;'}</td></tr>
  <tr class="opt${naCetak ? ' na' : ''}"><td colspan="3"><b>Jenis Cetakan :</b> Continue ${box(i.jenis_cetakan === 'continue')} &nbsp;/&nbsp; Fixed ${box(i.jenis_cetakan === 'fixed')}</td></tr>
  ${OC_CETAKAN.map((x) => line(x.key, x.label)).join('')}
  <tr class="opt${naCetak ? ' na' : ''}"><td colspan="3"><b>Cetakan Masuk Gusset</b> ${box(i.gusset === 'masuk')} &nbsp;/&nbsp; <b>Tidak masuk Gusset</b> ${box(i.gusset === 'tidak')}</td></tr>
  ${OC_AKHIR.map((x) => line(x.key, x.label)).join('')}
  ${line(OC_KELENGKAPAN.key, OC_KELENGKAPAN.label)}
</tbody></table>
${c.catatan ? `<p class="oc-note"><b>Catatan:</b> ${esc(c.catatan).replace(/\n/g, '<br>')}</p>` : blank ? '<p class="oc-note"><b>Catatan:</b> <span class="oc-fill wide">&nbsp;</span></p>' : ''}

<table class="oc-sign"><tbody><tr>
  ${sign('Divisi Marketing', c.marketing_name, c.marketing_at)}
  ${sign('Divisi PPIC', c.ppic_name, c.ppic_at)}
  ${sign('Divisi Operasional', c.operasional_name, c.operasional_at)}
</tr></tbody></table>
</div>
${c.lampiran ? `<p class="oc-foot">${c.lampiran} lampiran desain tersimpan di SIMPAP (${esc(c.nomor)}).</p>` : ''}
</div>`
}

// CSS untuk Word (halaman cetak memakai aturan yang sama di globals.css, bagian "Form Checklist Order Custom")
export const OC_WORD_CSS = `
@page { size: 21cm 29.7cm; margin: 1.4cm 1.6cm; }
body { font-family: Arial, sans-serif; font-size: 10pt; color: #1b1d2e; }
.pap-sheet-head { width: 100%; border-collapse: collapse; border-bottom: 3px double #1f2a5a; }
.pap-sheet-head td { vertical-align: middle; padding: 0 10pt 6pt 0; }
.pap-sheet-head h1 { margin: 0; font-size: 14pt; color: #1f2a5a; }
.pap-sheet-head p { margin: 0; color: #555; font-size: 8.5pt; }
.oc-title { margin: 14pt 0 10pt; text-align: center; font-size: 15pt; letter-spacing: 1pt; color: #1f2a5a; }
.oc-meta { width: 100%; border-collapse: collapse; margin-bottom: 8pt; }
.oc-meta td { padding: 2pt 4pt; vertical-align: bottom; }
.oc-meta td.k { width: 16%; color: #555; white-space: nowrap; }
.oc-fill { display: inline-block; min-width: 150pt; border-bottom: 1px dotted #777; }
.oc-fill.b { font-weight: bold; } .oc-fill.wide { min-width: 380pt; }
.oc-frame { border: 1px solid #333; padding: 10pt 14pt; }
.oc-list { width: 100%; border-collapse: collapse; }
.oc-list td { padding: 3pt 0; vertical-align: bottom; font-size: 10.5pt; }
.oc-list tr.hd td { font-weight: bold; font-size: 11pt; padding-bottom: 4pt; }
.oc-list tr.sec td { font-weight: bold; padding-top: 10pt; }
.oc-list td.lbl { width: 46%; font-weight: bold; white-space: nowrap; }
.oc-list td.dots { border-bottom: 1px dotted #555; }
.oc-list td.line { border-bottom: 1px solid #333; }
.oc-list td.ck { width: 22pt; text-align: right; }
.oc-list tr.opt td { font-weight: normal; }
.oc-list tr.na td { color: #999; }
.oc-box { display: inline-block; width: 11pt; height: 11pt; border: 1px solid #222; text-align: center; font-size: 9pt; line-height: 11pt; color: #0b7a5a; }
.val { color: #1f2a5a; font-weight: normal; }
.hint, .req { color: #555; font-weight: normal; font-size: 9pt; }
.oc-note { margin: 10pt 0 0; font-size: 9.5pt; }
.oc-sign { width: 100%; border-collapse: collapse; margin-top: 18pt; }
.oc-sign td { width: 33%; text-align: center; vertical-align: top; padding: 0 6pt; }
.oc-sign .role { font-size: 10pt; }
.oc-sign .space { height: 48pt; }
.oc-sign .name { border-top: 1px solid #333; padding-top: 3pt; font-size: 9.5pt; }
.oc-sign .date { color: #555; font-size: 8.5pt; }
.oc-stamp { border: 1px dashed #12a37a; color: #0b7a5a; font-size: 8pt; padding: 1pt 5pt; }
.oc-foot { margin-top: 6pt; color: #777; font-size: 8.5pt; }
`
