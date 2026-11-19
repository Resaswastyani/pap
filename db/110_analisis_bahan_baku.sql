-- Analisis Bahan Baku: harga bahan acuan yang diisi manual di SIMPAP (mis. harga terbaru dari supplier termasuk PPN).
-- Bila kosong, analisis memakai harga dari Accurate (harga pokok rata-rata atau harga beli terakhir di PO).
CREATE TABLE IF NOT EXISTS production_material_prices (
  item_accurate_id INT UNSIGNED  NOT NULL,             -- barang bahan di Accurate
  harga            DECIMAL(20,4) NOT NULL,             -- Rupiah per satuan bahan
  catatan          VARCHAR(255)  NULL,                 -- mis. "per 13/11/26, BMA, incl PPN"
  updated_by       INT UNSIGNED  NULL,
  updated_at       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (item_accurate_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
