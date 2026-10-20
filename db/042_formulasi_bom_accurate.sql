-- PAP-MS: Formulasi Produk memakai Bill of Material (Formula Produksi) Accurate.
-- HPP tidak dipakai: bahan formulasi = barang Accurate bertanda Bahan Baku, jumlah per satuan hasil (bukan harga).

-- 1. Salinan Bill of Material Accurate (sinkron: daftar + detail bahan)
CREATE TABLE IF NOT EXISTS accurate_boms (
  accurate_id           INT UNSIGNED NOT NULL,
  number                VARCHAR(80)  NULL,            -- BOM.2026.10.00009
  trans_date            DATE         NULL,
  description           VARCHAR(500) NULL,
  item_accurate_id      INT UNSIGNED NULL,            -- barang jadi
  item_no               VARCHAR(80)  NULL,
  item_name             VARCHAR(255) NULL,
  quantity              DECIMAL(18,4) NULL,           -- jumlah hasil per formula (umumnya 1)
  unit                  VARCHAR(40)  NULL,
  suspended             TINYINT(1)   NOT NULL DEFAULT 0,
  last_update           VARCHAR(20)  NULL,
  detail_synced_update  VARCHAR(20)  NULL,
  synced_at             DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (accurate_id),
  KEY idx_boms_item (item_accurate_id),
  KEY idx_boms_number (number)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS accurate_bom_materials (
  bom_accurate_id   INT UNSIGNED NOT NULL,
  line_id           INT UNSIGNED NOT NULL,            -- id baris detailMaterial Accurate
  seq               SMALLINT UNSIGNED NULL,
  item_accurate_id  INT UNSIGNED NULL,                -- barang bahan baku
  item_no           VARCHAR(80)  NULL,
  item_name         VARCHAR(255) NULL,
  quantity          DECIMAL(18,6) NULL,               -- jumlah per formula (per jumlah hasil)
  unit              VARCHAR(40)  NULL,
  PRIMARY KEY (bom_accurate_id, line_id),
  KEY idx_bom_materials_item (item_accurate_id),
  CONSTRAINT fk_bom_materials_bom FOREIGN KEY (bom_accurate_id) REFERENCES accurate_boms (accurate_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. Formulasi PAP-MS = satu BOM Accurate + data tambahan (jenis plastik, kualitas, catatan, arsip)
ALTER TABLE formulations ADD COLUMN IF NOT EXISTS bom_accurate_id INT UNSIGNED NULL AFTER id;
ALTER TABLE formulations ADD UNIQUE KEY IF NOT EXISTS uq_formulations_bom (bom_accurate_id);
-- Formulasi lama (sebelum terhubung Accurate) tetap terbaca; bahan lamanya dari Tabel HPP
ALTER TABLE formulation_items MODIFY material_id INT UNSIGNED NULL;

