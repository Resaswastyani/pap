-- PAP-MS Training Karyawan (Guidance HR: "program development HR untuk semua karyawan", "platform / program development program HR").
-- Materi dari folder Google Drive "Training Karyawan": tiap subfolder = satu modul, file di dalamnya = materi (video diputar di SIMPAP,
-- dokumen dibuka di Drive). HRD menambah deskripsi, kategori, sasaran divisi, link video lain (YouTube / Drive), dan mencatat peserta.

CREATE TABLE IF NOT EXISTS training_modules (
  id               INT UNSIGNED NOT NULL AUTO_INCREMENT,
  drive_folder_id  VARCHAR(100) NULL,               -- subfolder Drive (kosong = modul dibuat manual)
  judul            VARCHAR(255) NOT NULL,
  kategori         VARCHAR(80)  NULL,
  deskripsi        TEXT         NULL,
  sasaran          VARCHAR(500) NULL,               -- divisi sasaran (dipisah koma); kosong = semua karyawan
  wajib            TINYINT(1)   NOT NULL DEFAULT 0,
  durasi_menit     SMALLINT UNSIGNED NULL,
  aktif            TINYINT(1)   NOT NULL DEFAULT 1,
  urut             SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  synced_at        DATETIME     NULL,
  created_by       INT UNSIGNED NULL,
  created_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_training_folder (drive_folder_id),
  CONSTRAINT fk_training_created_by FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS training_materials (
  id               INT UNSIGNED NOT NULL AUTO_INCREMENT,
  module_id        INT UNSIGNED NOT NULL,
  sumber           ENUM('drive','manual') NOT NULL DEFAULT 'drive',
  drive_file_id    VARCHAR(100) NULL,
  judul            VARCHAR(255) NOT NULL,
  jenis            ENUM('video','dokumen','link') NOT NULL,
  url              VARCHAR(1000) NULL,              -- link manual (YouTube, Drive, web)
  mime             VARCHAR(120) NULL,
  ukuran           BIGINT UNSIGNED NULL,
  folder           VARCHAR(500) NULL,               -- sub-subfolder di dalam modul
  urut             SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  synced_at        DATETIME     NULL,
  created_by       INT UNSIGNED NULL,
  created_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_training_material_file (drive_file_id),
  KEY idx_training_materials_module (module_id, urut),
  CONSTRAINT fk_training_materials_module FOREIGN KEY (module_id) REFERENCES training_modules (id) ON DELETE CASCADE,
  CONSTRAINT fk_training_materials_user FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS training_participants (
  id               INT UNSIGNED NOT NULL AUTO_INCREMENT,
  module_id        INT UNSIGNED NOT NULL,
  employee_id      INT UNSIGNED NOT NULL,
  status           ENUM('terdaftar','selesai','tidak_lulus') NOT NULL DEFAULT 'terdaftar',
  tanggal          DATE         NULL,               -- tanggal selesai / pelaksanaan
  nilai            DECIMAL(5,2) NULL,
  catatan          VARCHAR(500) NULL,
  updated_by       INT UNSIGNED NULL,
  updated_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_training_participant (module_id, employee_id),
  KEY idx_training_participant_employee (employee_id),
  CONSTRAINT fk_training_participants_module FOREIGN KEY (module_id) REFERENCES training_modules (id) ON DELETE CASCADE,
  CONSTRAINT fk_training_participants_employee FOREIGN KEY (employee_id) REFERENCES employees (id) ON DELETE CASCADE,
  CONSTRAINT fk_training_participants_user FOREIGN KEY (updated_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO app_settings (`key`, value) VALUES ('hrd.training_folder_url', '');

-- Menu Training: semua divisi bisa melihat & menonton materi; dikelola HRD / GM / admin
INSERT IGNORE INTO division_menus (division_id, menu_key) SELECT id, 'training' FROM divisions;
