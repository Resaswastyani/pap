-- PAP-MS: gambar part pada Lembar Perawatan Mesin (gambar yang ditempel di sel kolom NAMA PART di spreadsheet).
-- Dibaca dari ekspor XLSX Google Drive saat sinkron; diganti hanya bila isi gambar berubah (hash).

CREATE TABLE IF NOT EXISTS maintenance_sheet_images (
  id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  sheet_tab  VARCHAR(120) NOT NULL,
  part_no    SMALLINT UNSIGNED NULL,
  part       VARCHAR(200) NOT NULL,
  urut       SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  name       VARCHAR(255) NULL,
  mime       VARCHAR(40)  NOT NULL,
  size       INT UNSIGNED NOT NULL,
  data       MEDIUMBLOB   NOT NULL,
  sheet_row  INT UNSIGNED NULL,
  PRIMARY KEY (id),
  KEY idx_msimg_part (sheet_tab, part_no, part)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
