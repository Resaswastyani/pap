-- PAP-MS: rekening pembayaran dipilih per penawaran (dropdown dari Template dokumen, satu rekening per baris)
-- Kosong = dokumen menampilkan semua rekening di Template dokumen (perilaku lama).
ALTER TABLE quotations ADD COLUMN IF NOT EXISTS rekening VARCHAR(255) NULL AFTER syarat;
