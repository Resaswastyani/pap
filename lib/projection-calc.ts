// Hitungan Riset & Proyeksi bahan baku (dipakai di server dan browser, tanpa akses database).
// Per produk: bahan (kg) = jumlah x berat per satuan x (1 + waste%), lalu dibagi ke tiap bahan sesuai % komposisi.
// HPP bahan = jumlah semua (kebutuhan x harga bahan). GPF = nilai jual - HPP bahan.

export type ProjComp = { key: string; item_accurate_id: number | null; name: string; persen: number }
export type ProjItem = {
  item_accurate_id: number | null; item_no?: string | null; nama: string; satuan: string | null; quantity: number; harga_jual: number | null
  berat: number; waste: number; komposisi: ProjComp[]; bom_number: string | null; catatan: string | null
}
export type ProjPrice = { key: string; item_accurate_id: number | null; name: string; unit: string | null; harga: number | null; sumber?: string | null }

export const materialKey = (itemId: number | null, name: string) => (itemId ? `a${itemId}` : `n:${name.trim().toLowerCase()}`)

export function calcProjection(items: ProjItem[], prices: ProjPrice[], stock: Record<string, number | null> = {}) {
  const priceBy = new Map(prices.map((p) => [p.key, p]))
  const mats = new Map<string, { key: string; item_accurate_id: number | null; name: string; unit: string | null; kebutuhan: number; harga: number | null; nilai: number; produk: number }>()
  const rows = items.map((it) => {
    const bahanKg = (Number(it.quantity) || 0) * (Number(it.berat) || 0) * (1 + (Number(it.waste) || 0) / 100)
    const persenTotal = it.komposisi.reduce((a, k) => a + (Number(k.persen) || 0), 0)
    let hpp = 0
    let hargaKosong = false
    for (const k of it.komposisi) {
      const need = bahanKg * ((Number(k.persen) || 0) / 100)
      const pr = priceBy.get(k.key)
      const harga = pr?.harga ?? null
      if (harga === null && need > 0) hargaKosong = true
      const cost = need * (harga ?? 0)
      hpp += cost
      const m = mats.get(k.key) ?? { key: k.key, item_accurate_id: k.item_accurate_id, name: pr?.name ?? k.name, unit: pr?.unit ?? 'kg', kebutuhan: 0, harga, nilai: 0, produk: 0 }
      m.kebutuhan += need
      m.nilai += cost
      m.produk++
      mats.set(k.key, m)
    }
    const nilai = it.harga_jual === null || it.harga_jual === undefined ? null : (Number(it.quantity) || 0) * Number(it.harga_jual)
    const gpf = nilai === null ? null : nilai - hpp
    return {
      ...it, bahan_kg: bahanKg, persen_total: persenTotal, hpp, hpp_unit: it.quantity ? hpp / it.quantity : null, hpp_kg: bahanKg ? hpp / bahanKg : null,
      nilai, gpf, margin: gpf !== null && nilai ? (gpf / nilai) * 100 : null, harga_kosong: hargaKosong,
    }
  })
  const materials = [...mats.values()].map((m) => {
    const stok = stock[m.key] ?? null
    return { ...m, stok, kurang: stok === null ? null : Math.max(0, m.kebutuhan - Math.max(0, stok)) }
  }).sort((a, b) => b.nilai - a.nilai || b.kebutuhan - a.kebutuhan)
  const hpp = rows.reduce((a, r) => a + r.hpp, 0)
  const nilai = rows.reduce((a, r) => a + (r.nilai ?? 0), 0)
  const withPrice = rows.filter((r) => r.nilai !== null)
  const gpf = withPrice.reduce((a, r) => a + (r.gpf ?? 0), 0)
  const nilaiValid = withPrice.reduce((a, r) => a + (r.nilai ?? 0), 0)
  const bahanKg = rows.reduce((a, r) => a + r.bahan_kg, 0)
  return {
    items: rows,
    materials,
    totals: {
      produk: rows.length, bahan_kg: bahanKg, hpp, nilai, gpf, margin: nilaiValid ? (gpf / nilaiValid) * 100 : null, hpp_kg: bahanKg ? hpp / bahanKg : null,
      komposisi_salah: rows.filter((r) => r.komposisi.length && Math.abs(r.persen_total - 100) > 0.01).length,
      tanpa_komposisi: rows.filter((r) => !r.komposisi.length).length,
      harga_kosong: materials.filter((m) => m.harga === null).length,
      kurang: materials.filter((m) => (m.kurang ?? 0) > 0).length,
    },
  }
}
