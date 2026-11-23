-- Checklist Order Custom bisa diisi per produk saat membuat / mengubah Dokumen Order (Surat Order / Proforma).
-- Desain dari Master Data (Logo & Desain, tabel drive_files) disimpan di isian JSON (isian.desain).
ALTER TABLE order_custom_checklists ADD COLUMN IF NOT EXISTS order_document_id INT UNSIGNED NULL AFTER product_id;
ALTER TABLE order_custom_checklists ADD KEY IF NOT EXISTS idx_occ_doc (order_document_id);
ALTER TABLE order_custom_checklists ADD CONSTRAINT fk_occ_doc FOREIGN KEY IF NOT EXISTS (order_document_id) REFERENCES order_documents (id) ON DELETE SET NULL;
