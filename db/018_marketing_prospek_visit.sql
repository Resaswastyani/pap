-- PAP-MS: Marketing tahap 1 - Database Prospek (pipeline), Jadwal Visit (check-in GPS + foto), Log Follow-up
-- Divisi Marketing dipecah sesuai Guidance: Marketing Digital, Marketing Development, Marketing Maintenance, Tim Desain.

-- 1. Divisi baru (divisi "Marketing" lama tetap ada, mis. untuk kepala marketing)
INSERT INTO divisions (code, name, has_levels, sort_order) VALUES
  ('marketing_digital',     'Marketing Digital',     1, 11),
  ('marketing_development', 'Marketing Development', 1, 12),
  ('marketing_maintenance', 'Marketing Maintenance', 1, 13),
  ('tim_desain',            'Tim Desain',            1, 14)
ON DUPLICATE KEY UPDATE name = VALUES(name), has_levels = VALUES(has_levels), sort_order = VALUES(sort_order);

-- 2. Menu: divisi marketing baru mendapat menu yang sama dengan Marketing + menu Prospek & Jadwal Visit
INSERT IGNORE INTO division_menus (division_id, menu_key)
SELECT d.id, dm.menu_key FROM divisions d
JOIN division_menus dm ON dm.division_id = (SELECT id FROM divisions WHERE code = 'marketing')
WHERE d.code IN ('marketing_digital', 'marketing_development', 'marketing_maintenance');

INSERT IGNORE INTO division_menus (division_id, menu_key)
SELECT d.id, m.menu_key FROM divisions d JOIN (
  SELECT 'prospek' AS menu_key UNION ALL SELECT 'visit'
) m WHERE d.code IN ('marketing', 'marketing_digital', 'marketing_development', 'marketing_maintenance', 'general_manager');

INSERT IGNORE INTO division_menus (division_id, menu_key)
SELECT d.id, m.menu_key FROM divisions d JOIN (
  SELECT 'dashboard' AS menu_key UNION ALL SELECT 'produk' UNION ALL SELECT 'progress-kerja'
) m WHERE d.code = 'tim_desain';

