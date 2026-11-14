-- Prospek mengikuti format tabel "Program Mkt Dev":
-- per produk: jenis plastik, qty kebutuhan (kg), harga per satuan, satuan harga, GPF per satuan; per prospek: payment
ALTER TABLE prospect_products
  ADD COLUMN IF NOT EXISTS jenis_plastik VARCHAR(40) NULL AFTER estimasi,
  ADD COLUMN IF NOT EXISTS qty_kg DECIMAL(14,2) NULL AFTER jenis_plastik,
  ADD COLUMN IF NOT EXISTS harga DECIMAL(15,2) NULL AFTER qty_kg,
  ADD COLUMN IF NOT EXISTS satuan_harga VARCHAR(20) NULL AFTER harga,
  ADD COLUMN IF NOT EXISTS gpf DECIMAL(15,2) NULL AFTER satuan_harga;

ALTER TABLE prospects
  ADD COLUMN IF NOT EXISTS payment VARCHAR(255) NULL AFTER kompetitor,
  ADD COLUMN IF NOT EXISTS import_batch VARCHAR(40) NULL AFTER payment,
  ADD INDEX IF NOT EXISTS idx_prospects_import_batch (import_batch);

-- Impor sebelumnya (sebelum ada import_batch): kelompokkan dari log aktivitas impor agar bisa dibatalkan
UPDATE prospects p
  JOIN activity_logs l ON l.path = '/api/prospects/import' AND l.method = 'POST' AND l.actor_id = p.created_by
    AND p.created_at BETWEEN l.created_at - INTERVAL 3 MINUTE AND l.created_at + INTERVAL 1 MINUTE
SET p.import_batch = CONCAT('log-', l.id)
WHERE p.import_batch IS NULL
  AND NOT EXISTS (SELECT 1 FROM marketing_activities a WHERE a.prospect_id = p.id AND a.hasil LIKE 'Prospek dibuat%');
