-- PAP-MS Grade & Gaji: pengaturan payroll (seperti "Pengaturan Payroll" di HRIS Altius) dan pengaturan gaji per karyawan
-- (seperti isian "Payroll" pada data Pegawai di Altius), lalu dipakai menghitung gaji per periode cut off dari Absensi.
-- Disimpan di PAP-MS (bukan spreadsheet). Gaji per karyawan diisi awal dari Data Karyawan (NPWP, BPJS, rekening, status pajak)
-- dan tab kebijakan gaji spreadsheet (upah harian, tarif per jam, lembur, tunjangan); setelah itu dikelola HRD.

CREATE TABLE IF NOT EXISTS payroll_settings (
  id                   TINYINT UNSIGNED NOT NULL,
  -- Rate BPJS perusahaan (%)
  bpjs_kes_perusahaan  DECIMAL(6,3) NOT NULL DEFAULT 4,
  bpjs_jht_perusahaan  DECIMAL(6,3) NOT NULL DEFAULT 3.7,
  bpjs_jkk             DECIMAL(6,3) NOT NULL DEFAULT 0.24,
  bpjs_jkm             DECIMAL(6,3) NOT NULL DEFAULT 0.3,
  bpjs_jpn_perusahaan  DECIMAL(6,3) NOT NULL DEFAULT 2,
  usia_pensiun         TINYINT UNSIGNED NOT NULL DEFAULT 58,
  -- Rate BPJS pegawai (%)
  bpjs_kes_pegawai     DECIMAL(6,3) NOT NULL DEFAULT 1,
  bpjs_jht_pegawai     DECIMAL(6,3) NOT NULL DEFAULT 2,
  bpjs_jpn_pegawai     DECIMAL(6,3) NOT NULL DEFAULT 1,
  -- Maksimum nilai yang diperhitungkan (Rp)
  max_bpjs_kes         DECIMAL(14,2) NOT NULL DEFAULT 12000000,
  max_bpjs_jpn         DECIMAL(14,2) NOT NULL DEFAULT 9559600,
  -- UMR
  umr                  DECIMAL(14,2) NOT NULL DEFAULT 0,
  lembur_umr           TINYINT(1)   NOT NULL DEFAULT 0,      -- dasar lembur = UMR bila nilai pokok lembur kosong
  -- Cut off
  cutoff_tanggal       TINYINT UNSIGNED NOT NULL DEFAULT 27,  -- periode = tanggal (cut off + 1) bulan lalu s/d tanggal cut off
  cutoff_mingguan      VARCHAR(10)  NULL,                     -- hari cut off untuk gaji mingguan (kosong = tidak ada)
  prorata              VARCHAR(20)  NOT NULL DEFAULT 'bulan_berjalan', -- bulan_berjalan / hari_kerja_fix / tidak
  hari_kerja_fix       TINYINT UNSIGNED NOT NULL DEFAULT 0,
  -- Pajak
  metode_pajak         VARCHAR(20)  NOT NULL DEFAULT 'non_gross_up', -- non_gross_up / gross_up
  updated_by           INT UNSIGNED NULL,
  updated_at           DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  CONSTRAINT fk_payroll_settings_user FOREIGN KEY (updated_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Nilai dari Pengaturan Payroll Altius PT PAP
INSERT IGNORE INTO payroll_settings (id, bpjs_kes_perusahaan, bpjs_jht_perusahaan, bpjs_jkk, bpjs_jkm, bpjs_jpn_perusahaan, usia_pensiun,
  bpjs_kes_pegawai, bpjs_jht_pegawai, bpjs_jpn_pegawai, max_bpjs_kes, max_bpjs_jpn, umr, lembur_umr, cutoff_tanggal, cutoff_mingguan, prorata, hari_kerja_fix, metode_pajak)
VALUES (1, 4, 3.7, 0.24, 0.3, 2, 99, 1, 2, 1, 12000000, 9559600, 2138247, 0, 27, NULL, 'bulan_berjalan', 0, 'non_gross_up');

-- Pengaturan gaji per karyawan (kunci NIP, karena Data Karyawan disinkron ulang dari spreadsheet)
CREATE TABLE IF NOT EXISTS employee_payrolls (
  id                   INT UNSIGNED NOT NULL AUTO_INCREMENT,
  nip                  VARCHAR(30)  NOT NULL,
  tanggal_berlaku      DATE         NULL,
  gaji_pokok           DECIMAL(14,2) NOT NULL DEFAULT 0,      -- per bulan
  gaji_harian          DECIMAL(14,2) NULL,
  gaji_per_jam_aktif   TINYINT(1)   NOT NULL DEFAULT 0,
  gaji_per_jam         DECIMAL(14,2) NULL,
  fix_hari_kerja       TINYINT UNSIGNED NULL,
  tunjangan_lain       DECIMAL(14,2) NOT NULL DEFAULT 0,      -- per bulan
  pendapatan_lain      DECIMAL(14,2) NOT NULL DEFAULT 0,      -- per bulan
  potongan_lain        DECIMAL(14,2) NOT NULL DEFAULT 0,      -- per bulan
  pendapatan_harian    DECIMAL(14,2) NOT NULL DEFAULT 0,      -- per hari hadir (uang makan / transport)
  tipe_kalkulasi       VARCHAR(30)  NOT NULL DEFAULT 'kehadiran_cutoff', -- kehadiran_cutoff / bulanan_tetap
  lembur_per_jam       DECIMAL(14,2) NULL,
  lembur_per_jam_libur DECIMAL(14,2) NULL,
  pokok_lembur         DECIMAL(14,2) NULL,                    -- dasar hitung lembur bila tarif per jam kosong
  cuti_diuangkan       DECIMAL(14,2) NOT NULL DEFAULT 0,      -- per hari cuti
  no_bpjs_tk           VARCHAR(40)  NULL,
  nilai_bpjs_tk        DECIMAL(14,2) NULL,                    -- upah dasar BPJS Ketenagakerjaan
  bpjs_tk_ditanggung   VARCHAR(12)  NOT NULL DEFAULT 'pegawai', -- pegawai / perusahaan
  no_bpjs_kes          VARCHAR(40)  NULL,
  nilai_bpjs_kes       DECIMAL(14,2) NULL,                    -- upah dasar BPJS Kesehatan
  bpjs_kes_ditanggung  VARCHAR(12)  NOT NULL DEFAULT 'pegawai',
  npwp                 VARCHAR(40)  NULL,
  status_ptkp          VARCHAR(10)  NULL,                     -- TK/0 ... K/3
  metode_pajak         VARCHAR(20)  NULL,                     -- kosong = ikut pengaturan payroll
  bank                 VARCHAR(80)  NULL,
  no_rekening          VARCHAR(60)  NULL,
  nama_pemilik         VARCHAR(150) NULL,
  updated_by           INT UNSIGNED NULL,
  updated_at           DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_employee_payrolls_nip (nip),
  CONSTRAINT fk_employee_payrolls_user FOREIGN KEY (updated_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
