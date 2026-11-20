// Formulir "Analisa Aspek Teknik Atas Rencana Order Baru / Spec Baru" sebagai HTML (server-only).
// Dipakai halaman cetak (/cetak/analisa-teknik/[id] -> PDF lewat dialog cetak) dan ekspor Word (/api/tech-analyses/[id]/word).
// Tata letak memakai tabel agar tampil sama di browser, PDF, dan Microsoft Word.
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
// Nilai kosong: garis isian (untuk diisi tangan pada formulir cetak)
const val = (v: string) => (v.trim() ? v : '<span class="ta-blank">&nbsp;</span>')

export const BISA_LABEL = { bisa: 'BISA diproduksi dengan produktivitas optimal', bersyarat: 'BISA dengan syarat / penyesuaian', tidak: 'TIDAK BISA diproduksi dengan produktivitas optimal' } as const
const BISA_SHORT = { bisa: 'Bisa diproduksi', bersyarat: 'Bisa bersyarat', tidak: 'Tidak bisa diproduksi' } as const
export const KUALITAS_LABEL = { mudah: 'Mudah', sedang: 'Sedang', sulit: 'Sulit' } as const
const STATUS_LABEL = { draft: 'Draft Marketing', diserahkan: 'Di Dept Teknik', dianalisa: 'Menunggu Direksi', selesai: 'Selesai' } as const

export async function techAnalysisSettings() {
  return loadSettings('doc.')
}

