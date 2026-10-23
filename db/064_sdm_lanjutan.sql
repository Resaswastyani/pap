-- SDM lanjutan (Guidance HR): izin / cuti / dayoff dengan persetujuan, KPI & performa karyawan, laporan BPJS, perizinan perusahaan.

-- Pengajuan izin / cuti / dayoff. Setelah disetujui, tanggalnya ditandai di Absensi (attendance_days.leave_id)
-- sehingga ikut dihitung di gaji (cuti diuangkan) dan laporan kehadiran.
CREATE TABLE IF NOT EXISTS leave_requests (
  id               INT UNSIGNED NOT NULL AUTO_INCREMENT,
  nomor            VARCHAR(30)  NOT NULL,                     -- IZ/YYYY/MM/NNNN
  nip              VARCHAR(30)  NOT NULL,
  nama             VARCHAR(150) NOT NULL,
  divisi           VARCHAR(100) NULL,
  jenis            ENUM('cuti','izin','sakit','dayoff','dinas','cuti_khusus') NOT NULL,
  tanggal_mulai    DATE         NOT NULL,
  tanggal_selesai  DATE         NOT NULL,
  hari             DECIMAL(4,1) NOT NULL,
  alasan           VARCHAR(1000) NULL,
  lampiran_url     VARCHAR(500) NULL,                         -- surat dokter / bukti (link Drive)
  status           ENUM('diajukan','disetujui','ditolak','dibatalkan') NOT NULL DEFAULT 'diajukan',
  catatan_approval VARCHAR(500) NULL,
  approved_by      INT UNSIGNED NULL,
  approved_at      DATETIME     NULL,
  created_by       INT UNSIGNED NOT NULL,
  created_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_leave_nomor (nomor),
  KEY idx_leave_nip (nip, tanggal_mulai),
  KEY idx_leave_status (status, tanggal_mulai)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE attendance_days ADD COLUMN IF NOT EXISTS leave_id INT UNSIGNED NULL AFTER keterangan, ADD KEY IF NOT EXISTS idx_attendance_leave (leave_id);

-- KPI karyawan per bulan: indikator otomatis (kehadiran, ketepatan waktu, grade operator) dihitung saat dibuka;
-- yang disimpan di sini penilaian atasan (1-5) dan tindak lanjut / pembinaan.
CREATE TABLE IF NOT EXISTS employee_kpis (
  id               INT UNSIGNED NOT NULL AUTO_INCREMENT,
  periode          CHAR(7)      NOT NULL,                     -- YYYY-MM
  nip              VARCHAR(30)  NOT NULL,
  nama             VARCHAR(150) NOT NULL,
  nilai            JSON         NOT NULL,                     -- { produktivitas, kualitas, sikap } skala 1-5
  catatan          VARCHAR(1000) NULL,
  tindak_lanjut    VARCHAR(1000) NULL,
  updated_by       INT UNSIGNED NULL,
  updated_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_employee_kpi (periode, nip)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Perizinan & legalitas perusahaan (NIB, izin lingkungan, sertifikat, dsb.) dengan masa berlaku
CREATE TABLE IF NOT EXISTS company_permits (
  id               INT UNSIGNED NOT NULL AUTO_INCREMENT,
  nama             VARCHAR(200) NOT NULL,
  kategori         VARCHAR(80)  NULL,
  nomor            VARCHAR(120) NULL,
  instansi         VARCHAR(200) NULL,
  tanggal_terbit   DATE         NULL,
  berlaku_sampai   DATE         NULL,                         -- kosong = berlaku selamanya
  pengingat_hari   SMALLINT UNSIGNED NOT NULL DEFAULT 60,
  pic              VARCHAR(150) NULL,
  file_url         VARCHAR(500) NULL,
  catatan          VARCHAR(1000) NULL,
  created_by       INT UNSIGNED NULL,
  updated_by       INT UNSIGNED NULL,
  created_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_permit_berlaku (berlaku_sampai)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO app_settings (`key`, value) VALUES ('hrd.jatah_cuti', '12');

-- Izin & Cuti: semua divisi bisa mengajukan (untuk diri sendiri / anggota tim); HRD & GM menyetujui
INSERT IGNORE INTO division_menus (division_id, menu_key) SELECT d.id, 'izin-cuti' FROM divisions d;
INSERT IGNORE INTO division_menus (division_id, menu_key)
SELECT d.id, m.menu_key FROM divisions d
JOIN (SELECT 'kpi-karyawan' AS menu_key UNION ALL SELECT 'bpjs' UNION ALL SELECT 'perizinan') m
WHERE d.code IN ('hrd', 'general_manager');
INSERT IGNORE INTO division_menus (division_id, menu_key) SELECT d.id, 'kpi-karyawan' FROM divisions d WHERE d.code IN ('produksi', 'ppic');
INSERT IGNORE INTO division_menus (division_id, menu_key) SELECT d.id, 'bpjs' FROM divisions d WHERE d.code = 'accounting';
INSERT IGNORE INTO division_menus (division_id, menu_key) SELECT d.id, 'perizinan' FROM divisions d WHERE d.code IN ('general_affair', 'accounting');
