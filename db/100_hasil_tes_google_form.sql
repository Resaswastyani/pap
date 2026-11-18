-- Hasil tes Papikostik & IQ dari Google Form (spreadsheet jawaban) disinkron ke employee_tests.
-- Satu jawaban form = satu baris (sheet_key unik); isian manual HRD tetap sumber 'manual'.
ALTER TABLE employee_tests
  ADD COLUMN IF NOT EXISTS sumber VARCHAR(10) NOT NULL DEFAULT 'manual' AFTER lampiran_url,
  ADD COLUMN IF NOT EXISTS sheet_key VARCHAR(190) NULL AFTER sumber,
  ADD UNIQUE INDEX IF NOT EXISTS uq_employee_tests_sheet (sheet_key);

INSERT IGNORE INTO app_settings (`key`, value) VALUES
  ('hrd.tes_papikostik_url', 'https://docs.google.com/spreadsheets/d/1g9gUs5BFevcek4NhFxxpU6WBY_5Eqyqe6Wu3X8wTBok/edit'),
  ('hrd.tes_iq_url', 'https://docs.google.com/spreadsheets/d/1xlQ48a0uiAcw1wVReS8BZrYOI40FVkow0AlQCs2gV7c/edit');
