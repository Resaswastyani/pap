-- Rencana Produksi ke depan: pesanan (Sales Order Accurate, barang "Diproduksi") dijadwalkan ke tanggal & Shift 1/2/3.
-- Menggantikan tabel uji 107 (pembagian shift pada MP Accurate, yang ternyata catatan realisasi, bukan rencana).
DROP TABLE IF EXISTS production_plan_shifts;

CREATE TABLE IF NOT EXISTS production_job_shifts (
  id          INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  job_id      INT UNSIGNED  NOT NULL,                -- production_jobs (satu baris pesanan)
  tanggal     DATE          NOT NULL,                -- tanggal rencana produksi
  shift       TINYINT UNSIGNED NOT NULL,             -- 1, 2, 3
  quantity    DECIMAL(18,4) NOT NULL,
  catatan     VARCHAR(255)  NULL,                    -- regu / operator / mesin
  created_by  INT UNSIGNED  NULL,
  updated_by  INT UNSIGNED  NULL,
  created_at  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_pjs_tanggal (tanggal, shift),
  KEY idx_pjs_job (job_id),
  CONSTRAINT fk_pjs_job FOREIGN KEY (job_id) REFERENCES production_jobs (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
