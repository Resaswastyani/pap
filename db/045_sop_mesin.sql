-- PAP-MS: menu Standar Setting diganti "SOP Mesin" = video SOP dari folder Google Drive Teknik.
-- Video dibaca dari folder Drive (akun Google di Master Data, atau tampilan publik folder bila akun belum terhubung),
-- lalu disimpan agar halaman cepat; kelompok mesin ditebak dari nama file dan bisa dibetulkan Teknik.

CREATE TABLE IF NOT EXISTS sop_videos (
  id               INT UNSIGNED NOT NULL AUTO_INCREMENT,
  drive_file_id    VARCHAR(100) NOT NULL,
  judul            VARCHAR(255) NOT NULL,            -- nama file tanpa ekstensi
  nama_file        VARCHAR(255) NOT NULL,
  folder           VARCHAR(500) NULL,                -- subfolder di dalam folder SOP (kosong = folder utama)
  mime             VARCHAR(150) NULL,
  ukuran           BIGINT UNSIGNED NULL,
  diubah_drive     DATETIME     NULL,
  kategori         VARCHAR(60)  NOT NULL DEFAULT 'Umum', -- Blow, Rotogravure, Gusset & Buffer, Cutseal, Umum
  lini             VARCHAR(20)  NULL,                -- PP / HD bila disebut di nama file
  kategori_manual  TINYINT(1)   NOT NULL DEFAULT 0,  -- dibetulkan Teknik: sinkron tidak menimpa
  urut             INT UNSIGNED NOT NULL DEFAULT 0,
  synced_at        DATETIME     NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_sop_videos_file (drive_file_id),
  KEY idx_sop_videos_kategori (kategori, lini)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Link folder SOP (bisa diganti dari menu SOP Mesin)
INSERT IGNORE INTO app_settings (`key`, value) VALUES
  ('teknis.sop_folder_url', 'https://drive.google.com/drive/folders/1aEtrSAH33Z8u-VEzCZFOy6S4y1zEaO1D?usp=sharing');

-- Akses menu: semua divisi yang dulu punya Standar Setting (Teknik, Produksi, PPIC, GM) kini membuka SOP Mesin
UPDATE IGNORE division_menus SET menu_key = 'sop-mesin' WHERE menu_key = 'standar-setting';
DELETE FROM division_menus WHERE menu_key = 'standar-setting';

-- Standar Setting dihapus (tabel masih kosong)
DROP TABLE IF EXISTS machine_settings;
