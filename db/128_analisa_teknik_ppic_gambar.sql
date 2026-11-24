-- Analisa Teknik Order: menu pengajuan Marketing & PPIC (dari Sales Order Accurate), gambar per produk
-- (lampiran file + desain Master Data), jumlah gambar per kantong, dengan / tanpa roto; qty di Data Produk.
ALTER TABLE prospect_tech_analyses ADD COLUMN IF NOT EXISTS sumber VARCHAR(20) NULL AFTER product_id;       -- marketing / ppic / prospek / produk
ALTER TABLE prospect_tech_analyses ADD COLUMN IF NOT EXISTS customer_id INT UNSIGNED NULL AFTER sumber;
ALTER TABLE prospect_tech_analyses ADD COLUMN IF NOT EXISTS so_accurate_id INT UNSIGNED NULL AFTER customer_id;
ALTER TABLE prospect_tech_analyses ADD COLUMN IF NOT EXISTS so_number VARCHAR(80) NULL AFTER so_accurate_id;
ALTER TABLE prospect_tech_analyses ADD COLUMN IF NOT EXISTS jumlah_gambar SMALLINT UNSIGNED NULL AFTER kesulitan_print; -- gambar per kantong
ALTER TABLE prospect_tech_analyses ADD COLUMN IF NOT EXISTS desain LONGTEXT NULL AFTER critical_to_quality;   -- JSON desain Master Data [{id,name,mime,web_link}]
ALTER TABLE prospect_tech_analyses ADD COLUMN IF NOT EXISTS roto ENUM('dengan','tanpa') NULL AFTER proses;     -- diisi Teknik
ALTER TABLE prospect_tech_analyses ADD KEY IF NOT EXISTS idx_pta_sumber (sumber);
ALTER TABLE prospect_tech_analyses ADD CONSTRAINT fk_pta_customer FOREIGN KEY IF NOT EXISTS (customer_id) REFERENCES customers (id) ON DELETE SET NULL;
UPDATE prospect_tech_analyses SET sumber = CASE WHEN product_id IS NOT NULL THEN 'produk' WHEN prospect_id IS NOT NULL THEN 'prospek' ELSE 'marketing' END WHERE sumber IS NULL;

ALTER TABLE customer_products ADD COLUMN IF NOT EXISTS qty DECIMAL(18,2) NULL AFTER jenis;
ALTER TABLE customer_products ADD COLUMN IF NOT EXISTS qty_satuan VARCHAR(20) NULL AFTER qty;

-- Menu baru: Pengajuan Analisa Teknik (Marketing) & Analisa Teknik PPIC
INSERT IGNORE INTO division_menus (division_id, menu_key)
SELECT d.id, 'analisa-teknik-mkt' FROM divisions d WHERE d.code IN ('marketing', 'marketing_development', 'marketing_maintenance', 'marketing_digital', 'general_manager');
INSERT IGNORE INTO division_menus (division_id, menu_key)
SELECT d.id, 'analisa-teknik-ppic' FROM divisions d WHERE d.code IN ('ppic', 'general_manager');

-- Lampiran file gambar per analisa teknik
ALTER TABLE note_attachments MODIFY owner_type ENUM('activity','request_log','stage','job','repair','maintenance_log','purchase_request','ticket','damage_log','complaint','order_custom','tech_analysis') NOT NULL;
