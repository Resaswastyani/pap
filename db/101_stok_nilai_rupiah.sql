-- Nilai stok (Rupiah): harga pokok rata-rata per unit dari Accurate (balanceUnitCost), nilai = stok fisik x harga pokok
ALTER TABLE accurate_items ADD COLUMN IF NOT EXISTS unit_cost DECIMAL(20,4) NULL AFTER vendor_price;
