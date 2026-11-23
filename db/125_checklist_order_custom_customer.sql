-- Checklist Order Custom: customer & produk diambil dari data yang ada.
-- Order baru -> dari Prospek (prospect_id); repeat order -> dari Customer (customer_id) + Data Produk (product_id).
ALTER TABLE order_custom_checklists ADD COLUMN IF NOT EXISTS customer_id INT UNSIGNED NULL AFTER prospect_id;
ALTER TABLE order_custom_checklists ADD COLUMN IF NOT EXISTS product_id INT UNSIGNED NULL AFTER customer_id;
ALTER TABLE order_custom_checklists ADD KEY IF NOT EXISTS idx_occ_customer (customer_id);
ALTER TABLE order_custom_checklists ADD CONSTRAINT fk_occ_customer FOREIGN KEY IF NOT EXISTS (customer_id) REFERENCES customers (id) ON DELETE SET NULL;
ALTER TABLE order_custom_checklists ADD CONSTRAINT fk_occ_product FOREIGN KEY IF NOT EXISTS (product_id) REFERENCES customer_products (id) ON DELETE SET NULL;
