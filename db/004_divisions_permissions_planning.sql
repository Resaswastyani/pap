-- PAP-MS: divisi, role (level akses), permission per user, dan planning
-- Sebelumnya "role" = divisi (marketing, ppic, ...). Mulai migrasi ini:
--   divisions   = divisi tempat user bekerja (Marketing, PPIC, HRD, ...)
--   roles       = level akses: super_admin (Staff IT), admin (General Manager), lead, staff
--   permissions = hak akses fitur; default dari role, bisa ditambah/dicabut per user

-- 1. Divisi -------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS divisions (
  id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  code       VARCHAR(50)  NOT NULL,
  name       VARCHAR(100) NOT NULL,
  has_levels TINYINT(1)   NOT NULL DEFAULT 1, -- 1 = punya Lead & Staff
  sort_order INT          NOT NULL DEFAULT 0,
  created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_divisions_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO divisions (code, name, has_levels, sort_order) VALUES
  ('hrd',             'HRD',             0, 1),
  ('marketing',       'Marketing',       1, 2),
  ('produksi',        'Produksi',        1, 3),
  ('teknik',          'Teknik',          1, 4),
  ('ppic',            'PPIC',            1, 5),
  ('purchasing',      'Purchasing',      1, 6),
  ('general_manager', 'General Manager', 0, 7),
  ('general_affair',  'General Affair',  0, 8),
  ('staff_it',        'Staff IT',        0, 9),
  ('accounting',      'Accounting',      1, 10)
ON DUPLICATE KEY UPDATE name = VALUES(name), has_levels = VALUES(has_levels), sort_order = VALUES(sort_order);

-- 2. Menu bawaan per divisi (pengganti role_menus) ----------------------------
CREATE TABLE IF NOT EXISTS division_menus (
  division_id INT UNSIGNED NOT NULL,
  menu_key    VARCHAR(50)  NOT NULL,
  PRIMARY KEY (division_id, menu_key),
  CONSTRAINT fk_division_menus_division FOREIGN KEY (division_id) REFERENCES divisions (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO division_menus (division_id, menu_key)
SELECT d.id, rm.menu_key FROM role_menus rm JOIN roles r ON r.id = rm.role_id JOIN divisions d ON d.code = r.code;

INSERT IGNORE INTO division_menus (division_id, menu_key)
SELECT d.id, m.menu_key FROM divisions d JOIN (
  SELECT 'hrd' AS code, 'dashboard' AS menu_key UNION ALL
  SELECT 'hrd', 'karyawan' UNION ALL
  SELECT 'hrd', 'absensi' UNION ALL
  SELECT 'hrd', 'progress-kerja' UNION ALL
  SELECT 'hrd', 'planning-meeting' UNION ALL
  SELECT 'teknik', 'dashboard' UNION ALL
  SELECT 'teknik', 'jadwal-produksi' UNION ALL
  SELECT 'teknik', 'data-mesin' UNION ALL
  SELECT 'teknik', 'progress-kerja' UNION ALL
  SELECT 'teknik', 'planning-meeting' UNION ALL
  SELECT 'general_affair', 'dashboard' UNION ALL
  SELECT 'general_affair', 'karyawan' UNION ALL
  SELECT 'general_affair', 'progress-kerja' UNION ALL
  SELECT 'general_affair', 'planning-meeting'
) AS m ON m.code = d.code;

-- 3. User mendapat divisi dari role lama --------------------------------------
ALTER TABLE users ADD COLUMN IF NOT EXISTS division_id INT UNSIGNED NULL AFTER role_id;
UPDATE users u JOIN roles r ON r.id = u.role_id JOIN divisions d ON d.code = r.code
SET u.division_id = d.id WHERE u.division_id IS NULL;

-- 4. Role baru = level akses --------------------------------------------------
INSERT INTO roles (code, name, description, is_admin, is_super_admin) VALUES
  ('super_admin', 'Super Admin', 'Staff IT: akses ke semua menu, data, dan pengaturan', 1, 1),
  ('admin',       'Admin',       'General Manager: monitoring & approval semua divisi',  1, 0),
  ('lead',        'Lead',        'Kepala divisi: monitoring, approval, dan CRUD planning divisinya', 0, 0),
  ('staff',       'Staff',       'Membuat pengajuan planning dan update progress',      0, 0)
ON DUPLICATE KEY UPDATE name = VALUES(name), description = VALUES(description), is_admin = VALUES(is_admin), is_super_admin = VALUES(is_super_admin);

UPDATE users u
JOIN roles old_r ON old_r.id = u.role_id
JOIN roles new_r ON new_r.code = CASE old_r.code WHEN 'staff_it' THEN 'super_admin' WHEN 'general_manager' THEN 'admin' ELSE 'lead' END
SET u.role_id = new_r.id
WHERE old_r.code NOT IN ('super_admin', 'admin', 'lead', 'staff');

DROP TABLE IF EXISTS role_menus;
DELETE FROM roles WHERE code NOT IN ('super_admin', 'admin', 'lead', 'staff');

ALTER TABLE users MODIFY division_id INT UNSIGNED NOT NULL;
ALTER TABLE users ADD CONSTRAINT fk_users_division FOREIGN KEY IF NOT EXISTS (division_id) REFERENCES divisions (id);

-- 5. Permission ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS permissions (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  code        VARCHAR(80)  NOT NULL,
  name        VARCHAR(150) NOT NULL,
  module      VARCHAR(50)  NOT NULL,
  sort_order  INT          NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uq_permissions_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO permissions (code, name, module, sort_order) VALUES
  ('planning.view',            'Lihat planning divisi sendiri',               'Planning', 1),
  ('planning.view_all',        'Lihat planning semua divisi',                 'Planning', 2),
  ('planning.create',          'Buat pengajuan planning',                     'Planning', 3),
  ('planning.update_progress', 'Update progress & status planning',           'Planning', 4),
  ('planning.manage',          'Kelola (edit & hapus) semua planning',        'Planning', 5),
  ('planning.approve',         'Approve / tolak planning',                    'Planning', 6),
  ('users.manage',             'Manajemen user & permission user',            'Sistem',   7),
  ('roles.manage',             'Manajemen role & permission role',            'Sistem',   8)
ON DUPLICATE KEY UPDATE name = VALUES(name), module = VALUES(module), sort_order = VALUES(sort_order);

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id       INT UNSIGNED NOT NULL,
  permission_id INT UNSIGNED NOT NULL,
  PRIMARY KEY (role_id, permission_id),
  CONSTRAINT fk_role_permissions_role FOREIGN KEY (role_id) REFERENCES roles (id) ON DELETE CASCADE,
  CONSTRAINT fk_role_permissions_permission FOREIGN KEY (permission_id) REFERENCES permissions (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- super_admin tidak perlu baris: selalu punya semua permission
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p JOIN (
  SELECT 'staff' AS role_code, 'planning.view' AS perm UNION ALL
  SELECT 'staff', 'planning.create' UNION ALL
  SELECT 'staff', 'planning.update_progress' UNION ALL
  SELECT 'lead', 'planning.view' UNION ALL
  SELECT 'lead', 'planning.create' UNION ALL
  SELECT 'lead', 'planning.update_progress' UNION ALL
  SELECT 'lead', 'planning.manage' UNION ALL
  SELECT 'lead', 'planning.approve' UNION ALL
  SELECT 'admin', 'planning.view' UNION ALL
  SELECT 'admin', 'planning.view_all' UNION ALL
  SELECT 'admin', 'planning.create' UNION ALL
  SELECT 'admin', 'planning.update_progress' UNION ALL
  SELECT 'admin', 'planning.manage' UNION ALL
  SELECT 'admin', 'planning.approve'
) AS m ON m.role_code = r.code AND m.perm = p.code;

-- Permission khusus per user: allowed = 1 menambah, allowed = 0 mencabut
CREATE TABLE IF NOT EXISTS user_permissions (
  user_id       INT UNSIGNED NOT NULL,
  permission_id INT UNSIGNED NOT NULL,
  allowed       TINYINT(1)   NOT NULL DEFAULT 1,
  PRIMARY KEY (user_id, permission_id),
  CONSTRAINT fk_user_permissions_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_user_permissions_permission FOREIGN KEY (permission_id) REFERENCES permissions (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 6. Planning -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS plannings (
  id              INT UNSIGNED NOT NULL AUTO_INCREMENT,
  nomor           VARCHAR(30)  NULL,
  division_id     INT UNSIGNED NOT NULL,
  judul           VARCHAR(200) NOT NULL,
  deskripsi       TEXT         NULL,
  tanggal_mulai   DATE         NOT NULL,
  tanggal_selesai DATE         NOT NULL,
  status          ENUM('belum_mulai','berjalan','selesai','ditunda','dibatalkan') NOT NULL DEFAULT 'belum_mulai',
  progress        TINYINT UNSIGNED NOT NULL DEFAULT 0,
  approval        ENUM('menunggu','disetujui','ditolak') NOT NULL DEFAULT 'menunggu',
  approval_note   VARCHAR(500) NULL,
  approved_by     INT UNSIGNED NULL,
  approved_at     DATETIME     NULL,
  created_by      INT UNSIGNED NOT NULL,
  created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_plannings_nomor (nomor),
  KEY idx_plannings_division (division_id, approval, status),
  CONSTRAINT fk_plannings_division FOREIGN KEY (division_id) REFERENCES divisions (id),
  CONSTRAINT fk_plannings_created_by FOREIGN KEY (created_by) REFERENCES users (id),
  CONSTRAINT fk_plannings_approved_by FOREIGN KEY (approved_by) REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT chk_plannings_progress CHECK (progress <= 100),
  CONSTRAINT chk_plannings_tanggal CHECK (tanggal_selesai >= tanggal_mulai)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Lampiran: link, atau file (gambar/PDF/Word) yang disimpan di database
CREATE TABLE IF NOT EXISTS planning_files (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  planning_id INT UNSIGNED NOT NULL,
  type        ENUM('link','file') NOT NULL,
  name        VARCHAR(255) NOT NULL,
  url         VARCHAR(1000) NULL,
  mime        VARCHAR(150) NULL,
  size        INT UNSIGNED NULL,
  data        MEDIUMBLOB   NULL,
  uploaded_by INT UNSIGNED NOT NULL,
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_planning_files_planning (planning_id),
  CONSTRAINT fk_planning_files_planning FOREIGN KEY (planning_id) REFERENCES plannings (id) ON DELETE CASCADE,
  CONSTRAINT fk_planning_files_user FOREIGN KEY (uploaded_by) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
