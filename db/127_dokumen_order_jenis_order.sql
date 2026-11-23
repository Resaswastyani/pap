-- Dokumen Order: jenis order Polos / Custom. Custom -> Form Order Custom per produk; cetak = SO + Form Order + Gambar Desain.
-- Polos -> cetak SO saja.
ALTER TABLE order_documents ADD COLUMN IF NOT EXISTS jenis_order ENUM('polos','custom') NOT NULL DEFAULT 'polos' AFTER jenis;
-- Dokumen lama yang sudah punya checklist order custom dianggap order custom
UPDATE order_documents d SET d.jenis_order = 'custom'
WHERE d.jenis_order = 'polos' AND EXISTS (SELECT 1 FROM order_custom_checklists o WHERE o.order_document_id = d.id);
