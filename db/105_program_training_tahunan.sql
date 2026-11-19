-- Program Training Tahunan (menu Training > Program Tahunan): rencana training per tahun untuk Staff dan Produksi,
-- realisasinya dari sesi Jadwal Training yang dihubungkan ke program (training_sessions.program_id).
CREATE TABLE IF NOT EXISTS training_programs (
  id               INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  kode             VARCHAR(30)   NOT NULL,                       -- TP-2026-001
  tahun            SMALLINT UNSIGNED NOT NULL,
  nama             VARCHAR(200)  NOT NULL,
  kategori         VARCHAR(80)   NULL,                           -- K3, Mesin, Mutu / QC, Soft skill, ...
  jenis            VARCHAR(40)   NOT NULL DEFAULT 'wajib',       -- wajib, pengembangan, sertifikasi, penyegaran, induksi
  kelompok         ENUM('staff','produksi','semua') NOT NULL DEFAULT 'semua',
  divisi           VARCHAR(500)  NULL,                           -- sasaran divisi, dipisah koma (kosong = semua di kelompok)
  tujuan           TEXT          NULL,
  bulan            VARCHAR(40)   NULL,                           -- bulan pelaksanaan "1,4,7,10"
  frekuensi        VARCHAR(30)   NULL,                           -- sekali, bulanan, triwulan, semester, tahunan
  durasi_jam       DECIMAL(6,1)  NULL,
  metode           VARCHAR(30)   NULL,                           -- internal, eksternal, online, on_the_job
  penyelenggara    VARCHAR(200)  NULL,                           -- pemateri / lembaga
  target_peserta   INT UNSIGNED  NULL,
  anggaran         DECIMAL(15,2) NULL,
  realisasi_biaya  DECIMAL(15,2) NULL,
  indikator        VARCHAR(500)  NULL,                           -- indikator keberhasilan
  status           ENUM('rencana','berjalan','selesai','ditunda','batal') NOT NULL DEFAULT 'rencana',
  module_id        INT UNSIGNED  NULL,                           -- modul materi terkait
  catatan          TEXT          NULL,
  created_by       INT UNSIGNED  NULL,
  updated_by       INT UNSIGNED  NULL,
  created_at       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_training_programs_kode (kode),
  KEY idx_training_programs_tahun (tahun, kelompok, status),
  CONSTRAINT fk_training_programs_module FOREIGN KEY (module_id) REFERENCES training_modules (id) ON DELETE SET NULL,
  CONSTRAINT fk_training_programs_created FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT fk_training_programs_updated FOREIGN KEY (updated_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE training_sessions ADD COLUMN IF NOT EXISTS program_id INT UNSIGNED NULL AFTER status,
  ADD INDEX IF NOT EXISTS idx_training_sessions_program (program_id);
ALTER TABLE training_sessions ADD CONSTRAINT fk_training_sessions_program FOREIGN KEY IF NOT EXISTS (program_id) REFERENCES training_programs (id) ON DELETE SET NULL;
