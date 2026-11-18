-- General Affair: menu "Data GA" tampil sebagai "Inventaris" (tab "Inventaris lainnya" = daftar inventaris lama),
-- menu baru "Jadwal Service Inventaris", dan depresiasi harga per tahun untuk memantau nilai jual barang.

-- Depresiasi per barang: persen per tahun + metode (garis lurus / saldo menurun). Kosong = mengikuti default kategori.
ALTER TABLE ga_inventaris
  ADD COLUMN IF NOT EXISTS depresiasi_pct    DECIMAL(5,2) NULL AFTER harga_beli,
  ADD COLUMN IF NOT EXISTS metode_depresiasi ENUM('garis_lurus','saldo_menurun') NULL AFTER depresiasi_pct;

-- Jadwal service per barang inventaris (servis AC, ganti oli kendaraan, kalibrasi, ...). Berulang tiap interval_bulan;
-- interval kosong = sekali jalan (selesai setelah dicatat).
CREATE TABLE IF NOT EXISTS ga_service_schedules (
  id               INT UNSIGNED NOT NULL AUTO_INCREMENT,
  item_id          INT UNSIGNED NOT NULL,
  nama             VARCHAR(200) NOT NULL,              -- jenis service, mis. "Cuci AC", "Ganti oli & tune up"
  interval_bulan   SMALLINT UNSIGNED NULL,
  jadwal           DATE         NOT NULL,              -- jadwal service berikutnya
  terakhir         DATE         NULL,                  -- service terakhir yang dicatat
  vendor           VARCHAR(150) NULL,
  perkiraan_biaya  DECIMAL(18,2) NULL,
  pic_id           INT UNSIGNED NULL,
  pic_lain         VARCHAR(150) NULL,
  pengingat_hari   SMALLINT UNSIGNED NOT NULL DEFAULT 7,
  aktif            TINYINT(1)   NOT NULL DEFAULT 1,
  catatan          TEXT         NULL,
  created_by       INT UNSIGNED NOT NULL,
  created_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_ga_service_jadwal (aktif, jadwal),
  KEY idx_ga_service_item (item_id),
  CONSTRAINT fk_ga_service_item FOREIGN KEY (item_id) REFERENCES ga_inventaris (id) ON DELETE CASCADE,
  CONSTRAINT fk_ga_service_pic FOREIGN KEY (pic_id) REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT fk_ga_service_created_by FOREIGN KEY (created_by) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Realisasi service dicatat di riwayat inventaris (jenis 'service') dan terhubung ke jadwalnya
ALTER TABLE ga_inventaris_logs
  MODIFY COLUMN jenis ENUM('tambah','mutasi','kondisi','perbaikan','catatan','penghapusan','service') NOT NULL,
  ADD COLUMN IF NOT EXISTS schedule_id INT UNSIGNED NULL AFTER item_id,
  ADD COLUMN IF NOT EXISTS vendor VARCHAR(150) NULL AFTER biaya;
ALTER TABLE ga_inventaris_logs ADD CONSTRAINT fk_ga_inventaris_logs_schedule FOREIGN KEY IF NOT EXISTS (schedule_id) REFERENCES ga_service_schedules (id) ON DELETE SET NULL;

-- Menu "Inventaris" (kunci ga-data) dibuka untuk divisi yang dulu punya menu Inventaris lama (ga-inventaris), dan sebaliknya,
-- supaya akses tab "Inventaris lainnya" tidak berubah. Menu Jadwal Service Inventaris untuk divisi yang sama.
INSERT IGNORE INTO division_menus (division_id, menu_key) SELECT division_id, 'ga-data' FROM division_menus WHERE menu_key = 'ga-inventaris';
INSERT IGNORE INTO division_menus (division_id, menu_key) SELECT division_id, 'ga-inventaris' FROM division_menus WHERE menu_key = 'ga-data';
INSERT IGNORE INTO division_menus (division_id, menu_key) SELECT division_id, 'ga-service' FROM division_menus WHERE menu_key = 'ga-data';
