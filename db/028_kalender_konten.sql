-- PAP-MS: Kalender konten Marketing Digital + request konten (gambar/video) ke Tim Desain + bank konten

-- Menu Kalender Konten: Marketing Digital (pengelola), Marketing, Tim Desain, GM
INSERT IGNORE INTO division_menus (division_id, menu_key)
SELECT d.id, 'konten' FROM divisions d WHERE d.code IN ('marketing', 'marketing_digital', 'tim_desain', 'general_manager');

-- Request desain kini dua kategori: klise cetakan (masuk Data Produk) dan konten digital (masuk bank konten)
ALTER TABLE design_requests ADD COLUMN IF NOT EXISTS kategori ENUM('klise','konten') NOT NULL DEFAULT 'klise' AFTER nomor;
ALTER TABLE design_requests ADD COLUMN IF NOT EXISTS jenis_konten ENUM('gambar','video','carousel','lainnya') NULL AFTER kategori;

-- Rencana konten / kampanye digital
CREATE TABLE IF NOT EXISTS content_plans (
  id                INT UNSIGNED NOT NULL AUTO_INCREMENT,
  judul             VARCHAR(255) NOT NULL,
  platform          VARCHAR(40)  NOT NULL,       -- instagram, tiktok, facebook, website, whatsapp, marketplace, google, lainnya
  jenis             VARCHAR(40)  NOT NULL,       -- feed, reels, story, video, artikel, iklan, blasting, lainnya
  jadwal_tayang     DATETIME     NOT NULL,
  status            ENUM('ide','produksi','siap','tayang','batal') NOT NULL DEFAULT 'ide',
  tujuan            VARCHAR(255) NULL,           -- awareness, edukasi, promo, cari lead, ...
  target_sektor     VARCHAR(255) NULL,           -- laundry, beras, F&B, ...
  caption           TEXT         NULL,
  anggaran          DECIMAL(14,2) NULL,          -- budget iklan / blasting
  link_hasil        VARCHAR(1000) NULL,          -- link postingan setelah tayang
  reach             INT UNSIGNED NULL,
  engagement        INT UNSIGNED NULL,
  leads             INT UNSIGNED NULL,           -- lead yang didapat dari konten ini
  catatan           TEXT         NULL,
  pic_id            INT UNSIGNED NULL,
  design_request_id INT UNSIGNED NULL,
  created_by        INT UNSIGNED NOT NULL,
  created_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_content_jadwal (jadwal_tayang),
  CONSTRAINT fk_content_pic FOREIGN KEY (pic_id) REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT fk_content_design FOREIGN KEY (design_request_id) REFERENCES design_requests (id) ON DELETE SET NULL,
  CONSTRAINT fk_content_created_by FOREIGN KEY (created_by) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
