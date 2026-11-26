// Formulir "Analisa Aspek Teknik Atas Rencana Order Baru / Spec Baru" sebagai HTML (server-only).
// Dipakai halaman cetak (/cetak/analisa-teknik/[id] -> PDF lewat dialog cetak) dan ekspor Word (/api/tech-analyses/[id]/word).
// Susunan mengikuti formulir Excel Dept Teknik (label = isi, tabel mesin, kesimpulan, rekomendasi Direksi); tata letak
// memakai tabel agar tampil sama di browser, PDF, dan Microsoft Word.
import { loadSettings } from '@/lib/hpp'
import type { TechAnalysis } from '@/lib/tech-analysis'
import type { TaSignRole } from '@/lib/tech-analysis-signature'

// Isi kolom tanda tangan: gambar TTD digital, nama penandatangan, tanggal tanda tangan
type Sig = { img: (p: TaSignRole) => string; nama: (p: TaSignRole, fallback: string | null) => string; tgl: (p: TaSignRole, fallback: string | null) => string }

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

// Judul formulir: dari Prospek / Marketing = Analisa; dari Sales Order (PPIC) = Rekomendasi Proses Produksi
const TITLE_ANALISA = 'Analisa Aspek Tehnik Atas Rencana Order Baru / Spec Baru'
const TITLE_SO = 'Rekomendasi Proses Produksi - dari Dept Tehnik &#8594; Tujuan PRODUKTIVITAS MAKSIMAL'

export async function techAnalysisSettings() {
  return loadSettings('doc.')
}

