-- Kapasitas Produksi: lebar minimal per mesin + kapasitas terpakai per bulan (ton) per mesin, dibandingkan kapasitas efektif.
ALTER TABLE production_capacities ADD COLUMN IF NOT EXISTS lebar_min_cm DECIMAL(7,1) NULL AFTER jenis_plastik;

CREATE TABLE IF NOT EXISTS production_capacity_usage (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  capacity_id INT UNSIGNED NOT NULL,
  periode CHAR(7) NOT NULL,
  terpakai_ton DECIMAL(10,2) NOT NULL,
  catatan VARCHAR(500) NULL,
  updated_by INT UNSIGNED NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_capacity_periode (capacity_id, periode),
  KEY idx_periode (periode),
  CONSTRAINT fk_capacity_usage_capacity FOREIGN KEY (capacity_id) REFERENCES production_capacities(id) ON DELETE CASCADE,
  CONSTRAINT fk_capacity_usage_user FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
