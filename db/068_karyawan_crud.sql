-- Karyawan bisa ditambah, diubah, dan dihapus HRD di PAP-MS (form Data Diri, Pekerjaan, Payroll seperti HRIS Altius).
-- Karyawan yang ditambah / diubah di PAP-MS ditandai sumber = 'pap' sehingga sinkron spreadsheet Data Karyawan tidak
-- menimpa atau menghapusnya; NIP yang dihapus di PAP-MS dicatat di employee_deletions agar tidak muncul lagi saat sinkron.
ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS nama_depan        VARCHAR(100) NULL AFTER nama,
  ADD COLUMN IF NOT EXISTS nama_belakang     VARCHAR(100) NULL AFTER nama_depan,
  ADD COLUMN IF NOT EXISTS golongan_darah    VARCHAR(5)   NULL AFTER tgl_lahir,
  ADD COLUMN IF NOT EXISTS tipe_id           VARCHAR(20)  NULL AFTER id_finger,          -- KTP / SIM / Paspor
  ADD COLUMN IF NOT EXISTS tgl_akhir_id      DATE         NULL AFTER no_id,
  ADD COLUMN IF NOT EXISTS kode_pos          VARCHAR(10)  NULL AFTER alamat_tinggal,
  ADD COLUMN IF NOT EXISTS kontak_darurat    VARCHAR(150) NULL AFTER jumlah_anak,
  ADD COLUMN IF NOT EXISTS hp_darurat        VARCHAR(40)  NULL AFTER kontak_darurat,
  ADD COLUMN IF NOT EXISTS tgl_akhir_kontrak DATE         NULL AFTER tgl_akhir_percobaan,
  ADD COLUMN IF NOT EXISTS sumber            ENUM('sheet','pap') NOT NULL DEFAULT 'sheet' AFTER sheet_row,
  ADD COLUMN IF NOT EXISTS diubah_oleh       INT UNSIGNED NULL AFTER sumber,
  ADD COLUMN IF NOT EXISTS diubah_pada       DATETIME     NULL AFTER diubah_oleh;

CREATE TABLE IF NOT EXISTS employee_deletions (
  nip         VARCHAR(30)  NOT NULL,
  nama        VARCHAR(150) NOT NULL,
  deleted_by  INT UNSIGNED NULL,
  deleted_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (nip)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