// gambar: lampiran gambar produk (file gambar, link Drive / gambar, file & link lain); thumbs=false (Word) = nama + link saja
export type TaGambar = { name: string; src: string | null; link?: string | null; type?: string }
export function techAnalysisHtml(a: TechAnalysis, doc: Record<string, string>, logoSrc: string, gambar: TaGambar[] = [], thumbs = true) {
  const perusahaan = doc.nama || 'PT. Pandawa Amerta Packindo'
  // Pengaju: PPIC (dari Sales Order) atau Marketing
  const dept = a.sumber === 'ppic' ? 'PPIC' : 'Marketing'
  const row = (label: string, value: string, side = '', indent = false) =>
    `<tr><td class="lbl${indent ? ' in' : ''}">${label}</td><td class="eq">=</td><td class="val">${val(value)}</td><td class="side">${side}</td></tr>`
  const print = a.print_jenis === 'polos' ? 'POLOS' : a.print_jenis === 'print' ? `Print ${a.jumlah_warna ?? '…'} warna` : ''
  const qty = a.qty_order !== null ? `${n(a.qty_order)} ${esc(a.qty_satuan ?? '')}` : ''
  const frek = a.frekuensi === 'sekali' ? 'Hanya 1x order' : a.frekuensi === 'rutin' ? `Order rutin per ${a.rutin_bulan ?? '…'} bulan` : 'Hanya 1x Order / Order Rutin per …. Bln'
  const used = a.proses.filter((p) => p.dipakai)
  const totalProd = used.reduce((s, p) => s + (p.produktivitas ?? 0), 0)
  // Nama penandatangan di bawah garis tanda tangan (kosong = ruang isi tangan)
  const sign = (name: string | null) => (name ? `<b>${esc(name)}</b>` : '<span class="ta1-muted">( ........................................ )</span>')
  // Tanda tangan digital (gambar lewat /api/ttd/<token>; Word butuh URL absolut dari logoSrc)
  const origin = logoSrc.replace(/\/logo-pap\.png$/, '')
  const ttd: Sig = { img: (p) => { const t = a.ttd?.[p]; return t ? `<img class="ta1-sigimg" src="${esc(`${origin}/api/ttd/${t.token}`)}" alt="Tanda tangan ${esc(t.nama)}" height="54">` : '' }, nama: (p, fallback) => sign(a.ttd?.[p]?.nama ?? fallback), tgl: (p, fallback) => tgl(a.ttd?.[p]?.signed_at ?? fallback) }

  const kop = `<table class="pap-sheet-head"><tbody><tr>
  <td class="logo"><img src="${esc(logoSrc)}" alt="" width="110"></td>
  <td><h1>${esc(perusahaan)}</h1><p>Flexible Plastic Packaging Manufacture</p>${doc.alamat ? `<p>${esc(doc.alamat)}</p>` : ''}</td>
</tr></tbody></table>`
  const procTable = `<table class="ta1-proc">
  <thead><tr><th class="ck"></th><th class="m">Mesin / Proses</th><th class="k">Kecepatan Mesin</th><th class="k2">Kec Roto Max</th><th class="k3">Jalur</th><th class="k3">Tumpuk</th><th>Keterangan Lainnya</th><th class="r">Hasil Produktivitas (Kg/Jam)</th></tr></thead>
  <tbody>${a.proses.map((p) => `<tr class="${p.dipakai ? 'on' : ''}"><td class="ck">${p.dipakai ? '&#9745;' : '&#9744;'}</td><td class="m">${esc(p.mesin)}</td><td class="k">${p.kec_label ? `${esc(p.kec_label)} = ` : ''}${p.kecepatan ? `<b>${esc(p.kecepatan)}</b>` : ''}</td><td class="k2">${p.kec_roto_max ? `<b>${esc(p.kec_roto_max)}</b>` : ''}</td>${/^inline blow/i.test(p.mesin.trim()) ? `<td class="k3" colspan="2">Jml Warna${p.warna ? ` = <b>${esc(p.warna)}</b>` : ''}</td>` : `<td class="k3">${p.jalur ? esc(p.jalur) : ''}</td><td class="k3">${p.tumpuk ? esc(p.tumpuk) : ''}</td>`}<td>${br(p.keterangan)}</td><td class="r">${p.produktivitas !== null ? `<b>${n(p.produktivitas)}</b>` : ''}</td></tr>`).join('')}
  <tr><td class="ck">&#9744;</td><td class="m">&nbsp;</td><td class="k"></td><td class="k2"></td><td class="k3"></td><td class="k3"></td><td></td><td class="r"></td></tr>
  <tr><td class="ck">&#9744;</td><td class="m">&nbsp;</td><td class="k"></td><td class="k2"></td><td class="k3"></td><td class="k3"></td><td></td><td class="r"></td></tr></tbody>
  ${used.length ? `<tfoot><tr><td></td><td colspan="6"><b>${used.length} proses dipakai</b></td><td class="r"><b>${totalProd ? n(totalProd) : ''}</b></td></tr></tfoot>` : ''}
</table>`
  // Dari Sales Order (PPIC): formulir "Rekomendasi Proses Produksi" Dept Tehnik (satu halaman + gambar produk)
  if (a.sumber === 'ppic') return rekomendasiHtml(a, kop, procTable, ttd) + gambarPages(a, gambar, thumbs, TITLE_SO)

  return `<div class="pap-sheet pap-ta ta-v1">
${kop}

<h2 class="ta1-title">${TITLE_ANALISA}</h2>
<p class="ta1-sub">Dari Dept ${dept} ke Dept Tehnik</p>

<table class="ta1-info"><tbody><tr>
  <td><b>Dibuat oleh Dept ${dept} dan diserahkan ke Dept Tehnik tanggal</b> = ${val(tgl(a.tanggal_serah))}${a.created_name ? ` <span class="ta1-muted">(${esc(a.created_name)})</span>` : ''}</td>
  <td class="no">No. Pengajuan <b>${esc(a.nomor)}</b></td>
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
  ${row('Jumlah Gambar / Kantong <i>(diisi PPIC)</i>', a.jumlah_gambar !== null ? n(a.jumlah_gambar) : '', '', true)}
  ${row('Spec Lainnya <span class="ta1-muted">(Airhole, Pillow Case, dll)</span>', br(a.spec_lainnya), '', true)}
  ${row('<b>Qty Order</b>', qty, esc(frek))}
  ${row('<b>Critical to Quality</b>', br(a.critical_to_quality))}
</tbody></table>

<p class="ta1-h">Rekomendasi/Analisa Sesuai Urutan Proses <i>(diisi oleh Tehnik)</i></p>
${procTable}

</div>
<br class="ta1-pb" clear="all" style="page-break-before:always">
<div class="pap-sheet pap-ta ta-v1 ta1-page2">
<table class="ta1-p2head"><tbody><tr>
  <td><b>${TITLE_ANALISA}</b><div class="ta1-muted">${esc(a.nama_produk)} · ${esc(a.nama_customer)}</div></td>
  <td class="no">No. <b>${esc(a.nomor)}</b><div class="ta1-muted">Halaman 2</div></td>
</tr></tbody></table>

<p class="ta1-h">Kesimpulan Analisa Tehnis Produksi dan Rekomendasi dari Dept Tehnik</p>
<table class="ta1-concl"><tbody>
  <tr><td class="no">1</td><td><b>Bisa / Tidak Bisa Diproduksi dengan Produktivitas yg optimal</b> = ${a.bisa_produksi ? esc(BISA_LABEL[a.bisa_produksi]) : '<span class="ta1-muted">&#9744; Bisa &nbsp; &#9744; Bisa bersyarat &nbsp; &#9744; Tidak bisa</span>'}<div class="exp">Penjelasan = ${val(br(a.penjelasan_produksi))}</div></td></tr>
  <tr><td class="no">2</td><td><b>Tingkat Kesulitan untuk memenuhi Kwalitas</b> = ${a.kesulitan_kualitas ? esc(KUALITAS_LABEL[a.kesulitan_kualitas]) : '<span class="ta1-muted">&#9744; Mudah &nbsp; &#9744; Sedang &nbsp; &#9744; Sulit</span>'}<div class="exp">Penjelasan = ${val(br(a.penjelasan_kualitas))}</div></td></tr>
  <tr><td class="no">3</td><td><b>Catatan2 Penting Lainnya</b><div class="exp">${val(br(a.catatan_lain))}</div></td></tr>
</tbody></table>

<p class="ta1-h">Rekomendasi dari Direksi</p>
<table class="ta1-rek"><tbody><tr><td>${val(br(a.rekomendasi_direksi))}</td></tr></tbody></table>

<table class="ta1-sign"><tbody>
  <tr class="role"><td>Dibuat oleh,<div>Dept ${dept}</div></td><td>Dianalisa oleh,<div>Dept Tehnik</div></td><td>Rekomendasi,<div>Direksi</div></td></tr>
  <tr class="space"><td>${ttd.img('pengaju') || (a.tanggal_serah ? '<span class="ta1-stamp">Diserahkan</span>' : '&nbsp;')}</td><td>${ttd.img('teknik') || (a.teknik_name ? '<span class="ta1-stamp">Diparaf digital</span>' : '&nbsp;')}</td><td>${ttd.img('direksi') || (a.direksi_name ? '<span class="ta1-stamp">Diparaf digital</span>' : '&nbsp;')}</td></tr>
  <tr class="name"><td>${ttd.nama('pengaju', a.created_name)}</td><td>${ttd.nama('teknik', a.teknik_name)}</td><td>${ttd.nama('direksi', a.direksi_name)}</td></tr>
  <tr class="date"><td>Tanggal: ${ttd.tgl('pengaju', a.tanggal_serah) || '……………………'}</td><td>Tanggal: ${ttd.tgl('teknik', a.teknik_at) || '……………………'}</td><td>Tanggal: ${ttd.tgl('direksi', a.direksi_at) || '……………………'}</td></tr>
</tbody></table>
</div>${gambarPages(a, gambar, thumbs, TITLE_ANALISA)}`
}

