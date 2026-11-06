-- Accounting:
-- 1. Faktur uang muka (DP) customer di Accurate = faktur penjualan bertanda invoiceDp. Ditandai agar uang muka bisa
--    ditampilkan tersendiri dan tidak terhitung dua kali sebagai omzet (faktur pelunasan memuat nilai penuh pesanan).
-- 2. PPN digunggung: faktur diinput manual Accounting per masa (PPN kurang bayar = keluaran + digunggung − masukan).
-- 3. Tutup buku manual per bulan: angka Accurate bulan itu dibekukan (acc_closed_cache) dan catatan masa itu dikunci.

ALTER TABLE accurate_sales_invoices ADD COLUMN IF NOT EXISTS is_dp TINYINT(1) NULL AFTER status;
ALTER TABLE accurate_sales_invoices ADD KEY IF NOT EXISTS idx_invoices_dp (is_dp, trans_date);

CREATE TABLE IF NOT EXISTS tax_digunggung (
  id               INT UNSIGNED NOT NULL AUTO_INCREMENT,
  masa             CHAR(7)       NOT NULL,             -- YYYY-MM
  nomor            VARCHAR(40)   NOT NULL,             -- otomatis: DG.YYYY.MM.0001
  tanggal          DATE          NOT NULL,
  no_faktur_pajak  VARCHAR(60)   NULL,                 -- opsional, diisi manual
  customer         VARCHAR(200)  NOT NULL,
  jatuh_tempo      DATE          NULL,
  dpp              DECIMAL(18,2) NOT NULL DEFAULT 0,
  dpp_nilai_lain   DECIMAL(18,2) NOT NULL DEFAULT 0,   -- 11/12 x DPP
  ppn              DECIMAL(18,2) NOT NULL DEFAULT 0,
  total            DECIMAL(18,2) NOT NULL DEFAULT 0,
  catatan          VARCHAR(500)  NULL,
  created_by       INT UNSIGNED  NULL,
  updated_by       INT UNSIGNED  NULL,
  created_at       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_tax_digunggung_nomor (nomor),
  KEY idx_tax_digunggung_masa (masa, tanggal),
  CONSTRAINT fk_tax_digunggung_created FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT fk_tax_digunggung_updated FOREIGN KEY (updated_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS acc_closings (
  periode     CHAR(7)      NOT NULL,                   -- YYYY-MM
  ringkasan   TEXT         NULL,                       -- angka utama saat ditutup (JSON)
  catatan     VARCHAR(500) NULL,
  closed_by   INT UNSIGNED NULL,
  closed_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (periode),
  CONSTRAINT fk_acc_closings_user FOREIGN KEY (closed_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS acc_closed_cache (
  cache_key   VARCHAR(190) NOT NULL,
  periode     CHAR(7)      NOT NULL,
  data        MEDIUMTEXT   NOT NULL,
  PRIMARY KEY (cache_key),
  KEY idx_acc_closed_cache_periode (periode)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
