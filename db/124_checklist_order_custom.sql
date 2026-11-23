-- Form Checklist Order Custom: kelengkapan data order custom (spek, desain plastik, desain cetakan) sebelum produksi.
-- Alur: Marketing mengisi & memeriksa -> diserahkan ke PPIC (verifikasi & paraf) -> Divisi Operasional / Produksi
-- (terima & paraf) -> selesai. Bisa dicentang di SIMPAP atau dicetak (PDF / Word, juga formulir kosong) lalu dicentang manual.
CREATE TABLE IF NOT EXISTS order_custom_checklists (
  id                INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  nomor             VARCHAR(30)   NOT NULL,              -- OC-2026-0001
  status            ENUM('draft','ppic','operasional','selesai') NOT NULL DEFAULT 'draft',
  tanggal           DATE          NOT NULL,
  prospect_id       INT UNSIGNED  NULL,
  nama_customer     VARCHAR(255)  NOT NULL,
  nama_produk       VARCHAR(255)  NOT NULL,
  referensi         VARCHAR(150)  NULL,                  -- No. SO / PO / quotation / request desain
  isian             LONGTEXT      NULL,                  -- JSON isian checklist (lihat lib/order-custom.ts)
  catatan           TEXT          NULL,
  alasan_kembali    TEXT          NULL,                  -- alasan dikembalikan ke Marketing (terakhir)
  marketing_oleh    INT UNSIGNED  NULL,
  marketing_at      DATETIME      NULL,
  ppic_oleh         INT UNSIGNED  NULL,
  ppic_at           DATETIME      NULL,
  operasional_oleh  INT UNSIGNED  NULL,
  operasional_at    DATETIME      NULL,
  created_by        INT UNSIGNED  NULL,
  updated_by        INT UNSIGNED  NULL,
  created_at        DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_occ_nomor (nomor),
  KEY idx_occ_status (status, updated_at),
  KEY idx_occ_prospect (prospect_id),
  CONSTRAINT fk_occ_prospect FOREIGN KEY (prospect_id) REFERENCES prospects (id) ON DELETE SET NULL,
  CONSTRAINT fk_occ_marketing FOREIGN KEY (marketing_oleh) REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT fk_occ_ppic FOREIGN KEY (ppic_oleh) REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT fk_occ_operasional FOREIGN KEY (operasional_oleh) REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT fk_occ_creator FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE notifications MODIFY type ENUM('meeting_baru','meeting_diubah','meeting_reminder','planning_pic','planning_baru','sistem','prospek_baru','visit_reminder','followup_due','sample_update','desain_update','repeat_order','pembayaran','quotation','perbaikan_mesin','perawatan_mesin','stok_sparepart','pengajuan_pembelian','tiket','action_plan','kendala_customer','analisa_teknik','order_custom') NOT NULL;

-- Lampiran desain plastik / desain cetakan / aksesoris (owner_type 'order_custom')
ALTER TABLE note_attachments MODIFY owner_type ENUM('activity','request_log','stage','job','repair','maintenance_log','purchase_request','ticket','damage_log','complaint','order_custom') NOT NULL;

-- Menu "Form Order Custom" (Marketing) & "Checklist Order Custom" (Produksi) memakai satu hak akses 'order-custom'
INSERT IGNORE INTO division_menus (division_id, menu_key)
SELECT id, 'order-custom' FROM divisions
WHERE code IN ('marketing','marketing_development','marketing_maintenance','marketing_digital','ppic','produksi','general_manager');
