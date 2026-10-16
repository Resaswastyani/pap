-- PAP-MS: penanda versi label folder Drive (bulan/brand). Kode baru memindai ulang folder dengan labels_v lama
-- karena struktur Cetak tidak seragam (ada yang tanpa folder bulan).
ALTER TABLE drive_folders ADD COLUMN IF NOT EXISTS labels_v TINYINT UNSIGNED NOT NULL DEFAULT 1;
