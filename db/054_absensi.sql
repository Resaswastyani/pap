-- PAP-MS Absensi (Guidance HR: "mendata absensi seluruh karyawan", "absensi terintegrasi dengan perhitungan gaji operator").
-- Sumber: laporan kehadiran HRIS Altius (data mesin Fingerspot), diekspor ke Excel lalu disinkron dari Google Drive
-- atau diunggah langsung. Satu baris per karyawan per tanggal; ekspor ulang rentang yang sama memperbarui baris.

CREATE TABLE IF NOT EXISTS attendance_days (
  id               INT UNSIGNED NOT NULL AUTO_INCREMENT,
  nip              VARCHAR(30)  NOT NULL,
  nama             VARCHAR(150) NOT NULL,
  nama_key         VARCHAR(150) NOT NULL,
  tanggal          DATE         NOT NULL,
  shift            VARCHAR(60)  NULL,
  jadwal_masuk     TIME         NULL,
  jadwal_pulang    TIME         NULL,
  jam_masuk        TIME         NULL,
  jam_pulang       TIME         NULL,
  scan             SMALLINT UNSIGNED NULL,           -- jumlah scan (format log)
  status           VARCHAR(20)  NOT NULL,           -- hadir / terlambat / tidak_hadir / izin / sakit / cuti / libur / dinas / tanpa_scan
  status_asli      VARCHAR(60)  NULL,               -- tulisan status di laporan Altius
  keterangan       VARCHAR(500) NULL,
  terlambat_menit  SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  pulang_cepat_menit SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  lembur_menit     SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  sumber           ENUM('drive','upload') NOT NULL DEFAULT 'drive',
  updated_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_attendance (nip, tanggal),
  KEY idx_attendance_tanggal (tanggal, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO app_settings (`key`, value) VALUES ('hrd.absensi_sheet_url', '');
