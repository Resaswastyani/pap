-- Training Karyawan: folder materi & spreadsheet jadwal dari Google Drive (keduanya privat, dibaca lewat akun Google di Master Data).
-- Hasil baca spreadsheet jadwal disimpan utuh sebagai JSON (cermin sheet, hanya baca; perubahan dilakukan di Google Sheet).

CREATE TABLE IF NOT EXISTS training_schedule (
  id         TINYINT UNSIGNED NOT NULL,
  data       MEDIUMTEXT NOT NULL,
  synced_at  DATETIME NOT NULL,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

UPDATE app_settings SET value = 'https://drive.google.com/drive/folders/18Ys8J4l81oqZ4NSFNIgYQatF8CUGpBlK' WHERE `key` = 'hrd.training_folder_url' AND (value IS NULL OR value = '');
INSERT IGNORE INTO app_settings (`key`, value) VALUES ('hrd.training_schedule_url', 'https://docs.google.com/spreadsheets/d/14PjZ_YdLbRUM1P_nxIEWIUVSvwtDlexUfs85oHGvYPo/edit');
