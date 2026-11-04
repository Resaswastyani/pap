-- Menu Inventaris (General Affair): daftar aset / barang inventaris kantor, diisi langsung di PAP-MS.
-- Riwayat mencatat mutasi lokasi / pemegang, perubahan kondisi, perbaikan, dan catatan lain.
CREATE TABLE IF NOT EXISTS ga_inventaris (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  kode          VARCHAR(40)   NOT NULL,
  nama          VARCHAR(200)  NOT NULL,
  kategori      VARCHAR(100)  NULL,
  merek         VARCHAR(150)  NULL,               -- merek / tipe
  nomor_seri    VARCHAR(150)  NULL,
  lokasi        VARCHAR(150)  NULL,               -- ruangan / area
  pemegang_id   INT UNSIGNED  NULL,               -- penanggung jawab (user PAP-MS)
  pemegang_lain VARCHAR(150)  NULL,               -- penanggung jawab di luar user PAP-MS
  tanggal_beli  DATE          NULL,
  harga_beli    DECIMAL(18,2) NULL,
  kondisi       ENUM('baik','perlu_perbaikan','rusak','hilang') NOT NULL DEFAULT 'baik',
  status        ENUM('aktif','dihapuskan') NOT NULL DEFAULT 'aktif', -- dihapuskan = dijual / dibuang / tidak dipakai lagi
  catatan       TEXT          NULL,
  foto          MEDIUMBLOB    NULL,
  foto_mime     VARCHAR(50)   NULL,
  foto_at       DATETIME      NULL,
  created_by    INT UNSIGNED  NOT NULL,
  created_at    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_ga_inventaris_kode (kode),
  KEY idx_ga_inventaris_status (status, kategori),
  CONSTRAINT fk_ga_inventaris_pemegang FOREIGN KEY (pemegang_id) REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT fk_ga_inventaris_created_by FOREIGN KEY (created_by) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ga_inventaris_logs (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  item_id     INT UNSIGNED NOT NULL,
  tanggal     DATE         NOT NULL,
  jenis       ENUM('tambah','mutasi','kondisi','perbaikan','catatan','penghapusan') NOT NULL,
  keterangan  TEXT         NULL,
  biaya       DECIMAL(18,2) NULL,                 -- biaya perbaikan
  created_by  INT UNSIGNED NOT NULL,
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_ga_inventaris_logs_item (item_id, tanggal),
  CONSTRAINT fk_ga_inventaris_logs_item FOREIGN KEY (item_id) REFERENCES ga_inventaris (id) ON DELETE CASCADE,
  CONSTRAINT fk_ga_inventaris_logs_user FOREIGN KEY (created_by) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Menu untuk divisi General Affair & General Manager (divisi lain bisa ditambah di Manajemen Role > Menu per divisi)
INSERT IGNORE INTO division_menus (division_id, menu_key)
SELECT d.id, 'ga-inventaris' FROM divisions d WHERE d.code IN ('general_affair', 'general_manager');
