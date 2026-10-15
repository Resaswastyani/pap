-- PAP-MS: Sales Order Accurate (dengan baris barang) sebagai sumber Data Produk per customer

-- 1. Header Sales Order
CREATE TABLE IF NOT EXISTS accurate_sales_orders (
  accurate_id          INT UNSIGNED NOT NULL,
  number               VARCHAR(80)  NULL,
  trans_date           DATE         NULL,
  customer_accurate_id INT UNSIGNED NULL,
  total_amount         DECIMAL(18,2) NULL,
  status               VARCHAR(80)  NULL,
  last_update          VARCHAR(20)  NULL,  -- lastUpdate Accurate (dd/MM/yyyy HH:mm:ss)
  items_synced_update  VARCHAR(20)  NULL,  -- lastUpdate saat baris barang terakhir diambil; beda = perlu diambil ulang
  synced_at            DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (accurate_id),
  KEY idx_so_customer (customer_accurate_id, trans_date),
  KEY idx_so_pending (items_synced_update)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. Baris barang Sales Order
CREATE TABLE IF NOT EXISTS accurate_sales_order_items (
  so_accurate_id   INT UNSIGNED NOT NULL,
  line_id          INT UNSIGNED NOT NULL,
  item_accurate_id INT UNSIGNED NULL,
  item_no          VARCHAR(80)  NULL,
  item_name        VARCHAR(255) NULL,
  quantity         DECIMAL(18,4) NULL,
  unit             VARCHAR(40)  NULL,
  unit_price       DECIMAL(18,2) NULL,
  notes            VARCHAR(500) NULL,
  PRIMARY KEY (so_accurate_id, line_id),
  KEY idx_soi_item (item_accurate_id),
  CONSTRAINT fk_soi_so FOREIGN KEY (so_accurate_id) REFERENCES accurate_sales_orders (accurate_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. Produk terhubung ke barang Accurate; customer_id = customer utama (pemesan terbanyak), boleh kosong
ALTER TABLE customer_products MODIFY customer_id INT UNSIGNED NULL;
ALTER TABLE customer_products ADD COLUMN IF NOT EXISTS accurate_item_id INT UNSIGNED NULL AFTER customer_id;
ALTER TABLE customer_products ADD UNIQUE KEY IF NOT EXISTS uq_products_item (accurate_item_id);
ALTER TABLE customer_products MODIFY created_by INT UNSIGNED NULL; -- produk dari sinkron Accurate tidak punya pembuat
