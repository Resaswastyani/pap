-- PAP-MS Fase 3 Produksi: database formulasi produk (Guidance: PPIC update formulasi bahan untuk produksi;
-- formulasi bahan & target quantity di SPK). ERD: formulasi & detail_formulasi. Bahan = bahan baku Tabel HPP (raw_materials).

CREATE TABLE IF NOT EXISTS formulations (
  id                INT UNSIGNED NOT NULL AUTO_INCREMENT,
  kode              VARCHAR(30)  NOT NULL,
  nama              VARCHAR(200) NOT NULL,
  jenis_plastik     VARCHAR(40)  NULL,                -- HD, PP, PE, LLDPE, Mika, ...
  tingkat_kualitas  VARCHAR(100) NULL,                -- Grade A, food grade, reguler, ...
  product_id        INT UNSIGNED NULL,                -- formulasi khusus produk customer (opsional)
  versi             SMALLINT UNSIGNED NOT NULL DEFAULT 1, -- naik setiap komposisi bahan berubah
  status            ENUM('aktif','arsip') NOT NULL DEFAULT 'aktif',
  catatan           TEXT         NULL,
  created_by        INT UNSIGNED NOT NULL,
  updated_by        INT UNSIGNED NULL,
  created_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_formulations_kode (kode),
  KEY idx_formulations_product (product_id),
  CONSTRAINT fk_formulations_product FOREIGN KEY (product_id) REFERENCES customer_products (id) ON DELETE SET NULL,
  CONSTRAINT fk_formulations_created_by FOREIGN KEY (created_by) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Campuran bahan: total persentase = 100
CREATE TABLE IF NOT EXISTS formulation_items (
  id              INT UNSIGNED NOT NULL AUTO_INCREMENT,
  formulation_id  INT UNSIGNED NOT NULL,
  urutan          TINYINT UNSIGNED NOT NULL,
  material_id     INT UNSIGNED NOT NULL,
  persentase      DECIMAL(6,3) NOT NULL,
  keterangan      VARCHAR(255) NULL,
  PRIMARY KEY (id),
  KEY idx_formulation_items (formulation_id, urutan),
  CONSTRAINT fk_formulation_items_formulation FOREIGN KEY (formulation_id) REFERENCES formulations (id) ON DELETE CASCADE,
  CONSTRAINT fk_formulation_items_material FOREIGN KEY (material_id) REFERENCES raw_materials (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- SPK memakai formulasi dari database (teks formulasi di SPK tetap disimpan sebagai salinan saat terbit)
ALTER TABLE production_jobs ADD COLUMN IF NOT EXISTS formulasi_id INT UNSIGNED NULL AFTER formulasi;
ALTER TABLE production_jobs ADD CONSTRAINT fk_jobs_formulasi FOREIGN KEY IF NOT EXISTS (formulasi_id) REFERENCES formulations (id) ON DELETE SET NULL;

-- Menu Formulasi Produk: PPIC (kelola), Produksi, Teknik, Purchasing (kebutuhan bahan), GM
INSERT IGNORE INTO division_menus (division_id, menu_key)
SELECT d.id, 'formulasi' FROM divisions d WHERE d.code IN ('ppic', 'produksi', 'teknik', 'purchasing', 'general_manager');
