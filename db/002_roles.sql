-- PAP-MS: role & hak akses menu
-- staff_it = Super Admin (akses semua menu, tidak perlu baris di role_menus)
-- general_manager = Admin (semua menu operasional, kecuali Pengaturan sistem)

CREATE TABLE IF NOT EXISTS roles (
  id             INT UNSIGNED NOT NULL AUTO_INCREMENT,
  code           VARCHAR(50)  NOT NULL,
  name           VARCHAR(100) NOT NULL,
  description    VARCHAR(255) NULL,
  is_admin       TINYINT(1)   NOT NULL DEFAULT 0,
  is_super_admin TINYINT(1)   NOT NULL DEFAULT 0,
  created_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_roles_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO roles (code, name, description, is_admin, is_super_admin) VALUES
  ('marketing',       'Marketing',              'Customer, quotation, dan order dari customer', 0, 0),
  ('accounting',      'Accounting',             'Keuangan, penagihan, dan data karyawan',       0, 0),
  ('ppic',            'PPIC',                   'Perencanaan dan pengendalian produksi',        0, 0),
  ('purchasing',      'Purchasing',             'Pembelian bahan baku dan kebutuhan pabrik',    0, 0),
  ('produksi',        'Produksi',               'Blow, rotogravure, dan bag making',            0, 0),
  ('general_manager', 'General Manager',        'Admin: akses semua menu operasional',          1, 0),
  ('staff_it',        'Staff IT (Super Admin)', 'Super admin: akses ke semua menu dan sistem',  1, 1)
ON DUPLICATE KEY UPDATE name = VALUES(name), description = VALUES(description), is_admin = VALUES(is_admin), is_super_admin = VALUES(is_super_admin);

CREATE TABLE IF NOT EXISTS role_menus (
  role_id  INT UNSIGNED NOT NULL,
  menu_key VARCHAR(50)  NOT NULL,
  PRIMARY KEY (role_id, menu_key),
  CONSTRAINT fk_role_menus_role FOREIGN KEY (role_id) REFERENCES roles (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Menu: dashboard, customer, quotation, sbk, jadwal-produksi, data-mesin, karyawan, absensi, progress-kerja, planning-meeting, pengaturan
INSERT IGNORE INTO role_menus (role_id, menu_key)
SELECT r.id, m.menu_key FROM roles r JOIN (
  SELECT 'marketing' AS code, 'dashboard' AS menu_key UNION ALL
  SELECT 'marketing', 'customer' UNION ALL
  SELECT 'marketing', 'quotation' UNION ALL
  SELECT 'marketing', 'progress-kerja' UNION ALL
  SELECT 'marketing', 'planning-meeting' UNION ALL
  SELECT 'accounting', 'dashboard' UNION ALL
  SELECT 'accounting', 'customer' UNION ALL
  SELECT 'accounting', 'quotation' UNION ALL
  SELECT 'accounting', 'karyawan' UNION ALL
  SELECT 'accounting', 'absensi' UNION ALL
  SELECT 'accounting', 'progress-kerja' UNION ALL
  SELECT 'accounting', 'planning-meeting' UNION ALL
  SELECT 'ppic', 'dashboard' UNION ALL
  SELECT 'ppic', 'sbk' UNION ALL
  SELECT 'ppic', 'jadwal-produksi' UNION ALL
  SELECT 'ppic', 'data-mesin' UNION ALL
  SELECT 'ppic', 'progress-kerja' UNION ALL
  SELECT 'ppic', 'planning-meeting' UNION ALL
  SELECT 'purchasing', 'dashboard' UNION ALL
  SELECT 'purchasing', 'jadwal-produksi' UNION ALL
  SELECT 'purchasing', 'data-mesin' UNION ALL
  SELECT 'purchasing', 'progress-kerja' UNION ALL
  SELECT 'purchasing', 'planning-meeting' UNION ALL
  SELECT 'produksi', 'dashboard' UNION ALL
  SELECT 'produksi', 'sbk' UNION ALL
  SELECT 'produksi', 'jadwal-produksi' UNION ALL
  SELECT 'produksi', 'data-mesin' UNION ALL
  SELECT 'produksi', 'progress-kerja' UNION ALL
  SELECT 'produksi', 'planning-meeting' UNION ALL
  SELECT 'general_manager', 'dashboard' UNION ALL
  SELECT 'general_manager', 'customer' UNION ALL
  SELECT 'general_manager', 'quotation' UNION ALL
  SELECT 'general_manager', 'sbk' UNION ALL
  SELECT 'general_manager', 'jadwal-produksi' UNION ALL
  SELECT 'general_manager', 'data-mesin' UNION ALL
  SELECT 'general_manager', 'karyawan' UNION ALL
  SELECT 'general_manager', 'absensi' UNION ALL
  SELECT 'general_manager', 'progress-kerja' UNION ALL
  SELECT 'general_manager', 'planning-meeting'
) AS m ON m.code = r.code;

-- users.role (teks) diganti users.role_id (relasi ke roles)
ALTER TABLE users ADD COLUMN IF NOT EXISTS role_id INT UNSIGNED NULL AFTER password_hash;
UPDATE users u JOIN roles r ON r.code = 'staff_it' SET u.role_id = r.id WHERE u.role_id IS NULL AND u.role = 'Super Admin';
UPDATE users u JOIN roles r ON r.code = 'marketing' SET u.role_id = r.id WHERE u.role_id IS NULL;
ALTER TABLE users MODIFY role_id INT UNSIGNED NOT NULL;
ALTER TABLE users ADD CONSTRAINT fk_users_role FOREIGN KEY IF NOT EXISTS (role_id) REFERENCES roles (id);
ALTER TABLE users DROP COLUMN IF EXISTS role;
