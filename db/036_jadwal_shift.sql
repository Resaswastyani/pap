-- PAP-MS: Jadwal Shift karyawan produksi, disinkron dari spreadsheet di Google Drive (akun Google yang terhubung di Master Data)
-- Satu jadwal per bulan (periode YYYY-MM); sinkron ulang mengganti seluruh baris bulan tersebut.

CREATE TABLE IF NOT EXISTS shift_schedules (
  id           INT UNSIGNED NOT NULL AUTO_INCREMENT,
  periode      CHAR(7)      NOT NULL,            -- 2026-10
  judul        VARCHAR(255) NULL,                -- judul di sheet, mis. JADWAL KARYAWAN PRODUKSI BULAN OKTOBER 2026
  sheet_tab    VARCHAR(150) NULL,
  synced_by    INT UNSIGNED NULL,
  synced_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_shift_periode (periode),
  CONSTRAINT fk_shift_synced_by FOREIGN KEY (synced_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS shift_schedule_rows (
  id             INT UNSIGNED NOT NULL AUTO_INCREMENT,
  schedule_id    INT UNSIGNED NOT NULL,
  urut           SMALLINT UNSIGNED NOT NULL,
  nama           VARCHAR(150) NOT NULL,
  bagian         VARCHAR(100) NULL,              -- dari nama "SUMARNO - KEBERSIHAN" -> KEBERSIHAN
  nomor_induk    VARCHAR(30)  NULL,
  pilihan_shift  VARCHAR(30)  NULL,              -- Pagi, Malam, 2 Shift, 3 Shift
  jadwal         VARCHAR(500) NOT NULL,          -- JSON array per tanggal: "1" / "2" / "3" / "" (libur) / kode lain
  PRIMARY KEY (id),
  KEY idx_shift_rows_schedule (schedule_id, urut),
  CONSTRAINT fk_shift_rows_schedule FOREIGN KEY (schedule_id) REFERENCES shift_schedules (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Link spreadsheet jadwal (bisa diganti dari menu Jadwal Shift)
INSERT IGNORE INTO app_settings (`key`, value) VALUES
  ('jadwal_shift.sheet_url', 'https://docs.google.com/spreadsheets/d/1ABcIFeHNp5mADq5alUREayfEUg3vFWZB/edit?usp=drive_link&ouid=116992751279000154130&rtpof=true&sd=true');

-- Menu Jadwal Shift: Produksi, PPIC, Teknik, HRD, GM (admin otomatis semua menu)
INSERT IGNORE INTO division_menus (division_id, menu_key)
SELECT d.id, 'jadwal-shift' FROM divisions d WHERE d.code IN ('produksi', 'ppic', 'teknik', 'hrd', 'general_manager');
