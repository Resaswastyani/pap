// Formulir "Analisa Aspek Teknik Atas Rencana Order Baru / Spec Baru" sebagai HTML (server-only).
// Dipakai halaman cetak (/cetak/analisa-teknik/[id] -> PDF lewat dialog cetak) dan ekspor Word (/api/tech-analyses/[id]/word).
import { loadSettings } from '@/lib/hpp'
import type { TechAnalysis } from '@/lib/tech-analysis'

const MONTHS = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember']
const tgl = (v: string | null) => {
  if (!v) return ''
  const [y, m, d] = v.slice(0, 10).split('-').map(Number)
  return `${d} ${MONTHS[m - 1]} ${y}`
}
const esc = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
const n = (v: number | null, digits = 2) => (v === null ? '' : v.toLocaleString('id-ID', { maximumFractionDigits: digits }))
const br = (v: string | null) => esc(v ?? '').replace(/\n/g, '<br>')

export const BISA_LABEL = { bisa: 'BISA diproduksi dengan produktivitas optimal', bersyarat: 'BISA dengan syarat / penyesuaian', tidak: 'TIDAK BISA diproduksi dengan produktivitas optimal' } as const
export const KUALITAS_LABEL = { mudah: 'Mudah', sedang: 'Sedang', sulit: 'Sulit' } as const

export async function techAnalysisSettings() {
  return loadSettings('doc.')
}

export function techAnalysisHtml(a: TechAnalysis, doc: Record<string, string>, logoSrc: string) {
  const perusahaan = doc.nama || 'PT. Pandawa Amerta Packindo'
  const row = (label: string, value: string, right = '', indent = false) =>
    `<tr><td class="lbl${indent ? ' in' : ''}">${label}</td><td class="eq">=</td><td class="val">${value}</td><td class="side">${right}</td></tr>`
  const print = a.print_jenis === 'polos' ? 'POLOS' : a.print_jenis === 'print' ? `Print ${a.jumlah_warna ?? ''} warna`.replace('  ', ' ') : ''
  const qty = a.qty_order !== null ? `${n(a.qty_order)} ${esc(a.qty_satuan ?? '')}` : ''
  const frek = a.frekuensi === 'sekali' ? 'Hanya 1x order' : a.frekuensi === 'rutin' ? `Order rutin per ${a.rutin_bulan ?? '...'} bulan` : 'Hanya 1x Order / Order Rutin per .... Bln'
  const used = a.proses.filter((p) => p.dipakai)
  const totalProd = used.reduce((s, p) => s + (p.produktivitas ?? 0), 0)
  const paraf = (name: string | null, at: string | null) => (name ? `${esc(name)}, ${tgl(at)}` : '')

  return `<div class="pap-sheet pap-ta">
<table class="pap-sheet-head"><tbody><tr>
  <td class="logo"><img src="${esc(logoSrc)}" alt="" width="110"></td>
  <td><h1>${esc(perusahaan)}</h1><p>Flexible Plastic Packaging Manufacture</p>${doc.alamat ? `<p>${esc(doc.alamat)}</p>` : ''}</td>
</tr></tbody></table>
<h2 class="pap-ta-title">Analisa Aspek Tehnik Atas Rencana Order Baru / Spec Baru</h2>
<p class="pap-ta-sub">Dari Dept Marketing ke Dept Tehnik · No. ${esc(a.nomor)}</p>
<p class="pap-ta-line"><b>Dibuat oleh Dept Marketing dan diserahkan ke Dept Tehnik tanggal</b> = ${tgl(a.tanggal_serah)}${a.created_name ? ` <span class="muted">(${esc(a.created_name)})</span>` : ''}</p>

<table class="pap-ta-spec"><tbody>
  ${row('<b>Nama Produk</b> <i>(diisi Marketing)</i>', `<b>${esc(a.nama_produk)}</b>`)}
  ${row('<b>Nama Customer</b> <i>(diisi Marketing)</i>', esc(a.nama_customer))}
  <tr><td class="lbl" colspan="4"><b>Spec Order =</b></td></tr>
  ${row('Jenis Plastik', esc(a.jenis_plastik ?? ''), '', true)}
  ${row('Panjang (cm)', n(a.panjang_cm), '', true)}
  ${row('Lebar (cm)', n(a.lebar_cm), '', true)}
  ${row('Tebal (mm)', n(a.tebal_mm, 4), '', true)}
  ${row('POLOS / Jml Print', esc(print), `Tingkat Kesulitan Print = ${esc(a.kesulitan_print ?? '')}`, true)}
  ${row('Spec Lainnya (Airhole, Pillow Case, dll)', br(a.spec_lainnya), '', true)}
  ${row('<b>Qty Order</b>', qty, esc(frek))}
  ${row('<b>Critical to Quality</b>', br(a.critical_to_quality))}
</tbody></table>

<h3 class="pap-ta-h">Analisa Sesuai Urutan Proses <i>(diisi oleh Tehnik)</i></h3>
<table class="pap-ta-proses">
  <thead><tr><th class="ck"></th><th>Mesin / Proses</th><th>Kecepatan Mesin</th><th>Keterangan Lainnya</th><th>Produktivitas / Jam (Kg)</th></tr></thead>
  <tbody>${a.proses.map((p) => `<tr class="${p.dipakai ? 'on' : ''}"><td class="ck">${p.dipakai ? '&#9745;' : '&#9744;'}</td><td>${esc(p.mesin)}</td><td>${esc(p.kec_label ? `${p.kec_label} = ${p.kecepatan}` : p.kecepatan)}</td><td>${br(p.keterangan)}</td><td class="r">${n(p.produktivitas)}</td></tr>`).join('')}
  <tr><td class="ck">&#9744;</td><td>&nbsp;</td><td></td><td></td><td></td></tr></tbody>
  ${used.length ? `<tfoot><tr><td></td><td colspan="3"><b>${used.length} proses dipakai</b></td><td class="r"><b>${totalProd ? n(totalProd) : ''}</b></td></tr></tfoot>` : ''}
</table>

<table class="pap-ta-concl"><tbody>
  <tr><td colspan="2" class="big"><b>Kesimpulan Analisa Tehnis Produksi dan Rekomendasi dari Dept Tehnik</b></td><td class="paraf">Tanggal &amp; Paraf = ${paraf(a.teknik_name, a.teknik_at)}</td></tr>
  <tr><td class="no">1</td><td colspan="2"><b>Bisa / Tidak Bisa Diproduksi dengan Produktivitas yg optimal</b> = ${a.bisa_produksi ? esc(BISA_LABEL[a.bisa_produksi]) : ''}<div class="exp">Penjelasan = ${br(a.penjelasan_produksi)}</div></td></tr>
  <tr><td class="no">2</td><td colspan="2"><b>Tingkat Kesulitan untuk memenuhi Kwalitas</b> = ${a.kesulitan_kualitas ? esc(KUALITAS_LABEL[a.kesulitan_kualitas]) : ''}<div class="exp">Penjelasan = ${br(a.penjelasan_kualitas)}</div></td></tr>
  <tr><td class="no">3</td><td colspan="2"><b>Catatan2 Penting Lainnya</b><div class="exp">${br(a.catatan_lain)}</div></td></tr>
  <tr><td colspan="2" class="big"><b>Rekomendasi dari Direksi</b> = ${br(a.rekomendasi_direksi)}</td><td class="paraf">Tanggal &amp; Paraf = ${paraf(a.direksi_name, a.direksi_at)}</td></tr>
</tbody></table>
</div>`
}

