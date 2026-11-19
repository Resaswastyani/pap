-- Rencana Produksi (CRUD): setiap rencana = satu tanggal + shift + produk + jumlah + nilai.
-- Produk diambil dari pesanan Accurate (production_jobs) atau langsung dari daftar produk Accurate (barang "Diproduksi").
-- Menggantikan production_job_shifts (108) yang hanya bisa terikat ke pesanan.
DROP TABLE IF EXISTS production_job_shifts;

CREATE TABLE IF NOT EXISTS production_plan_entries (
  id               INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  tanggal          DATE          NOT NULL,              -- tanggal rencana produksi
  shift            TINYINT UNSIGNED NOT NULL,           -- 1, 2, 3
  sumber           ENUM('pesanan','produk') NOT NULL DEFAULT 'produk',
  job_id           INT UNSIGNED  NULL,                  -- pesanan (production_jobs) bila sumber = pesanan
  item_accurate_id INT UNSIGNED  NULL,
  item_no          VARCHAR(80)   NULL,
  item_name        VARCHAR(255)  NOT NULL,
  customer_name    VARCHAR(255)  NULL,
  so_number        VARCHAR(80)   NULL,
  quantity         DECIMAL(18,4) NOT NULL,
  unit             VARCHAR(40)   NULL,
  unit_price       DECIMAL(20,4) NULL,                  -- Rupiah per satuan; nilai = quantity x unit_price
  catatan          VARCHAR(255)  NULL,                  -- regu / operator / mesin
  created_by       INT UNSIGNED  NULL,
  updated_by       INT UNSIGNED  NULL,
  created_at       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_ppe_tanggal (tanggal, shift),
  KEY idx_ppe_job (job_id),
  CONSTRAINT fk_ppe_job FOREIGN KEY (job_id) REFERENCES production_jobs (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
