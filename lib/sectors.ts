// Sektor customer untuk laporan penjualan (Laundry, Beras, Sektor Umum, Lainnya). Identifikasi berurutan:
//   0. Kategori yang dipilih manual di menu Customer (kolom customers.sektor_manual)
//   1. Kode kategori customer di Accurate: "Pelanggan (LAU)" -> Laundry, "Pembeli (BRS)" -> Beras
//   2. Nama customer: mengandung "laundr" / "londri" / "loundr" -> Laundry; "beras" -> Beras
//      (mis. "Kak Tasya - Laundry 99 Manado" tanpa kode kategori tetap masuk Laundry)
//   3. Customer yang ditetapkan manual sebagai "Lainnya" (LAINNYA_NAME, saat ini hanya PT Tarunakusuma Purinusa)
//   4. Selain itu (kode SU, kategori "Umum" bawaan Accurate, atau tanpa kategori) -> Sektor Umum
// Urutan tetap = urutan warna grafik (--viz-s1..s4); jangan diurutkan ulang menurut nilai.
export const SECTORS = [
  { key: 'laundry', label: 'Laundry', code: 'LAU', tone: 's1' },
  { key: 'beras', label: 'Beras', code: 'BRS', tone: 's2' },
  { key: 'umum', label: 'Sektor Umum', code: 'SU', tone: 's3' },
  { key: 'lainnya', label: 'Lainnya', code: null, tone: 's4' },
] as const
export type SectorKey = (typeof SECTORS)[number]['key']

const LAUNDRY_NAME = ['laundr', 'londri', 'loundr']
const BERAS_NAME = ['beras']
// Customer khusus sektor Lainnya (dicocokkan pada nama, huruf kecil). Tambahkan di sini bila perlu.
const LAINNYA_NAME = ['tarunakusuma']

// Ekspresi SQL: kolom kategori customer (+ nama customer) -> kunci sektor.
// Nama default diturunkan dari kolom kategori: c.category -> c.name, MAX(c.category) -> MAX(c.name).
export const sectorSql = (category: string, name = category.replace(/category/g, 'name'), manual = category.replace(/category/g, 'sektor_manual')) => {
  const nameLike = (words: string[]) => words.map((w) => `LOWER(COALESCE(${name}, '')) LIKE '%${w}%'`).join(' OR ')
  return `CASE WHEN ${manual} IN (${SECTORS.map((s) => `'${s.key}'`).join(', ')}) THEN ${manual} WHEN ${category} LIKE '%(LAU)%' THEN 'laundry' WHEN ${category} LIKE '%(BRS)%' THEN 'beras'
    WHEN ${nameLike(LAUNDRY_NAME)} THEN 'laundry' WHEN ${nameLike(BERAS_NAME)} THEN 'beras' WHEN ${nameLike(LAINNYA_NAME)} THEN 'lainnya' ELSE 'umum' END`
}

export const SECTOR_LABEL = Object.fromEntries(SECTORS.map((s) => [s.key, s.label])) as Record<SectorKey, string>
