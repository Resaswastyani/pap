-- PAP-MS HRD (Guidance Human Resource): data karyawan, grade operator, dan kebijakan gaji dari Google Drive.
--   - Data Karyawan  : spreadsheet "Data_Karyawan" (ekspor sistem HR) -> employees
--   - Grade & Gaji   : spreadsheet "Data Grade dan Kenaikan Gaji"
--       tab "Draft Grade"           -> employee_grades (nilai teknis mesin & QC product dari tiap kepala shift)
--       tab "Kebijakan UMK ..."     -> employee_salaries (upah harian, grade, kenaikan, tunjangan, BPJS, THR, tarif per jam & lembur)
-- Data diganti dengan isi spreadsheet setiap sinkron (Drive = sumber utama). Data pribadi hanya ditampilkan ke HRD / GM / admin.

CREATE TABLE IF NOT EXISTS employees (
  id               INT UNSIGNED NOT NULL AUTO_INCREMENT,
  nip              VARCHAR(30)  NOT NULL,
  nama             VARCHAR(150) NOT NULL,
  nama_key         VARCHAR(150) NOT NULL,          -- nama huruf kecil tanpa tanda baca (pencocokan dengan sheet grade / gaji)
  email            VARCHAR(255) NULL,
  handphone        VARCHAR(40)  NULL,
  jenis_kelamin    VARCHAR(20)  NULL,
  tempat_lahir     VARCHAR(100) NULL,
  tgl_lahir        DATE         NULL,
  agama            VARCHAR(30)  NULL,
  status_menikah   VARCHAR(30)  NULL,
  pendidikan       VARCHAR(150) NULL,
  tgl_masuk        DATE         NULL,
  departemen       VARCHAR(100) NULL,
  divisi           VARCHAR(100) NULL,
  jabatan          VARCHAR(100) NULL,
  level_posisi     VARCHAR(60)  NULL,
  status_karyawan  VARCHAR(40)  NULL,              -- Tetap / Kontrak / Masa Percobaan / Resign
  tgl_akhir_percobaan DATE      NULL,
  tgl_berhenti     DATE         NULL,
  nip_atasan       VARCHAR(30)  NULL,
  nama_atasan      VARCHAR(150) NULL,
  masa_kerja       VARCHAR(80)  NULL,
  hari_kerja       VARCHAR(80)  NULL,
  id_finger        VARCHAR(40)  NULL,
  -- data pribadi
  no_id            VARCHAR(40)  NULL,
  alamat_id        TEXT         NULL,
  alamat_tinggal   TEXT         NULL,
  no_bpjs_tk       VARCHAR(40)  NULL,
  no_bpjs_kes      VARCHAR(40)  NULL,
  npwp             VARCHAR(40)  NULL,
  bank             VARCHAR(80)  NULL,
  no_rek           VARCHAR(60)  NULL,
  rek_an           VARCHAR(150) NULL,
  status_pajak     VARCHAR(30)  NULL,
  nama_ibu         VARCHAR(150) NULL,
  jumlah_anak      TINYINT UNSIGNED NULL,
  sheet_row        INT UNSIGNED NULL,
  synced_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_employees_nip (nip),
  KEY idx_employees_nama (nama_key),
  KEY idx_employees_status (status_karyawan, divisi)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS employee_grades (
  id               INT UNSIGNED NOT NULL AUTO_INCREMENT,
  no               SMALLINT UNSIGNED NULL,
  nama             VARCHAR(150) NOT NULL,
  nama_key         VARCHAR(150) NOT NULL,
  skor             JSON         NOT NULL,           -- [{ penilai, teknis, qc, total }]
  rata_rata        DECIMAL(6,2) NULL,
  grade            VARCHAR(5)   NULL,
  sheet_row        INT UNSIGNED NULL,
  PRIMARY KEY (id),
  KEY idx_employee_grades_nama (nama_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS employee_salaries (
  id               INT UNSIGNED NOT NULL AUTO_INCREMENT,
  no               SMALLINT UNSIGNED NULL,
  nama             VARCHAR(150) NOT NULL,
  nama_key         VARCHAR(150) NOT NULL,
  no_rek_cimb      VARCHAR(60)  NULL,
  no_rek_lain      VARCHAR(150) NULL,
  upah_harian      DECIMAL(14,2) NULL,              -- upah 7 jam kerja
  grade            VARCHAR(5)   NULL,
  nominal_grade    DECIMAL(14,2) NULL,
  upah_harian_total DECIMAL(14,2) NULL,             -- 7 jam kerja + tunjangan grade
  upah_bulanan     DECIMAL(14,2) NULL,              -- upah 25 hari kerja
  kenaikan_harian  DECIMAL(14,2) NULL,
  kenaikan_bulanan DECIMAL(14,2) NULL,
  kenaikan_persen  DECIMAL(6,2) NULL,
  tunjangan        DECIMAL(14,2) NULL,
  total_terima     DECIMAL(14,2) NULL,
  bpjs_laka        DECIMAL(14,2) NULL,
  bpjs_kematian    DECIMAL(14,2) NULL,
  bpjs_kesehatan   DECIMAL(14,2) NULL,
  thr              DECIMAL(14,2) NULL,
  total_bpjs_thr   DECIMAL(14,2) NULL,
  tanpa_thr        DECIMAL(14,2) NULL,
  tarif_jam        DECIMAL(12,2) NULL,
  lembur_jam       DECIMAL(12,2) NULL,
  lembur_libur_jam DECIMAL(12,2) NULL,
  sheet_row        INT UNSIGNED NULL,
  PRIMARY KEY (id),
  KEY idx_employee_salaries_nama (nama_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO app_settings (`key`, value) VALUES
  ('hrd.karyawan_sheet_url', 'https://docs.google.com/spreadsheets/d/12lOqggdzYmHfRWVHXcs5eTdY09jyCUVc/edit?usp=sharing&ouid=117889372015070172180&rtpof=true&sd=true'),
  ('hrd.grade_sheet_url', 'https://docs.google.com/spreadsheets/d/17A6RvfIBhWNHhactFE0v8TStUZ-pXy87xnf3001PfEQ/edit?usp=sharing');

-- Menu Grade & Gaji: HRD, GM, Accounting (penggajian)
INSERT IGNORE INTO division_menus (division_id, menu_key)
SELECT d.id, m.menu_key FROM divisions d JOIN (
  SELECT 'hrd' AS code, 'grade-gaji' AS menu_key UNION ALL SELECT 'general_manager', 'grade-gaji' UNION ALL SELECT 'accounting', 'grade-gaji'
) AS m ON m.code = d.code;
