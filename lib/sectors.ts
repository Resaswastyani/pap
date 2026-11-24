// Sektor customer untuk laporan penjualan (Laundry, Beras, Sektor Umum). Identifikasi berurutan:
//   1. Kode kategori customer di Accurate: "Pelanggan (LAU)" -> Laundry, "Pembeli (BRS)" -> Beras
//   2. Nama customer: mengandung "laundr" / "londri" / "loundr" -> Laundry; "beras" -> Beras
//      (mis. "Kak Tasya - Laundry 99 Manado" tanpa kode kategori tetap masuk Laundry)
//   3. Selain itu (kode SU, kategori "Umum" bawaan Accurate, atau tanpa kategori) -> Sektor Umum
// Tidak ada lagi sektor "Lainnya". Urutan tetap = urutan warna grafik (--viz-s1..s3); jangan diurutkan ulang menurut nilai.
export const SECTORS = [
  { key: 'laundry', label: 'Laundry', code: 'LAU', tone: 's1' },
  { key: 'beras', label: 'Beras', code: 'BRS', tone: 's2' },
  { key: 'umum', label: 'Sektor Umum', code: 'SU', tone: 's3' },
] as const
export type SectorKey = (typeof SECTORS)[number]['key']

const LAUNDRY_NAME = ['laundr', 'londri', 'loundr']
const BERAS_NAME = ['beras']

// Ekspresi SQL: kolom kategori customer (+ nama customer) -> kunci sektor.
// Nama default diturunkan dari kolom kategori: c.category -> c.name, MAX(c.category) -> MAX(c.name).
export const sectorSql = (category: string, name = category.replace(/category/g, 'name')) => {
  const nameLike = (words: string[]) => words.map((w) => `LOWER(COALESCE(${name}, '')) LIKE '%${w}%'`).join(' OR ')
  return `CASE WHEN ${category} LIKE '%(LAU)%' THEN 'laundry' WHEN ${category} LIKE '%(BRS)%' THEN 'beras'
    WHEN ${nameLike(LAUNDRY_NAME)} THEN 'laundry' WHEN ${nameLike(BERAS_NAME)} THEN 'beras' ELSE 'umum' END`
}

export const SECTOR_LABEL = Object.fromEntries(SECTORS.map((s) => [s.key, s.label])) as Record<SectorKey, string>
