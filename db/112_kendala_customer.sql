-- Kendala Customer: keluhan / komplain customer (kualitas produk, pengiriman, administrasi, pelayanan)
-- dengan tracking penanganan: Baru -> Investigasi -> Perbaikan -> Konfirmasi customer -> Selesai (atau Ditolak),
-- akar masalah, tindakan perbaikan & pencegahan (CAPA), solusi ke customer, kompensasi, kepuasan, dan riwayat.
CREATE TABLE IF NOT EXISTS customer_complaints (
  id                  INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  nomor               VARCHAR(30)   NOT NULL,              -- KC-2026-0001
  tanggal             DATE          NOT NULL,              -- tanggal keluhan diterima
  customer_id         INT UNSIGNED  NULL,
  customer_nama       VARCHAR(255)  NOT NULL,              -- nama customer (tetap tersimpan walau data customer berubah)
  kontak              VARCHAR(150)  NULL,                  -- PIC / no. HP customer
  channel             ENUM('whatsapp','telepon','email','kunjungan','marketplace','lainnya') NOT NULL DEFAULT 'whatsapp',
  judul               VARCHAR(200)  NOT NULL,
  kategori            ENUM('kualitas','ukuran','cetak','kemasan','pengiriman','kurang_kirim','salah_kirim','administrasi','pelayanan','lainnya') NOT NULL DEFAULT 'kualitas',
  prioritas           ENUM('rendah','normal','tinggi','kritis') NOT NULL DEFAULT 'normal',
  deskripsi           TEXT          NOT NULL,
  produk              VARCHAR(255)  NULL,
  item_accurate_id    INT UNSIGNED  NULL,
  referensi           VARCHAR(150)  NULL,                  -- no. SO / faktur / surat jalan / batch
  qty_terdampak       DECIMAL(18,4) NULL,
  satuan              VARCHAR(40)   NULL,
  status              ENUM('baru','investigasi','perbaikan','konfirmasi','selesai','ditolak') NOT NULL DEFAULT 'baru',
  pic_id              INT UNSIGNED  NULL,                  -- penanggung jawab penanganan
  divisi_terkait      VARCHAR(80)   NULL,                  -- mis. Produksi, Logistik, Marketing
  target_selesai      DATE          NULL,
  akar_masalah        TEXT          NULL,
  tindakan_perbaikan  TEXT          NULL,
  tindakan_pencegahan TEXT          NULL,
  solusi              ENUM('ganti_barang','retur','kirim_ulang','potongan_harga','perbaikan','penjelasan','lainnya') NULL,
  solusi_detail       VARCHAR(500)  NULL,
  nilai_kompensasi    DECIMAL(20,2) NULL,                  -- biaya / kompensasi ke customer (Rp)
  kepuasan            TINYINT UNSIGNED NULL,               -- 1-5 saat ditutup
  catatan_penutupan   TEXT          NULL,
  selesai_at          DATETIME      NULL,
  dilaporkan_oleh     INT UNSIGNED  NULL,
  created_at          DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_cc_nomor (nomor),
  KEY idx_cc_status (status, tanggal),
  KEY idx_cc_tanggal (tanggal),
  KEY idx_cc_customer (customer_id),
  KEY idx_cc_pic (pic_id),
  CONSTRAINT fk_cc_customer FOREIGN KEY (customer_id) REFERENCES customers (id) ON DELETE SET NULL,
  CONSTRAINT fk_cc_pic FOREIGN KEY (pic_id) REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT fk_cc_reporter FOREIGN KEY (dilaporkan_oleh) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Riwayat tracking: perubahan status, tindakan, dan komentar
CREATE TABLE IF NOT EXISTS customer_complaint_updates (
  id           INT UNSIGNED NOT NULL AUTO_INCREMENT,
  complaint_id INT UNSIGNED NOT NULL,
  user_id      INT UNSIGNED NULL,
  jenis        ENUM('komentar','status','tindakan','sistem') NOT NULL DEFAULT 'komentar',
  status_dari  VARCHAR(20)  NULL,
  status_ke    VARCHAR(20)  NULL,
  pesan        TEXT         NOT NULL,
  created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_ccu_complaint (complaint_id, created_at),
  CONSTRAINT fk_ccu_complaint FOREIGN KEY (complaint_id) REFERENCES customer_complaints (id) ON DELETE CASCADE,
  CONSTRAINT fk_ccu_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Lampiran foto / video / dokumen keluhan memakai note_attachments (owner_type 'complaint')
ALTER TABLE note_attachments MODIFY owner_type ENUM('activity','request_log','stage','job','repair','maintenance_log','purchase_request','ticket','damage_log','complaint') NOT NULL;

ALTER TABLE notifications MODIFY type ENUM('meeting_baru','meeting_diubah','meeting_reminder','planning_pic','planning_baru','sistem','prospek_baru','visit_reminder','followup_due','sample_update','desain_update','repeat_order','pembayaran','quotation','perbaikan_mesin','perawatan_mesin','stok_sparepart','pengajuan_pembelian','tiket','action_plan','kendala_customer') NOT NULL;

-- Menu Kendala Customer: divisi operasional & manajemen (bisa diatur lagi di Manajemen Role)
INSERT IGNORE INTO division_menus (division_id, menu_key)
SELECT id, 'kendala-customer' FROM divisions
WHERE code IN ('marketing','marketing_development','marketing_maintenance','marketing_digital','produksi','ppic','general_manager','inventory_logistik','teknik','purchasing','accounting');
