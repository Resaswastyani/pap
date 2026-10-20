-- PAP-MS: Rekap kerusakan mesin dari spreadsheet "Laporan Kerusakan Mesin" di Google Drive (tab REKAP KERUSAKAN)
-- + isian form Laporan Kerusakan Mesin dari aplikasi. Baris dari sheet diganti penuh setiap sinkron.

CREATE TABLE IF NOT EXISTS machine_damage_logs (
  id           INT UNSIGNED NOT NULL AUTO_INCREMENT,
  source       ENUM('sheet','app') NOT NULL DEFAULT 'app',
  sheet_row    INT UNSIGNED NULL,           -- nomor baris di sheet (urutan asli)
  no_laporan   INT UNSIGNED NULL,           -- kolom NO (baris lanjutan memakai NO laporan di atasnya)
  tanggal      DATE         NULL,
  mesin        VARCHAR(150) NULL,           -- nama mesin seperti ditulis
  mesin_key    VARCHAR(150) NULL,           -- nama mesin dinormalisasi untuk rekap (mis. "cutseal hd")
  komponen     VARCHAR(150) NULL,
  kerusakan    TEXT         NULL,
  tindakan     TEXT         NULL,
  keterangan   TEXT         NULL,
  created_by   INT UNSIGNED NULL,
  created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_damage_tanggal (tanggal),
  KEY idx_damage_mesin (mesin_key),
  KEY idx_damage_source (source, sheet_row),
  CONSTRAINT fk_damage_created_by FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO app_settings (`key`, value) VALUES
  ('kerusakan_mesin.sheet_url', 'https://docs.google.com/spreadsheets/d/1KFf9mAanl_Szo6I_6jQzmcj5zzwR64Eh/edit?usp=sharing&ouid=116992751279000154130&rtpof=true&sd=true');
