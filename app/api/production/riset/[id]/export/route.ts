import { fail, handle, int, requireUser } from '@/lib/api'
import { requireMenu } from '@/lib/customers'
import { calcProjection, loadProjection } from '@/lib/material-projection'
import { canViewProduction } from '@/lib/production'
import { writeXlsx, type XlsxCell } from '@/lib/xlsx-write'

type Ctx = { params: Promise<{ id: string }> }

// Unduh satu riset (Excel): ringkasan, kebutuhan bahan, HPP & GPF per produk, komposisi
export const GET = handle(async (_request: Request, ctx: Ctx) => {
  const user = await requireUser()
  requireMenu(user, canViewProduction(user))
  const p = await loadProjection(int((await ctx.params).id) ?? fail(404, 'Riset / proyeksi tidak ditemukan.'))
  const r = calcProjection(p.items, p.prices, p.stock)
  const t = r.totals
  const h = (v: string): XlsxCell => ({ v, s: 'head' })
  const n = (v: number | null): XlsxCell => (v === null ? { v: '', s: 'cell' } : { v: Math.round(v * 100) / 100, s: 'num' })
  const c = (v: string | number | null): XlsxCell => ({ v: v ?? '', s: 'cell' })
  const periode = p.tanggal_mulai || p.tanggal_selesai ? `${p.tanggal_mulai ?? '…'} s.d. ${p.tanggal_selesai ?? '…'}` : '-'
  const ringkasan: XlsxCell[][] = [
    [{ v: `RISET BAHAN BAKU ${p.kode}`, s: 'title' }],
    [c(p.nama)], [c(`Periode: ${periode}`)], ...(p.catatan ? [[c(p.catatan)]] : []), [],
    [h('Ringkasan'), h('Nilai')],
    [c('Jumlah produk'), n(t.produk)], [c('Total bahan (kg, termasuk waste)'), n(t.bahan_kg)], [c('HPP bahan (Rp)'), n(t.hpp)], [c('HPP bahan per kg (Rp)'), n(t.hpp_kg)],
    [c('Nilai jual (Rp)'), n(t.nilai)], [c('GPF / laba kotor (Rp)'), n(t.gpf)], [c('Margin GPF (%)'), n(t.margin)],
  ]
  const bahan: XlsxCell[][] = [
    ['Bahan', 'Satuan', 'Kebutuhan', 'Harga/satuan', 'Nilai (Rp)', 'Stok Accurate', 'Kurang', 'Dipakai produk'].map(h),
    ...r.materials.map((m) => [c(m.name), c(m.unit), n(m.kebutuhan), n(m.harga), n(m.nilai), n(m.stok), n(m.kurang), n(m.produk)]),
    [c('TOTAL'), c(''), n(r.materials.reduce((a, m) => a + m.kebutuhan, 0)), c(''), n(r.materials.reduce((a, m) => a + m.nilai, 0))],
  ]
  const produk: XlsxCell[][] = [
    ['Produk', 'Satuan', 'Jumlah', 'Berat bahan/satuan (kg)', 'Waste %', 'Bahan (kg)', 'HPP bahan (Rp)', 'HPP/satuan', 'HPP/kg', 'Harga jual/satuan', 'Nilai jual (Rp)', 'GPF (Rp)', 'Margin %', 'BOM', 'Catatan'].map(h),
    ...r.items.map((i) => [c(i.nama), c(i.satuan), n(i.quantity), n(i.berat), n(i.waste), n(i.bahan_kg), n(i.hpp), n(i.hpp_unit), n(i.hpp_kg), n(i.harga_jual), n(i.nilai), n(i.gpf), n(i.margin), c(i.bom_number), c(i.catatan)]),
  ]
  const komposisi: XlsxCell[][] = [
    ['Produk', 'Bahan', 'Komposisi %', 'Kebutuhan (kg)', 'Harga bahan', 'Biaya (Rp)'].map(h),
    ...r.items.flatMap((i) => i.komposisi.map((k) => {
      const need = i.bahan_kg * (k.persen / 100)
      const harga = p.prices.find((x) => x.key === k.key)?.harga ?? null
      return [c(i.nama), c(k.name), n(k.persen), n(need), n(harga), n(harga === null ? null : need * harga)]
    })),
  ]
  const xlsx = writeXlsx([
    { title: 'Ringkasan', rows: ringkasan, widths: [36, 22] },
    { title: 'Kebutuhan Bahan', rows: bahan, freeze: { row: 1, col: 1 }, widths: [36, 8, 14, 14, 16, 14, 12, 12] },
    { title: 'HPP & GPF Produk', rows: produk, freeze: { row: 1, col: 1 }, widths: [40, 8, 12, 12, 9, 12, 16, 12, 12, 14, 16, 16, 10, 20, 26] },
    { title: 'Komposisi', rows: komposisi, freeze: { row: 1, col: 1 }, widths: [40, 30, 12, 14, 14, 16] },
  ])
  return new Response(new Uint8Array(xlsx), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${p.kode} ${p.nama.replace(/[\\/:*?"<>|]/g, ' ').replace(/[^\x20-\x7E]/g, '').slice(0, 80)}.xlsx"`,
      'Cache-Control': 'no-store',
    },
  })
})
