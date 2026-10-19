-- PAP-MS Fase 1 Produksi (Guidance: SPK berisi formulasi bahan & target quantity; laporan hasil produksi & monitoring QC per shift)

-- 1. SPK (Surat Perintah Kerja) = job produksi yang diterbitkan PPIC
ALTER TABLE production_jobs ADD COLUMN IF NOT EXISTS spk_nomor        VARCHAR(30)   NULL AFTER nomor;
ALTER TABLE production_jobs ADD COLUMN IF NOT EXISTS spk_terbit_at    DATETIME      NULL AFTER spk_nomor;
ALTER TABLE production_jobs ADD COLUMN IF NOT EXISTS spk_terbit_oleh  INT UNSIGNED  NULL AFTER spk_terbit_at;
ALTER TABLE production_jobs ADD COLUMN IF NOT EXISTS target_qty       DECIMAL(18,4) NULL AFTER unit;          -- target hasil produksi (kosong = jumlah pesanan)
ALTER TABLE production_jobs ADD COLUMN IF NOT EXISTS formulasi        TEXT          NULL AFTER catatan;       -- campuran / formulasi bahan
ALTER TABLE production_jobs ADD COLUMN IF NOT EXISTS tingkat_kualitas VARCHAR(100)  NULL AFTER formulasi;     -- mis. Grade A, food grade
ALTER TABLE production_jobs ADD COLUMN IF NOT EXISTS acuan_kerja      TEXT          NULL AFTER tingkat_kualitas; -- acuan kerja / instruksi untuk KA Shift
ALTER TABLE production_jobs ADD UNIQUE KEY IF NOT EXISTS uq_jobs_spk_nomor (spk_nomor);

-- Target per tahap (mis. Blow dalam kg, Bag making dalam pcs); kosong = target job
ALTER TABLE production_stages ADD COLUMN IF NOT EXISTS target_qty  DECIMAL(18,4) NULL AFTER progress;
ALTER TABLE production_stages ADD COLUMN IF NOT EXISTS target_unit VARCHAR(40)   NULL AFTER target_qty;

-- 2. Laporan hasil produksi per tahap, tanggal, & shift + monitoring QC
CREATE TABLE IF NOT EXISTS production_results (
  id             INT UNSIGNED NOT NULL AUTO_INCREMENT,
  job_id         INT UNSIGNED NOT NULL,
  stage_id       INT UNSIGNED NOT NULL,
  tanggal        DATE         NOT NULL,            -- tanggal produksi (shift 3 dini hari ikut tanggal mulai shift)
  shift          TINYINT UNSIGNED NOT NULL,        -- 1, 2, 3
  machine_id     INT UNSIGNED NULL,
  jumlah_hasil   DECIMAL(18,4) NOT NULL,           -- total keluar mesin
  jumlah_reject  DECIMAL(18,4) NOT NULL DEFAULT 0, -- afalan / reject
  satuan         VARCHAR(40)  NULL,
  operator       VARCHAR(255) NULL,                -- nama operator yang bertugas
  kendala        TEXT         NULL,                -- kendala bahan baku / mesin
  catatan        TEXT         NULL,
  status_qc      ENUM('menunggu','lolos','perbaikan','reject') NOT NULL DEFAULT 'menunggu',
  catatan_qc     TEXT         NULL,
  qc_by          INT UNSIGNED NULL,
  qc_at          DATETIME     NULL,
  reported_by    INT UNSIGNED NOT NULL,
  created_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_results_tanggal (tanggal, shift),
  KEY idx_results_stage (stage_id),
  KEY idx_results_job (job_id),
  CONSTRAINT fk_results_job FOREIGN KEY (job_id) REFERENCES production_jobs (id) ON DELETE CASCADE,
  CONSTRAINT fk_results_stage FOREIGN KEY (stage_id) REFERENCES production_stages (id) ON DELETE CASCADE,
  CONSTRAINT fk_results_machine FOREIGN KEY (machine_id) REFERENCES machines (id) ON DELETE SET NULL,
  CONSTRAINT fk_results_qc_by FOREIGN KEY (qc_by) REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT fk_results_reported_by FOREIGN KEY (reported_by) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. Menu Hasil Produksi & QC: Produksi, PPIC, Teknik (kendala mesin), GM. Menu SPK (kunci 'sbk') sudah untuk PPIC, Produksi, GM.
INSERT IGNORE INTO division_menus (division_id, menu_key)
SELECT d.id, 'hasil-produksi' FROM divisions d WHERE d.code IN ('produksi', 'ppic', 'teknik', 'general_manager');

-- 4. Permission verifikasi QC (selain Kepala Produksi, PPIC lead, GM)
INSERT INTO permissions (code, name, module, sort_order) VALUES
  ('production.qc', 'Verifikasi QC hasil produksi', 'Produksi', 33)
ON DUPLICATE KEY UPDATE name = VALUES(name), module = VALUES(module), sort_order = VALUES(sort_order);

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code = 'production.qc' WHERE r.code = 'admin';
