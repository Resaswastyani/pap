-- Analisa Aspek Teknik atas Rencana Order Baru / Spec Baru (dari Dept Marketing ke Dept Teknik).
-- Alur: Marketing mengisi spek order -> diserahkan ke Teknik -> Teknik menganalisa proses mesin & menyimpulkan
-- (bisa / tidak diproduksi, tingkat kesulitan kualitas) -> Direksi memberi rekomendasi. Bisa dicetak (PDF) & diunduh Word.
CREATE TABLE IF NOT EXISTS prospect_tech_analyses (
  id                   INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  nomor                VARCHAR(30)   NOT NULL,              -- AT-2026-0001
  prospect_id          INT UNSIGNED  NULL,
  status               ENUM('draft','diserahkan','dianalisa','selesai') NOT NULL DEFAULT 'draft',
  tanggal_serah        DATE          NULL,                  -- diserahkan Marketing ke Teknik
  -- Diisi Marketing
  nama_produk          VARCHAR(255)  NOT NULL,
  nama_customer        VARCHAR(255)  NOT NULL,
  jenis_plastik        VARCHAR(80)   NULL,
  panjang_cm           DECIMAL(10,2) NULL,
  lebar_cm             DECIMAL(10,2) NULL,
  tebal_mm             DECIMAL(10,4) NULL,
  print_jenis          ENUM('polos','print') NULL,
  jumlah_warna         TINYINT UNSIGNED NULL,               -- jumlah warna print
  kesulitan_print      VARCHAR(255)  NULL,
  spec_lainnya         TEXT          NULL,                  -- airhole, pillow case, dll.
  qty_order            DECIMAL(18,2) NULL,
  qty_satuan           VARCHAR(20)   NULL,
  frekuensi            ENUM('sekali','rutin') NULL,         -- hanya 1x order / order rutin
  rutin_bulan          SMALLINT UNSIGNED NULL,              -- rutin per ... bulan
  critical_to_quality  TEXT          NULL,
  -- Diisi Teknik
  proses               LONGTEXT      NULL,                  -- JSON [{ mesin, kec_label, dipakai, kecepatan, keterangan, produktivitas }]
  bisa_produksi        ENUM('bisa','bersyarat','tidak') NULL,
  penjelasan_produksi  TEXT          NULL,
  kesulitan_kualitas   ENUM('mudah','sedang','sulit') NULL,
  penjelasan_kualitas  TEXT          NULL,
  catatan_lain         TEXT          NULL,
  teknik_oleh          INT UNSIGNED  NULL,
  teknik_at            DATETIME      NULL,
  -- Diisi Direksi
  rekomendasi_direksi  TEXT          NULL,
  direksi_oleh         INT UNSIGNED  NULL,
  direksi_at           DATETIME      NULL,
  created_by           INT UNSIGNED  NULL,
  updated_by           INT UNSIGNED  NULL,
  created_at           DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at           DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_pta_nomor (nomor),
  KEY idx_pta_prospect (prospect_id),
  KEY idx_pta_status (status, updated_at),
  CONSTRAINT fk_pta_prospect FOREIGN KEY (prospect_id) REFERENCES prospects (id) ON DELETE SET NULL,
  CONSTRAINT fk_pta_teknik FOREIGN KEY (teknik_oleh) REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT fk_pta_direksi FOREIGN KEY (direksi_oleh) REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT fk_pta_creator FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE notifications MODIFY type ENUM('meeting_baru','meeting_diubah','meeting_reminder','planning_pic','planning_baru','sistem','prospek_baru','visit_reminder','followup_due','sample_update','desain_update','repeat_order','pembayaran','quotation','perbaikan_mesin','perawatan_mesin','stok_sparepart','pengajuan_pembelian','tiket','action_plan','kendala_customer','analisa_teknik') NOT NULL;

-- Menu "Analisa Teknik Order" (grup Teknik) untuk Dept Teknik, PPIC, Produksi & GM; Marketing memakainya lewat menu Prospek
INSERT IGNORE INTO division_menus (division_id, menu_key)
SELECT id, 'analisa-teknik' FROM divisions WHERE code IN ('teknik','ppic','produksi','general_manager');
