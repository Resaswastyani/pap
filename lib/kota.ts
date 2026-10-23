// Daftar kota / kabupaten (nama umum di alamat) -> provinsi, untuk membaca tujuan kirim dari alamat bebas.
// Urutan: nama yang lebih panjang dicocokkan lebih dulu (mis. "Jakarta Utara" sebelum "Jakarta").
export const KOTA_PROVINSI: Record<string, string> = {
  // DKI Jakarta
  'Jakarta Utara': 'DKI Jakarta', 'Jakarta Barat': 'DKI Jakarta', 'Jakarta Selatan': 'DKI Jakarta', 'Jakarta Timur': 'DKI Jakarta', 'Jakarta Pusat': 'DKI Jakarta', Jakarta: 'DKI Jakarta',
  // Banten
  'Tangerang Selatan': 'Banten', Tangerang: 'Banten', Serang: 'Banten', Cilegon: 'Banten', Pandeglang: 'Banten', Lebak: 'Banten',
  // Jawa Barat
  Bogor: 'Jawa Barat', Depok: 'Jawa Barat', Bekasi: 'Jawa Barat', Karawang: 'Jawa Barat', Purwakarta: 'Jawa Barat', Subang: 'Jawa Barat', Bandung: 'Jawa Barat', Cimahi: 'Jawa Barat',
  Sumedang: 'Jawa Barat', Garut: 'Jawa Barat', Tasikmalaya: 'Jawa Barat', Ciamis: 'Jawa Barat', Banjar: 'Jawa Barat', Cirebon: 'Jawa Barat', Indramayu: 'Jawa Barat', Majalengka: 'Jawa Barat',
  Kuningan: 'Jawa Barat', Sukabumi: 'Jawa Barat', Cianjur: 'Jawa Barat', Pangandaran: 'Jawa Barat',
  // Jawa Tengah
  Semarang: 'Jawa Tengah', Salatiga: 'Jawa Tengah', Ungaran: 'Jawa Tengah', Kendal: 'Jawa Tengah', Demak: 'Jawa Tengah', Kudus: 'Jawa Tengah', Jepara: 'Jawa Tengah', Pati: 'Jawa Tengah',
  Rembang: 'Jawa Tengah', Blora: 'Jawa Tengah', Grobogan: 'Jawa Tengah', Purwodadi: 'Jawa Tengah', Surakarta: 'Jawa Tengah', Solo: 'Jawa Tengah', Sukoharjo: 'Jawa Tengah', Kartasura: 'Jawa Tengah',
  Karanganyar: 'Jawa Tengah', Sragen: 'Jawa Tengah', Boyolali: 'Jawa Tengah', Klaten: 'Jawa Tengah', Wonogiri: 'Jawa Tengah', Magelang: 'Jawa Tengah', Temanggung: 'Jawa Tengah',
  Wonosobo: 'Jawa Tengah', Purworejo: 'Jawa Tengah', Kebumen: 'Jawa Tengah', Banjarnegara: 'Jawa Tengah', Purbalingga: 'Jawa Tengah', Banyumas: 'Jawa Tengah', Purwokerto: 'Jawa Tengah',
  Cilacap: 'Jawa Tengah', Pekalongan: 'Jawa Tengah', Batang: 'Jawa Tengah', Pemalang: 'Jawa Tengah', Tegal: 'Jawa Tengah', Slawi: 'Jawa Tengah', Brebes: 'Jawa Tengah',
  // DI Yogyakarta
  Yogyakarta: 'Daerah Istimewa Yogyakarta', Jogja: 'Daerah Istimewa Yogyakarta', Jogjakarta: 'Daerah Istimewa Yogyakarta', Sleman: 'Daerah Istimewa Yogyakarta',
  Bantul: 'Daerah Istimewa Yogyakarta', 'Kulon Progo': 'Daerah Istimewa Yogyakarta', 'Gunung Kidul': 'Daerah Istimewa Yogyakarta', Gunungkidul: 'Daerah Istimewa Yogyakarta',
  // Jawa Timur
  Surabaya: 'Jawa Timur', Sidoarjo: 'Jawa Timur', Gresik: 'Jawa Timur', Lamongan: 'Jawa Timur', Tuban: 'Jawa Timur', Bojonegoro: 'Jawa Timur', Mojokerto: 'Jawa Timur', Jombang: 'Jawa Timur',
  Pasuruan: 'Jawa Timur', Probolinggo: 'Jawa Timur', Malang: 'Jawa Timur', Batu: 'Jawa Timur', Blitar: 'Jawa Timur', Kediri: 'Jawa Timur', Nganjuk: 'Jawa Timur', Madiun: 'Jawa Timur',
  Ngawi: 'Jawa Timur', Magetan: 'Jawa Timur', Ponorogo: 'Jawa Timur', Pacitan: 'Jawa Timur', Trenggalek: 'Jawa Timur', Tulungagung: 'Jawa Timur', Lumajang: 'Jawa Timur', Jember: 'Jawa Timur',
  Bondowoso: 'Jawa Timur', Situbondo: 'Jawa Timur', Banyuwangi: 'Jawa Timur', Bangkalan: 'Jawa Timur', Sampang: 'Jawa Timur', Pamekasan: 'Jawa Timur', Sumenep: 'Jawa Timur',
  // Bali & Nusa Tenggara
  Denpasar: 'Bali', Badung: 'Bali', Gianyar: 'Bali', Tabanan: 'Bali', Buleleng: 'Bali', Singaraja: 'Bali', Klungkung: 'Bali', Karangasem: 'Bali', Jembrana: 'Bali', Kuta: 'Bali',
  Mataram: 'Nusa Tenggara Barat', Lombok: 'Nusa Tenggara Barat', Sumbawa: 'Nusa Tenggara Barat', Bima: 'Nusa Tenggara Barat',
  Kupang: 'Nusa Tenggara Timur', 'Labuan Bajo': 'Nusa Tenggara Timur', Ende: 'Nusa Tenggara Timur', Maumere: 'Nusa Tenggara Timur', Sumba: 'Nusa Tenggara Timur', Flores: 'Nusa Tenggara Timur',
  // Sumatera
  Medan: 'Sumatera Utara', Binjai: 'Sumatera Utara', 'Deli Serdang': 'Sumatera Utara', 'Pematang Siantar': 'Sumatera Utara', Padang: 'Sumatera Barat', Bukittinggi: 'Sumatera Barat',
  Pekanbaru: 'Riau', Dumai: 'Riau', Batam: 'Kepulauan Riau', 'Tanjung Pinang': 'Kepulauan Riau', Jambi: 'Jambi', Palembang: 'Sumatera Selatan', Lubuklinggau: 'Sumatera Selatan',
  Bengkulu: 'Bengkulu', 'Bandar Lampung': 'Lampung', Lampung: 'Lampung', Metro: 'Lampung', 'Pangkal Pinang': 'Bangka Belitung', Pangkalpinang: 'Bangka Belitung', Belitung: 'Bangka Belitung',
  'Banda Aceh': 'Nanggroe Aceh Darussalam', Lhokseumawe: 'Nanggroe Aceh Darussalam',
  // Kalimantan
  Pontianak: 'Kalimantan Barat', Singkawang: 'Kalimantan Barat', Ketapang: 'Kalimantan Barat', 'Palangka Raya': 'Kalimantan Tengah', Palangkaraya: 'Kalimantan Tengah', Sampit: 'Kalimantan Tengah',
  Banjarmasin: 'Kalimantan Selatan', Banjarbaru: 'Kalimantan Selatan', Martapura: 'Kalimantan Selatan', Samarinda: 'Kalimantan Timur', Balikpapan: 'Kalimantan Timur', Bontang: 'Kalimantan Timur',
  Tenggarong: 'Kalimantan Timur', Tarakan: 'Kalimantan Utara',
  // Sulawesi
  Makassar: 'Sulawesi Selatan', Gowa: 'Sulawesi Selatan', Maros: 'Sulawesi Selatan', Parepare: 'Sulawesi Selatan', Palopo: 'Sulawesi Selatan', Manado: 'Sulawesi Utara', Bitung: 'Sulawesi Utara',
  Palu: 'Sulawesi Tengah', Kendari: 'Sulawesi Tenggara', Gorontalo: 'Gorontalo', Mamuju: 'Sulawesi Barat',
  // Maluku & Papua
  Ambon: 'Maluku', Ternate: 'Maluku Utara', Sorong: 'Papua Barat', Manokwari: 'Papua Barat', Jayapura: 'Papua', Merauke: 'Papua', Timika: 'Papua',
}
export const KOTA_NAMES = Object.keys(KOTA_PROVINSI).sort((a, b) => b.length - a.length)