export function techAnalysisHtml(a: TechAnalysis, doc: Record<string, string>, logoSrc: string) {
  const perusahaan = doc.nama || 'PT. Pandawa Amerta Packindo'
  const ukuran = [a.panjang_cm !== null ? `P ${n(a.panjang_cm)} cm` : '', a.lebar_cm !== null ? `L ${n(a.lebar_cm)} cm` : '', a.tebal_mm !== null ? `T ${n(a.tebal_mm, 4)} mm` : ''].filter(Boolean).join(' &times; ')
  const print = a.print_jenis === 'polos' ? 'Polos' : a.print_jenis === 'print' ? `Print ${a.jumlah_warna ?? '…'} warna` : ''
  const qty = a.qty_order !== null ? `${n(a.qty_order)} ${esc(a.qty_satuan ?? '')}` : ''
  const frek = a.frekuensi === 'sekali' ? 'Hanya 1x order' : a.frekuensi === 'rutin' ? `Rutin per ${a.rutin_bulan ?? '…'} bulan` : ''
  const used = a.proses.filter((p) => p.dipakai)
  const totalProd = used.reduce((s, p) => s + (p.produktivitas ?? 0), 0)
  const status = STATUS_LABEL[a.status] ?? a.status
  const kv = (label: string, value: string) => `<td class="k">${label}</td><td class="v">${val(value)}</td>`

  return `<div class="pap-sheet pap-ta ta-v2">
<table class="pap-sheet-head"><tbody><tr>
  <td class="logo"><img src="${esc(logoSrc)}" alt="" width="110"></td>
  <td><h1>${esc(perusahaan)}</h1><p>Flexible Plastic Packaging Manufacture</p>${doc.alamat ? `<p>${esc(doc.alamat)}</p>` : ''}</td>
</tr></tbody></table>

<table class="ta-titlebar"><tbody><tr>
  <td class="ta-title-cell">
    <div class="ta-kicker">Formulir · Dept Marketing &rarr; Dept Tehnik</div>
    <h2 class="ta-title">Analisa Aspek Tehnik</h2>
    <div class="ta-subtitle">Atas Rencana Order Baru / Spec Baru</div>
  </td>
  <td class="ta-meta-cell">
    <table class="ta-meta"><tbody>
      <tr><td>No. Dokumen</td><td><b>${esc(a.nomor)}</b></td></tr>
      <tr><td>Diserahkan</td><td>${val(tgl(a.tanggal_serah))}</td></tr>
      <tr><td>Marketing</td><td>${val(esc(a.created_name ?? ''))}</td></tr>
      <tr><td>Status</td><td><span class="ta-badge st-${a.status}">${esc(status)}</span></td></tr>
    </tbody></table>
  </td>
</tr></tbody></table>

<table class="ta-sec"><tbody><tr><td class="ta-sec-no">A</td><td class="ta-sec-title">Spesifikasi Order <span>diisi oleh Marketing</span></td></tr></tbody></table>
<table class="ta-spec"><tbody>
  <tr>${kv('Nama Produk', `<b>${esc(a.nama_produk)}</b>`)}${kv('Nama Customer', `<b>${esc(a.nama_customer)}</b>`)}</tr>
  <tr>${kv('Jenis Plastik', esc(a.jenis_plastik ?? ''))}${kv('Ukuran', ukuran)}</tr>
  <tr>${kv('Polos / Jml Print', esc(print))}${kv('Kesulitan Print', esc(a.kesulitan_print ?? ''))}</tr>
  <tr>${kv('Qty Order', qty)}${kv('Frekuensi Order', esc(frek))}</tr>
  <tr><td class="k">Spec Lainnya</td><td class="v" colspan="3">${val(br(a.spec_lainnya))}<div class="ta-hint">Airhole, pillow case, gusset, dll.</div></td></tr>
  <tr class="ta-ctq"><td class="k">Critical to Quality</td><td class="v" colspan="3">${val(br(a.critical_to_quality))}</td></tr>
</tbody></table>

<table class="ta-sec"><tbody><tr><td class="ta-sec-no">B</td><td class="ta-sec-title">Analisa Sesuai Urutan Proses <span>diisi oleh Dept Tehnik</span></td></tr></tbody></table>
<table class="ta-proc">
  <thead><tr><th class="no">No</th><th class="ck">Pakai</th><th>Mesin / Proses</th><th>Kecepatan Mesin</th><th>Keterangan Lainnya</th><th class="r">Produktivitas<br>(kg / jam)</th></tr></thead>
  <tbody>${a.proses.map((p, i) => `<tr class="${p.dipakai ? 'on' : ''}">
    <td class="no">${i + 1}</td>
    <td class="ck"><span class="ta-check${p.dipakai ? ' on' : ''}">${p.dipakai ? '&#10003;' : '&nbsp;'}</span></td>
    <td class="m">${esc(p.mesin)}</td>
    <td>${p.kec_label ? `<span class="ta-kec">${esc(p.kec_label)}</span> ` : ''}${p.kecepatan ? `<b>${esc(p.kecepatan)}</b>` : ''}</td>
    <td>${br(p.keterangan)}</td>
    <td class="r">${p.produktivitas !== null ? `<b>${n(p.produktivitas)}</b>` : ''}</td>
  </tr>`).join('')}
  <tr><td class="no">${a.proses.length + 1}</td><td class="ck"><span class="ta-check">&nbsp;</span></td><td class="m ta-muted">Proses lain: ……………</td><td></td><td></td><td></td></tr></tbody>
  <tfoot><tr><td colspan="5">${used.length ? `<b>${used.length} proses dipakai</b> &middot; ${used.map((p) => esc(p.mesin)).join(' &rarr; ')}` : 'Proses yang dipakai: centang kolom Pakai'}</td><td class="r">${totalProd ? `<b>${n(totalProd)}</b>` : ''}</td></tr></tfoot>
</table>

<table class="ta-sec"><tbody><tr><td class="ta-sec-no">C</td><td class="ta-sec-title">Kesimpulan Analisa Tehnis Produksi &amp; Rekomendasi <span>Dept Tehnik</span></td></tr></tbody></table>
<table class="ta-concl"><tbody>
  <tr>
    <td class="q"><span class="ta-qno">1</span>Bisa / Tidak Bisa Diproduksi dengan Produktivitas yang Optimal</td>
    <td class="a">${a.bisa_produksi ? `<span class="ta-badge v-${a.bisa_produksi}">${esc(BISA_SHORT[a.bisa_produksi])}</span>` : '<span class="ta-opt">&#9744; Bisa &nbsp; &#9744; Bersyarat &nbsp; &#9744; Tidak bisa</span>'}<div class="ta-exp"><span>Penjelasan:</span> ${val(br(a.penjelasan_produksi))}</div></td>
  </tr>
  <tr>
    <td class="q"><span class="ta-qno">2</span>Tingkat Kesulitan untuk Memenuhi Kualitas</td>
    <td class="a">${a.kesulitan_kualitas ? `<span class="ta-badge q-${a.kesulitan_kualitas}">${esc(KUALITAS_LABEL[a.kesulitan_kualitas])}</span>` : '<span class="ta-opt">&#9744; Mudah &nbsp; &#9744; Sedang &nbsp; &#9744; Sulit</span>'}<div class="ta-exp"><span>Penjelasan:</span> ${val(br(a.penjelasan_kualitas))}</div></td>
  </tr>
  <tr>
    <td class="q"><span class="ta-qno">3</span>Catatan Penting Lainnya</td>
    <td class="a">${val(br(a.catatan_lain))}</td>
  </tr>
</tbody></table>

<table class="ta-sec"><tbody><tr><td class="ta-sec-no">D</td><td class="ta-sec-title">Rekomendasi dari Direksi</td></tr></tbody></table>
<table class="ta-rek"><tbody><tr><td>${val(br(a.rekomendasi_direksi))}</td></tr></tbody></table>

<table class="ta-sign"><tbody>
  <tr><td>Dibuat oleh,<div class="ta-role">Dept Marketing</div></td><td>Dianalisa oleh,<div class="ta-role">Dept Tehnik</div></td><td>Rekomendasi,<div class="ta-role">Direksi</div></td></tr>
  <tr class="ta-sign-space"><td>${a.tanggal_serah ? '<span class="ta-signed">Diserahkan</span>' : '&nbsp;'}</td><td>${a.teknik_name ? '<span class="ta-signed">Diparaf digital</span>' : '&nbsp;'}</td><td>${a.direksi_name ? '<span class="ta-signed">Diparaf digital</span>' : '&nbsp;'}</td></tr>
  <tr class="ta-sign-name"><td>${val(esc(a.created_name ?? ''))}<div>${tgl(a.tanggal_serah)}</div></td><td>${val(esc(a.teknik_name ?? ''))}<div>${tgl(a.teknik_at)}</div></td><td>${val(esc(a.direksi_name ?? ''))}<div>${tgl(a.direksi_at)}</div></td></tr>
</tbody></table>
<p class="ta-foot">${esc(a.nomor)} &middot; Dokumen dari SIMPAP &middot; ${esc(perusahaan)}</p>
</div>`
}

