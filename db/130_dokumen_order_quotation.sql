-- Dokumen Order dari Quotation: Surat Order & Proforma Invoice quotation yang diterima diedit dulu di menu Dokumen Order
-- (tombol Surat Order / Proforma Invoice di Quotation membuka dokumen yang tertaut, atau draf baru berisi data quotation)
ALTER TABLE order_documents ADD COLUMN IF NOT EXISTS quotation_id INT UNSIGNED NULL AFTER so_number;
ALTER TABLE order_documents ADD KEY IF NOT EXISTS idx_od_quotation (quotation_id, jenis);
