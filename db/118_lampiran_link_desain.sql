-- Request desain / konten: lampiran referensi & hasil desain boleh berupa link (Google Drive, Canva, dll.)
-- selain file (semua format, maks 4 MB). Baris link: url terisi, data kosong.
ALTER TABLE design_request_files ADD COLUMN IF NOT EXISTS url VARCHAR(1000) NULL AFTER mime;
