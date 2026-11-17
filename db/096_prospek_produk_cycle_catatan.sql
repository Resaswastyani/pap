-- Prospek: per produk ada cycle kebutuhan (tiap N hari / bulan) dan spek khusus / catatan (opsional)
ALTER TABLE prospect_products
  ADD COLUMN IF NOT EXISTS cycle_nilai SMALLINT UNSIGNED NULL AFTER gpf,
  ADD COLUMN IF NOT EXISTS cycle_satuan VARCHAR(10) NULL AFTER cycle_nilai,
  ADD COLUMN IF NOT EXISTS catatan VARCHAR(500) NULL AFTER cycle_satuan;
