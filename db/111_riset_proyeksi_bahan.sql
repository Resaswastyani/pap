-- Riset & Proyeksi bahan baku (simulasi, seperti Excel "Proyeksi Produksi"):
-- satu dokumen berisi daftar produk rencana + komposisi bahan (HD, HD KW, PE, Kalsium, ...) + harga bahan,
-- lalu dihitung kebutuhan bahan, nilai Rupiah, HPP bahan, nilai jual, dan GPF. Tidak mengubah data Accurate.
CREATE TABLE IF NOT EXISTS material_projections (
  id              INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  kode            VARCHAR(30)   NOT NULL,
  nama            VARCHAR(200)  NOT NULL,
  tanggal_mulai   DATE          NULL,                 -- periode proyeksi (opsional)
  tanggal_selesai DATE          NULL,
  catatan         TEXT          NULL,
  harga_bahan     LONGTEXT      NULL,                 -- JSON [{ key, item_accurate_id, name, unit, harga, sumber }]
  created_by      INT UNSIGNED  NULL,
  updated_by      INT UNSIGNED  NULL,
  created_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_mp_kode (kode)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS material_projection_items (
  id               INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  projection_id    INT UNSIGNED  NOT NULL,
  sort             SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  item_accurate_id INT UNSIGNED  NULL,                -- produk Accurate (opsional; boleh produk baru/manual)
  nama             VARCHAR(255)  NOT NULL,
  satuan           VARCHAR(40)   NULL,
  quantity         DECIMAL(18,4) NOT NULL DEFAULT 0,
  harga_jual       DECIMAL(20,4) NULL,                -- Rupiah per satuan
  berat            DECIMAL(18,6) NOT NULL DEFAULT 1,  -- kg bahan per 1 satuan produk (1 untuk produk kg)
  waste            DECIMAL(6,3)  NOT NULL DEFAULT 5,  -- risiko waste & BS (%)
  komposisi        LONGTEXT      NULL,                -- JSON [{ key, item_accurate_id, name, persen }]
  bom_number       VARCHAR(80)   NULL,                -- BOM Accurate asal komposisi (bila diambil dari BOM)
  catatan          VARCHAR(255)  NULL,
  PRIMARY KEY (id),
  KEY idx_mpi_projection (projection_id, sort),
  CONSTRAINT fk_mpi_projection FOREIGN KEY (projection_id) REFERENCES material_projections (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
