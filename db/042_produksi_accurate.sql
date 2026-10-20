-- PAP-MS: Rencana Produksi (manufacture-order, MP) dan Penyelesaian Barang Jadi (finished-good-slip, FGS) dari Accurate.
-- Header semua dokumen disinkron lewat list.do (inkremental lastUpdate); baris barang diambil dari detail.do
-- untuk dokumen terbaru (lihat ACCURATE_PRODUCTION_DAYS di lib/accurate-sync.ts).

CREATE TABLE IF NOT EXISTS accurate_manufacture_orders (
  accurate_id          INT UNSIGNED NOT NULL,
  number               VARCHAR(80)  NULL,
  name                 VARCHAR(255) NULL,
  trans_date           DATE         NULL,
  start_date           DATE         NULL,
  end_date             DATE         NULL,
  status               VARCHAR(40)  NULL,           -- PROCESSED, ...
  status_name          VARCHAR(80)  NULL,           -- Terproses, ...
  progress             DECIMAL(6,2) NULL,           -- portion (%)
  description          TEXT         NULL,
  last_update          VARCHAR(20)  NULL,           -- lastUpdate Accurate (dd/MM/yyyy HH:mm:ss)
  detail_synced_update VARCHAR(20)  NULL,           -- lastUpdate saat baris terakhir diambil; beda = perlu diambil ulang
  synced_at            DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (accurate_id),
  KEY idx_mo_date (trans_date),
  KEY idx_mo_pending (detail_synced_update)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Baris Rencana Produksi: satu per formula produksi (BOM) / produk utama
CREATE TABLE IF NOT EXISTS accurate_manufacture_order_items (
  mo_accurate_id    INT UNSIGNED  NOT NULL,
  line_id           INT UNSIGNED  NOT NULL,
  seq               INT UNSIGNED  NULL,
  item_accurate_id  INT UNSIGNED  NULL,
  item_no           VARCHAR(80)   NULL,
  item_name         VARCHAR(500)  NULL,
  bom_accurate_id   INT UNSIGNED  NULL,
  bom_number        VARCHAR(80)   NULL,
  quantity          DECIMAL(18,4) NULL,
  unit              VARCHAR(40)   NULL,
  start_date        DATE          NULL,
  end_date          DATE          NULL,
  status            VARCHAR(40)   NULL,           -- FINISHED, ...
  status_name       VARCHAR(80)   NULL,           -- Selesai, ...
  progress          DECIMAL(6,2)  NULL,           -- portionProgress (%)
  wo_quantity       DECIMAL(18,4) NULL,           -- kuantitas perintah kerja
  fgs_quantity      DECIMAL(18,4) NULL,           -- kuantitas produk jadi (penyelesaian)
  material_percent  DECIMAL(6,2)  NULL,           -- % bahan sudah diambil
  notes             VARCHAR(1000) NULL,
  PRIMARY KEY (mo_accurate_id, line_id),
  KEY idx_moi_item (item_accurate_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS accurate_finished_good_slips (
  accurate_id          INT UNSIGNED NOT NULL,
  number               VARCHAR(80)  NULL,
  trans_date           DATE         NULL,
  wo_accurate_id       INT UNSIGNED NULL,           -- Perintah Kerja (WO)
  wo_number            VARCHAR(80)  NULL,
  mo_accurate_id       INT UNSIGNED NULL,           -- Rencana Produksi (MP) asal perintah kerja
  description          TEXT         NULL,
  last_update          VARCHAR(20)  NULL,
  detail_synced_update VARCHAR(20)  NULL,
  synced_at            DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (accurate_id),
  KEY idx_fgs_date (trans_date),
  KEY idx_fgs_mo (mo_accurate_id),
  KEY idx_fgs_pending (detail_synced_update)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Barang jadi yang diselesaikan
CREATE TABLE IF NOT EXISTS accurate_finished_good_slip_items (
  fgs_accurate_id  INT UNSIGNED  NOT NULL,
  line_id          INT UNSIGNED  NOT NULL,
  seq              INT UNSIGNED  NULL,
  item_accurate_id INT UNSIGNED  NULL,
  item_no          VARCHAR(80)   NULL,
  item_name        VARCHAR(500)  NULL,
  quantity         DECIMAL(18,4) NULL,
  unit             VARCHAR(40)   NULL,
  warehouse        VARCHAR(150)  NULL,
  notes            VARCHAR(1000) NULL,
  PRIMARY KEY (fgs_accurate_id, line_id),
  KEY idx_fgsi_item (item_accurate_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
