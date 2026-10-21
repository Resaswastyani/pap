-- PAP-MS Fase 4 Teknik (Guidance divisi Tehnik):
--   1. Jadwal & checkup perawatan mesin  -> "Pengecekan fungsi mesin dan maintenance rutin", "Dokumen checkup & maintenance mesin"
--   2. Standar setting mesin             -> "Membuat standar setting penggunaan mesin", "Dokumen standar settingan mesin"
--   3. Peralatan & sparepart teknik      -> "Mengatur stok sparepart tehnik mesin", "Mengatur dan mendata peralatan tehnik"
--   4. Pengajuan pembelian               -> "Pengajuan pembelian peralatan tehnik atau sparepart ke divisi purchasing"

-- 1. Jadwal perawatan rutin per mesin (interval hari) + log checkup
CREATE TABLE IF NOT EXISTS maintenance_plans (
  id               INT UNSIGNED NOT NULL AUTO_INCREMENT,
  machine_id       INT UNSIGNED NOT NULL,
  judul            VARCHAR(200) NOT NULL,            -- mis. Ganti oli gearbox, Cek pisau las
  komponen         VARCHAR(150) NULL,                -- komponen mesin (sama dengan critical point bila ada)
  interval_hari    SMALLINT UNSIGNED NOT NULL,       -- tiap berapa hari
  berikutnya       DATE         NOT NULL,            -- jatuh tempo berikutnya
  terakhir         DATE         NULL,                -- checkup terakhir
  pic_id           INT UNSIGNED NULL,                -- teknisi penanggung jawab
  aktif            TINYINT(1)   NOT NULL DEFAULT 1,
  catatan          TEXT         NULL,
  created_by       INT UNSIGNED NOT NULL,
  created_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_maint_plans_due (aktif, berikutnya),
  KEY idx_maint_plans_machine (machine_id),
  CONSTRAINT fk_maint_plans_machine FOREIGN KEY (machine_id) REFERENCES machines (id) ON DELETE CASCADE,
  CONSTRAINT fk_maint_plans_pic FOREIGN KEY (pic_id) REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT fk_maint_plans_created_by FOREIGN KEY (created_by) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS maintenance_logs (
  id               INT UNSIGNED NOT NULL AUTO_INCREMENT,
  plan_id          INT UNSIGNED NULL,                -- kosong = checkup di luar jadwal
  machine_id       INT UNSIGNED NOT NULL,
  tanggal          DATE         NOT NULL,
  hasil            ENUM('baik','perlu_tindakan','rusak') NOT NULL,
  temuan           TEXT         NULL,
  tindakan         TEXT         NULL,
  durasi_menit     INT UNSIGNED NULL,
  repair_id        INT UNSIGNED NULL,                -- hasil rusak -> laporan Kerusakan Mesin
  dikerjakan_oleh  INT UNSIGNED NOT NULL,
  created_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_maint_logs_machine (machine_id, tanggal),
  KEY idx_maint_logs_plan (plan_id, tanggal),
  CONSTRAINT fk_maint_logs_plan FOREIGN KEY (plan_id) REFERENCES maintenance_plans (id) ON DELETE SET NULL,
  CONSTRAINT fk_maint_logs_machine FOREIGN KEY (machine_id) REFERENCES machines (id) ON DELETE CASCADE,
  CONSTRAINT fk_maint_logs_repair FOREIGN KEY (repair_id) REFERENCES machine_repairs (id) ON DELETE SET NULL,
  CONSTRAINT fk_maint_logs_user FOREIGN KEY (dikerjakan_oleh) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. Standar setting mesin: parameter per mesin, bisa per produk / kondisi (kosong = umum)
CREATE TABLE IF NOT EXISTS machine_settings (
  id               INT UNSIGNED NOT NULL AUTO_INCREMENT,
  machine_id       INT UNSIGNED NOT NULL,
  produk           VARCHAR(200) NULL,                -- produk / ukuran / jenis bahan; kosong = setting umum
  parameter        VARCHAR(150) NOT NULL,            -- Suhu zona 1, Kecepatan screw, Tekanan angin, ...
  nilai            VARCHAR(100) NOT NULL,
  satuan           VARCHAR(40)  NULL,
  toleransi        VARCHAR(60)  NULL,                -- mis. ± 5
  urut             SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  catatan          VARCHAR(500) NULL,
  updated_by       INT UNSIGNED NULL,
  created_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_machine_settings (machine_id, produk, urut),
  CONSTRAINT fk_machine_settings_machine FOREIGN KEY (machine_id) REFERENCES machines (id) ON DELETE CASCADE,
  CONSTRAINT fk_machine_settings_user FOREIGN KEY (updated_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. Peralatan & sparepart teknik + mutasi stok
CREATE TABLE IF NOT EXISTS tech_items (
  id               INT UNSIGNED NOT NULL AUTO_INCREMENT,
  kode             VARCHAR(40)  NOT NULL,
  nama             VARCHAR(200) NOT NULL,
  jenis            ENUM('sparepart','peralatan','bahan') NOT NULL DEFAULT 'sparepart', -- bahan = oli, grease, dll.
  kategori         VARCHAR(100) NULL,
  machine_id       INT UNSIGNED NULL,                -- dipakai untuk mesin ini (kosong = umum)
  satuan           VARCHAR(40)  NOT NULL DEFAULT 'pcs',
  stok             DECIMAL(18,4) NOT NULL DEFAULT 0,
  stok_minimum     DECIMAL(18,4) NOT NULL DEFAULT 0,
  lokasi           VARCHAR(150) NULL,
  kondisi          ENUM('baik','perlu_perbaikan','rusak') NOT NULL DEFAULT 'baik', -- untuk peralatan
  catatan          TEXT         NULL,
  aktif            TINYINT(1)   NOT NULL DEFAULT 1,
  created_by       INT UNSIGNED NOT NULL,
  created_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_tech_items_kode (kode),
  KEY idx_tech_items_jenis (aktif, jenis),
  CONSTRAINT fk_tech_items_machine FOREIGN KEY (machine_id) REFERENCES machines (id) ON DELETE SET NULL,
  CONSTRAINT fk_tech_items_created_by FOREIGN KEY (created_by) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4. Pengajuan pembelian (Teknik -> Purchasing)
CREATE TABLE IF NOT EXISTS purchase_requests (
  id               INT UNSIGNED NOT NULL AUTO_INCREMENT,
  nomor            VARCHAR(30)  NULL,                -- PP-YYYYMM-00001
  keperluan        TEXT         NOT NULL,            -- alasan / untuk apa
  prioritas        ENUM('darurat','tinggi','normal') NOT NULL DEFAULT 'normal',
  dibutuhkan       DATE         NULL,
  status           ENUM('diajukan','disetujui','dipesan','diterima','ditolak','batal') NOT NULL DEFAULT 'diajukan',
  repair_id        INT UNSIGNED NULL,                -- untuk perbaikan mesin tertentu
  catatan_purchasing TEXT       NULL,
  requested_by     INT UNSIGNED NOT NULL,
  processed_by     INT UNSIGNED NULL,
  processed_at     DATETIME     NULL,
  received_at      DATETIME     NULL,
  created_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_purchase_requests_nomor (nomor),
  KEY idx_purchase_requests_status (status, prioritas),
  CONSTRAINT fk_purchase_requests_repair FOREIGN KEY (repair_id) REFERENCES machine_repairs (id) ON DELETE SET NULL,
  CONSTRAINT fk_purchase_requests_user FOREIGN KEY (requested_by) REFERENCES users (id),
  CONSTRAINT fk_purchase_requests_processed FOREIGN KEY (processed_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS purchase_request_items (
  id               INT UNSIGNED NOT NULL AUTO_INCREMENT,
  request_id       INT UNSIGNED NOT NULL,
  item_id          INT UNSIGNED NULL,                -- barang yang sudah ada di data sparepart (stok bertambah saat diterima)
  nama             VARCHAR(200) NOT NULL,
  spesifikasi      VARCHAR(500) NULL,
  jumlah           DECIMAL(18,4) NOT NULL,
  satuan           VARCHAR(40)  NOT NULL DEFAULT 'pcs',
  urut             SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  KEY idx_pr_items_request (request_id, urut),
  CONSTRAINT fk_pr_items_request FOREIGN KEY (request_id) REFERENCES purchase_requests (id) ON DELETE CASCADE,
  CONSTRAINT fk_pr_items_item FOREIGN KEY (item_id) REFERENCES tech_items (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS tech_item_moves (
  id               INT UNSIGNED NOT NULL AUTO_INCREMENT,
  item_id          INT UNSIGNED NOT NULL,
  tanggal          DATE         NOT NULL,
  jenis            ENUM('masuk','keluar','penyesuaian') NOT NULL,
  jumlah           DECIMAL(18,4) NOT NULL,           -- masuk/keluar: positif; penyesuaian: selisih (+/-)
  stok_setelah     DECIMAL(18,4) NOT NULL,
  repair_id        INT UNSIGNED NULL,                -- dipakai untuk perbaikan mesin
  purchase_request_id INT UNSIGNED NULL,             -- masuk dari pengajuan pembelian yang diterima
  keterangan       VARCHAR(500) NULL,
  created_by       INT UNSIGNED NOT NULL,
  created_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_tech_moves_item (item_id, id),
  CONSTRAINT fk_tech_moves_item FOREIGN KEY (item_id) REFERENCES tech_items (id) ON DELETE CASCADE,
  CONSTRAINT fk_tech_moves_repair FOREIGN KEY (repair_id) REFERENCES machine_repairs (id) ON DELETE SET NULL,
  CONSTRAINT fk_tech_moves_pr FOREIGN KEY (purchase_request_id) REFERENCES purchase_requests (id) ON DELETE SET NULL,
  CONSTRAINT fk_tech_moves_user FOREIGN KEY (created_by) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 5. Lampiran (foto checkup, penawaran vendor) memakai lampiran catatan
-- (sekaligus menambahkan 'repair' = foto Kerusakan Mesin, yang sudah dipakai kode tetapi belum ada di enum)
ALTER TABLE note_attachments MODIFY owner_type ENUM('activity','request_log','stage','job','repair','maintenance_log','purchase_request') NOT NULL;

-- 6. Notifikasi: tujuan umum (nama menu + id data) agar fitur baru tidak perlu kolom baru per jenis
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS target_page VARCHAR(40) NULL AFTER repair_id;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS target_id   INT UNSIGNED NULL AFTER target_page;
ALTER TABLE notifications MODIFY type ENUM('meeting_baru','meeting_diubah','meeting_reminder','planning_pic','planning_baru','sistem','prospek_baru','visit_reminder','followup_due','sample_update','desain_update','repeat_order','pembayaran','quotation','perbaikan_mesin','perawatan_mesin','stok_sparepart','pengajuan_pembelian') NOT NULL;

-- 7. Menu Teknik: Teknik (pengelola), Produksi & PPIC (lihat jadwal perawatan & standar setting), Purchasing (sparepart & pengajuan), GM
INSERT IGNORE INTO division_menus (division_id, menu_key)
SELECT d.id, m.menu_key FROM divisions d JOIN (
  SELECT 'teknik' AS code, 'perawatan-mesin' AS menu_key UNION ALL SELECT 'produksi', 'perawatan-mesin' UNION ALL SELECT 'ppic', 'perawatan-mesin' UNION ALL SELECT 'general_manager', 'perawatan-mesin' UNION ALL
  SELECT 'teknik', 'standar-setting' UNION ALL SELECT 'produksi', 'standar-setting' UNION ALL SELECT 'ppic', 'standar-setting' UNION ALL SELECT 'general_manager', 'standar-setting' UNION ALL
  SELECT 'teknik', 'sparepart' UNION ALL SELECT 'purchasing', 'sparepart' UNION ALL SELECT 'general_manager', 'sparepart' UNION ALL
  SELECT 'teknik', 'pengajuan-pembelian' UNION ALL SELECT 'purchasing', 'pengajuan-pembelian' UNION ALL SELECT 'general_manager', 'pengajuan-pembelian'
) AS m ON m.code = d.code;
