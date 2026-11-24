-- Kategori (sektor) customer bisa diubah manual di menu Customer: laundry / beras / umum / lainnya.
-- Kosong = otomatis (kode kategori Accurate LAU/BRS, nama customer, lalu Sektor Umum). Tidak tertimpa sinkron Accurate.
ALTER TABLE customers ADD COLUMN IF NOT EXISTS sektor_manual VARCHAR(20) NULL AFTER category;
