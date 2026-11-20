-- Rencana Produksi: mesin wajib dipilih dari daftar Kapasitas Produksi (production_capacities);
-- kolom catatan kini "catatan khusus" (opsional). Harga per satuan tidak diisi di form lagi (otomatis dari pesanan / produk Accurate).
ALTER TABLE production_plan_entries ADD COLUMN IF NOT EXISTS capacity_id INT UNSIGNED NULL AFTER shift;
ALTER TABLE production_plan_entries ADD KEY IF NOT EXISTS idx_ppe_capacity (capacity_id);
ALTER TABLE production_plan_entries ADD CONSTRAINT fk_ppe_capacity FOREIGN KEY IF NOT EXISTS (capacity_id) REFERENCES production_capacities (id) ON DELETE SET NULL;
