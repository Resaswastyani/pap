-- PAP-MS: Request Sample (Marketing -> PPIC -> Produksi -> kirim -> approval customer)
--         Request Desain klise (Marketing -> Tim Desain -> review customer -> desain final ke Data Produk)

-- 1. Menu: Request Sample untuk Marketing, PPIC, Produksi, GM; Request Desain untuk Marketing, Tim Desain, GM
INSERT IGNORE INTO division_menus (division_id, menu_key)
SELECT d.id, 'sample' FROM divisions d
WHERE d.code IN ('marketing', 'marketing_digital', 'marketing_development', 'marketing_maintenance', 'ppic', 'produksi', 'general_manager');

INSERT IGNORE INTO division_menus (division_id, menu_key)
SELECT d.id, 'desain' FROM divisions d
WHERE d.code IN ('marketing', 'marketing_digital', 'marketing_development', 'marketing_maintenance', 'tim_desain', 'general_manager');

-- 2. Request sample
CREATE TABLE IF NOT EXISTS sample_requests (
  id               INT UNSIGNED NOT NULL AUTO_INCREMENT,
  nomor            VARCHAR(30)  NULL,
  prospect_id      INT UNSIGNED NULL,
  customer_id      INT UNSIGNED NULL,
  product_id       INT UNSIGNED NULL,          -- produk acuan dari Data Produk (opsional)
  nama_produk      VARCHAR(255) NOT NULL,
  jenis            VARCHAR(80)  NULL,
  ukuran           VARCHAR(150) NULL,
  ketebalan        VARCHAR(80)  NULL,
  bahan            VARCHAR(255) NULL,
  warna_cetak      VARCHAR(255) NULL,
  jumlah           VARCHAR(80)  NULL,
  spesifikasi      TEXT         NULL,          -- detail lain
  special_request  TEXT         NULL,
  tenggat          DATE         NULL,          -- kapan sample dibutuhkan
  status           ENUM('diajukan','dijadwalkan','diproduksi','selesai','dikirim','disetujui','revisi','batal') NOT NULL DEFAULT 'diajukan',
  jadwal_produksi  DATE         NULL,          -- diisi PPIC
  pengiriman       VARCHAR(255) NULL,          -- kurir / resi / diantar sales
  feedback         TEXT         NULL,          -- tanggapan customer terakhir
  revisi_ke        TINYINT UNSIGNED NOT NULL DEFAULT 0,
  requested_by     INT UNSIGNED NOT NULL,
  created_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_sample_nomor (nomor),
  KEY idx_sample_status (status),
  CONSTRAINT fk_sample_prospect FOREIGN KEY (prospect_id) REFERENCES prospects (id) ON DELETE SET NULL,
  CONSTRAINT fk_sample_customer FOREIGN KEY (customer_id) REFERENCES customers (id) ON DELETE SET NULL,
  CONSTRAINT fk_sample_product FOREIGN KEY (product_id) REFERENCES customer_products (id) ON DELETE SET NULL,
  CONSTRAINT fk_sample_requested_by FOREIGN KEY (requested_by) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. Request desain klise
CREATE TABLE IF NOT EXISTS design_requests (
  id               INT UNSIGNED NOT NULL AUTO_INCREMENT,
  nomor            VARCHAR(30)  NULL,
  prospect_id      INT UNSIGNED NULL,
  customer_id      INT UNSIGNED NULL,
  product_id       INT UNSIGNED NULL,          -- produk Data Produk (diisi otomatis saat desain disetujui)
  judul            VARCHAR(255) NOT NULL,      -- nama produk / desain
  jenis            VARCHAR(80)  NULL,
  ukuran           VARCHAR(150) NULL,
  warna_cetak      VARCHAR(255) NULL,
  brief            TEXT         NOT NULL,
  deadline         DATE         NULL,
  status           ENUM('diajukan','dikerjakan','review','revisi','disetujui','batal') NOT NULL DEFAULT 'diajukan',
  designer_id      INT UNSIGNED NULL,
  revisi_ke        TINYINT UNSIGNED NOT NULL DEFAULT 0,
  feedback         TEXT         NULL,
  final_file_id    INT UNSIGNED NULL,
  requested_by     INT UNSIGNED NOT NULL,
  created_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_design_nomor (nomor),
  KEY idx_design_status (status),
  CONSTRAINT fk_design_prospect FOREIGN KEY (prospect_id) REFERENCES prospects (id) ON DELETE SET NULL,
  CONSTRAINT fk_design_customer FOREIGN KEY (customer_id) REFERENCES customers (id) ON DELETE SET NULL,
  CONSTRAINT fk_design_product FOREIGN KEY (product_id) REFERENCES customer_products (id) ON DELETE SET NULL,
  CONSTRAINT fk_design_designer FOREIGN KEY (designer_id) REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT fk_design_requested_by FOREIGN KEY (requested_by) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- File desain: referensi dari sales, dan hasil desain per versi dari Tim Desain
CREATE TABLE IF NOT EXISTS design_request_files (
  id           INT UNSIGNED NOT NULL AUTO_INCREMENT,
  design_id    INT UNSIGNED NOT NULL,
  kind         ENUM('referensi','desain') NOT NULL,
  versi        TINYINT UNSIGNED NOT NULL DEFAULT 0,
  name         VARCHAR(255) NOT NULL,
  mime         VARCHAR(150) NOT NULL,
  size         INT UNSIGNED NOT NULL,
  data         MEDIUMBLOB   NOT NULL,
  uploaded_by  INT UNSIGNED NOT NULL,
  created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_design_files (design_id, kind),
  CONSTRAINT fk_design_files_design FOREIGN KEY (design_id) REFERENCES design_requests (id) ON DELETE CASCADE,
  CONSTRAINT fk_design_files_user FOREIGN KEY (uploaded_by) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4. Riwayat status (timeline) kedua request
CREATE TABLE IF NOT EXISTS request_logs (
  id           INT UNSIGNED NOT NULL AUTO_INCREMENT,
  sample_id    INT UNSIGNED NULL,
  design_id    INT UNSIGNED NULL,
  user_id      INT UNSIGNED NOT NULL,
  status_from  VARCHAR(30)  NULL,
  status_to    VARCHAR(30)  NULL,
  catatan      TEXT         NULL,
  created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_logs_sample (sample_id),
  KEY idx_logs_design (design_id),
  CONSTRAINT fk_logs_sample FOREIGN KEY (sample_id) REFERENCES sample_requests (id) ON DELETE CASCADE,
  CONSTRAINT fk_logs_design FOREIGN KEY (design_id) REFERENCES design_requests (id) ON DELETE CASCADE,
  CONSTRAINT fk_logs_user FOREIGN KEY (user_id) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 5. Notifikasi untuk tiap tahap
ALTER TABLE notifications MODIFY type ENUM('meeting_baru','meeting_diubah','meeting_reminder','planning_pic','planning_baru','sistem','prospek_baru','visit_reminder','followup_due','sample_update','desain_update') NOT NULL;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS sample_id INT UNSIGNED NULL AFTER visit_id;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS design_id INT UNSIGNED NULL AFTER sample_id;
ALTER TABLE notifications ADD CONSTRAINT fk_notifications_sample FOREIGN KEY IF NOT EXISTS (sample_id) REFERENCES sample_requests (id) ON DELETE CASCADE;
ALTER TABLE notifications ADD CONSTRAINT fk_notifications_design FOREIGN KEY IF NOT EXISTS (design_id) REFERENCES design_requests (id) ON DELETE CASCADE;
