-- Data GA: tab "Lainnya" di spreadsheet GA (listrik, air, sewa, asuransi, pajak kendaraan, dan biaya GA lain).
-- Tab dibuat otomatis oleh SIMPAP saat data pertama ditambahkan; kolom: No | Nama Item | Kategori | Vendor / Provider |
-- No. Pelanggan / Akun | Biaya | Siklus | Jatuh Tempo | Penanggung Jawab | Status | Catatan
CREATE TABLE IF NOT EXISTS ga_others (
  id                INT UNSIGNED NOT NULL AUTO_INCREMENT,
  no                SMALLINT UNSIGNED NULL,
  nama              VARCHAR(200) NOT NULL,
  kategori          VARCHAR(80)  NULL,
  vendor            VARCHAR(150) NULL,
  no_pelanggan      VARCHAR(100) NULL,
  biaya             DECIMAL(16,2) NULL,
  siklus            VARCHAR(30)  NULL,
  jatuh_tempo       DATE         NULL,
  penanggung_jawab  VARCHAR(150) NULL,
  status            VARCHAR(30)  NULL,
  catatan           TEXT         NULL,
  sheet_row         INT UNSIGNED NULL,
  synced_at         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_ga_others_tempo (jatuh_tempo)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
