// Depresiasi (penyusutan) harga barang inventaris per tahun untuk memantau perkiraan nilai jualnya.
// Modul murni (tanpa database) supaya bisa dipakai di server dan di layar.
//   Garis lurus  : turun persen yang sama dari harga beli tiap tahun (25% = habis dalam 4 tahun).
//   Saldo menurun: turun persen dari nilai sisa tahun sebelumnya (tidak pernah nol, melambat tiap tahun).

export type MetodeDepresiasi = 'garis_lurus' | 'saldo_menurun'
export const METODE_DEPRESIASI: Record<MetodeDepresiasi, string> = { garis_lurus: 'Garis lurus', saldo_menurun: 'Saldo menurun' }

// Default per kategori mengikuti kelompok harta PMK 96/2009: kelompok 1 (umur 4 th) 25%, kelompok 2 (8 th) 12,5%
export const DEPRESIASI_KATEGORI: Record<string, number> = {
  Elektronik: 25, 'Komputer & Laptop': 25, 'Peralatan Kantor': 25, 'Peralatan Dapur': 25, 'AC & Pendingin': 25,
  Furnitur: 12.5, Kendaraan: 12.5,
}
export const DEPRESIASI_DEFAULT = 25

export const defaultPct = (kategori: string | null | undefined) => {
  const k = (kategori ?? '').trim().toLowerCase()
  const hit = Object.entries(DEPRESIASI_KATEGORI).find(([name]) => name.toLowerCase() === k)
  return hit ? hit[1] : DEPRESIASI_DEFAULT
}

export type DepresiasiInput = { harga_beli: number | null; tanggal_beli: string | null; jumlah?: number; kategori?: string | null; depresiasi_pct?: number | null; metode_depresiasi?: MetodeDepresiasi | null }
export type DepresiasiRow = { tahun_ke: number; tanggal: string; nilai_awal: number; penyusutan: number; nilai_akhir: number }
export type Depresiasi = {
  pct: number; metode: MetodeDepresiasi; otomatis: boolean // otomatis = memakai default kategori
  harga: number; umur_tahun: number; nilai_sekarang: number; penyusutan_total: number; persen_sisa: number
  umur_ekonomis: number | null // tahun sampai nilai habis (garis lurus)
  jadwal: DepresiasiRow[]
}

const round = (n: number) => Math.round(n)
const addYears = (iso: string, n: number) => {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`)
  d.setUTCFullYear(d.getUTCFullYear() + n)
  return d.toISOString().slice(0, 10)
}
// Umur barang dalam tahun (pecahan) dari tanggal beli s/d hari ini
export const umurTahun = (tanggalBeli: string, today: string) => Math.max(0, (Date.parse(today) - Date.parse(tanggalBeli.slice(0, 10))) / (365.25 * 86400e3))

const nilaiPada = (harga: number, pct: number, metode: MetodeDepresiasi, tahun: number) =>
  metode === 'garis_lurus' ? Math.max(0, harga * (1 - (pct / 100) * tahun)) : harga * (1 - pct / 100) ** tahun

// Nilai per barang (harga beli per unit × jumlah). Null bila harga / tanggal beli belum diisi.
export function hitungDepresiasi(i: DepresiasiInput, today = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10)): Depresiasi | null {
  if (i.harga_beli === null || i.harga_beli === undefined || !i.tanggal_beli) return null
  const harga = i.harga_beli * (i.jumlah ?? 1)
  const otomatis = i.depresiasi_pct === null || i.depresiasi_pct === undefined
  const pct = otomatis ? defaultPct(i.kategori) : Number(i.depresiasi_pct)
  const metode: MetodeDepresiasi = i.metode_depresiasi ?? 'garis_lurus'
  const umur = umurTahun(i.tanggal_beli, today)
  const sekarang = round(nilaiPada(harga, pct, metode, umur))
  const umurEkonomis = metode === 'garis_lurus' && pct > 0 ? Math.round((100 / pct) * 100) / 100 : null
  // Jadwal per tahun: sampai nilai habis (garis lurus) atau 10 tahun (saldo menurun), minimal sampai tahun berjalan
  const batas = Math.min(40, Math.max(Math.ceil(umur), umurEkonomis ? Math.ceil(umurEkonomis) : 10, 1))
  const jadwal: DepresiasiRow[] = []
  for (let k = 1; k <= batas; k++) {
    const awal = round(nilaiPada(harga, pct, metode, k - 1))
    const akhir = round(nilaiPada(harga, pct, metode, k))
    jadwal.push({ tahun_ke: k, tanggal: addYears(i.tanggal_beli, k), nilai_awal: awal, penyusutan: awal - akhir, nilai_akhir: akhir })
    if (akhir <= 0) break
  }
  return {
    pct, metode, otomatis, harga, umur_tahun: Math.round(umur * 10) / 10, nilai_sekarang: sekarang, penyusutan_total: harga - sekarang,
    persen_sisa: harga ? Math.round((sekarang / harga) * 1000) / 10 : 0, umur_ekonomis: umurEkonomis, jadwal,
  }
}
