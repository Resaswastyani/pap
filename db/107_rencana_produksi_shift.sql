-- Rencana Produksi: pembagian pengerjaan per shift (1/2/3) untuk setiap baris formula MP dari Accurate.
-- Data Accurate tetap hanya-baca; pembagian shift, jumlah, dan harga per satuan diisi di SIMPAP.
-- Nilai = jumlah x harga per satuan (bawaan: harga pokok rata-rata barang dari Accurate, bisa diubah).
CREATE TABLE IF NOT EXISTS production_plan_shifts (
  id             INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  mo_accurate_id INT UNSIGNED  NOT NULL,
  line_id        INT UNSIGNED  NOT NULL,
  shift          TINYINT UNSIGNED NOT NULL,          -- 1, 2, 3
  tanggal        DATE          NULL,                 -- tanggal pengerjaan (opsional)
  quantity       DECIMAL(18,4) NOT NULL,
  unit_price     DECIMAL(20,4) NULL,                 -- Rupiah per satuan
  catatan        VARCHAR(255)  NULL,                 -- mis. regu / operator / mesin
  created_by     INT UNSIGNED  NULL,
  updated_by     INT UNSIGNED  NULL,
  created_at     DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_pps_line (mo_accurate_id, line_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
