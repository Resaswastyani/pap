-- PAP-MS Lembur & Slip Gaji (seperti slip Altius PT PAP):
--   - Lembur Rutin   : kelebihan jam kerja di atas 40 jam per minggu (1 hari = 7 jam, 6 hari = 42 jam -> 2 jam lembur rutin)
--   - Lembur Variabel: otomatis dari absensi (jam di luar shift 8 jam, atau bekerja di hari libur rutin) + input manual HRD
--   Minggu dihitung mulai hari libur rutin karyawan (dari Jadwal Shift), dalam periode cut off.

ALTER TABLE payroll_settings
  ADD COLUMN IF NOT EXISTS jam_kerja_harian      DECIMAL(4,2) NOT NULL DEFAULT 7    AFTER hari_kerja_fix,
  ADD COLUMN IF NOT EXISTS istirahat_jam         DECIMAL(4,2) NOT NULL DEFAULT 1    AFTER jam_kerja_harian,
  ADD COLUMN IF NOT EXISTS batas_jam_mingguan    DECIMAL(5,2) NOT NULL DEFAULT 40   AFTER istirahat_jam,
  ADD COLUMN IF NOT EXISTS faktor_lembur         DECIMAL(4,2) NOT NULL DEFAULT 1.2  AFTER batas_jam_mingguan,
  ADD COLUMN IF NOT EXISTS faktor_lembur_libur   DECIMAL(4,2) NOT NULL DEFAULT 1.5  AFTER faktor_lembur,
  ADD COLUMN IF NOT EXISTS toleransi_lembur_menit SMALLINT UNSIGNED NOT NULL DEFAULT 15 AFTER faktor_lembur_libur;

-- Lembur variabel input manual HRD (tambahan, atau mengganti lembur otomatis di tanggal itu)
CREATE TABLE IF NOT EXISTS overtime_entries (
  id          INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  nip         VARCHAR(30)   NOT NULL,
  tanggal     DATE          NOT NULL,
  jam         DECIMAL(5,2)  NOT NULL,
  hari        ENUM('kerja','libur') NOT NULL DEFAULT 'kerja',   -- tarif lembur hari kerja / hari libur
  mode        ENUM('tambah','ganti') NOT NULL DEFAULT 'tambah', -- ganti = lembur otomatis tanggal itu diabaikan
  keterangan  VARCHAR(500)  NULL,
  created_by  INT UNSIGNED  NULL,
  created_at  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_overtime_nip (nip, tanggal),
  KEY idx_overtime_tanggal (tanggal),
  CONSTRAINT fk_overtime_user FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
