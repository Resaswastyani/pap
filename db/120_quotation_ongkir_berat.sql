-- Quotation: ongkos kirim dirinci per kg x berat kiriman (kg) lalu dijumlahkan ke total penawaran.
-- Berat default = jumlah produk bersatuan kg (bisa diubah). Penawaran lama tanpa berat tetap tampil per kg saja.
ALTER TABLE quotations ADD COLUMN IF NOT EXISTS ongkir_berat_kg DECIMAL(14,2) NULL AFTER ongkir_per_kg;
