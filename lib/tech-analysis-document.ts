// Formulir "Analisa Aspek Teknik Atas Rencana Order Baru / Spec Baru" sebagai HTML (server-only).
// Dipakai halaman cetak (/cetak/analisa-teknik/[id] -> PDF lewat dialog cetak) dan ekspor Word (/api/tech-analyses/[id]/word).
// Susunan mengikuti formulir Excel Dept Teknik (label = isi, tabel mesin, kesimpulan, rekomendasi Direksi); tata letak
// memakai tabel agar tampil sama di browser, PDF, dan Microsoft Word.
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
// Isian kosong: garis titik-titik untuk diisi tangan
const val = (v: string) => (v.trim() ? v : '<span class="ta1-blank">&nbsp;</span>')

export const BISA_LABEL = { bisa: 'BISA diproduksi dengan produktivitas optimal', bersyarat: 'BISA dengan syarat / penyesuaian', tidak: 'TIDAK BISA diproduksi dengan produktivitas optimal' } as const
export const KUALITAS_LABEL = { mudah: 'Mudah', sedang: 'Sedang', sulit: 'Sulit' } as const

export async function techAnalysisSettings() {
  return loadSettings('doc.')
}

export function techAnalysisHtml(a: TechAnalysis, doc: Record<string, string>, logoSrc: string) {
  const perusahaan = doc.nama || 'PT. Pandawa Amerta Packindo'
  const row = (label: string, value: string, side = '', indent = false) =>
    `<tr><td class="lbl${indent ? ' in' : ''}">${label}</td><td class="eq">=</td><td class="val">${val(value)}</td><td class="side">${side}</td></tr>`
  const print = a.print_jenis === 'polos' ? 'POLOS' : a.print_jenis === 'print' ? `Print ${a.jumlah_warna ?? '…'} warna` : ''
  const qty = a.qty_order !== null ? `${n(a.qty_order)} ${esc(a.qty_satuan ?? '')}` : ''
  const frek = a.frekuensi === 'sekali' ? 'Hanya 1x order' : a.frekuensi === 'rutin' ? `Order rutin per ${a.rutin_bulan ?? '…'} bulan` : 'Hanya 1x Order / Order Rutin per …. Bln'
  const used = a.proses.filter((p) => p.dipakai)
  const totalProd = used.reduce((s, p) => s + (p.produktivitas ?? 0), 0)
  const paraf = (name: string | null, at: string | null) => (name ? `<b>${esc(name)}</b>, ${tgl(at)}` : '<span class="ta1-blank short">&nbsp;</span>')

  return `<div class="pap-sheet pap-ta ta-v1">
<table class="pap-sheet-head"><tbody><tr>
  <td class="logo"><img src="${esc(logoSrc)}" alt="" width="110"></td>
  <td><h1>${esc(perusahaan)}</h1><p>Flexible Plastic Packaging Manufacture</p>${doc.alamat ? `<p>${esc(doc.alamat)}</p>` : ''}</td>
</tr></tbody></table>

<h2 class="ta1-title">Analisa Aspek Tehnik Atas Rencana Order Baru / Spec Baru</h2>
<p class="ta1-sub">Dari Dept Marketing ke Dept Tehnik</p>

<table class="ta1-info"><tbody><tr>
  <td><b>Dibuat oleh Dept Marketing dan diserahkan ke Dept Tehnik tanggal</b> = ${val(tgl(a.tanggal_serah))}${a.created_name ? ` <span class="ta1-muted">(${esc(a.created_name)})</span>` : ''}</td>
  <td class="no">No. <b>${esc(a.nomor)}</b></td>
</tr></tbody></table>

<table class="ta1-spec"><tbody>
  ${row('<b>Nama Produk</b> <i>(diisi Marketing)</i>', `<b>${esc(a.nama_produk)}</b>`)}
  ${row('<b>Nama Customer</b> <i>(diisi Marketing)</i>', esc(a.nama_customer))}
  <tr class="grp"><td colspan="4"><b>Spec Order =</b></td></tr>
  ${row('Jenis Plastik', esc(a.jenis_plastik ?? ''), '', true)}
  ${row('Panjang (cm)', n(a.panjang_cm), '', true)}
  ${row('Lebar (cm)', n(a.lebar_cm), '', true)}
  ${row('Tebal (mm)', n(a.tebal_mm, 4), '', true)}
  ${row('POLOS / Jml Print', esc(print), `Tingkat Kesulitan Print = ${esc(a.kesulitan_print ?? '')}`, true)}
  ${row('Spec Lainnya <span class="ta1-muted">(Airhole, Pillow Case, dll)</span>', br(a.spec_lainnya), '', true)}
  ${row('<b>Qty Order</b>', qty, esc(frek))}
  ${row('<b>Critical to Quality</b>', br(a.critical_to_quality))}
</tbody></table>

<p class="ta1-h">Analisa Sesuai Urutan Proses <i>(diisi oleh Tehnik)</i></p>
<table class="ta1-proc">
  <thead><tr><th class="ck"></th><th class="m">Mesin / Proses</th><th class="k">Kecepatan Mesin</th><th>Keterangan Lainnya</th><th class="r">Produktivitas / Jam (Kg)</th></tr></thead>
  <tbody>${a.proses.map((p) => `<tr class="${p.dipakai ? 'on' : ''}"><td class="ck">${p.dipakai ? '&#9745;' : '&#9744;'}</td><td class="m">${esc(p.mesin)}</td><td class="k">${p.kec_label ? `${esc(p.kec_label)} = ` : ''}${p.kecepatan ? `<b>${esc(p.kecepatan)}</b>` : ''}</td><td>${br(p.keterangan)}</td><td class="r">${p.produktivitas !== null ? `<b>${n(p.produktivitas)}</b>` : ''}</td></tr>`).join('')}
  <tr><td class="ck">&#9744;</td><td class="m">&nbsp;</td><td class="k"></td><td></td><td class="r"></td></tr>
  <tr><td class="ck">&#9744;</td><td class="m">&nbsp;</td><td class="k"></td><td></td><td class="r"></td></tr></tbody>
  ${used.length ? `<tfoot><tr><td></td><td colspan="3"><b>${used.length} proses dipakai</b></td><td class="r"><b>${totalProd ? n(totalProd) : ''}</b></td></tr></tfoot>` : ''}
</table>

<table class="ta1-concl"><tbody>
  <tr class="hd"><td colspan="2"><b>Kesimpulan Analisa Tehnis Produksi dan Rekomendasi dari Dept Tehnik</b></td><td class="paraf">Tanggal &amp; Paraf = ${paraf(a.teknik_name, a.teknik_at)}</td></tr>
  <tr><td class="no">1</td><td colspan="2"><b>Bisa / Tidak Bisa Diproduksi dengan Produktivitas yg optimal</b> = ${a.bisa_produksi ? esc(BISA_LABEL[a.bisa_produksi]) : '<span class="ta1-muted">&#9744; Bisa &nbsp; &#9744; Bisa bersyarat &nbsp; &#9744; Tidak bisa</span>'}<div class="exp">Penjelasan = ${val(br(a.penjelasan_produksi))}</div></td></tr>
  <tr><td class="no">2</td><td colspan="2"><b>Tingkat Kesulitan untuk memenuhi Kwalitas</b> = ${a.kesulitan_kualitas ? esc(KUALITAS_LABEL[a.kesulitan_kualitas]) : '<span class="ta1-muted">&#9744; Mudah &nbsp; &#9744; Sedang &nbsp; &#9744; Sulit</span>'}<div class="exp">Penjelasan = ${val(br(a.penjelasan_kualitas))}</div></td></tr>
  <tr><td class="no">3</td><td colspan="2"><b>Catatan2 Penting Lainnya</b><div class="exp">${val(br(a.catatan_lain))}</div></td></tr>
</tbody></table>

<table class="ta1-rek"><tbody><tr>
  <td><b>Rekomendasi dari Direksi</b> = ${val(br(a.rekomendasi_direksi))}</td>
  <td class="paraf">Tanggal &amp; Paraf = ${paraf(a.direksi_name, a.direksi_at)}</td>
</tr></tbody></table>
</div>`
}

