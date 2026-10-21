-- PAP-MS: daftar supplier (vendor) dari Accurate di menu Pengajuan Pembelian.
-- "Supplier teknik" (mesin, sparepart, bengkel) ditebak dari kategori & nama vendor di Accurate dan bisa dibetulkan
-- Teknik / Purchasing (kolom teknik: NULL = otomatis, 1 = ya, 0 = bukan).

CREATE TABLE IF NOT EXISTS accurate_vendors (
  accurate_id    INT UNSIGNED NOT NULL,
  vendor_no      VARCHAR(50)  NULL,
  name           VARCHAR(255) NOT NULL,
  category       VARCHAR(150) NULL,
  mobile_phone   VARCHAR(80)  NULL,
  work_phone     VARCHAR(80)  NULL,
  email          VARCHAR(255) NULL,
  city           VARCHAR(150) NULL,
  address        VARCHAR(500) NULL,
  suspended      TINYINT(1)   NOT NULL DEFAULT 0,
  teknik         TINYINT(1)   NULL,                 -- penandaan manual; NULL = ikut tebakan otomatis
  synced_at      DATETIME     NOT NULL,
  PRIMARY KEY (accurate_id),
  KEY idx_vendors_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Supplier yang dipilih Purchasing untuk pengajuan pembelian
ALTER TABLE purchase_requests ADD COLUMN IF NOT EXISTS vendor_accurate_id INT UNSIGNED NULL AFTER repair_id;
