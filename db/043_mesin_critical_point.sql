-- PAP-MS: Data Mesin & critical point perawatan dari spreadsheet "MAPPING TEKNIS MESIN" di Google Drive
-- (dibaca dengan akun Google yang terhubung di Master Data, seperti Logo & Desain dan Kalender Konten).
-- Sinkron: lini (INLINE PP / INLINE HD) -> mesin -> komponen -> langkah perawatan bernomor + link foto/video Drive.

-- 1. Mesin dari sheet dikenali lewat sheet_key (lini + nama mesin); status, kapasitas & keterangan tetap diatur di PAP-MS
ALTER TABLE machines ADD COLUMN IF NOT EXISTS lini      VARCHAR(40) NULL AFTER tahap;
ALTER TABLE machines ADD COLUMN IF NOT EXISTS sheet_key VARCHAR(80) NULL AFTER id;
ALTER TABLE machines ADD UNIQUE KEY IF NOT EXISTS uq_machines_sheet_key (sheet_key);

-- 2. Critical point perawatan per komponen mesin
CREATE TABLE IF NOT EXISTS machine_checkpoints (
  id             INT UNSIGNED NOT NULL AUTO_INCREMENT,
  machine_id     INT UNSIGNED NOT NULL,
  komponen       VARCHAR(150) NOT NULL,           -- EPC, Dies, Pisau Las, ...
  komponen_urut  SMALLINT UNSIGNED NOT NULL,
  jenis          ENUM('langkah','catatan') NOT NULL DEFAULT 'langkah',
  urut           SMALLINT UNSIGNED NOT NULL,      -- nomor langkah (catatan: urutan tampil)
  teks           TEXT         NOT NULL,
  keterangan     TEXT         NULL,               -- baris penjelas "-> ..." di bawah langkah
  link           VARCHAR(1000) NULL,              -- foto / video / dokumen di Google Drive
  drive_file_id  VARCHAR(100) NULL,
  sheet_ref      VARCHAR(150) NULL,
  PRIMARY KEY (id),
  KEY idx_checkpoints_machine (machine_id, komponen_urut, jenis, urut),
  KEY idx_checkpoints_drive (drive_file_id),
  CONSTRAINT fk_checkpoints_machine FOREIGN KEY (machine_id) REFERENCES machines (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. Data pembantu per mesin: SOP mesin, video lini, sumber manual
CREATE TABLE IF NOT EXISTS machine_documents (
  id             INT UNSIGNED NOT NULL AUTO_INCREMENT,
  machine_id     INT UNSIGNED NOT NULL,
  urut           SMALLINT UNSIGNED NOT NULL,
  judul          VARCHAR(255) NOT NULL,
  url            VARCHAR(1000) NULL,
  drive_file_id  VARCHAR(100) NULL,
  PRIMARY KEY (id),
  KEY idx_machine_documents (machine_id, urut),
  KEY idx_machine_documents_drive (drive_file_id),
  CONSTRAINT fk_machine_documents_machine FOREIGN KEY (machine_id) REFERENCES machines (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4. Link spreadsheet (bisa diganti dari menu Data Mesin)
INSERT IGNORE INTO app_settings (`key`, value) VALUES
  ('teknis.sheet_url', 'https://docs.google.com/spreadsheets/d/1MRCTFQxTokFa3WMB0Q3GtpX96xEfcf5f_7Xo-3e42BA/edit?usp=sharing');
