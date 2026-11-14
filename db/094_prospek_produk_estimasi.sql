-- Prospek: estimasi order per produk diminati (satu prospek bisa beberapa produk)
ALTER TABLE prospect_products ADD COLUMN IF NOT EXISTS estimasi VARCHAR(150) NULL AFTER label;
