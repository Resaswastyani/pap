// Sektor customer untuk laporan penjualan. Sumbernya kategori customer di Accurate:
// "Pelanggan (LAU)", "Pembeli (BRS)", "Pelanggan (SU)", ... -> kode di dalam kurung.
// Kategori tanpa kode (mis. "Umum" bawaan Accurate) masuk "Lainnya".
// Urutan tetap = urutan warna grafik (--viz-s1..s4); jangan diurutkan ulang menurut nilai.
export const SECTORS = [
  { key: 'laundry', label: 'Laundry', code: 'LAU', tone: 's1' },
  { key: 'beras', label: 'Beras', code: 'BRS', tone: 's2' },
  { key: 'umum', label: 'Sektor Umum', code: 'SU', tone: 's3' },
  { key: 'lainnya', label: 'Lainnya', code: null, tone: 's4' },
] as const
export type SectorKey = (typeof SECTORS)[number]['key']

// Ekspresi SQL: kolom kategori customer -> kunci sektor
export const sectorSql = (category: string) =>
  `CASE ${SECTORS.filter((s) => s.code).map((s) => `WHEN ${category} LIKE '%(${s.code})%' THEN '${s.key}'`).join(' ')} ELSE 'lainnya' END`
