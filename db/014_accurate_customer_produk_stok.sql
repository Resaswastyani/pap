-- PAP-MS: integrasi Accurate Online (customer, faktur untuk CRM, stok) + data produk per customer

-- 1. Status sinkronisasi per jenis data (dipakai cron & tombol "Sinkron sekarang")
CREATE TABLE IF NOT EXISTS accurate_sync_state (
  entity       VARCHAR(40)  NOT NULL,
  last_success DATETIME     NULL,      -- sinkron terakhir yang selesai (WIB)
  since_marker VARCHAR(20)  NULL,      -- filter lastUpdate Accurate untuk sinkron berikutnya (dd/MM/yyyy HH:mm:ss)
  next_page    INT UNSIGNED NOT NULL DEFAULT 1, -- lanjutan bila sinkron terpotong batas waktu
  run_started  VARCHAR(20)  NULL,
  status       ENUM('ok','berjalan','gagal') NOT NULL DEFAULT 'ok',
  message      VARCHAR(500) NULL,
  updated_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (entity)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. Customer (salinan dari Accurate; diedit di PAP-MS -> disimpan ke Accurate lalu ke sini)
CREATE TABLE IF NOT EXISTS customers (
  id              INT UNSIGNED NOT NULL AUTO_INCREMENT,
  accurate_id     INT UNSIGNED NULL,
  customer_no     VARCHAR(50)  NULL,
  name            VARCHAR(255) NOT NULL,
  category        VARCHAR(150) NULL,
  email           VARCHAR(255) NULL,
  mobile_phone    VARCHAR(80)  NULL,
  work_phone      VARCHAR(80)  NULL,
  bill_street     VARCHAR(500) NULL,
  bill_city       VARCHAR(150) NULL,
  bill_province   VARCHAR(150) NULL,
  bill_zip        VARCHAR(20)  NULL,
  npwp_no         VARCHAR(50)  NULL,
  notes           TEXT         NULL,
  suspended       TINYINT(1)   NOT NULL DEFAULT 0,
  raw             JSON         NULL,
  synced_at       DATETIME     NULL,
  created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_customers_accurate (accurate_id),
  KEY idx_customers_no (customer_no),
  KEY idx_customers_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. Faktur penjualan (ringkas) untuk CRM: repeat order & pembeli nonaktif
CREATE TABLE IF NOT EXISTS accurate_sales_invoices (
  accurate_id          INT UNSIGNED NOT NULL,
  number               VARCHAR(80)  NULL,
  trans_date           DATE         NULL,
  customer_accurate_id INT UNSIGNED NULL,
  total_amount         DECIMAL(18,2) NULL,
  status               VARCHAR(80)  NULL,
  synced_at            DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (accurate_id),
  KEY idx_invoices_customer (customer_accurate_id, trans_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4. Stok barang dari Accurate
CREATE TABLE IF NOT EXISTS accurate_items (
  accurate_id   INT UNSIGNED NOT NULL,
  item_no       VARCHAR(80)  NULL,
  name          VARCHAR(255) NOT NULL,
  item_type     VARCHAR(40)  NULL,
  category      VARCHAR(150) NULL,
  unit          VARCHAR(40)  NULL,
  quantity      DECIMAL(18,4) NULL,
  min_quantity  DECIMAL(18,4) NULL,
  suspended     TINYINT(1)   NOT NULL DEFAULT 0,
  raw           JSON         NULL,
  synced_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (accurate_id),
  KEY idx_items_no (item_no),
  KEY idx_items_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 5. Data produk per customer (spesifikasi, bahan, desain)
CREATE TABLE IF NOT EXISTS customer_products (
  id           INT UNSIGNED NOT NULL AUTO_INCREMENT,
  customer_id  INT UNSIGNED NOT NULL,
  kode         VARCHAR(80)  NULL,          -- kode/nomor barang di Accurate (opsional)
  nama         VARCHAR(255) NOT NULL,
  jenis        VARCHAR(80)  NULL,          -- HD, PP, PE, Mika rigid, ...
  spesifikasi  TEXT         NULL,          -- ukuran, ketebalan, warna, jenis cetak, model kantong
  bahan        TEXT         NULL,          -- keterangan bahan baku
  keterangan   TEXT         NULL,
  status       ENUM('aktif','nonaktif') NOT NULL DEFAULT 'aktif',
  created_by   INT UNSIGNED NOT NULL,
  updated_by   INT UNSIGNED NULL,
  created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_products_customer (customer_id),
  KEY idx_products_nama (nama),
  CONSTRAINT fk_products_customer FOREIGN KEY (customer_id) REFERENCES customers (id) ON DELETE CASCADE,
  CONSTRAINT fk_products_created_by FOREIGN KEY (created_by) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Lampiran produk: PDF desain / gambar (disimpan di database)
CREATE TABLE IF NOT EXISTS customer_product_files (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  product_id  INT UNSIGNED NOT NULL,
  name        VARCHAR(255) NOT NULL,
  mime        VARCHAR(150) NOT NULL,
  size        INT UNSIGNED NOT NULL,
  data        MEDIUMBLOB   NOT NULL,
  uploaded_by INT UNSIGNED NOT NULL,
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_product_files_product (product_id),
  CONSTRAINT fk_product_files_product FOREIGN KEY (product_id) REFERENCES customer_products (id) ON DELETE CASCADE,
  CONSTRAINT fk_product_files_user FOREIGN KEY (uploaded_by) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 6. Menu baru & akses per divisi
--    produk: Marketing, PPIC, Produksi, Purchasing, Accounting (keuangan), General Manager
--    stok:   Marketing, PPIC, Produksi, Purchasing, Accounting, General Manager
INSERT IGNORE INTO division_menus (division_id, menu_key)
SELECT d.id, m.menu_key FROM divisions d JOIN (
  SELECT 'marketing' AS code, 'produk' AS menu_key UNION ALL
  SELECT 'ppic', 'produk' UNION ALL
  SELECT 'produksi', 'produk' UNION ALL
  SELECT 'purchasing', 'produk' UNION ALL
  SELECT 'accounting', 'produk' UNION ALL
  SELECT 'general_manager', 'produk' UNION ALL
  SELECT 'marketing', 'stok' UNION ALL
  SELECT 'ppic', 'stok' UNION ALL
  SELECT 'produksi', 'stok' UNION ALL
  SELECT 'purchasing', 'stok' UNION ALL
  SELECT 'accounting', 'stok' UNION ALL
  SELECT 'general_manager', 'stok'
) AS m ON m.code = d.code;

-- 7. Permission
INSERT INTO permissions (code, name, module, sort_order) VALUES
  ('customer.manage', 'Edit customer (tersimpan ke Accurate) & sinkron data Accurate', 'Customer', 21),
  ('product.manage',  'Tambah/edit data produk & upload desain',                     'Customer', 22)
ON DUPLICATE KEY UPDATE name = VALUES(name), module = VALUES(module), sort_order = VALUES(sort_order);

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code IN ('customer.manage', 'product.manage') WHERE r.code = 'admin';
