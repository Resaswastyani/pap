-- PAP-MS Purchasing (Guidance divisi Purchasing), data dari Accurate Online (hanya baca):
--   - Database supplier                     -> accurate_vendors (+ catatan PAP-MS di vendor_profiles)
--   - PO pembelian & monitoring penerimaan  -> accurate_purchase_orders (+ baris barang)
--   - Database update harga bahan baku      -> harga dari baris PO (accurate_purchase_order_items)
--   - Hutang supplier / permintaan bayar    -> accurate_purchase_invoices (sisa hutang & jatuh tempo)
--   - Pembelian by request                  -> purchase_requests (Fase 4 Teknik) ditautkan ke nomor PO Accurate; PPIC ikut bisa mengajukan

CREATE TABLE IF NOT EXISTS accurate_vendors (
  accurate_id      INT UNSIGNED NOT NULL,
  vendor_no        VARCHAR(50)  NULL,
  name             VARCHAR(255) NOT NULL,
  category         VARCHAR(150) NULL,                -- kategori pemasok di Accurate
  email            VARCHAR(255) NULL,
  mobile_phone     VARCHAR(80)  NULL,
  work_phone       VARCHAR(80)  NULL,
  suspended        TINYINT(1)   NOT NULL DEFAULT 0,
  last_update      VARCHAR(20)  NULL,
  synced_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (accurate_id),
  KEY idx_acc_vendors_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Catatan Purchasing per supplier (tidak dikirim ke Accurate)
CREATE TABLE IF NOT EXISTS vendor_profiles (
  vendor_accurate_id INT UNSIGNED NOT NULL,
  jenis            SET('bahan_baku','bahan_pendukung','teknik','atk','jasa','lainnya') NULL,
  kontak           VARCHAR(150) NULL,                -- nama sales / PIC supplier
  telepon          VARCHAR(80)  NULL,
  lead_time_hari   SMALLINT UNSIGNED NULL,
  penilaian        TINYINT UNSIGNED NULL,            -- 1..5
  catatan          TEXT         NULL,
  updated_by       INT UNSIGNED NULL,
  updated_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (vendor_accurate_id),
  CONSTRAINT fk_vendor_profiles_user FOREIGN KEY (updated_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS accurate_purchase_orders (
  accurate_id      INT UNSIGNED NOT NULL,
  number           VARCHAR(80)  NULL,
  trans_date       DATE         NULL,
  ship_date        DATE         NULL,                -- tanggal kirim yang diharapkan
  vendor_accurate_id INT UNSIGNED NULL,
  total_amount     DECIMAL(20,2) NULL,
  status           VARCHAR(40)  NULL,                -- WAITING / ONPROCESS / FULLRECEIVED / CLOSED ...
  status_name      VARCHAR(80)  NULL,
  percent_shipped  DECIMAL(7,2) NULL,
  last_update      VARCHAR(20)  NULL,
  detail_synced_update VARCHAR(20) NULL,
  synced_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (accurate_id),
  KEY idx_acc_po_date (trans_date),
  KEY idx_acc_po_vendor (vendor_accurate_id, trans_date),
  KEY idx_acc_po_number (number)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS accurate_purchase_order_items (
  po_accurate_id   INT UNSIGNED NOT NULL,
  line_id          INT UNSIGNED NOT NULL,
  seq              INT          NULL,
  item_accurate_id INT UNSIGNED NULL,
  item_no          VARCHAR(80)  NULL,
  item_name        VARCHAR(500) NULL,
  quantity         DECIMAL(20,4) NULL,
  unit             VARCHAR(40)  NULL,
  unit_price       DECIMAL(20,4) NULL,
  total_price      DECIMAL(20,2) NULL,
  quantity_shipped DECIMAL(20,4) NULL,               -- sudah diterima
  notes            VARCHAR(1000) NULL,
  PRIMARY KEY (po_accurate_id, line_id),
  KEY idx_acc_poi_item (item_accurate_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS accurate_purchase_invoices (
  accurate_id      INT UNSIGNED NOT NULL,
  number           VARCHAR(80)  NULL,
  trans_date       DATE         NULL,
  due_date         DATE         NULL,
  vendor_accurate_id INT UNSIGNED NULL,
  total_amount     DECIMAL(20,2) NULL,
  owing            DECIMAL(20,2) NULL,               -- sisa hutang (primeOwing)
  status_name      VARCHAR(80)  NULL,                -- Belum Lunas / Lunas ...
  last_update      VARCHAR(20)  NULL,
  synced_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (accurate_id),
  KEY idx_acc_pi_owing (owing, due_date),
  KEY idx_acc_pi_vendor (vendor_accurate_id, trans_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Pengajuan pembelian -> PO Accurate yang memenuhinya
ALTER TABLE purchase_requests ADD COLUMN IF NOT EXISTS po_number VARCHAR(80) NULL AFTER catatan_purchasing;

-- Menu Purchasing: Purchasing & GM (semua), Accounting (supplier, PO, hutang), PPIC (PO, harga bahan, pengajuan pembelian bahan)
INSERT IGNORE INTO division_menus (division_id, menu_key)
SELECT d.id, m.menu_key FROM divisions d JOIN (
  SELECT 'purchasing' AS code, 'supplier' AS menu_key UNION ALL SELECT 'purchasing', 'po-pembelian' UNION ALL SELECT 'purchasing', 'harga-bahan' UNION ALL SELECT 'purchasing', 'hutang-supplier' UNION ALL
  SELECT 'general_manager', 'supplier' UNION ALL SELECT 'general_manager', 'po-pembelian' UNION ALL SELECT 'general_manager', 'harga-bahan' UNION ALL SELECT 'general_manager', 'hutang-supplier' UNION ALL
  SELECT 'accounting', 'supplier' UNION ALL SELECT 'accounting', 'po-pembelian' UNION ALL SELECT 'accounting', 'hutang-supplier' UNION ALL
  SELECT 'ppic', 'po-pembelian' UNION ALL SELECT 'ppic', 'harga-bahan' UNION ALL SELECT 'ppic', 'pengajuan-pembelian'
) AS m ON m.code = d.code;
