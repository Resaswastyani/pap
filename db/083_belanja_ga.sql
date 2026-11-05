-- Menu Belanja ATK & RTK (General Affair): catatan belanja / nota pembelian ATK, RTK, obat, konsumsi, dll.
-- Satu nota = satu kali belanja (tanggal, toko, kategori) berisi beberapa item.
CREATE TABLE IF NOT EXISTS ga_belanja (
  id          INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  tanggal     DATE          NOT NULL,
  kategori    VARCHAR(50)   NOT NULL DEFAULT 'ATK',
  toko        VARCHAR(150)  NULL,
  catatan     TEXT          NULL,
  total       DECIMAL(18,2) NOT NULL DEFAULT 0,  -- jumlah total item (atau diisi langsung bila item tanpa harga)
  sumber      VARCHAR(255)  NULL,                -- asal impor Excel "<file>|<sheet>|<tabel>"; mencegah impor ganda
  created_by  INT UNSIGNED  NOT NULL,
  created_at  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_ga_belanja_sumber (sumber),
  KEY idx_ga_belanja_tanggal (tanggal, kategori),
  CONSTRAINT fk_ga_belanja_created_by FOREIGN KEY (created_by) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ga_belanja_items (
  id           INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  belanja_id   INT UNSIGNED  NOT NULL,
  urutan       SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  nama         VARCHAR(255)  NOT NULL,
  qty          DECIMAL(12,2) NULL,
  satuan       VARCHAR(40)   NULL,
  harga_satuan DECIMAL(18,2) NULL,
  total        DECIMAL(18,2) NULL,
  PRIMARY KEY (id),
  KEY idx_ga_belanja_items_nota (belanja_id, urutan),
  CONSTRAINT fk_ga_belanja_items_nota FOREIGN KEY (belanja_id) REFERENCES ga_belanja (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Menu untuk divisi General Affair & General Manager (divisi lain bisa ditambah di Manajemen Role > Menu per divisi)
INSERT IGNORE INTO division_menus (division_id, menu_key)
SELECT d.id, 'ga-belanja' FROM divisions d WHERE d.code IN ('general_affair', 'general_manager');