// CSS untuk Word (halaman cetak memakai aturan yang sama di globals.css, bagian "Lembar Analisa Teknik")
export const TA_WORD_CSS = `
@page { size: 21cm 29.7cm; margin: 1.4cm 1.5cm; }
body { font-family: Arial, sans-serif; font-size: 9.5pt; color: #1b1d2e; }
.pap-sheet-head { width: 100%; border-collapse: collapse; border-bottom: 3px double #1f2a5a; }
.pap-sheet-head td { vertical-align: middle; padding: 0 10pt 6pt 0; }
.pap-sheet-head h1 { margin: 0; font-size: 14pt; color: #1f2a5a; }
.pap-sheet-head p { margin: 0; color: #555; font-size: 8.5pt; }
.ta1-title { margin: 12pt 0 0; text-align: center; font-size: 12.5pt; text-decoration: underline; color: #1f2a5a; }
.ta1-sub { margin: 2pt 0 10pt; text-align: center; color: #555; font-size: 9pt; }
.ta1-muted { color: #777; }
.ta1-blank { display: inline-block; min-width: 110pt; border-bottom: 1px dotted #999; }
.ta1-blank.short { min-width: 70pt; }
.ta1-info { width: 100%; border-collapse: collapse; margin-bottom: 6pt; }
.ta1-info td { padding: 2pt 0; vertical-align: bottom; }
.ta1-info td.no { width: 26%; text-align: right; }
.ta1-spec { width: 100%; border-collapse: collapse; }
.ta1-spec td { padding: 3pt 5pt; border-bottom: 1px solid #e3e5ee; vertical-align: top; }
.ta1-spec td.lbl { width: 34%; } .ta1-spec td.in { padding-left: 16pt; }
.ta1-spec td.eq { width: 10pt; text-align: center; color: #555; }
.ta1-spec td.side { width: 30%; color: #333; }
.ta1-spec tr.grp td { background: #f4f5f9; }
.ta1-h { margin: 12pt 0 4pt; font-weight: bold; font-size: 10pt; }
.ta1-proc { width: 100%; border-collapse: collapse; }
.ta1-proc th, .ta1-proc td { padding: 3pt 5pt; border: 1px solid #555; vertical-align: top; }
.ta1-proc th { background: #e9ebf3; font-size: 8.5pt; }
.ta1-proc td.ck { width: 16pt; text-align: center; }
.ta1-proc td.m { width: 34%; } .ta1-proc td.k { width: 22%; } .ta1-proc td.r, .ta1-proc th.r { width: 16%; text-align: right; }
.ta1-proc tr.on td { background: #eefaf3; }
.ta1-concl { width: 100%; border-collapse: collapse; margin-top: 12pt; }
.ta1-concl td { padding: 4pt 5pt; border-bottom: 1px solid #e3e5ee; vertical-align: top; }
.ta1-concl tr.hd td { border-bottom: 1.5pt solid #1f2a5a; font-size: 10pt; }
.ta1-concl td.no { width: 14pt; text-align: right; font-weight: bold; }
.ta1-concl td.paraf, .ta1-rek td.paraf { width: 32%; }
.ta1-concl .exp { margin-top: 2pt; color: #333; }
.ta1-rek { width: 100%; border-collapse: collapse; margin-top: 10pt; }
.ta1-rek td { padding: 6pt 5pt; border-top: 1.5pt solid #1f2a5a; border-bottom: 1px solid #e3e5ee; vertical-align: top; font-size: 10pt; }
`
