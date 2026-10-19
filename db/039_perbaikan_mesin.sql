-- PAP-MS Fase 2 Produksi: laporan kerusakan mesin dari Produksi ke Teknik (ERD: permintaan_perbaikan)
-- Guidance: Produksi melaporkan mesin rusak / kendala / troubleshoot ke Teknik; Teknik melakukan maintenance dadakan.

CREATE TABLE IF NOT EXISTS machine_repairs (
  id               INT UNSIGNED NOT NULL AUTO_INCREMENT,
  nomor            VARCHAR(30)  NULL,                -- PRB-YYYYMM-00001
  machine_id       INT UNSIGNED NOT NULL,
  result_id        INT UNSIGNED NULL,                -- dari laporan hasil produksi (kendala mesin)
  keluhan          TEXT         NOT NULL,
  prioritas        ENUM('darurat','tinggi','normal') NOT NULL DEFAULT 'normal',
  mesin_berhenti   TINYINT(1)   NOT NULL DEFAULT 0,  -- mesin tidak bisa dipakai -> status mesin jadi maintenance
  status           ENUM('baru','dikerjakan','menunggu_part','selesai','batal') NOT NULL DEFAULT 'baru',
  teknisi_id       INT UNSIGNED NULL,
  penyebab         TEXT         NULL,
  tindakan         TEXT         NULL,
  sparepart        TEXT         NULL,                -- sparepart dipakai / dibutuhkan (stok sparepart menyusul di modul Teknik)
  target_selesai   DATETIME     NULL,
  mulai_at         DATETIME     NULL,
  selesai_at       DATETIME     NULL,
  reported_by      INT UNSIGNED NOT NULL,
  updated_by       INT UNSIGNED NULL,
  created_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_repairs_nomor (nomor),
  KEY idx_repairs_status (status, prioritas),
  KEY idx_repairs_machine (machine_id),
  CONSTRAINT fk_repairs_machine FOREIGN KEY (machine_id) REFERENCES machines (id),
  CONSTRAINT fk_repairs_result FOREIGN KEY (result_id) REFERENCES production_results (id) ON DELETE SET NULL,
  CONSTRAINT fk_repairs_teknisi FOREIGN KEY (teknisi_id) REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT fk_repairs_reported_by FOREIGN KEY (reported_by) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Notifikasi ke Teknik / pelapor, bisa diklik membuka laporan
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS repair_id INT UNSIGNED NULL AFTER quotation_id;
ALTER TABLE notifications MODIFY type ENUM('meeting_baru','meeting_diubah','meeting_reminder','planning_pic','planning_baru','sistem','prospek_baru','visit_reminder','followup_due','sample_update','desain_update','repeat_order','pembayaran','quotation','perbaikan_mesin') NOT NULL;

-- Menu Kerusakan Mesin: Produksi (pelapor), Teknik (penanganan), PPIC (dampak jadwal), GM
INSERT IGNORE INTO division_menus (division_id, menu_key)
SELECT d.id, 'perbaikan-mesin' FROM divisions d WHERE d.code IN ('produksi', 'teknik', 'ppic', 'general_manager');
