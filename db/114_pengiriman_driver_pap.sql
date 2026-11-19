-- Surat order: cara pengiriman (armada / driver sendiri PT. PAP, ekspedisi, atau diambil customer) + nama driver / kendaraan
ALTER TABLE quotations ADD COLUMN IF NOT EXISTS pengiriman ENUM('ambil','ekspedisi','driver_pap') NULL AFTER expedition_id;
ALTER TABLE quotations ADD COLUMN IF NOT EXISTS driver_nama VARCHAR(150) NULL AFTER pengiriman;
-- Data lama: ada ekspedisi = ekspedisi; surat order tanpa ekspedisi = diambil sendiri / belum ditentukan
UPDATE quotations SET pengiriman = 'ekspedisi' WHERE pengiriman IS NULL AND expedition_id IS NOT NULL;