// CSS untuk Word (subset CSS sederhana)
export const TA_WORD_CSS = `
@page { size: 21cm 29.7cm; margin: 1.4cm 1.4cm; }
body { font-family: Arial, sans-serif; font-size: 9.5pt; color: #111; }
.pap-sheet-head { width: 100%; border-collapse: collapse; border-bottom: 3px double #1f2a5a; }
.pap-sheet-head td { vertical-align: middle; padding: 0 10pt 6pt 0; }
.pap-sheet-head h1 { margin: 0; font-size: 14pt; color: #1f2a5a; }
.pap-sheet-head p { margin: 0; color: #444; font-size: 8.5pt; }
.pap-ta-title { margin: 10pt 0 0; text-align: center; font-size: 12pt; text-decoration: underline; }
.pap-ta-sub { margin: 2pt 0 8pt; text-align: center; color: #444; }
.pap-ta-line { margin: 0 0 8pt; }
.muted { color: #666; }
.pap-ta-spec { width: 100%; border-collapse: collapse; }
.pap-ta-spec td { padding: 2pt 4pt; border-bottom: 1px solid #e3e5ee; vertical-align: top; }
.pap-ta-spec td.lbl { width: 36%; } .pap-ta-spec td.in { padding-left: 16pt; } .pap-ta-spec td.eq { width: 3%; }
.pap-ta-spec td.side { width: 30%; color: #333; }
.pap-ta-h { margin: 10pt 0 4pt; font-size: 10pt; }
.pap-ta-proses { width: 100%; border-collapse: collapse; }
.pap-ta-proses th, .pap-ta-proses td { padding: 3pt 5pt; border: 1px solid #222; vertical-align: top; }
.pap-ta-proses th { background: #eef0f7; }
.pap-ta-proses td.ck { width: 16pt; text-align: center; }
.pap-ta-proses td.r { text-align: right; }
.pap-ta-proses tr.on td { background: #f3f0ff; }
.pap-ta-concl { width: 100%; border-collapse: collapse; margin-top: 10pt; }
.pap-ta-concl td { padding: 4pt 5pt; vertical-align: top; border-bottom: 1px solid #e3e5ee; }
.pap-ta-concl td.big { font-size: 10.5pt; } .pap-ta-concl td.no { width: 14pt; text-align: right; }
.pap-ta-concl td.paraf { width: 30%; } .pap-ta-concl .exp { margin-top: 2pt; color: #333; }
`
