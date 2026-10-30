-- Jobdesk karyawan (dari dokumen "IGP - HRD - Jobdesk & SOP", 2022) dan CRUD materi training oleh HRD.

CREATE TABLE IF NOT EXISTS job_descriptions (
  id                  INT UNSIGNED NOT NULL AUTO_INCREMENT,
  jabatan             VARCHAR(150) NOT NULL,
  atasan_langsung     VARCHAR(150) NULL,
  atasan_tak_langsung VARCHAR(150) NULL,
  bawahan             VARCHAR(255) NULL,
  fungsi              TEXT         NULL,
  tugas               TEXT         NULL,      -- satu tugas per baris
  koordinasi          TEXT         NULL,      -- satu bagian per baris
  sumber              VARCHAR(255) NULL,      -- dokumen asal + nama pemegang di dokumen
  updated_by          INT UNSIGNED NULL,
  created_at          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_job_descriptions_jabatan (jabatan)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Jobdesk per karyawan. Memakai NIP karena baris karyawan diperbarui dari sinkron spreadsheet.
CREATE TABLE IF NOT EXISTS employee_jobdesks (
  nip                VARCHAR(30)  NOT NULL,
  job_description_id INT UNSIGNED NOT NULL,
  updated_by         INT UNSIGNED NULL,
  updated_at         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (nip),
  KEY idx_employee_jobdesks_job (job_description_id),
  CONSTRAINT fk_employee_jobdesks_job FOREIGN KEY (job_description_id) REFERENCES job_descriptions (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO job_descriptions (jabatan, atasan_langsung, atasan_tak_langsung, bawahan, fungsi, tugas, koordinasi, sumber) VALUES
('Marketing Executive Online', 'Head Marketing', 'Director', NULL,
 'Melaksanakan / meng-eksekusi Program Kerja & Target-2 Penjualan dan Profit, dengan aktivitas penjualan / marketing secara Online.',
 'Melaksanakan tugas-tugas dari Atasan Langsung / Tak Langsung
Mengelola Fitur-2 Bisnis yang ada di WA Business, meng-update, memperbaiki, dan sejenis sehingga Fitur-2 menjadi semakin attractive di public.
Melakukan Leads Magnet, mengaktivasi portofolio Customer secara berkala
Menerapkan strategi-stategi marketing
Menjaga Loyalty Customer
Menjaga nama baik perusahaan dengan komunikasi, pelayanan, dan sikap-sikap yang profesional
Melayani Permintaan / Kebutuhan Customer / Pelanggan – Closing Order
Malakukan Up selling & Cross Selling
Membuat / nge-Print Sales Order ( SO ) untuk Customer dan dikoordinasikan ke Bag. Produksi ( PPIC )
Mengisi / Input Data Sales Order
Memantau progress Sales Order sampai dengan Delivery, dan memberitahukan ke Customer atas barang pesanan yang sudah terkirim
Melaporkan sesuai permintaan Atasan
Mengusulkan hal-hal untuk kepentingan kenaikkan Order / Penjualan',
 'Bagian PPIC (Produksi)
Bagian Digital Marketing',
 'JobDesc Mkt Executive Online · pemegang di dokumen: Intan Mutiara'),
('Content Creator (Laundry & Kantong beras)', 'Head Digital Marketing', 'Director', NULL,
 'Bertanggung jawab atas desain konten baik gambar, video maupun desain custom logo dari customer.',
 'Membuat desain konten sebagai bahan promosi baik berupa postingan socmed atau poster untuk blasting ke customer.
Take foto dan video.
Membuat konsep untuk video.
Editing video untuk socmed/youtube.
Desain logo customer atas permintaan dari Marketing Executive.
Melaksanakan tugas lain dari Atasan.',
 'Marketing Eksekutif
Head PPIC/Staff PPIC',
 'Jobdesk Digital Marketing 2022 · pemegang di dokumen: Seno Ari W.'),
('Content Creator (Restaurant Dejava)', 'Head Digital Marketing', 'Director', NULL,
 'Bertanggung jawab atas desain konten baik gambar dan video untuk bahan promosi di Social Media.',
 'Desain konten harian Facebook dan Instagram RDJ
Membuat dan editing video untuk RDJ
Foto Produk
Upload konten IG & FB
Membuat caption postingan
Melaksanakan tugas lain dari Atasan.',
 'Head Marketing
Staff Restaurant Dejava',
 'Jobdesk Digital Marketing 2022 · pemegang di dokumen: Dea Prasetya'),
('Reach Market', 'Head Digital Marketing', 'Director', NULL,
 'Mencari dan menyimpan data customer yang bisa diberikan penawaran produk.',
 'Scrape data menggunakan tools Scraper Sender dengan kata kunci untuk Laundry dan Beras di seluruh
Scrape data secara manual dengan menggunakan bantuan Social Media baik Facebook maupun Instagram, dll.
Blasting secara manual dari data hasil scrape melalui WA. Jika ada feedback nomor langsung dikirim ke HP DM.
Membantu mencari tools yang lebih bagus untuk mengembangkan digital marketing dalam hal mencari data calon customer.
Membuat laporan berupa excel yang disimpan sebagai data base.',
 'Head Marketing
Marketing Eksekutif',
 'Jobdesk Digital Marketing 2022 · pemegang di dokumen: Dwi Jayanti'),
('Head Digital Marketing', 'Director', NULL, NULL,
 'Bertanggung jawab atas semua proses program Marketing melalui digital system untuk mencapai target-target penjualan.
Menangani dan bertanggung jawab atas asset digital yang ada di Indografika Putra & Restaurant Dejava',
 'Indografika Putra: Membuat postingan penawaran di Social Media
Indografika Putra: Kirim penawaran melalui Group/Komunitas yang ada di Social Media
Indografika Putra: Kirim pemawaran melalui Inbox di Social Media
Indografika Putra: Scrape data calon customer melalui Social Media
Indografika Putra: Blasting secara manual dari data hasil scrape melalui WA. Jika ada feedback nomor langsung dikirim ke HP DM.
Indografika Putra: Mengatur konten untuk promosi (postingan, video, poster, catalog, dll)
Restaurant Dejava: Mengatur dan menyusun konten baik postingan Social Media, video, delivery online dll
Restaurant Dejava: Setting untuk akun delivery online & optimasinya.
Restaurant Dejava: Mengatur & menyusun rencana/program Ads untuk promosi (FB&IG Ads dan Paid promote)',
 'Head Marketing Eksekutif
Head PPIC/Staff PPIC
Staff Restaurant Dejava',
 'Jobdesk Digital Marketing 2022 · pemegang di dokumen: Chesa Mayda Astyaneuva'),
('Staff PPIC', 'PPIC Head', 'Director', NULL,
 'Bertanggung jawab atas kontrol terhadap barang jadi, persediaan bahan baku, pengendalian perencanaan produksi, dan pengiriman barang (distribusi dan logistik).',
 'Menerima order dari bagian marketing executive.
Membuat perencanaan produksi berdasarkan atas order yang sudah di terima.
Membuat rencana pengadaan bahan baku yang di butuhkan untuk keperluan proses produksi berdasarkan pada order dengan memperhitungkan kondisi stock barang update di pabrik.
Memonitor kegiatan manajemen inventory stock yang ada di pabrik.
Menyusun jadwal proses produksi dengan memperhitungkan waktu kerja dan jumlah operator yang tepat melalui koordinasi dengan kepala produksi sehingga barang yang di produksi tersebut bisa dikirim tepat waktu dan sesuai dengan permintaan dari customer.
Menginformasikan ke bagian marketing executive jika terjadi masalah dalam proses produksi yang berpotensi akan menyebabkan terjadinya keterlambatan pengiriman barang ke customer.
Memastikan pengiriman lewat ekspedisi berjalan dengan lancar.
Membuat nota faktur pengiriman barang.
Secara aktif melakukan komunikasi dengan semua divisi yang terkait dengan proses produksi sehingga diperoleh informasi yang akurat.',
 'Kepala Produksi
Marketing Executive',
 'Jobdesk Office Produksi 2022 · pemegang di dokumen: Elinda Eka Ernawati'),
('Admin Produksi', 'Head PPIC', 'Director', NULL,
 'Mengurus administrasi dan menyusun laporan hasil dan performa produksi.',
 'Mencatat logbook harian hasil produksi, input data ke komputer.
Mendata hasil barang jadi dan penyerahan ke packing.
Membuat laporan data waste dan BS & produktivas
Mengatur administrasi pengiriman job order dan job online.
Pencatatan nota masuk dari supplier.
Pembelian ATK untuk keperluan kantor dan produksi.
Melakukan stock upname bahan baku dan barang jadi bersama PPIC.
Melakukan pengarsipan administrasi produksi.
Membuat jadwal shift dan mendata lembur pekerja.
Menghitung stok bahan-bahan produksi, input data ke komputer.
Mencatat efektifitas kerja mesin.',
 'Kepala Produksi
Staff PPIC',
 'Jobdesk Office Produksi 2022 · pemegang di dokumen: Sri Yunani'),
('Kepala Produksi', 'Director', NULL, NULL,
 'Bertanggung jawab atas kinerja dan kelancaran proses produksi atas order untuk mencapai target.',
 'Membuat jadwal shift produksi
Mengatur jadwal proses produksi bersama PPIC mengacu pada waktu kinerja dan jumlah operator sehingga kegiatan produksi lancar dan bisa kirim tepat waktu.
Memastikan bahan baku dan order terpenuhi
Menjaga dan mengawasi agar PPIC dan mutu barang jadi sesuai dengan standar yang telah ditetapkan.
Mengawasi pembuatan laporan produksi (laporan absensi, pemakaian bahan baku dan hasil produksi)
Mengefektifkan penggunaan SDM
Membuat metode kerja supaya proses produksi dapat berjalan dengan lancar.',
 'PPIC Head
Staff PPIC',
 'Jobdesk Office Produksi 2022 · pemegang di dokumen: Yoel Patrisia A.'),
('Head PPIC', 'Director', NULL, NULL,
 'Bertanggung jawab atas control terhadap barang jadi, persediaan stock bahan baku dan jadwal perencanaan produksi.',
 'Bertanggung jawab proses administrasi permintaan pembuatan sample, penerimaan order, penyelesaian order baik offline maupun online.
Menyususn rencana pengadaan bahan yang didasarkan dari order yang masuk dari marketing dan kebijakan minimum stock
Monitoring stock bahan (mentah, dalam proses dan sudah jadi)
Bertanggung jawab atas ketertiban pelaporan.
Bertanggung jawab atas pengawasan dan pengendalian barang jadi.
Bertanggung jawab atas iklim kerja kontruktif pada sub-ordinate.
Melaksanakan tugas lain dari atasan langsung atau atasan tidak langsung baik lisan maupun tertulis.
Menjaga kerahasiaan perusahaan dalam segala bentuknya.',
 'Kepala Produksi
Marketing Executive',
 'Jobdesk Office Produksi 2022 · pemegang di dokumen: Dewi Sulistyowati'),
('Head Teknik', 'Director', NULL, NULL,
 'Bertanggung jawab atas kegiatan perawatan dan perbaikan terhadap mesin produksi, system penunjang dan utilitas bangunan dan mengembangkan teknologi yang inovatif.',
 'Memastikan mesin bisa bekerja secara optimal
Membuat jadwal perawatan
Mendukung/ membantu produksi jika ada masalah dan kendala mesin.
Upgrade teknologi sehingga didapatkan kapasitas mesin lebih tinggi dan lebih ekonomis.
Memberikan petunjuk tentang tata cara penggunaan dan perawatan mesin dan alat bantu agar dapat digunakan secara optimal',
 'Kepala Produksi
Staff Teknik Produksi',
 'Jobdesk Office Produksi 2022 · pemegang di dokumen: Rewang S.H.'),
('Shift Leader', 'Kepala Produksi', 'Director', NULL,
 'Bertanggung jawab atas efisiensi SDM per-shift dalam menjalankan proses produksi.',
 'Menerima jadwal proses produksi dari kepala produksi
Briefing/planning tugas tugas kegiatan sesuai kemampuan operator.
Memastiakn mesin produksi siap jalan
Memonitor/ memgawasi per bagian produksi yang sudah ditugaskan ke operator.
Mengatur order order masuk yang harus dikerjakan terlebih dahulu sesuai dengan kepala produksi.
Melaporkan ketersediaan stock tinta, solven, dan pisau rotogravure ke kepala produksi.
Memastikan kelancaran proses produksi.
QC (menjaga barang jadi agar sesuai standar kualitas yang diinginkan).',
 'Kepala Produksi
Bagian Teknik',
 'Jobdesk Office Produksi 2022'),
('Staff HRD', 'Director', NULL, NULL,
 'Manajemen sumber daya manusia di perusahaan.',
 'Rekrutmen dan seleksi
Training and Development
Administrasi personalia : database karyawan, payroll, absensi, cuti, izin kerja, kontrak kerja
Kompensasi dan benefit
Mengumpulkan data penilaian kinerja
Mensosialisasikan kebijakan-kebijakan perusahaan
Menciptakan iklim kerja yang kondusif',
 'Kepala Produksi
Finance',
 'Jobdesk Staff HRD 2022 · pemegang di dokumen: Rizky Claravita');

-- Pemasangan awal memakai jabatan karyawan saat ini, karena nama pemegang di dokumen 2022 banyak yang sudah berubah.
-- Yang tidak cocok dibiarkan kosong; HRD melengkapinya di menu Karyawan > Jobdesk.
INSERT IGNORE INTO employee_jobdesks (nip, job_description_id)
SELECT e.nip, j.id FROM employees e JOIN job_descriptions j ON
  (j.jabatan = 'Marketing Executive Online' AND e.jabatan = 'Staff Marketing' AND e.divisi = 'Marketing')
  OR (j.jabatan = 'Head Digital Marketing' AND e.jabatan = 'Kepala Divisi' AND e.divisi = 'Digital Marketing')
  OR (j.jabatan = 'Head PPIC' AND e.jabatan = 'Kepala PPIC')
  OR (j.jabatan = 'Staff HRD' AND e.jabatan = 'Staff HR')
  OR (j.jabatan = 'Shift Leader' AND e.jabatan = 'Kepala Shift')
  OR (j.jabatan = 'Kepala Produksi' AND e.nama_key LIKE 'yoel patri%')
  OR (j.jabatan = 'Head Teknik' AND e.nama_key LIKE 'rewang%')
WHERE e.tgl_berhenti IS NULL;

-- Materi training: file yang diunggah HRD, ubah judul materi Drive, sembunyikan materi Drive
ALTER TABLE training_materials
  MODIFY sumber ENUM('drive','manual','upload') NOT NULL DEFAULT 'drive',
  ADD COLUMN IF NOT EXISTS judul_edited TINYINT(1) NOT NULL DEFAULT 0 AFTER judul,
  ADD COLUMN IF NOT EXISTS tersembunyi TINYINT(1) NOT NULL DEFAULT 0 AFTER judul_edited;

CREATE TABLE IF NOT EXISTS training_material_files (
  material_id INT UNSIGNED NOT NULL,
  nama_file   VARCHAR(255) NOT NULL,
  data        MEDIUMBLOB   NOT NULL,
  PRIMARY KEY (material_id),
  CONSTRAINT fk_training_material_files FOREIGN KEY (material_id) REFERENCES training_materials (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
