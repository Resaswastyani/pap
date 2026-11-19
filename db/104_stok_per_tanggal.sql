-- Stok per tanggal (Stok Bahan Baku & Barang Jadi):
-- harian = dicatat otomatis dari salinan Accurate setiap sinkron (nilai akhir hari itu, termasuk harga pokok hari itu)
-- asof   = dihitung dari Accurate (get-stock asOfDate) untuk tanggal sebelum pencatatan harian ada; nilai memakai harga pokok saat dihitung
CREATE TABLE IF NOT EXISTS stock_snapshots (
  tanggal      DATE          NOT NULL,
  accurate_id  INT UNSIGNED  NOT NULL,
  qty          DECIMAL(18,4) NULL,
  unit_cost    DECIMAL(20,4) NULL,
  sumber       ENUM('harian','asof') NOT NULL DEFAULT 'harian',
  updated_at   DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (tanggal, accurate_id),
  KEY idx_stock_snapshots_item (accurate_id, tanggal)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
