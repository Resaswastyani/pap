// Perhitungan HPP kantong plastik (dipakai server & kalkulator di browser, tanpa akses database).
//
// Berat per pcs (gram) = (lebar + gusset) x panjang x 2 lapis x tebal(cm) x density(g/cm3)
//   tebal(cm) = mikron / 10.000
// HPP per kg:
//   bahan   = harga resin/kg x (1 + susut%)  [+ pewarna x porsi% bila ada]
//   proses  = blow + cetak x jumlah warna + bag making (tidak untuk roll)
//   overhead= (bahan + proses) x overhead%
// HPP per pcs = HPP per kg x berat(gram) / 1000. Harga saran = HPP x (1 + margin%).
// Biaya klise (sekali buat) = jumlah warna x biaya klise per warna, ditampilkan terpisah.

export type HppParams = {
  blow_per_kg: number
  cetak_per_kg_warna: number
  bagmaking_per_kg: number
  waste_persen: number
  overhead_persen: number
  klise_per_warna: number
  margin_persen: number
  ppn_persen: number
}

export const HPP_PARAM_KEYS: (keyof HppParams)[] = ['blow_per_kg', 'cetak_per_kg_warna', 'bagmaking_per_kg', 'waste_persen', 'overhead_persen', 'klise_per_warna', 'margin_persen', 'ppn_persen']

export const HPP_PARAM_LABEL: Record<keyof HppParams, string> = {
  blow_per_kg: 'Biaya proses blow (Rp/kg)',
  cetak_per_kg_warna: 'Biaya cetak per warna (Rp/kg)',
  bagmaking_per_kg: 'Biaya bag making / potong-seal (Rp/kg)',
  waste_persen: 'Susut / afalan bahan (%)',
  overhead_persen: 'Overhead (%)',
  klise_per_warna: 'Biaya klise per warna (Rp, sekali buat)',
  margin_persen: 'Margin / untung default di atas HPP (%)',
  ppn_persen: 'PPN (%)',
}

export type HppModel = 'kantong' | 'gusset' | 'roll' | 'lainnya'
export const HPP_MODEL_LABEL: Record<HppModel, string> = { kantong: 'Kantong (tanpa lipatan)', gusset: 'Kantong gusset (lipatan samping)', roll: 'Roll / sheet', lainnya: 'Lainnya' }

export type HppInput = {
  model: HppModel
  panjang_cm: number | null
  lebar_cm: number | null
  gusset_cm: number | null
  tebal_mikron: number | null
  jumlah_warna: number
  satuan: string // 'pcs' | 'kg'
  resin: { harga: number; density: number | null } | null
  pewarna?: { harga: number; persen: number } | null
}

export type HppResult = {
  berat_gram: number | null
  pcs_per_kg: number | null
  bahan_per_kg: number
  proses_per_kg: number
  overhead_per_kg: number
  hpp_per_kg: number
  hpp_satuan: number | null
  harga_saran: number | null
  klise: number
  peringatan: string[]
}

const num = (v: number | null | undefined) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

export function hitungHpp(input: HppInput, p: HppParams): HppResult {
  const peringatan: string[] = []
  const density = input.resin?.density ?? null
  const panjang = num(input.panjang_cm)
  const lebar = num(input.lebar_cm)
  const gusset = input.model === 'gusset' ? num(input.gusset_cm) : 0
  const tebal = num(input.tebal_mikron)

  let berat: number | null = null
  if (input.model !== 'roll' && input.model !== 'lainnya' && panjang > 0 && lebar > 0 && tebal > 0 && density) {
    berat = (lebar + gusset) * panjang * 2 * (tebal / 10_000) * density
  }

  if (!input.resin) peringatan.push('Pilih bahan baku.')
  else if (!input.resin.harga) peringatan.push('Harga bahan baku belum diisi di Tabel HPP.')
  if (!p.blow_per_kg) peringatan.push('Biaya proses blow belum diisi di Tabel HPP.')
  if (input.jumlah_warna > 0 && !p.cetak_per_kg_warna) peringatan.push('Biaya cetak per warna belum diisi di Tabel HPP.')

  const pewarna = input.pewarna && input.pewarna.persen > 0 ? (input.pewarna.harga * input.pewarna.persen) / 100 : 0
  const resinPorsi = input.pewarna ? 1 - Math.min(100, Math.max(0, input.pewarna.persen)) / 100 : 1
  const bahan = (num(input.resin?.harga) * resinPorsi + pewarna) * (1 + num(p.waste_persen) / 100)
  const proses = num(p.blow_per_kg) + num(p.cetak_per_kg_warna) * Math.max(0, input.jumlah_warna) + (input.model === 'roll' ? 0 : num(p.bagmaking_per_kg))
  const overhead = (bahan + proses) * (num(p.overhead_persen) / 100)
  const hppKg = bahan + proses + overhead

  let hppSatuan: number | null = null
  if (input.satuan === 'kg') hppSatuan = hppKg
  else if (berat) hppSatuan = (hppKg * berat) / 1000
  else peringatan.push('Isi ukuran (panjang, lebar, tebal) untuk menghitung harga per pcs, atau gunakan satuan kg.')

  return {
    berat_gram: berat === null ? null : Math.round(berat * 10_000) / 10_000,
    pcs_per_kg: berat ? Math.floor(1000 / berat) : null,
    bahan_per_kg: Math.round(bahan),
    proses_per_kg: Math.round(proses),
    overhead_per_kg: Math.round(overhead),
    hpp_per_kg: Math.round(hppKg),
    hpp_satuan: hppSatuan === null ? null : Math.round(hppSatuan * 100) / 100,
    harga_saran: hppSatuan === null ? null : Math.ceil(hppSatuan * (1 + num(p.margin_persen) / 100)),
    klise: Math.max(0, input.jumlah_warna) * num(p.klise_per_warna),
    peringatan,
  }
}

export const rupiah = (value: number | null | undefined, digits = 0) =>
  value === null || value === undefined ? '—' : `Rp ${value.toLocaleString('id-ID', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`
