-- Program Training Tahunan: tanggal rencana per bulan pelaksanaan, "2026-01-15,2026-04-10" (opsional)
ALTER TABLE training_programs ADD COLUMN IF NOT EXISTS tanggal VARCHAR(400) NULL AFTER bulan;
