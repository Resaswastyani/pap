import { handle, requireUser } from '@/lib/api'
import { requireMenu } from '@/lib/customers'
import { analyzeMaterials, readOptions, SUMBER_LABEL } from '@/lib/material-analysis'
import { canViewProduction } from '@/lib/production'
import { writeXlsx, type XlsxCell } from '@/lib/xlsx-write'

export const maxDuration = 60

const MASALAH: Record<string, string> = { tanpa_bom: 'Belum ada BOM', satuan_beda: 'Satuan beda dengan BOM', tanpa_harga_bahan: 'Ada bahan tanpa harga' }

// Unduh Analisis Bahan Baku (Excel): ringkasan, kebutuhan per bahan, HPP & GPF per produk, komposisi BOM
export const GET = handle(async (request: Request) => {
  const user = await requireUser()
  requireMenu(user, canViewProduction(user))
  const o = readOptions(new URL(request.url).searchParams)
  const a = await analyzeMaterials(o)
  const t = a.totals
  const h = (v: string): XlsxCell => ({ v, s: 'head' })
  const n = (v: number | null): XlsxCell => (v === null ? { v: '', s: 'cell' } : { v: Math.round(v * 100) / 100, s: 'num' })
  const c = (v: string | number | null): XlsxCell => ({ v: v ?? '', s: 'cell' })
  const hargaLabel = `${o.harga === 'po' ? 'harga beli terakhir (PO)' : 'harga pokok rata-rata Accurate'}${o.ppn ? ' + PPN 11%' : ''}; harga acuan SIMPAP diutamakan`

  const ringkasan: XlsxCell[][] = [
    [{ v: 'ANALISIS BAHAN BAKU', s: 'title' }],
    [c(`Sumber: ${SUMBER_LABEL[o.sumber]} · Periode ${o.from} s.d. ${o.to}`)],
    [c(`Harga bahan: ${hargaLabel}`)],
    [],
    [h('Ringkasan'), h('Nilai')],
    [c('Baris produksi'), n(t.baris)], [c('Produk'), n(t.produk)], [c('Total produksi (kg)'), n(t.produksi_kg)],
    [c('Kebutuhan bahan baku (kg)'), n(t.bahan_baku_kg)], [c('Nilai bahan baku (Rp)'), n(t.nilai_bahan_baku)], [c('Nilai bahan pendukung (Rp)'), n(t.nilai_bahan_pendukung)],
    [c('HPP bahan (Rp)'), n(t.hpp)], [c('HPP bahan per kg (Rp)'), n(t.hpp_per_kg)], [c('Nilai jual (Rp)'), n(t.nilai)], [c('GPF / laba kotor (Rp)'), n(t.gpf)], [c('Margin GPF (%)'), n(t.margin)],
    [],
    [h('Jenis bahan'), h('Kebutuhan (kg)'), h('Nilai (Rp)')],
    ...a.jenis.map((j) => [c(j.jenis), n(j.kebutuhan), n(j.nilai)]),
  ]
  const bahan: XlsxCell[][] = [
    ['Kode', 'Bahan', 'Jenis', 'Kelompok', 'Satuan', 'Kebutuhan', 'Harga/satuan', 'Sumber harga', 'Nilai (Rp)', 'Stok Accurate', 'Kurang', 'Dipakai produk'].map(h),
    ...a.materials.map((m) => [c(m.item_no), c(m.name), c(m.jenis), c(m.kelompok === 'baku' ? 'Bahan baku' : 'Bahan pendukung'), c(m.unit), n(m.kebutuhan), n(m.harga),
      c(m.harga_sumber === 'acuan' ? 'Harga acuan SIMPAP' : m.harga_sumber === 'po' ? 'Harga beli terakhir' : m.harga_sumber === 'rata' ? 'Harga pokok rata-rata' : '-'), n(m.nilai), n(m.stok), n(m.kurang), n(m.produk)]),
  ]
  const produk: XlsxCell[][] = [
    ['Kode', 'Produk', 'Jenis', 'Kuantitas', 'Satuan', 'Setara kg', 'BOM', 'HPP bahan (Rp)', 'HPP/satuan', 'HPP/kg', 'Nilai jual (Rp)', 'Harga jual/satuan', 'GPF (Rp)', 'Margin %', 'Catatan'].map(h),
    ...a.products.map((p) => [c(p.item_no), c(p.name), c(p.jenis), n(p.quantity), c(p.unit), n(p.kg), c(p.bom_number), n(p.hpp), n(p.hpp_per_unit), n(p.hpp_per_kg), n(p.nilai), n(p.harga_jual), n(p.gpf), n(p.margin),
      c([...p.masalah.map((x) => MASALAH[x]).filter(Boolean), p.nilai_lengkap ? '' : 'Sebagian tanpa harga jual'].filter(Boolean).join('; '))]),
  ]
  const komposisi: XlsxCell[][] = [
    ['Produk', 'BOM', 'Per', 'Bahan', 'Jenis', 'Pemakaian per satuan produk', '% komposisi', 'Harga bahan', 'Biaya per satuan produk'].map(h),
    ...a.products.flatMap((p) => {
      const total = p.komposisi.reduce((s, k) => s + k.per_unit, 0)
      return p.komposisi.map((k) => [c(p.name), c(p.bom_number), c(`${p.bom_qty} ${p.bom_unit ?? ''}`.trim()), c(k.name), c(k.jenis), n(k.per_unit), n(total ? (k.per_unit / total) * 100 : null), n(k.harga), n(k.harga === null ? null : k.per_unit * k.harga)])
    }),
  ]
  const xlsx = writeXlsx([
    { title: 'Ringkasan', rows: ringkasan, widths: [34, 20, 18] },
    { title: 'Kebutuhan Bahan', rows: bahan, freeze: { row: 1, col: 2 }, widths: [14, 36, 14, 16, 8, 14, 14, 22, 16, 14, 12, 12], autoFilter: `A1:L${bahan.length}` },
    { title: 'HPP & GPF Produk', rows: produk, freeze: { row: 1, col: 2 }, widths: [14, 44, 8, 12, 8, 12, 20, 16, 12, 12, 16, 14, 16, 10, 30], autoFilter: `A1:O${produk.length}` },
    { title: 'Komposisi BOM', rows: komposisi, freeze: { row: 1, col: 1 }, widths: [44, 20, 10, 32, 14, 16, 12, 14, 16], autoFilter: `A1:I${komposisi.length}` },
  ])
  return new Response(new Uint8Array(xlsx), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="Analisis Bahan Baku ${o.from} sd ${o.to}.xlsx"`,
      'Cache-Control': 'no-store',
    },
  })
})
