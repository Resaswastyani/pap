-- Tiket Kendala Sistem: semua pengguna bisa melaporkan kendala SIMPAP; Super Admin / Staff IT menangani semua tiket,
-- pengguna lain hanya melihat & menindaklanjuti tiket yang ia ajukan.

CREATE TABLE IF NOT EXISTS tickets (
  id              INT UNSIGNED NOT NULL AUTO_INCREMENT,
  nomor           VARCHAR(30)  NOT NULL,                 -- TKT-2026-0001
  judul           VARCHAR(200) NOT NULL,
  kategori        ENUM('error','akses','data','permintaan','lainnya') NOT NULL DEFAULT 'error',
  modul           VARCHAR(80)  NULL,                     -- menu SIMPAP yang bermasalah
  prioritas       ENUM('rendah','normal','tinggi','darurat') NOT NULL DEFAULT 'normal',
  deskripsi       TEXT         NOT NULL,
  status          ENUM('baru','diproses','menunggu_user','selesai','ditolak') NOT NULL DEFAULT 'baru',
  dilaporkan_oleh INT UNSIGNED NULL,
  ditangani_oleh  INT UNSIGNED NULL,
  selesai_at      DATETIME     NULL,
  created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_tickets_nomor (nomor),
  KEY idx_tickets_status (status, created_at),
  KEY idx_tickets_reporter (dilaporkan_oleh, created_at),
  CONSTRAINT fk_tickets_reporter FOREIGN KEY (dilaporkan_oleh) REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT fk_tickets_handler FOREIGN KEY (ditangani_oleh) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ticket_messages (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  ticket_id   INT UNSIGNED NOT NULL,
  user_id     INT UNSIGNED NULL,
  jenis       ENUM('komentar','status') NOT NULL DEFAULT 'komentar',
  pesan       TEXT         NOT NULL,
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_ticket_messages (ticket_id, created_at),
  CONSTRAINT fk_ticket_messages_ticket FOREIGN KEY (ticket_id) REFERENCES tickets (id) ON DELETE CASCADE,
  CONSTRAINT fk_ticket_messages_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE notifications MODIFY type ENUM('meeting_baru','meeting_diubah','meeting_reminder','planning_pic','planning_baru','sistem','prospek_baru','visit_reminder','followup_due','sample_update','desain_update','repeat_order','pembayaran','quotation','perbaikan_mesin','perawatan_mesin','stok_sparepart','pengajuan_pembelian','tiket') NOT NULL;

-- Menu Tiket Kendala terbuka untuk semua divisi
INSERT IGNORE INTO division_menus (division_id, menu_key) SELECT id, 'tiket' FROM divisions;
