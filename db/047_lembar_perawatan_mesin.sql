-- PAP-MS: Lembar Perawatan Mesin dari spreadsheet "IGP - Lembar Perawatan Mesin" di Google Drive.
-- Satu tab per mesin (judul "MAINTENANCE MESIN BLOW PP"), kolom NO | NAMA PART | KELOMPOK | MAINTENANCE | CHECK LIST | KETERANGAN.
-- Satu baris tabel = satu langkah maintenance; diganti seluruhnya setiap sinkron.

CREATE TABLE IF NOT EXISTS maintenance_sheet_items (
  id           INT UNSIGNED NOT NULL AUTO_INCREMENT,
  sheet_tab    VARCHAR(120) NOT NULL,          -- nama tab di spreadsheet
  mesin        VARCHAR(150) NOT NULL,          -- nama mesin dari judul tab, mis. "Mesin Blow PP"
  mesin_urut   SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  machine_id   INT UNSIGNED NULL,              -- mesin di Data Mesin bila cocok
  part_no      SMALLINT UNSIGNED NULL,
  part         VARCHAR(200) NOT NULL,
  kelompok     VARCHAR(150) NULL,
  langkah_urut SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  langkah      TEXT         NOT NULL,
  keterangan   TEXT         NULL,
  sheet_row    INT UNSIGNED NULL,
  PRIMARY KEY (id),
  KEY idx_msi_tab (sheet_tab, part_no, langkah_urut),
  KEY idx_msi_machine (machine_id),
  CONSTRAINT fk_msi_machine FOREIGN KEY (machine_id) REFERENCES machines (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO app_settings (`key`, value) VALUES
  ('perawatan.sheet_url', 'https://docs.google.com/spreadsheets/d/1A1aDYp9sduVwM_qDdlT_SX2JG14esEu-CPCjlC-rK-k/edit?usp=sharing');
