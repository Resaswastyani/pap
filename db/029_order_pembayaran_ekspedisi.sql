-- PAP-MS: Surat Order & Proforma Invoice (dari quotation diterima), konfirmasi pembayaran ke Accounting, master ekspedisi

-- 1. Ekspedisi (daftar ekspedisi termurah)
CREATE TABLE IF NOT EXISTS expeditions (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  nama          VARCHAR(150) NOT NULL,
  kontak        VARCHAR(150) NULL,
  telepon       VARCHAR(40)  NULL,
  tujuan        VARCHAR(255) NOT NULL,          -- kota / area tujuan, mis. "Surabaya", "Jabodetabek"
  tarif_per_kg  DECIMAL(12,2) NULL,
  minimal_kg    DECIMAL(8,2)  NULL,
  estimasi_hari VARCHAR(30)   NULL,             -- mis. "2-3"
  keterangan    VARCHAR(500)  NULL,
  aktif         TINYINT(1)    NOT NULL DEFAULT 1,
  updated_by    INT UNSIGNED  NULL,
  updated_at    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_expeditions_tujuan (tujuan)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. Data order pada quotation yang diterima
ALTER TABLE quotations ADD COLUMN IF NOT EXISTS order_nomor VARCHAR(30) NULL AFTER nomor;
ALTER TABLE quotations ADD COLUMN IF NOT EXISTS proforma_nomor VARCHAR(30) NULL AFTER order_nomor;
ALTER TABLE quotations ADD COLUMN IF NOT EXISTS order_at DATETIME NULL;
ALTER TABLE quotations ADD COLUMN IF NOT EXISTS tanggal_kirim DATE NULL;
ALTER TABLE quotations ADD COLUMN IF NOT EXISTS dp_persen DECIMAL(5,2) NULL;
ALTER TABLE quotations ADD COLUMN IF NOT EXISTS expedition_id INT UNSIGNED NULL;
ALTER TABLE quotations ADD COLUMN IF NOT EXISTS ongkir DECIMAL(14,2) NULL;
ALTER TABLE quotations ADD COLUMN IF NOT EXISTS catatan_order TEXT NULL;
ALTER TABLE quotations ADD CONSTRAINT fk_quotations_expedition FOREIGN KEY IF NOT EXISTS (expedition_id) REFERENCES expeditions (id) ON DELETE SET NULL;

-- 3. Konfirmasi pembayaran (Marketing -> Accounting)
CREATE TABLE IF NOT EXISTS payment_confirmations (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  quotation_id  INT UNSIGNED NULL,
  customer_id   INT UNSIGNED NULL,
  pembayar      VARCHAR(200) NOT NULL,           -- nama customer / usaha
  jenis         ENUM('dp','pelunasan','lainnya') NOT NULL DEFAULT 'dp',
  nominal       DECIMAL(16,2) NOT NULL,
  tanggal_bayar DATE         NOT NULL,
  metode        VARCHAR(100) NULL,               -- transfer BCA, tunai, ...
  bukti         MEDIUMBLOB   NULL,
  bukti_mime    VARCHAR(100) NULL,
  bukti_name    VARCHAR(255) NULL,
  catatan       VARCHAR(1000) NULL,
  status        ENUM('menunggu','diterima','ditolak') NOT NULL DEFAULT 'menunggu',
  alasan        VARCHAR(500) NULL,
  verified_by   INT UNSIGNED NULL,
  verified_at   DATETIME     NULL,
  created_by    INT UNSIGNED NOT NULL,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_payments_status (status, created_at),
  CONSTRAINT fk_payments_quotation FOREIGN KEY (quotation_id) REFERENCES quotations (id) ON DELETE SET NULL,
  CONSTRAINT fk_payments_customer FOREIGN KEY (customer_id) REFERENCES customers (id) ON DELETE SET NULL,
  CONSTRAINT fk_payments_verified_by FOREIGN KEY (verified_by) REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT fk_payments_created_by FOREIGN KEY (created_by) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Menu Pembayaran: Marketing, Accounting, GM
INSERT IGNORE INTO division_menus (division_id, menu_key)
SELECT d.id, 'pembayaran' FROM divisions d
WHERE d.code IN ('marketing', 'marketing_development', 'marketing_maintenance', 'accounting', 'general_manager');

-- Notifikasi pembayaran
ALTER TABLE notifications MODIFY type ENUM('meeting_baru','meeting_diubah','meeting_reminder','planning_pic','planning_baru','sistem','prospek_baru','visit_reminder','followup_due','sample_update','desain_update','repeat_order','pembayaran') NOT NULL;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS payment_id INT UNSIGNED NULL AFTER customer_id;
ALTER TABLE notifications ADD CONSTRAINT fk_notifications_payment FOREIGN KEY IF NOT EXISTS (payment_id) REFERENCES payment_confirmations (id) ON DELETE CASCADE;
