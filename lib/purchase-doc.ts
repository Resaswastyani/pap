// Dokumen cetak Pengajuan Pembelian (Purchasing) dan Pengajuan Pembelian GA: satu tata letak (kelas pap-sheet-*,
// sama dengan Quotation / Dokumen Order), dipakai halaman cetak /cetak/pengajuan-* (simpan PDF) dan ekspor Word.
import { loadSettings } from '@/lib/hpp'
import { GA_PR_PRIORITY, GA_PR_STATUS, loadGaPr, loadGaPrItems, requireGaRequest, type GaPrStatus } from '@/lib/ga-requests'
import { loadPr, loadPrItems } from '@/lib/purchase-requests'
import { PR_PRIORITY, PR_STATUS, requireTeknikMenu } from '@/lib/teknik'
import type { UserProfile } from '@/lib/users'

type DocItem = { nama: string; spesifikasi?: string | null; jumlah: number; satuan: string; harga?: number | null; realisasi?: number | null; catatan?: string | null }
export type PurchaseDocView = {
  judul: string; nomor: string; tanggal: string; status: string; prioritas: string; dibutuhkan: string | null
  pengaju: string; divisi: string; kategori?: string | null; perihal?: string | null; keperluan: string | null; referensi?: string | null
  items: DocItem[]; harga: boolean; realisasi: boolean; keterangan: string[]; tanda: { label: string; nama: string | null }[]
}

const MONTHS = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember']
const tanggal = (v: string | null) => (v ? `${Number(v.slice(8, 10))} ${MONTHS[Number(v.slice(5, 7)) - 1]} ${v.slice(0, 4)}` : '-')
const rp = (v: number) => `Rp ${v.toLocaleString('id-ID', { maximumFractionDigits: 0 })}`
const esc = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
const qty = (v: number) => v.toLocaleString('id-ID', { maximumFractionDigits: 2 })