-- 3. Prospek (calon customer) dengan status pipeline
CREATE TABLE IF NOT EXISTS prospects (
  id               INT UNSIGNED NOT NULL AUTO_INCREMENT,
  nama_usaha       VARCHAR(200) NOT NULL,
  sektor           VARCHAR(120) NULL,
  kontak_nama      VARCHAR(150) NULL,
  kontak_jabatan   VARCHAR(120) NULL,
  telepon          VARCHAR(40)  NULL,          -- nomor WhatsApp
  email            VARCHAR(200) NULL,
  alamat           VARCHAR(500) NULL,
  kota             VARCHAR(120) NULL,
  sumber           VARCHAR(60)  NULL,          -- Instagram, Google Maps, Website, Referensi, ...
  kebutuhan        VARCHAR(500) NULL,          -- produk yang diminati
  estimasi_order   VARCHAR(150) NULL,
  status           ENUM('baru','dihubungi','janji_temu','visit','penawaran','order_pertama','handover','gagal') NOT NULL DEFAULT 'baru',
  alasan_gagal     VARCHAR(500) NULL,
  assigned_to      INT UNSIGNED NULL,          -- sales Marketing Development
  maintenance_to   INT UNSIGNED NULL,          -- Marketing Maintenance setelah handover
  customer_id      INT UNSIGNED NULL,          -- terhubung ke customer (Accurate) setelah order
  next_followup_at DATETIME     NULL,
  last_activity_at DATETIME     NULL,
  catatan          TEXT         NULL,
  created_by       INT UNSIGNED NOT NULL,
  created_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_prospects_status (status, assigned_to),
  KEY idx_prospects_followup (next_followup_at),
  KEY idx_prospects_telepon (telepon),
  CONSTRAINT fk_prospects_assigned FOREIGN KEY (assigned_to) REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT fk_prospects_maintenance FOREIGN KEY (maintenance_to) REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT fk_prospects_customer FOREIGN KEY (customer_id) REFERENCES customers (id) ON DELETE SET NULL,
  CONSTRAINT fk_prospects_created_by FOREIGN KEY (created_by) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4. Jadwal visit / janji temu, dengan check-in lokasi GPS + foto
CREATE TABLE IF NOT EXISTS visits (
  id               INT UNSIGNED NOT NULL AUTO_INCREMENT,
  prospect_id      INT UNSIGNED NULL,
  customer_id      INT UNSIGNED NULL,
  sales_id         INT UNSIGNED NOT NULL,
  jenis            ENUM('visit','janji_temu','online') NOT NULL DEFAULT 'visit',
  jadwal           DATETIME     NOT NULL,
  tujuan           VARCHAR(500) NULL,
  alamat           VARCHAR(500) NULL,
  status           ENUM('terjadwal','selesai','tidak_bertemu','batal') NOT NULL DEFAULT 'terjadwal',
  checkin_at       DATETIME     NULL,
  checkin_lat      DECIMAL(10,7) NULL,
  checkin_lng      DECIMAL(10,7) NULL,
  checkin_accuracy INT UNSIGNED NULL,          -- meter
  foto             MEDIUMBLOB   NULL,
  foto_mime        VARCHAR(60)  NULL,
  hasil            TEXT         NULL,
  next_followup_at DATETIME     NULL,
  created_by       INT UNSIGNED NOT NULL,
  created_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_visits_sales (sales_id, jadwal),
  KEY idx_visits_jadwal (jadwal, status),
  CONSTRAINT fk_visits_prospect FOREIGN KEY (prospect_id) REFERENCES prospects (id) ON DELETE CASCADE,
  CONSTRAINT fk_visits_customer FOREIGN KEY (customer_id) REFERENCES customers (id) ON DELETE CASCADE,
  CONSTRAINT fk_visits_sales FOREIGN KEY (sales_id) REFERENCES users (id),
  CONSTRAINT fk_visits_created_by FOREIGN KEY (created_by) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 5. Log aktivitas follow-up (prospek maupun customer)
CREATE TABLE IF NOT EXISTS marketing_activities (
  id           INT UNSIGNED NOT NULL AUTO_INCREMENT,
  prospect_id  INT UNSIGNED NULL,
  customer_id  INT UNSIGNED NULL,
  visit_id     INT UNSIGNED NULL,
  user_id      INT UNSIGNED NOT NULL,
  jenis        ENUM('whatsapp','telepon','email','visit','meeting','catatan','status','handover') NOT NULL,
  hasil        TEXT         NULL,
  status_from  VARCHAR(30)  NULL,
  status_to    VARCHAR(30)  NULL,
  created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_activities_prospect (prospect_id, created_at),
  KEY idx_activities_customer (customer_id, created_at),
  CONSTRAINT fk_activities_prospect FOREIGN KEY (prospect_id) REFERENCES prospects (id) ON DELETE CASCADE,
  CONSTRAINT fk_activities_customer FOREIGN KEY (customer_id) REFERENCES customers (id) ON DELETE CASCADE,
  CONSTRAINT fk_activities_visit FOREIGN KEY (visit_id) REFERENCES visits (id) ON DELETE SET NULL,
  CONSTRAINT fk_activities_user FOREIGN KEY (user_id) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 6. Notifikasi: prospek diserahkan ke sales, reminder visit, follow-up jatuh tempo
ALTER TABLE notifications MODIFY type ENUM('meeting_baru','meeting_diubah','meeting_reminder','planning_pic','planning_baru','sistem','prospek_baru','visit_reminder','followup_due') NOT NULL;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS prospect_id INT UNSIGNED NULL AFTER planning_id;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS visit_id INT UNSIGNED NULL AFTER prospect_id;
ALTER TABLE notifications ADD CONSTRAINT fk_notifications_prospect FOREIGN KEY IF NOT EXISTS (prospect_id) REFERENCES prospects (id) ON DELETE CASCADE;
ALTER TABLE notifications ADD CONSTRAINT fk_notifications_visit FOREIGN KEY IF NOT EXISTS (visit_id) REFERENCES visits (id) ON DELETE CASCADE;
