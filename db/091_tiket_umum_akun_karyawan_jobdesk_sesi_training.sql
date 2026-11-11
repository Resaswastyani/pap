-- 1. Tiket kendala: selain kendala sistem SIMPAP, juga kendala IT umum (laptop/komputer, jaringan, printer, email, dll.)
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS jenis ENUM('sistem','umum') NOT NULL DEFAULT 'sistem' AFTER judul;
ALTER TABLE tickets MODIFY kategori ENUM('error','akses','data','permintaan','perangkat','jaringan','printer','email','software','lainnya') NOT NULL DEFAULT 'error';
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS lokasi VARCHAR(150) NULL AFTER modul;   -- kendala umum: perangkat / ruangan

-- 2. Akun login <-> data karyawan (Izin & Cuti: pengguna biasa hanya mengajukan untuk dirinya sendiri)
ALTER TABLE users ADD COLUMN IF NOT EXISTS employee_nip VARCHAR(30) NULL AFTER division_id;
-- Hubungkan otomatis bila email sama, atau nama persis sama dan hanya satu karyawan dengan nama itu
UPDATE users u JOIN employees e ON e.email IS NOT NULL AND e.email <> '' AND LOWER(e.email) = LOWER(u.email)
SET u.employee_nip = e.nip WHERE u.employee_nip IS NULL;
UPDATE users u
JOIN (SELECT LOWER(TRIM(nama)) AS n, MIN(nip) AS nip FROM employees WHERE tgl_berhenti IS NULL GROUP BY LOWER(TRIM(nama)) HAVING COUNT(*) = 1) e ON e.n = LOWER(TRIM(u.name))
SET u.employee_nip = e.nip WHERE u.employee_nip IS NULL;

-- 3. Jobdesk: kategori jabatan (Operator, Staff, Kepala, ...) dan bagian / divisi
ALTER TABLE job_descriptions ADD COLUMN IF NOT EXISTS kategori VARCHAR(40) NULL AFTER jabatan;
ALTER TABLE job_descriptions ADD COLUMN IF NOT EXISTS bagian VARCHAR(100) NULL AFTER kategori;

-- 4. Jadwal training dikelola di SIMPAP (sesi + peserta); bisa diimpor dari spreadsheet jadwal
CREATE TABLE IF NOT EXISTS training_sessions (
  id           INT UNSIGNED NOT NULL AUTO_INCREMENT,
  judul        VARCHAR(200) NOT NULL,                -- materi / nama training
  batch        VARCHAR(60)  NULL,
  tanggal      DATE         NOT NULL,
  jam_mulai    VARCHAR(5)   NULL,                    -- 13:00
  jam_selesai  VARCHAR(5)   NULL,
  tempat       VARCHAR(150) NULL,
  pemateri     VARCHAR(200) NULL,
  catatan      VARCHAR(1000) NULL,
  status       ENUM('terjadwal','selesai','batal') NOT NULL DEFAULT 'terjadwal',
  created_by   INT UNSIGNED NULL,
  created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_training_sessions_tanggal (tanggal),
  CONSTRAINT fk_training_sessions_user FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS training_session_participants (
  id           INT UNSIGNED NOT NULL AUTO_INCREMENT,
  session_id   INT UNSIGNED NOT NULL,
  nama         VARCHAR(150) NOT NULL,
  employee_id  INT UNSIGNED NULL,
  kehadiran    ENUM('terdaftar','hadir','tidak_hadir') NOT NULL DEFAULT 'terdaftar',
  PRIMARY KEY (id),
  KEY idx_tsp_session (session_id),
  CONSTRAINT fk_tsp_session FOREIGN KEY (session_id) REFERENCES training_sessions (id) ON DELETE CASCADE,
  CONSTRAINT fk_tsp_employee FOREIGN KEY (employee_id) REFERENCES employees (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
