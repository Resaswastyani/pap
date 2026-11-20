-- Quotation: ongkos kirim per kg (centang "Ongkos kirim" di bawah PPN, wajib isi harga per kg). Dicetak di penawaran,
-- tidak dijumlahkan ke total karena berat kiriman baru pasti saat pengiriman.
ALTER TABLE quotations ADD COLUMN IF NOT EXISTS pakai_ongkir TINYINT(1) NOT NULL DEFAULT 0 AFTER ppn;
ALTER TABLE quotations ADD COLUMN IF NOT EXISTS ongkir_per_kg DECIMAL(14,2) NULL AFTER pakai_ongkir;