// CSS lembar analisa (dipakai di Word; halaman cetak memakai aturan yang sama di globals.css)
export const TA_WORD_CSS = `
@page { size: 21cm 29.7cm; margin: 1.3cm 1.4cm; }
body { font-family: Arial, sans-serif; font-size: 9.5pt; color: #1b1d2e; }
.pap-sheet-head { width: 100%; border-collapse: collapse; border-bottom: 3px double #1f2a5a; }
.pap-sheet-head td { vertical-align: middle; padding: 0 10pt 6pt 0; }
.pap-sheet-head h1 { margin: 0; font-size: 14pt; color: #1f2a5a; }
.pap-sheet-head p { margin: 0; color: #555; font-size: 8.5pt; }
.ta-titlebar { width: 100%; border-collapse: collapse; margin: 10pt 0 4pt; }
.ta-title-cell { vertical-align: bottom; }
.ta-kicker { color: #6a4ee0; font-size: 7.5pt; font-weight: bold; letter-spacing: 1pt; text-transform: uppercase; }
.ta-title { margin: 2pt 0 0; font-size: 17pt; color: #1f2a5a; }
.ta-subtitle { color: #555; font-size: 10pt; }
.ta-meta-cell { width: 38%; vertical-align: bottom; }
.ta-meta { width: 100%; border-collapse: collapse; border: 1px solid #d9dcea; }
.ta-meta td { padding: 2.5pt 6pt; border-bottom: 1px solid #eceef5; font-size: 8.5pt; }
.ta-meta td:first-child { width: 42%; color: #6b7085; background: #f6f7fb; }
.ta-badge { padding: 1pt 6pt; border-radius: 8pt; font-size: 8pt; font-weight: bold; background: #eef0f7; color: #1f2a5a; }
.st-diserahkan { background: #fff3db; color: #8a5300; } .st-dianalisa { background: #ecebff; color: #4c37b8; } .st-selesai { background: #dcf5ec; color: #0b7a5a; }
.v-bisa, .q-mudah { background: #dcf5ec; color: #0b7a5a; } .v-bersyarat, .q-sedang { background: #fff3db; color: #8a5300; } .v-tidak, .q-sulit { background: #fde4e4; color: #b42318; }
.ta-sec { width: 100%; border-collapse: collapse; margin: 12pt 0 5pt; }
.ta-sec-no { width: 16pt; padding: 2pt 0; background: #1f2a5a; color: #fff; text-align: center; font-weight: bold; }
.ta-sec-title { padding: 2pt 8pt; background: #eef0f7; font-weight: bold; color: #1f2a5a; }
.ta-sec-title span { color: #6b7085; font-weight: normal; font-style: italic; font-size: 8.5pt; }
.ta-spec { width: 100%; border-collapse: collapse; border: 1px solid #d9dcea; }
.ta-spec td { padding: 4pt 6pt; border: 1px solid #e3e5ee; vertical-align: top; }
.ta-spec td.k { width: 17%; background: #f6f7fb; color: #4a4f66; font-size: 8.5pt; }
.ta-spec td.v { width: 33%; }
.ta-ctq td.v { background: #fffaf0; }
.ta-hint { color: #8a8fa5; font-size: 7.5pt; }
.ta-blank { display: inline-block; min-width: 90pt; border-bottom: 1px dotted #9aa0b4; }
.ta-proc { width: 100%; border-collapse: collapse; }
.ta-proc th { padding: 4pt 5pt; background: #1f2a5a; color: #fff; font-size: 8pt; border: 1px solid #1f2a5a; }
.ta-proc td { padding: 3pt 5pt; border: 1px solid #d9dcea; vertical-align: top; }
.ta-proc td.no { width: 16pt; text-align: center; color: #8a8fa5; }
.ta-proc td.ck { width: 24pt; text-align: center; }
.ta-proc td.r, .ta-proc th.r { text-align: right; }
.ta-proc tr.on td { background: #f1fbf6; }
.ta-proc tfoot td { background: #f6f7fb; font-size: 8.5pt; }
.ta-check { display: inline-block; width: 10pt; height: 10pt; border: 1px solid #9aa0b4; text-align: center; font-size: 8pt; line-height: 10pt; }
.ta-check.on { border-color: #12a37a; background: #12a37a; color: #fff; }
.ta-kec { color: #8a8fa5; font-size: 8pt; }
.ta-muted { color: #8a8fa5; }
.ta-concl { width: 100%; border-collapse: collapse; border: 1px solid #d9dcea; }
.ta-concl td { padding: 5pt 6pt; border: 1px solid #e3e5ee; vertical-align: top; }
.ta-concl td.q { width: 38%; background: #f6f7fb; font-weight: bold; color: #1f2a5a; }
.ta-qno { display: inline-block; width: 12pt; color: #6a4ee0; }
.ta-exp { margin-top: 3pt; } .ta-exp span { color: #6b7085; }
.ta-opt { color: #4a4f66; }
.ta-rek { width: 100%; border-collapse: collapse; border: 1px solid #d9dcea; }
.ta-rek td { height: 34pt; padding: 6pt; vertical-align: top; background: #fbfbfe; }
.ta-sign { width: 100%; border-collapse: collapse; margin-top: 14pt; }
.ta-sign td { width: 33%; padding: 3pt 8pt; text-align: center; vertical-align: top; }
.ta-role { color: #6b7085; font-size: 8pt; }
.ta-sign-space td { height: 40pt; vertical-align: middle; }
.ta-signed { padding: 1pt 6pt; border: 1px dashed #12a37a; color: #0b7a5a; font-size: 8pt; }
.ta-sign-name td { border-top: 1px solid #1b1d2e; font-weight: bold; }
.ta-sign-name div { color: #6b7085; font-weight: normal; font-size: 8pt; }
.ta-foot { margin: 10pt 0 0; color: #9aa0b4; font-size: 7pt; text-align: center; }
`
