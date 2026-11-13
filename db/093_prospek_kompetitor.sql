-- Prospek: kompetitor / supplier lain yang sudah dipakai calon customer
ALTER TABLE prospects ADD COLUMN IF NOT EXISTS kompetitor TEXT NULL AFTER estimasi_order;
