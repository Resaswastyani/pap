-- Analisa teknik order juga bisa diajukan dari menu Data Produk (per produk); tab Analisa Teknik di Data Produk
ALTER TABLE prospect_tech_analyses ADD COLUMN IF NOT EXISTS product_id INT UNSIGNED NULL AFTER prospect_id;
ALTER TABLE prospect_tech_analyses ADD KEY IF NOT EXISTS idx_pta_product (product_id);
ALTER TABLE prospect_tech_analyses ADD CONSTRAINT fk_pta_product FOREIGN KEY IF NOT EXISTS (product_id) REFERENCES customer_products (id) ON DELETE SET NULL;
