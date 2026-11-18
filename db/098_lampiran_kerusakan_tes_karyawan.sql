-- 1. Lampiran (file, link, foto / video) laporan kerusakan mesin.
--    Baris rekap dibuat ulang setiap sinkron spreadsheet (id berubah), jadi lampiran diikat ke kunci tetap:
--    "no:<no laporan>#<urutan>" untuk baris spreadsheet, "app:<id>" untuk isian form yang belum masuk spreadsheet.
--    damage_attachment_refs.id dipakai sebagai owner_id lampiran (note_attachments, owner_type 'damage_log').
ALTER TABLE machine_damage_logs
  ADD COLUMN IF NOT EXISTS ref_key VARCHAR(190) NULL,
  ADD INDEX IF NOT EXISTS idx_damage_ref_key (ref_key);

CREATE TABLE IF NOT EXISTS damage_attachment_refs (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  ref_key     VARCHAR(190) NOT NULL,
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_damage_ref_key (ref_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. Hasil tes karyawan (Papikostik, IQ, tes mata) — terpisah dari data karyawan agar tidak tertimpa sinkron spreadsheet
CREATE TABLE IF NOT EXISTS employee_tests (
  id           INT UNSIGNED NOT NULL AUTO_INCREMENT,
  employee_id  INT UNSIGNED NOT NULL,
  jenis        ENUM('papikostik','iq','mata') NOT NULL,
  tanggal      DATE         NULL,
  hasil        VARCHAR(255) NOT NULL,                 -- mis. "Normal", "Skor 110 (Rata-rata)", ringkasan profil
  skor         DECIMAL(6,2) NULL,                     -- angka IQ bila ada
  catatan      VARCHAR(1000) NULL,
  lampiran_url VARCHAR(500) NULL,                     -- link hasil tes (Google Drive)
  created_by   INT UNSIGNED NULL,
  created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_employee_tests_employee (employee_id, jenis),
  CONSTRAINT fk_employee_tests_employee FOREIGN KEY (employee_id) REFERENCES employees (id) ON DELETE CASCADE,
  CONSTRAINT fk_employee_tests_user FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
