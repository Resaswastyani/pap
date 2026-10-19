-- PAP-MS: Tarik SPK (SPK salah isi dicabut lalu diterbitkan ulang sebagai revisi; job produksi tetap berjalan)
-- Nomor terbit ulang: SPK-YYYYMM-00001-R1, -R2, ...
ALTER TABLE production_jobs ADD COLUMN IF NOT EXISTS spk_revisi       TINYINT UNSIGNED NOT NULL DEFAULT 0 AFTER spk_terbit_oleh;
ALTER TABLE production_jobs ADD COLUMN IF NOT EXISTS spk_ditarik_at   DATETIME     NULL AFTER spk_revisi;
ALTER TABLE production_jobs ADD COLUMN IF NOT EXISTS spk_ditarik_oleh INT UNSIGNED NULL AFTER spk_ditarik_at;
ALTER TABLE production_jobs ADD COLUMN IF NOT EXISTS spk_alasan_tarik VARCHAR(500) NULL AFTER spk_ditarik_oleh;
