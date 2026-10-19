-- PAP-MS: Kalender Konten disinkron dari Google Sheet "konten planning" (akun Google yang terhubung di Master Data)
-- sheet_key = kunci baris sheet (tanggal + judul + platform) agar sinkron berulang memperbarui, bukan menggandakan
ALTER TABLE content_plans ADD COLUMN IF NOT EXISTS sheet_key CHAR(40) NULL AFTER id;
ALTER TABLE content_plans ADD COLUMN IF NOT EXISTS sheet_ref VARCHAR(150) NULL AFTER sheet_key;
ALTER TABLE content_plans ADD UNIQUE KEY IF NOT EXISTS uq_content_sheet_key (sheet_key);
