-- Quotation: diskon (persen atau nominal Rp) dari subtotal; PPN dihitung dari harga setelah diskon.
ALTER TABLE quotations ADD COLUMN IF NOT EXISTS pakai_diskon TINYINT(1) NOT NULL DEFAULT 0 AFTER subtotal;
ALTER TABLE quotations ADD COLUMN IF NOT EXISTS diskon_tipe VARCHAR(10) NULL AFTER pakai_diskon;
ALTER TABLE quotations ADD COLUMN IF NOT EXISTS diskon_nilai DECIMAL(16,2) NULL AFTER diskon_tipe;
ALTER TABLE quotations ADD COLUMN IF NOT EXISTS diskon DECIMAL(16,2) NOT NULL DEFAULT 0 AFTER diskon_nilai;