// Formulir "Rekomendasi Proses Produksi" (analisa dari Sales Order / PPIC), mengikuti formulir Excel Dept Tehnik
function rekomendasiHtml(a: TechAnalysis, kop: string, procTable: string, ttd: Sig) {
  // Kolom Td Tangan / Paraf: gambar tanda tangan digital, atau cap "Diparaf digital" bila hanya disetujui di SIMPAP
  const paraf = (p: TaSignRole, on: boolean) => ttd.img(p) || (on ? '<span class="ta1-stamp">Diparaf digital</span>' : '')
  const r = (label: string, value: string, nama = '', paraf = '') =>
    `<tr><td class="lbl">${label}</td><td class="eq">=</td><td class="val">${val(value)}</td><td class="nm">${nama}</td><td class="pf">${paraf}</td></tr>`
  // Isian Teknik / Direksi lain yang ada di SIMPAP (tampil hanya bila diisi)
  const notes = [
    a.bisa_produksi ? `<b>Kesimpulan:</b> ${esc(BISA_LABEL[a.bisa_produksi])}${a.penjelasan_produksi ? ` · ${br(a.penjelasan_produksi)}` : ''}` : '',
    a.kesulitan_kualitas ? `<b>Kesulitan kwalitas:</b> ${esc(KUALITAS_LABEL[a.kesulitan_kualitas])}${a.penjelasan_kualitas ? ` · ${br(a.penjelasan_kualitas)}` : ''}` : '',
    a.catatan_lain ? `<b>Catatan:</b> ${br(a.catatan_lain)}` : '',
    a.rekomendasi_direksi ? `<b>Rekomendasi Direksi / Opr Mgr:</b> ${br(a.rekomendasi_direksi)}` : '',
  ].filter(Boolean)
  return `<div class="pap-sheet pap-ta ta-v1 ta1-so">
${kop}

<h2 class="ta1-title">${TITLE_SO}</h2>
<p class="ta1-sub">Dari Dept PPIC (Sales Order) ke Dept Tehnik</p>

<table class="ta1-info"><tbody>
  <tr><td><b>Status Order</b> = <span class="ta1-muted">&#9744; Baru &nbsp; &#9744; Repeat</span> <i class="ta1-muted">(diisi PPIC)</i></td><td class="no">No. Pengajuan <b>${esc(a.nomor)}</b></td></tr>
  <tr><td><b>Dibuat Tanggal</b> = ${val(tgl(a.tanggal_serah))}</td><td></td></tr>
</tbody></table>

<table class="ta1-spec ta1-sohead"><tbody>
  <tr class="hd"><td class="lbl"></td><td class="eq"></td><td class="val"></td><td class="nm"><b>Nama</b></td><td class="pf"><b>Td Tangan / Paraf</b></td></tr>
  ${r('<b>Nama Produk</b> <i>(diisi PPIC)</i>', `<b>${esc(a.nama_produk)}</b>`)}
  ${r('<b>Nomor Order / Buffer Stock</b> <i>(diisi PPIC)</i>', esc(a.so_number ?? ''))}
  ${r('<b>Nama Customer</b> <i>(diisi PPIC)</i>', esc(a.nama_customer))}
  ${r('Jumlah Gambar / Kantong <i>(diisi PPIC)</i>', a.jumlah_gambar !== null ? n(a.jumlah_gambar) : '')}
  ${r('<b>Diajukan oleh</b> <i>(diisi PPIC)</i>', ttd.tgl('pengaju', a.tanggal_serah), ttd.nama('pengaju', a.created_name), paraf('pengaju', false))}
  ${r('<b>Dibuat oleh</b> <i>(diisi Tehnik)</i>', ttd.tgl('teknik', a.teknik_at), ttd.nama('teknik', a.teknik_name), paraf('teknik', !!a.teknik_name))}
  ${r('<b>Disetujui</b> <i>(diisi Direksi / Opr Mgr)</i>', ttd.tgl('direksi', a.direksi_at), ttd.nama('direksi', a.direksi_name), paraf('direksi', !!a.direksi_name))}
</tbody></table>

<p class="ta1-h">Rekomendasi sesuai Urutan Proses <i>(diisi oleh Tehnik)</i></p>
${procTable}
${notes.length ? `<div class="ta1-sonotes">${notes.map((x) => `<p>${x}</p>`).join('')}</div>` : ''}

<p class="ta1-socat"><i>Catatan : Untuk Order2 Mass Product, atau Repeat Order cukup menggunakan Rekomendasi yg sudah pernah ada (cukup dilampirkan).<br>
Kecuali ada Perubahan Rekomendasi Proses Produksi yang baru dari Bagian Tehnik (jika ada perubahan2 tehnologi).</i></p>
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
.ta1-roto { margin: 2pt 0 4pt; font-size: 9pt; }
.ta1-fig { border: 1px solid #999; padding: 6pt; text-align: center; } .ta1-fig img { max-width: 100%; } .ta1-fig p { margin: 4pt 0 0; font-size: 9pt; }
.ta1-proc th { background: #e9ebf3; font-size: 8.5pt; }
.ta1-proc td.ck { width: 16pt; text-align: center; }
.ta1-proc td.m { width: 24%; } .ta1-proc td.k { width: 16%; } .ta1-proc td.k2, .ta1-proc th.k2 { width: 10%; } .ta1-proc td.k3, .ta1-proc th.k3 { width: 7%; } .ta1-proc td.r, .ta1-proc th.r { width: 13%; text-align: right; }
.ta1-proc tr.on td { background: #eefaf3; }
.ta1-concl { width: 100%; border-collapse: collapse; margin-top: 12pt; }
.ta1-concl td { padding: 4pt 5pt; border-bottom: 1px solid #e3e5ee; vertical-align: top; }
.ta1-concl tr.hd td { border-bottom: 1.5pt solid #1f2a5a; font-size: 10pt; }
.ta1-concl td.no { width: 14pt; text-align: right; font-weight: bold; }
.ta1-concl td.paraf, .ta1-rek td.paraf { width: 32%; }
.ta1-concl .exp { margin-top: 2pt; color: #333; }
.ta1-p2head { width: 100%; border-collapse: collapse; border-bottom: 1.5pt solid #1f2a5a; margin-bottom: 10pt; }
.ta1-p2head td { padding: 0 0 4pt; vertical-align: bottom; }
.ta1-p2head td.no { width: 28%; text-align: right; }
.ta1-rek { width: 100%; border-collapse: collapse; }
.ta1-rek td { height: 60pt; padding: 6pt; border: 1px solid #9aa0b4; vertical-align: top; }
.ta1-sign { width: 100%; border-collapse: collapse; margin-top: 18pt; }
.ta1-sign td { width: 33%; padding: 2pt 10pt; text-align: center; vertical-align: top; }
.ta1-sign tr.role div { color: #666; font-size: 8.5pt; }
.ta1-sign tr.space td { height: 56pt; vertical-align: middle; }
.ta1-sign tr.name td { border-top: 1px solid #1b1d2e; padding-top: 3pt; }
.ta1-sign tr.date td { color: #555; font-size: 8.5pt; }
.ta1-sohead td.lbl { width: 32%; } .ta1-sohead td.nm { width: 22%; } .ta1-sohead td.pf { width: 17%; text-align: center; } .ta1-sohead .ta1-sigimg { height: 32pt; max-width: 90pt; }
.ta1-sonotes { margin-top: 8pt; padding: 6pt 8pt; border: 1px solid #c9ccd8; font-size: 9pt; } .ta1-sonotes p { margin: 0 0 3pt; }
.ta1-socat { margin-top: 14pt; font-size: 9pt; color: #333; }
.ta1-sigimg { height: 46pt; width: auto; max-width: 150pt; }
.ta1-stamp { padding: 1pt 6pt; border: 1px dashed #12a37a; color: #0b7a5a; font-size: 8pt; }
`

// Gambar yang bisa dipratinjau; bila tidak (PDF, CDR, link biasa, Drive belum dibagikan) tampil kartu jenis file + link
const fileCard = (g: { name: string; type: string; link: string | null }) =>
  `<div class="ta1-filecard"><b>${esc(g.type)}</b><span>${esc(g.name)}</span><small>Pratinjau tidak tersedia${g.link ? ' · buka lewat link di bawah' : ''}</small></div>`
function figure(g: { name: string; src: string | null; type: string; link: string | null }) {
  // File PDF: halaman pertama dirender jadi gambar di browser (app/cetak/analisa-teknik/pdf-figures.tsx); kartu tampil bila gagal
  if (!g.src && g.type === 'PDF' && g.link && !/^https?:/.test(g.link)) return `<div class="ta1-pdf" data-pdf="${esc(g.link)}" data-name="${esc(g.name)}"></div>${fileCard(g)}`
  if (!g.src) return fileCard(g)
  // Gambar gagal dimuat (mis. file Drive privat): sembunyikan, tampilkan kartu file di sebelahnya
  return `<img src="${esc(g.src)}" alt="${esc(g.name)}" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">${fileCard(g).replace('<div class="ta1-filecard"', '<div class="ta1-filecard" style="display:none"')}`
}

// Gambar Produk: setiap gambar satu halaman A4 tersendiri (Halaman 3, 4, ...) dengan kop ringkas, gambar memenuhi halaman.
// Sumber: lampiran (file gambar, link Drive, file / link lain) + desain Master Data. Word (thumbs=false): nama file + link saja.
function gambarPages(a: TechAnalysis, files: TaGambar[], thumbs: boolean, title: string) {
  const first = a.sumber === 'ppic' ? 2 : 3 // Rekomendasi SO = 1 halaman, Analisa = 2 halaman
  const desain = (a.desain ?? []).map((d) => ({ name: d.name, src: `/api/order-custom/designs/${encodeURIComponent(d.id)}/thumb?s=1200` as string | null, link: d.web_link, type: 'Master Data' }))
  const all = [...files.map((f) => ({ ...f, link: f.link ?? null, type: f.type ?? 'Gambar' })), ...desain]
  if (!all.length) return ''
  const per = a.jumlah_gambar ? ` · ${n(a.jumlah_gambar)} gambar / kantong` : ''
  return all.map((g, i) => `
<br class="ta1-pb" clear="all" style="page-break-before:always">
<div class="pap-sheet pap-ta ta-v1 ta1-page2 ta1-page3">
<table class="ta1-p2head"><tbody><tr>
  <td><b>${title}</b><div class="ta1-muted">${esc(a.nama_produk)} · ${esc(a.nama_customer)}</div></td>
  <td class="no">No. <b>${esc(a.nomor)}</b><div class="ta1-muted">Halaman ${i + first} · Gambar Produk${all.length > 1 ? ` ${i + 1}/${all.length}` : ''}</div></td>
</tr></tbody></table>
<p class="ta1-h">Gambar Produk${per ? ` <i>(${per.slice(3)})</i>` : ''}</p>
<div class="ta1-fig">${thumbs ? figure(g) : ''}<p>${g.link ? `<a href="${esc(g.link)}">${esc(g.name)}</a>` : esc(g.name)}</p>${g.link && /^https?:/.test(g.link) ? `<p class="ta1-url">${esc(g.link)}</p>` : ''}</div>
</div>`).join('')
}
