-- PAP-MS: Jadwal Produksi dari Sales Order Accurate (barang bertanda "Diproduksi"), per tahap & mesin

-- 1. Tanda barang dari Accurate (Barang & Jasa > Umum > Tipe Persediaan) + penanda perlu ambil detail ulang
ALTER TABLE accurate_items ADD COLUMN IF NOT EXISTS item_produced TINYINT(1) NULL AFTER suspended;      -- [x] Diproduksi
ALTER TABLE accurate_items ADD COLUMN IF NOT EXISTS material_produced TINYINT(1) NULL AFTER item_produced; -- [x] Bahan Baku
ALTER TABLE accurate_items ADD COLUMN IF NOT EXISTS last_update VARCHAR(20) NULL;
ALTER TABLE accurate_items ADD COLUMN IF NOT EXISTS detail_synced_update VARCHAR(20) NULL;

-- 2. Tanggal kirim Sales Order (tenggat produksi)
ALTER TABLE accurate_sales_orders ADD COLUMN IF NOT EXISTS ship_date DATE NULL AFTER trans_date;

-- 3. Mesin produksi
CREATE TABLE IF NOT EXISTS machines (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  kode        VARCHAR(30)  NOT NULL,
  nama        VARCHAR(150) NOT NULL,
  tahap       VARCHAR(40)  NOT NULL,            -- Blow, Cetak, Bag making, Lainnya
  kapasitas   VARCHAR(150) NULL,                -- mis. 500 kg/hari
  status      ENUM('aktif','maintenance','nonaktif') NOT NULL DEFAULT 'aktif',
  keterangan  TEXT         NULL,
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_machines_kode (kode)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4. Job produksi: satu per baris barang Sales Order
CREATE TABLE IF NOT EXISTS production_jobs (
  id               INT UNSIGNED NOT NULL AUTO_INCREMENT,
  nomor            VARCHAR(30)  NULL,
  so_accurate_id   INT UNSIGNED NOT NULL,
  line_id          INT UNSIGNED NOT NULL,
  so_number        VARCHAR(80)  NULL,
  customer_id      INT UNSIGNED NULL,
  product_id       INT UNSIGNED NULL,
  item_accurate_id INT UNSIGNED NULL,
  item_name        VARCHAR(255) NOT NULL,
  quantity         DECIMAL(18,4) NULL,
  unit             VARCHAR(40)  NULL,
  due_date         DATE         NULL,          -- tanggal kirim SO
  status           ENUM('menunggu','dijadwalkan','berjalan','selesai','batal') NOT NULL DEFAULT 'menunggu',
  prioritas        ENUM('normal','tinggi') NOT NULL DEFAULT 'normal',
  catatan          TEXT         NULL,
  updated_by       INT UNSIGNED NULL,
  created_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_jobs_so_line (so_accurate_id, line_id),
  UNIQUE KEY uq_jobs_nomor (nomor),
  KEY idx_jobs_status (status, due_date),
  CONSTRAINT fk_jobs_customer FOREIGN KEY (customer_id) REFERENCES customers (id) ON DELETE SET NULL,
  CONSTRAINT fk_jobs_product FOREIGN KEY (product_id) REFERENCES customer_products (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 5. Tahap produksi per job (Blow -> Cetak -> Bag making), masing-masing dengan mesin & jadwal
CREATE TABLE IF NOT EXISTS production_stages (
  id           INT UNSIGNED NOT NULL AUTO_INCREMENT,
  job_id       INT UNSIGNED NOT NULL,
  urutan       TINYINT UNSIGNED NOT NULL,
  tahap        VARCHAR(40)  NOT NULL,
  machine_id   INT UNSIGNED NULL,
  plan_start   DATETIME     NULL,
  plan_end     DATETIME     NULL,
  actual_start DATETIME     NULL,
  actual_end   DATETIME     NULL,
  status       ENUM('belum','berjalan','selesai','dilewati') NOT NULL DEFAULT 'belum',
  progress     TINYINT UNSIGNED NOT NULL DEFAULT 0,
  pic_user_id  INT UNSIGNED NULL,
  catatan      VARCHAR(1000) NULL,
  updated_by   INT UNSIGNED NULL,
  updated_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_stages_job (job_id, urutan),
  KEY idx_stages_machine (machine_id, plan_start),
  CONSTRAINT fk_stages_job FOREIGN KEY (job_id) REFERENCES production_jobs (id) ON DELETE CASCADE,
  CONSTRAINT fk_stages_machine FOREIGN KEY (machine_id) REFERENCES machines (id) ON DELETE SET NULL,
  CONSTRAINT fk_stages_pic FOREIGN KEY (pic_user_id) REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT chk_stages_progress CHECK (progress <= 100)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 6. Akses menu: Jadwal Produksi juga untuk Marketing & Accounting (lihat saja)
INSERT IGNORE INTO division_menus (division_id, menu_key)
SELECT d.id, m.menu_key FROM divisions d JOIN (
  SELECT 'marketing' AS code, 'jadwal-produksi' AS menu_key UNION ALL
  SELECT 'accounting', 'jadwal-produksi'
) AS m ON m.code = d.code;

-- 7. Permission (selain aturan divisi: PPIC kelola jadwal, Produksi update progress)
INSERT INTO permissions (code, name, module, sort_order) VALUES
  ('production.manage',   'Kelola jadwal produksi & data mesin', 'Produksi', 31),
  ('production.progress', 'Update progress tahap produksi',      'Produksi', 32)
ON DUPLICATE KEY UPDATE name = VALUES(name), module = VALUES(module), sort_order = VALUES(sort_order);

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code IN ('production.manage', 'production.progress') WHERE r.code = 'admin';