export async function purchaseDocHtml(v: PurchaseDocView, logoSrc: string) {
  const doc = await loadSettings('doc.')
  const perusahaan = doc.nama || 'PT. Pandawa Amerta Packindo'
  const telepon = String(doc.telepon || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  const cols = 3 + (v.harga ? 2 : 0) + (v.realisasi ? 1 : 0)
  const totalEst = v.items.reduce((s, i) => s + i.jumlah * (i.harga ?? 0), 0)
  const totalReal = v.items.reduce((s, i) => s + i.jumlah * (i.realisasi ?? 0), 0)
  const meta = (a: [string, string], b?: [string, string]) =>
    `<tr><td>${esc(a[0])}</td><td${b ? '' : ' colspan="3"'}>: ${a[1]}</td>${b ? `<td>${esc(b[0])}</td><td>: ${b[1]}</td>` : ''}</tr>`

  return `<div class="pap-sheet">
<table class="pap-sheet-head"><tbody><tr>
  <td class="logo"><img src="${esc(logoSrc)}" alt="" width="120"></td>
  <td><h1>${esc(perusahaan)}</h1><p>Flexible Plastic Packaging Manufacture</p>${doc.alamat ? `<p>${esc(doc.alamat)}</p>` : ''}${telepon.length ? `<p>Telp/WA: ${telepon.map(esc).join(' · ')}</p>` : ''}${doc.email ? `<p>${esc(doc.email)}</p>` : ''}</td>
</tr></tbody></table>
<h2 class="pap-sheet-title">${esc(v.judul)}</h2>
<table class="pap-sheet-meta"><tbody>
  ${meta(['Nomor', esc(v.nomor)], ['Tanggal', tanggal(v.tanggal)])}
  ${meta(['Diajukan oleh', `<b>${esc(v.pengaju)}</b>`], ['Divisi', esc(v.divisi)])}
  ${meta(['Prioritas', esc(v.prioritas)], ['Dibutuhkan', tanggal(v.dibutuhkan)])}
  ${v.kategori ? meta(['Kategori', esc(v.kategori)], ['Status', esc(v.status)]) : meta(['Status', esc(v.status)])}
  ${v.perihal ? meta(['Perihal', esc(v.perihal)]) : ''}
  ${v.referensi ? meta(['Referensi', esc(v.referensi)]) : ''}
</tbody></table>
${v.keperluan ? `<h3>Keperluan</h3><p class="pre">${esc(v.keperluan)}</p>` : ''}
<table class="pap-sheet-items">
  <thead><tr><th>No</th><th>Barang / jasa</th><th>Jumlah</th>${v.harga ? '<th>Perkiraan harga</th><th>Perkiraan jumlah</th>' : ''}${v.realisasi ? '<th>Harga realisasi</th>' : ''}</tr></thead>
  <tbody>${v.items.map((it, i) => `<tr><td class="c">${i + 1}</td><td><b>${esc(it.nama)}</b>${it.spesifikasi ? `<div class="spec">${esc(it.spesifikasi)}</div>` : ''}${it.catatan ? `<div class="spec">${esc(it.catatan)}</div>` : ''}</td><td class="r">${qty(it.jumlah)} ${esc(it.satuan)}</td>${v.harga ? `<td class="r">${it.harga === null || it.harga === undefined ? '-' : rp(it.harga)}</td><td class="r">${it.harga ? rp(it.jumlah * it.harga) : '-'}</td>` : ''}${v.realisasi ? `<td class="r">${it.realisasi === null || it.realisasi === undefined ? '-' : rp(it.realisasi)}</td>` : ''}</tr>`).join('')}</tbody>
  ${v.harga ? `<tfoot>
    <tr class="grand"><td colspan="${cols - 1 - (v.realisasi ? 1 : 0)}" class="r">PERKIRAAN TOTAL</td><td class="r">${rp(totalEst)}</td>${v.realisasi ? '<td></td>' : ''}</tr>
    ${v.realisasi ? `<tr class="grand"><td colspan="${cols - 1}" class="r">TOTAL REALISASI</td><td class="r">${rp(totalReal)}</td></tr>` : ''}
  </tfoot>` : ''}
</table>
${v.keterangan.length ? `<h3>Keterangan</h3><p class="pre">${v.keterangan.map(esc).join('\n')}</p>` : ''}
<table class="pap-sheet-sign"><tbody><tr>
  ${v.tanda.map((t) => `<td><p>${esc(t.label)},</p><div class="space">&nbsp;</div><p><b>${t.nama ? esc(t.nama) : '(..............................)'}</b></p></td>`).join('')}
</tr></tbody></table>
</div>`
}

// ---------- Pengajuan Pembelian (Teknik / PPIC -> Purchasing) ----------
export async function purchaseRequestView(id: number, user: UserProfile): Promise<PurchaseDocView> {
  requireTeknikMenu(user, 'pengajuan-pembelian', 'Pengajuan Pembelian')
  const pr = (await loadPr(id)) as Record<string, unknown> & Awaited<ReturnType<typeof loadPr>>
  const items = await loadPrItems(pr.id)
  const keterangan = [
    pr.vendor_name && `Supplier: ${pr.vendor_name}${pr.vendor_phone ? ` (${pr.vendor_phone})` : ''}`,
    pr.po_number && `No. PO Accurate: ${pr.po_number}`,
    pr.catatan_purchasing && `Catatan Purchasing: ${pr.catatan_purchasing}`,
  ].filter(Boolean) as string[]
  return {
    judul: 'FORMULIR PENGAJUAN PEMBELIAN', nomor: String(pr.nomor ?? `#${pr.id}`), tanggal: String(pr.created_at).slice(0, 10),
    status: PR_STATUS[pr.status as keyof typeof PR_STATUS] ?? String(pr.status), prioritas: PR_PRIORITY[pr.prioritas as keyof typeof PR_PRIORITY] ?? String(pr.prioritas),
    dibutuhkan: (pr.dibutuhkan as string | null) ?? null, pengaju: String(pr.requested_name), divisi: String(pr.requester_division ?? '-'), keperluan: String(pr.keperluan ?? '') || null,
    referensi: pr.repair_nomor ? `Perbaikan mesin ${pr.repair_nomor}${pr.repair_mesin ? ` · ${pr.repair_mesin}` : ''}` : null,
    items: items.map((i) => ({ nama: i.nama, spesifikasi: (i as Record<string, unknown>).spesifikasi as string | null, jumlah: i.jumlah, satuan: i.satuan })),
    harga: false, realisasi: false, keterangan,
    tanda: [
      { label: 'Diajukan oleh', nama: String(pr.requested_name) },
      { label: 'Mengetahui (GM)', nama: null },
    ],
  }
}

// ---------- Pengajuan Pembelian GA ----------
export async function gaRequestView(id: number, user: UserProfile): Promise<PurchaseDocView> {
  requireGaRequest(user)
  const pr = await loadGaPr(id, user)
  const items = await loadGaPrItems(id)
  const status = pr.status as GaPrStatus
  const realisasi = items.some((i) => i.harga_realisasi !== null)
  const keterangan = [
    pr.vendor && `Dibeli di: ${pr.vendor}${pr.bought_at ? `, ${tanggal(String(pr.bought_at))}` : ''}`,
    pr.catatan_ga && `Catatan GA: ${pr.catatan_ga}`,
  ].filter(Boolean) as string[]
  return {
    judul: 'FORMULIR PENGAJUAN PEMBELIAN GENERAL AFFAIR', nomor: String(pr.nomor ?? `#${pr.id}`), tanggal: String(pr.created_at).slice(0, 10),
    status: GA_PR_STATUS[status] ?? status, prioritas: GA_PR_PRIORITY[pr.prioritas as keyof typeof GA_PR_PRIORITY] ?? String(pr.prioritas),
    dibutuhkan: (pr.dibutuhkan as string | null) ?? null, pengaju: String(pr.requested_name), divisi: String(pr.requested_division ?? '-'),
    kategori: String(pr.kategori), perihal: String(pr.judul), keperluan: (pr.keperluan as string | null) ?? null,
    items: items.map((i) => ({ nama: String(i.nama), jumlah: i.jumlah, satuan: String(i.satuan), harga: i.harga_estimasi, realisasi: i.harga_realisasi, catatan: (i.catatan as string | null) ?? null })),
    harga: true, realisasi, keterangan,
    tanda: [
      { label: 'Diajukan oleh', nama: String(pr.requested_name) },
      { label: 'Mengetahui (GM)', nama: null },
    ],
  }
}
