-- PAP-MS: Master Data (dikelola Admin & Super Admin, divisi lain melihat)
--   - Produk packaging (PE, HD, PP, mika, ...)
--   - Logo & desain dari Google Drive (PAP logo desain, Cetak 2023-2026) dengan preview gambar
--   - Data Produk, Customer, Data Mesin (halaman yang sudah ada, ditampilkan sebagai tab)

-- 1. Menu Master Data untuk semua divisi (lihat); kelola dibatasi ke Admin/Super Admin di kode
INSERT IGNORE INTO division_menus (division_id, menu_key) SELECT d.id, 'master-data' FROM divisions d;

-- 2. Produk packaging
CREATE TABLE IF NOT EXISTS packaging_types (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  kode        VARCHAR(30)  NOT NULL,
  nama        VARCHAR(150) NOT NULL,
  bahan       VARCHAR(150) NULL,          -- HDPE, LDPE, PP, PET, ...
  proses      VARCHAR(255) NULL,          -- Blow, Cetak, Bag making
  ketebalan   VARCHAR(100) NULL,          -- rentang umum, mis. 15-80 mikron
  kegunaan    VARCHAR(500) NULL,
  keterangan  TEXT         NULL,
  status      ENUM('aktif','nonaktif') NOT NULL DEFAULT 'aktif',
  sort_order  INT          NOT NULL DEFAULT 0,
  updated_by  INT UNSIGNED NULL,
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_packaging_kode (kode)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO packaging_types (kode, nama, bahan, proses, kegunaan, sort_order) VALUES
  ('HD',      'Kantong HD',          'HDPE',  'Blow, Cetak, Bag making', 'Kantong belanja, jinjing, laundry, sampah', 1),
  ('PE',      'Kantong PE',          'LDPE',  'Blow, Cetak, Bag making', 'Kemasan makanan, bening, lentur', 2),
  ('PP',      'Kantong PP',          'PP',    'Blow, Cetak, Bag making', 'Kemasan bening kaku, roti, garmen', 3),
  ('LAUNDRY', 'Plastik laundry',     'HDPE',  'Blow, Cetak, Bag making', 'Kantong & roll laundry', 4),
  ('ROLL',    'Plastik roll',        'HDPE/PE', 'Blow, Cetak',          'Roll / sheet tanpa bag making', 5),
  ('MIKA',    'Mika rigid',          'PET/PP', NULL,                     'Mika / kemasan kaku', 6);

-- 3. Google Drive: folder sumber desain
CREATE TABLE IF NOT EXISTS drive_roots (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  label       VARCHAR(100) NOT NULL,       -- "Cetak 2026", "PAP logo desain"
  folder_id   VARCHAR(100) NOT NULL,
  kategori    ENUM('logo','cetak') NOT NULL DEFAULT 'cetak',
  tahun       SMALLINT UNSIGNED NULL,
  aktif       TINYINT(1)   NOT NULL DEFAULT 1,
  sort_order  INT          NOT NULL DEFAULT 0,
  last_error  VARCHAR(500) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_drive_roots_folder (folder_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO drive_roots (label, folder_id, kategori, tahun, sort_order) VALUES
  ('PAP logo desain', '10W6HRdXStq4bAVarXsNw-oe5IzO9h05u', 'logo', NULL, 1),
  ('Cetak 2026',      '1PlLEXGnzF0MLLhmnAZshheq5H3uBtMeQ', 'cetak', 2026, 2),
  ('Cetak 2025',      '1OKgmhO8r9wPFrwqp_aQR6gLpVutUnT4i', 'cetak', 2025, 3),
  ('Cetak 2024',      '1TsSpOV99fK2S8ZmjCAwpqKMn-z1mPfjM', 'cetak', 2024, 4),
  ('Cetak 2023',      '1Pa-JSg94ECr0gXBWek2A2wnkVtxkcuzh', 'cetak', 2023, 5);

-- Folder hasil penelusuran (Cetak 2026 / Oktober / NT laundry), dipindai bertahap oleh sinkronisasi
CREATE TABLE IF NOT EXISTS drive_folders (
  id          VARCHAR(100) NOT NULL,       -- id folder Google Drive
  root_id     INT UNSIGNED NOT NULL,
  parent_id   VARCHAR(100) NULL,
  name        VARCHAR(255) NOT NULL,
  path        VARCHAR(1000) NOT NULL,      -- "Oktober / NT laundry"
  depth       TINYINT UNSIGNED NOT NULL,   -- 0 = root
  bulan       VARCHAR(60)  NULL,
  brand       VARCHAR(255) NULL,
  scanned_at  DATETIME     NULL,
  PRIMARY KEY (id),
  KEY idx_drive_folders_scan (scanned_at),
  CONSTRAINT fk_drive_folders_root FOREIGN KEY (root_id) REFERENCES drive_roots (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- File desain (gambar, PDF, CDR, AI, ...)
CREATE TABLE IF NOT EXISTS drive_files (
  id            VARCHAR(100) NOT NULL,     -- id file Google Drive
  root_id       INT UNSIGNED NOT NULL,
  folder_id     VARCHAR(100) NOT NULL,
  name          VARCHAR(255) NOT NULL,
  mime          VARCHAR(150) NOT NULL,
  size          BIGINT UNSIGNED NULL,
  modified_at   DATETIME     NULL,
  has_thumbnail TINYINT(1)   NOT NULL DEFAULT 0,
  web_link      VARCHAR(500) NULL,
  bulan         VARCHAR(60)  NULL,
  brand         VARCHAR(255) NULL,         -- nama folder brand/customer
  customer_id   INT UNSIGNED NULL,
  customer_manual TINYINT(1) NOT NULL DEFAULT 0, -- 1 = dihubungkan manual oleh admin (tidak ditimpa pencocokan otomatis)
  synced_at     DATETIME     NOT NULL,
  PRIMARY KEY (id),
  KEY idx_drive_files_folder (folder_id),
  KEY idx_drive_files_root (root_id, modified_at),
  KEY idx_drive_files_brand (brand),
  KEY idx_drive_files_customer (customer_id),
  CONSTRAINT fk_drive_files_root FOREIGN KEY (root_id) REFERENCES drive_roots (id) ON DELETE CASCADE,
  CONSTRAINT fk_drive_files_customer FOREIGN KEY (customer_id) REFERENCES customers (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
