-- Pajak berdiri sendiri: koreksi faktur PPN keluaran / masukan khusus menu Pajak (faktur Accurate tidak diubah).
-- sumber 'accurate' = koreksi atas faktur Accurate (nilai kosong = ikut Accurate; dikecualikan = tidak dihitung di pajak);
-- sumber 'manual'   = faktur yang dicatat langsung di menu Pajak.
CREATE TABLE IF NOT EXISTS tax_vat_entries (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  jenis         ENUM('keluaran','masukan') NOT NULL,
  sumber        ENUM('accurate','manual') NOT NULL DEFAULT 'manual',
  accurate_id   INT UNSIGNED  NULL,
  masa          CHAR(7)       NOT NULL,
  nomor         VARCHAR(80)   NULL,
  tanggal       DATE          NULL,
  pihak         VARCHAR(200)  NULL,
  faktur_pajak  VARCHAR(60)   NULL,
  dpp           DECIMAL(18,2) NULL,
  ppn           DECIMAL(18,2) NULL,
  dikecualikan  TINYINT(1)    NOT NULL DEFAULT 0,
  catatan       VARCHAR(500)  NULL,
  updated_by    INT UNSIGNED  NULL,
  updated_at    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_tax_vat_accurate (jenis, accurate_id),
  KEY idx_tax_vat_masa (masa, jenis),
  CONSTRAINT fk_tax_vat_user FOREIGN KEY (updated_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
