-- Dokumen Order: untuk prospek atau customer (Accurate), ongkos kirim per kg x berat kiriman (ditambahkan ke total),
-- dan diskon dalam persen (nilai Rupiah dihitung dari subtotal).
ALTER TABLE order_documents ADD COLUMN IF NOT EXISTS prospect_id INT UNSIGNED NULL AFTER so_number;
ALTER TABLE order_documents ADD COLUMN IF NOT EXISTS customer_id INT UNSIGNED NULL AFTER prospect_id;
ALTER TABLE order_documents ADD COLUMN IF NOT EXISTS ongkir_per_kg DECIMAL(14,2) NULL AFTER ekspedisi;
ALTER TABLE order_documents ADD COLUMN IF NOT EXISTS berat_kg DECIMAL(14,3) NULL AFTER ongkir_per_kg;
ALTER TABLE order_documents ADD COLUMN IF NOT EXISTS diskon_persen DECIMAL(9,4) NULL AFTER diskon;
ALTER TABLE order_documents ADD CONSTRAINT fk_order_doc_prospect FOREIGN KEY IF NOT EXISTS (prospect_id) REFERENCES prospects (id) ON DELETE SET NULL;
ALTER TABLE order_documents ADD CONSTRAINT fk_order_doc_customer FOREIGN KEY IF NOT EXISTS (customer_id) REFERENCES customers (id) ON DELETE SET NULL;
