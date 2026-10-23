-- PAP-MS Inventory & Logistik (Guidance: packing order yang sudah jadi, surat jalan, standar waktu pengiriman, daftar ekspedisi termurah).
--   - Ekspedisi: master + riwayat tarif per kg & estimasi hari (otomatis dari keterangan SO Accurate "Pengiriman dengan X Rp Y/kg estimasi a-b hari")
--   - Pengiriman: dibuat dari SO Accurate, alur packing -> siap kirim -> dikirim -> diterima, cetak Surat Jalan

-- Tabel expeditions sudah ada dari 029 (ekspedisi + tujuan + tarif); kolom tambahan di 062.

-- Tarif per tujuan: dari SO (sumber so) atau isian manual
CREATE TABLE IF NOT EXISTS expedition_rates (
  id             INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  expedition_id  INT UNSIGNED  NOT NULL,
  sumber         ENUM('so','manual') NOT NULL DEFAULT 'manual',
  so_accurate_id INT UNSIGNED  NULL,
  so_number      VARCHAR(80)   NULL,
  tanggal        DATE          NULL,
  kota           VARCHAR(120)  NULL,
  provinsi       VARCHAR(120)  NULL,
  tarif_per_kg   DECIMAL(14,2) NULL,
  estimasi_min   TINYINT UNSIGNED NULL,
  estimasi_max   TINYINT UNSIGNED NULL,
  catatan        VARCHAR(500)  NULL,
  created_by     INT UNSIGNED  NULL,
  created_at     DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_rate_so (so_accurate_id),
  KEY idx_rate_kota (kota, tarif_per_kg),
  KEY idx_rate_exp (expedition_id, tanggal),
  CONSTRAINT fk_rate_expedition FOREIGN KEY (expedition_id) REFERENCES expeditions (id) ON DELETE CASCADE,
  CONSTRAINT fk_rate_user FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS shipments (
  id                   INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  nomor                VARCHAR(40)   NOT NULL,           -- SJ/2026/10/0001
  status               ENUM('packing','siap_kirim','dikirim','diterima','batal') NOT NULL DEFAULT 'packing',
  customer_accurate_id INT UNSIGNED  NULL,
  customer_name        VARCHAR(255)  NOT NULL,
  customer_no          VARCHAR(50)   NULL,
  alamat               VARCHAR(1000) NULL,
  telepon              VARCHAR(80)   NULL,
  expedition_id        INT UNSIGNED  NULL,
  ekspedisi_nama       VARCHAR(120)  NULL,
  no_resi              VARCHAR(80)   NULL,
  koli                 SMALLINT UNSIGNED NULL,
  berat_kg             DECIMAL(12,2) NULL,
  tarif_per_kg         DECIMAL(14,2) NULL,
  ongkir               DECIMAL(14,2) NULL,
  rencana_kirim        DATE          NULL,               -- tanggal kirim di SO / rencana
  tanggal_kirim        DATE          NULL,
  target_tiba          DATE          NULL,
  tanggal_diterima     DATE          NULL,
  penerima             VARCHAR(120)  NULL,
  sopir                VARCHAR(120)  NULL,               -- pengantar ke ekspedisi / kendaraan
  catatan              VARCHAR(1000) NULL,
  created_by           INT UNSIGNED  NULL,
  updated_by           INT UNSIGNED  NULL,
  created_at           DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at           DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_shipment_nomor (nomor),
  KEY idx_shipment_status (status, rencana_kirim),
  KEY idx_shipment_customer (customer_accurate_id),
  CONSTRAINT fk_shipment_expedition FOREIGN KEY (expedition_id) REFERENCES expeditions (id) ON DELETE SET NULL,
  CONSTRAINT fk_shipment_created FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT fk_shipment_updated FOREIGN KEY (updated_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS shipment_items (
  id             INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  shipment_id    INT UNSIGNED  NOT NULL,
  so_accurate_id INT UNSIGNED  NULL,
  so_number      VARCHAR(80)   NULL,
  item_no        VARCHAR(80)   NULL,
  item_name      VARCHAR(500)  NOT NULL,
  qty            DECIMAL(14,4) NOT NULL,
  unit           VARCHAR(40)   NULL,
  koli           SMALLINT UNSIGNED NULL,
  catatan        VARCHAR(500)  NULL,
  PRIMARY KEY (id),
  KEY idx_shipitem_so (so_accurate_id),
  CONSTRAINT fk_shipitem_shipment FOREIGN KEY (shipment_id) REFERENCES shipments (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Keterangan & alamat kirim SO (dipakai untuk ekspedisi & surat jalan)
ALTER TABLE accurate_sales_orders
  ADD COLUMN IF NOT EXISTS description VARCHAR(2000) NULL,
  ADD COLUMN IF NOT EXISTS to_address  VARCHAR(1000) NULL;

-- Standar waktu pengiriman: dikirim paling lambat N hari setelah tanggal kirim di SO
INSERT IGNORE INTO app_settings (`key`, value) VALUES ('logistik.toleransi_kirim_hari', '0');

-- Divisi Inventory & Logistik (Guidance) + menu
INSERT INTO divisions (code, name, has_levels, sort_order)
SELECT 'inventory_logistik', 'Inventory & Logistik', 1, COALESCE(MAX(sort_order), 0) + 1 FROM divisions
WHERE NOT EXISTS (SELECT 1 FROM divisions WHERE code = 'inventory_logistik');

INSERT IGNORE INTO division_menus (division_id, menu_key)
SELECT d.id, m.menu_key FROM divisions d
JOIN (SELECT 'pengiriman' AS menu_key UNION ALL SELECT 'ekspedisi' UNION ALL SELECT 'stok') m
WHERE d.code = 'inventory_logistik';

INSERT IGNORE INTO division_menus (division_id, menu_key)
SELECT d.id, m.menu_key FROM divisions d
JOIN (SELECT 'pengiriman' AS menu_key UNION ALL SELECT 'ekspedisi') m
WHERE d.code IN ('ppic', 'produksi', 'general_manager', 'accounting', 'marketing', 'marketing_development', 'marketing_maintenance');
