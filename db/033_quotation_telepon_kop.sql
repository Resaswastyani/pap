-- PAP-MS: nomor Telepon / WA perusahaan di kop surat dipilih per penawaran (bisa lebih dari satu)
-- Pilihan = baris-baris "Telepon / WA" di Template dokumen. Disimpan satu nomor per baris.
-- Kosong = kop menampilkan semua nomor di Template dokumen (perilaku lama).
ALTER TABLE quotations ADD COLUMN IF NOT EXISTS telepon_kop VARCHAR(1000) NULL AFTER rekening;
