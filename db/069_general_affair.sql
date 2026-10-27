-- General Affair (GA): data nomor HP, langganan aplikasi, dan WiFi kantor dari spreadsheet
-- "PAP - GA - List No HP, Subscription, WIFI" di Google Drive (dua arah: ubah di PAP-MS ditulis ke sheet,
-- ubah di sheet terbaca saat sinkron), serta Pengajuan Pembelian GA (terpisah dari Pengajuan Pembelian Purchasing).

-- Tab "No HP PAP": satu baris per nomor, status bayar pulsa/paket per bulan (kolom tahun > bulan berisi "Sudah")
CREATE TABLE IF NOT EXISTS ga_phones (
  id           INT UNSIGNED NOT NULL AUTO_INCREMENT,
  no           SMALLINT UNSIGNED NULL,
  nomor        VARCHAR(40)  NOT NULL,
  ket          VARCHAR(150) NULL,              -- pemakai / keperluan (Mkt Laundry 1, HRD, WA API, ...)
  masa_aktif   DATE         NULL,
  provider     VARCHAR(80)  NULL,
  pembayaran   JSON         NULL,              -- { "2026-01": true, ... } (bulan yang ada kolomnya di sheet)
  sheet_row    INT UNSIGNED NULL,
  synced_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_ga_phones_masa (masa_aktif)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Tab "Subscription": langganan aplikasi / layanan
CREATE TABLE IF NOT EXISTS ga_subscriptions (
  id                INT UNSIGNED NOT NULL AUTO_INCREMENT,
  no                SMALLINT UNSIGNED NULL,
  nama              VARCHAR(200) NOT NULL,
  kategori          VARCHAR(80)  NULL,
  vendor            VARCHAR(150) NULL,
  biaya             DECIMAL(16,2) NULL,
  siklus            VARCHAR(30)  NULL,          -- Bulanan / Tahunan
  jatuh_tempo       DATE         NULL,
  metode_bayar      VARCHAR(80)  NULL,
  status            VARCHAR(30)  NULL,          -- Aktif / Tidak aktif
  penanggung_jawab  VARCHAR(150) NULL,
  user_akun         VARCHAR(255) NULL,
  catatan           TEXT         NULL,
  sheet_row         INT UNSIGNED NULL,
  synced_at         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_ga_subs_tempo (jatuh_tempo)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Tab "WIFI": tabel utama + tabel status bayar per bulan (blok per semester) di bawahnya
CREATE TABLE IF NOT EXISTS ga_wifi (
  id              INT UNSIGNED NOT NULL AUTO_INCREMENT,
  no              SMALLINT UNSIGNED NULL,
  nama            VARCHAR(150) NOT NULL,
  provider        VARCHAR(80)  NULL,
  id_pelanggan    VARCHAR(60)  NULL,
  nama_pelanggan  VARCHAR(200) NULL,
  biaya           DECIMAL(16,2) NULL,
  jatuh_tempo     VARCHAR(40)  NULL,           -- teks sheet, mis. "Tanggal 20"
  tgl_tagihan     TINYINT UNSIGNED NULL,       -- angka tanggal dari jatuh_tempo
  paket           VARCHAR(500) NULL,
  call_center     VARCHAR(60)  NULL,
  catatan         VARCHAR(500) NULL,
  pembayaran      JSON         NULL,
  sheet_row       INT UNSIGNED NULL,
  synced_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Pengajuan Pembelian GA (ATK, kebersihan, pulsa, langganan, perlengkapan kantor, ...)
-- Alur: diajukan -> disetujui -> dibeli -> selesai; bisa ditolak / dibatalkan
CREATE TABLE IF NOT EXISTS ga_purchase_requests (
  id              INT UNSIGNED NOT NULL AUTO_INCREMENT,
  nomor           VARCHAR(30)  NULL,           -- GA-YYYYMM-00001
  judul           VARCHAR(200) NOT NULL,
  kategori        VARCHAR(60)  NOT NULL,
  prioritas       ENUM('darurat','tinggi','normal') NOT NULL DEFAULT 'normal',
  dibutuhkan      DATE         NULL,
  keperluan       TEXT         NULL,
  status          ENUM('diajukan','disetujui','dibeli','selesai','ditolak','batal') NOT NULL DEFAULT 'diajukan',
  vendor          VARCHAR(200) NULL,           -- toko / penyedia saat dibeli
  catatan_ga      TEXT         NULL,
  requested_by    INT UNSIGNED NOT NULL,
  approved_by     INT UNSIGNED NULL,
  approved_at     DATETIME     NULL,
  bought_at       DATE         NULL,
  created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_ga_pr_nomor (nomor),
  KEY idx_ga_pr_status (status, prioritas),
  CONSTRAINT fk_ga_pr_user FOREIGN KEY (requested_by) REFERENCES users (id),
  CONSTRAINT fk_ga_pr_approver FOREIGN KEY (approved_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ga_purchase_request_items (
  id               INT UNSIGNED NOT NULL AUTO_INCREMENT,
  request_id       INT UNSIGNED NOT NULL,
  nama             VARCHAR(200) NOT NULL,
  jumlah           DECIMAL(14,2) NOT NULL DEFAULT 1,
  satuan           VARCHAR(40)  NOT NULL DEFAULT 'pcs',
  harga_estimasi   DECIMAL(16,2) NULL,
  harga_realisasi  DECIMAL(16,2) NULL,
  catatan          VARCHAR(500) NULL,
  PRIMARY KEY (id),
  KEY idx_ga_pr_items (request_id),
  CONSTRAINT fk_ga_pr_items FOREIGN KEY (request_id) REFERENCES ga_purchase_requests (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Link spreadsheet GA (bisa diganti di menu Data GA > Sumber data)
INSERT IGNORE INTO app_settings (`key`, value)
VALUES ('ga.sheet_url', 'https://docs.google.com/spreadsheets/d/1ojh_lsnCw17fzAc1z_hG02KzOqb7IF9X6gTBtTmGFn0/edit');

-- Menu GA untuk divisi General Affair dan General Manager (divisi lain bisa ditambah di Manajemen Role > Menu per divisi)
INSERT IGNORE INTO division_menus (division_id, menu_key)
SELECT d.id, m.menu_key FROM divisions d
JOIN (SELECT 'ga-data' AS menu_key UNION ALL SELECT 'ga-pengajuan') m
WHERE d.code IN ('general_affair', 'general_manager');
