-- PAP-MS: visit bisa diikuti lebih dari satu sales; produk diminati prospek terhubung ke Data Produk;
-- request sample berisi beberapa produk (spek opsional)

-- 1. Sales per visit (visits.sales_id tetap = PIC utama)
CREATE TABLE IF NOT EXISTS visit_sales (
  visit_id  INT UNSIGNED NOT NULL,
  user_id   INT UNSIGNED NOT NULL,
  PRIMARY KEY (visit_id, user_id),
  KEY idx_visit_sales_user (user_id),
  CONSTRAINT fk_visit_sales_visit FOREIGN KEY (visit_id) REFERENCES visits (id) ON DELETE CASCADE,
  CONSTRAINT fk_visit_sales_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
INSERT IGNORE INTO visit_sales (visit_id, user_id) SELECT id, sales_id FROM visits;

-- 2. Produk yang diminati prospek (dari Data Produk, atau teks bebas bila product_id kosong)
CREATE TABLE IF NOT EXISTS prospect_products (
  id           INT UNSIGNED NOT NULL AUTO_INCREMENT,
  prospect_id  INT UNSIGNED NOT NULL,
  product_id   INT UNSIGNED NULL,
  label        VARCHAR(255) NOT NULL,
  sort_order   SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  KEY idx_prospect_products (prospect_id),
  CONSTRAINT fk_prospect_products_prospect FOREIGN KEY (prospect_id) REFERENCES prospects (id) ON DELETE CASCADE,
  CONSTRAINT fk_prospect_products_product FOREIGN KEY (product_id) REFERENCES customer_products (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Prospek lama: kebutuhan "A; B" dipecah menjadi baris teks bebas, dicocokkan ke Data Produk bila namanya sama persis
INSERT INTO prospect_products (prospect_id, product_id, label, sort_order)
SELECT p.id, (SELECT cp.id FROM customer_products cp WHERE cp.nama = TRIM(j.label) LIMIT 1), TRIM(j.label), j.n
FROM prospects p
JOIN JSON_TABLE(CONCAT('["', REPLACE(REPLACE(p.kebutuhan, '"', ''), ';', '","'), '"]'), '$[*]' COLUMNS (n FOR ORDINALITY, label VARCHAR(255) PATH '$')) j
WHERE p.kebutuhan IS NOT NULL AND p.kebutuhan <> '' AND TRIM(j.label) <> ''
  AND NOT EXISTS (SELECT 1 FROM prospect_products x WHERE x.prospect_id = p.id);

-- 3. Produk dalam satu request sample (spek per produk, semuanya opsional kecuali nama)
CREATE TABLE IF NOT EXISTS sample_request_items (
  id           INT UNSIGNED NOT NULL AUTO_INCREMENT,
  sample_id    INT UNSIGNED NOT NULL,
  product_id   INT UNSIGNED NULL,
  nama_produk  VARCHAR(255) NOT NULL,
  jenis        VARCHAR(80)  NULL,
  ukuran       VARCHAR(150) NULL,
  ketebalan    VARCHAR(80)  NULL,
  bahan        VARCHAR(255) NULL,
  warna_cetak  VARCHAR(255) NULL,
  jumlah       VARCHAR(80)  NULL,
  catatan      VARCHAR(1000) NULL,
  sort_order   SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  KEY idx_sample_items (sample_id),
  CONSTRAINT fk_sample_items_sample FOREIGN KEY (sample_id) REFERENCES sample_requests (id) ON DELETE CASCADE,
  CONSTRAINT fk_sample_items_product FOREIGN KEY (product_id) REFERENCES customer_products (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
INSERT INTO sample_request_items (sample_id, product_id, nama_produk, jenis, ukuran, ketebalan, bahan, warna_cetak, jumlah)
SELECT s.id, s.product_id, s.nama_produk, s.jenis, s.ukuran, s.ketebalan, s.bahan, s.warna_cetak, s.jumlah FROM sample_requests s
WHERE NOT EXISTS (SELECT 1 FROM sample_request_items i WHERE i.sample_id = s.id);
