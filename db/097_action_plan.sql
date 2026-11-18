-- Action Plan (Corporate Plan): Program Kerja, PIC/support (akun SIMPAP), Progress Report, Issue Log, KPI Plan Monitoring.
-- Sumber: template "Plan Monitoring Program Kerja" (Google Sheet, sinkron dua arah; link di app_settings actionplan.sheet_url).
CREATE TABLE IF NOT EXISTS action_programs (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  kode          VARCHAR(20)  NOT NULL,
  nama          VARCHAR(255) NOT NULL,
  jenis         VARCHAR(60)  NULL,
  divisi        VARCHAR(80)  NULL,
  tujuan        TEXT         NULL,
  target        VARCHAR(500) NULL,
  pic_text      VARCHAR(255) NULL,
  support_text  VARCHAR(255) NULL,
  start_date    DATE         NULL,
  end_date      DATE         NULL,
  start_text    VARCHAR(60)  NULL,  -- teks asli di sheet bila bukan tanggal (mis. "Mid 2027")
  end_text      VARCHAR(60)  NULL,
  priority      VARCHAR(20)  NULL,
  status        VARCHAR(30)  NOT NULL DEFAULT 'Not Started',
  progress      TINYINT UNSIGNED NOT NULL DEFAULT 0,
  catatan       TEXT         NULL,
  prev_status   VARCHAR(30)  NULL,  -- status sebelum dibatalkan (dipakai saat diaktifkan kembali)
  cancel_reason VARCHAR(500) NULL,
  cancelled_at  DATETIME     NULL,
  cancelled_by  INT UNSIGNED NULL,
  created_by    INT UNSIGNED NULL,
  updated_by    INT UNSIGNED NULL,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_action_programs_kode (kode),
  KEY idx_action_programs_status (status),
  KEY idx_action_programs_end (end_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Akun SIMPAP yang menjadi PIC / support program (dipilih admin); PIC & support boleh update progress
CREATE TABLE IF NOT EXISTS action_program_users (
  program_id INT UNSIGNED NOT NULL,
  user_id    INT UNSIGNED NOT NULL,
  peran      ENUM('pic','support') NOT NULL DEFAULT 'pic',
  PRIMARY KEY (program_id, user_id),
  KEY idx_action_program_users_user (user_id),
  CONSTRAINT fk_apu_program FOREIGN KEY (program_id) REFERENCES action_programs (id) ON DELETE CASCADE,
  CONSTRAINT fk_apu_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Progress Report: riwayat update progress (dari SIMPAP atau sheet). Juga mencatat pembatalan / aktif kembali.
CREATE TABLE IF NOT EXISTS action_progress (
  id              INT UNSIGNED NOT NULL AUTO_INCREMENT,
  program_id      INT UNSIGNED NULL,
  program_kode    VARCHAR(20)  NULL,
  tanggal         DATE         NOT NULL,
  task            VARCHAR(500) NOT NULL,
  divisi          VARCHAR(80)  NULL,
  pic_text        VARCHAR(255) NULL,
  status          VARCHAR(30)  NULL,
  progress_before TINYINT UNSIGNED NULL,
  progress_after  TINYINT UNSIGNED NULL,
  kendala         TEXT         NULL,
  next_action     TEXT         NULL,
  next_deadline   DATE         NULL,
  evidence        VARCHAR(1000) NULL,
  jenis           ENUM('update','batal','aktif','sheet') NOT NULL DEFAULT 'update',
  user_id         INT UNSIGNED NULL,
  created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_action_progress_program (program_id, tanggal),
  KEY idx_action_progress_kode (program_kode),
  CONSTRAINT fk_action_progress_program FOREIGN KEY (program_id) REFERENCES action_programs (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Issue Log & Bottleneck Register
CREATE TABLE IF NOT EXISTS action_issues (
  id           INT UNSIGNED NOT NULL AUTO_INCREMENT,
  program_id   INT UNSIGNED NULL,
  program_kode VARCHAR(20)  NULL,
  tanggal      DATE         NOT NULL,
  issue        TEXT         NOT NULL,
  dampak       TEXT         NULL,
  severity     VARCHAR(20)  NULL,
  pic_text     VARCHAR(255) NULL,
  target_date  DATE         NULL,
  status       VARCHAR(30)  NOT NULL DEFAULT 'On Progress',
  akar_masalah TEXT         NULL,
  mitigasi     TEXT         NULL,
  catatan      TEXT         NULL,
  sheet_row    INT UNSIGNED NULL,
  created_by   INT UNSIGNED NULL,
  updated_by   INT UNSIGNED NULL,
  created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_action_issues_program (program_id),
  CONSTRAINT fk_action_issues_program FOREIGN KEY (program_id) REFERENCES action_programs (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- KPI Plan Monitoring: realisasi KPI berkode otomatis dihitung dari data program; sisanya diisi admin
CREATE TABLE IF NOT EXISTS action_kpis (
  id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  urutan     SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  nama       VARCHAR(120) NOT NULL,
  definisi   VARCHAR(500) NULL,
  target     VARCHAR(60)  NULL,
  realisasi  VARCHAR(60)  NULL,
  status     VARCHAR(30)  NULL,
  frekuensi  VARCHAR(30)  NULL,
  pic_text   VARCHAR(120) NULL,
  catatan    VARCHAR(500) NULL,
  auto_key   VARCHAR(30)  NULL,
  updated_by INT UNSIGNED NULL,
  updated_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_action_kpis_nama (nama)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO action_kpis (urutan, nama, definisi, target, frekuensi, pic_text, auto_key) VALUES
  (1, 'Dashboard Update', 'Dashboard action plan diupdate sesuai jadwal', '100%', 'Harian', 'Plan Monitoring', NULL),
  (2, 'Task Completion Rate', 'Persentase task selesai dibanding total task', '≥85%', 'Mingguan', 'Plan Monitoring', 'completion'),
  (3, 'Overdue Rate', 'Persentase task terlambat dibanding total task', '≤15%', 'Mingguan', 'Plan Monitoring', 'overdue'),
  (4, 'Task Tanpa PIC', 'Jumlah task aktif tanpa PIC', '0', 'Mingguan', 'Plan Monitoring', 'no_pic'),
  (5, 'Task Tanpa Deadline', 'Jumlah task aktif tanpa deadline', '0', 'Mingguan', 'Plan Monitoring', 'no_deadline'),
  (6, 'Critical Issue Escalation', 'Issue high severity dieskalasi ke manajemen', '≤24 jam', 'Harian', 'Plan Monitoring', NULL),
  (7, 'Weekly Report On-Time', 'Laporan mingguan terkirim tepat waktu', '100%', 'Mingguan', 'Plan Monitoring', NULL);

ALTER TABLE notifications MODIFY type ENUM('meeting_baru','meeting_diubah','meeting_reminder','planning_pic','planning_baru','sistem','prospek_baru','visit_reminder','followup_due','sample_update','desain_update','repeat_order','pembayaran','quotation','perbaikan_mesin','perawatan_mesin','stok_sparepart','pengajuan_pembelian','tiket','action_plan') NOT NULL;
