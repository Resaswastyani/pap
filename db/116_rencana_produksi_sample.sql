-- Rencana Produksi: sumber ketiga "sample" = pembuatan sample dari menu Request Sample.
ALTER TABLE production_plan_entries MODIFY COLUMN sumber ENUM('pesanan','produk','sample') NOT NULL DEFAULT 'produk';
ALTER TABLE production_plan_entries ADD COLUMN IF NOT EXISTS sample_id INT UNSIGNED NULL AFTER job_id;
ALTER TABLE production_plan_entries ADD COLUMN IF NOT EXISTS sample_item_id INT UNSIGNED NULL AFTER sample_id;
ALTER TABLE production_plan_entries ADD KEY IF NOT EXISTS idx_ppe_sample (sample_id);
ALTER TABLE production_plan_entries ADD CONSTRAINT fk_ppe_sample FOREIGN KEY IF NOT EXISTS (sample_id) REFERENCES sample_requests (id) ON DELETE SET NULL;
ALTER TABLE production_plan_entries ADD CONSTRAINT fk_ppe_sample_item FOREIGN KEY IF NOT EXISTS (sample_item_id) REFERENCES sample_request_items (id) ON DELETE SET NULL;
