-- PAP-MS: Tabel HPP (harga bahan baku + parameter biaya) dan Quotation (surat penawaran)

-- 1. Menu Tabel HPP: Marketing (dasar penawaran), Purchasing (update harga bahan), PPIC, Accounting, GM
INSERT IGNORE INTO division_menus (division_id, menu_key)
SELECT d.id, 'hpp' FROM divisions d
WHERE d.code IN ('marketing', 'marketing_digital', 'marketing_development', 'marketing_maintenance', 'purchasing', 'ppic', 'accounting', 'general_manager');
-- Quotation juga untuk sub-divisi marketing (divisi Marketing, GM, Accounting sudah punya)
INSERT IGNORE INTO division_menus (division_id, menu_key)
SELECT d.id, 'quotation' FROM divisions d WHERE d.code IN ('marketing_development', 'marketing_maintenance');

-- 2. Bahan baku dan harganya (diperbarui Purchasing/Admin)
CREATE TABLE IF NOT EXISTS raw_materials (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  kode        VARCHAR(30)  NOT NULL,
  nama        VARCHAR(150) NOT NULL,
  jenis       ENUM('resin','pewarna','tinta','aditif','lainnya') NOT NULL DEFAULT 'resin',
  satuan      VARCHAR(20)  NOT NULL DEFAULT 'kg',
  harga       DECIMAL(14,2) NOT NULL DEFAULT 0,   -- per satuan
  density     DECIMAL(6,3) NULL,                 -- g/cm3, untuk resin (menghitung berat kantong)
  keterangan  VARCHAR(500) NULL,
  aktif       TINYINT(1)   NOT NULL DEFAULT 1,
  updated_by  INT UNSIGNED NULL,
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_raw_materials_kode (kode)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Riwayat perubahan harga (grafik / audit harga bahan baku)
CREATE TABLE IF NOT EXISTS raw_material_prices (
  id           INT UNSIGNED NOT NULL AUTO_INCREMENT,
  material_id  INT UNSIGNED NOT NULL,
  harga        DECIMAL(14,2) NOT NULL,
  updated_by   INT UNSIGNED NULL,
  created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_material_prices (material_id, created_at),
  CONSTRAINT fk_material_prices_material FOREIGN KEY (material_id) REFERENCES raw_materials (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Harga awal 0: wajib diisi Purchasing/Admin sebelum dipakai menghitung HPP
INSERT IGNORE INTO raw_materials (kode, nama, jenis, harga, density) VALUES
  ('HDPE',  'Biji plastik HDPE',      'resin',   0, 0.950),
  ('LDPE',  'Biji plastik LDPE (PE)', 'resin',   0, 0.920),
  ('LLDPE', 'Biji plastik LLDPE',     'resin',   0, 0.920),
  ('PP',    'Biji plastik PP',        'resin',   0, 0.900),
  ('MB-PUTIH', 'Masterbatch putih',   'pewarna', 0, NULL),
  ('TINTA', 'Tinta cetak',            'tinta',   0, NULL);

-- 3. Parameter perhitungan HPP & data perusahaan untuk dokumen (key-value)
CREATE TABLE IF NOT EXISTS app_settings (
  `key`       VARCHAR(60)  NOT NULL,
  value       VARCHAR(2000) NULL,
  updated_by  INT UNSIGNED NULL,
  updated_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO app_settings (`key`, value) VALUES
  ('hpp.blow_per_kg', '0'),            -- biaya proses blow (Rp/kg)
  ('hpp.cetak_per_kg_warna', '0'),     -- biaya cetak per kg per warna (Rp)
  ('hpp.bagmaking_per_kg', '0'),       -- biaya potong/seal (Rp/kg), tidak untuk roll
  ('hpp.waste_persen', '5'),           -- susut / afalan bahan (%)
  ('hpp.overhead_persen', '10'),       -- listrik, tenaga kerja tak langsung, dll (%)
  ('hpp.klise_per_warna', '0'),        -- biaya klise sekali buat (Rp per warna)
  ('hpp.margin_persen', '20'),         -- margin default harga jual (%)
  ('hpp.ppn_persen', '11'),
  ('doc.nama', 'PT. Pandawa Amerta Packindo'),
  ('doc.alamat', ''),
  ('doc.telepon', ''),
  ('doc.email', ''),
  ('doc.rekening', ''),
  ('doc.syarat', 'Harga belum termasuk ongkos kirim.\nPembayaran DP 50% saat order, pelunasan sebelum barang dikirim.\nWaktu produksi ±14 hari kerja setelah desain & DP diterima.'),
  ('doc.penandatangan', '');

-- 4. Quotation (surat penawaran)
CREATE TABLE IF NOT EXISTS quotations (
  id             INT UNSIGNED NOT NULL AUTO_INCREMENT,
  nomor          VARCHAR(30)  NULL,
  prospect_id    INT UNSIGNED NULL,
  customer_id    INT UNSIGNED NULL,
  kepada         VARCHAR(200) NOT NULL,      -- nama usaha / customer
  kontak         VARCHAR(150) NULL,          -- up. nama PIC
  telepon        VARCHAR(40)  NULL,
  alamat         VARCHAR(500) NULL,
  tanggal        DATE         NOT NULL,
  berlaku_hari   SMALLINT UNSIGNED NOT NULL DEFAULT 14,
  status         ENUM('draft','dikirim','diterima','ditolak','batal') NOT NULL DEFAULT 'draft',
  pakai_ppn      TINYINT(1)   NOT NULL DEFAULT 1,
  ppn_persen     DECIMAL(5,2) NOT NULL DEFAULT 11,
  subtotal       DECIMAL(16,2) NOT NULL DEFAULT 0,
  ppn            DECIMAL(16,2) NOT NULL DEFAULT 0,
  total          DECIMAL(16,2) NOT NULL DEFAULT 0,
  syarat         TEXT         NULL,
  catatan        TEXT         NULL,           -- catatan internal (tidak dicetak)
  alasan         VARCHAR(500) NULL,           -- alasan ditolak / batal
  created_by     INT UNSIGNED NOT NULL,
  sent_at        DATETIME     NULL,
  created_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_quotations_nomor (nomor),
  KEY idx_quotations_status (status, tanggal),
  CONSTRAINT fk_quotations_prospect FOREIGN KEY (prospect_id) REFERENCES prospects (id) ON DELETE SET NULL,
  CONSTRAINT fk_quotations_customer FOREIGN KEY (customer_id) REFERENCES customers (id) ON DELETE SET NULL,
  CONSTRAINT fk_quotations_created_by FOREIGN KEY (created_by) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS quotation_items (
  id             INT UNSIGNED NOT NULL AUTO_INCREMENT,
  quotation_id   INT UNSIGNED NOT NULL,
  product_id     INT UNSIGNED NULL,
  nama_produk    VARCHAR(255) NOT NULL,
  spesifikasi    VARCHAR(1000) NULL,          -- teks spek yang dicetak di penawaran
  material_id    INT UNSIGNED NULL,
  model          ENUM('kantong','gusset','roll','lainnya') NOT NULL DEFAULT 'kantong',
  panjang_cm     DECIMAL(8,2) NULL,
  lebar_cm       DECIMAL(8,2) NULL,
  gusset_cm      DECIMAL(8,2) NULL,
  tebal_mikron   DECIMAL(8,2) NULL,
  jumlah_warna   TINYINT UNSIGNED NOT NULL DEFAULT 0,
  qty            DECIMAL(14,2) NOT NULL DEFAULT 0,
  satuan         VARCHAR(20)  NOT NULL DEFAULT 'pcs',   -- pcs / kg / pack / roll
  berat_gram     DECIMAL(12,4) NULL,          -- berat per pcs hasil hitung
  hpp_per_kg     DECIMAL(14,2) NULL,
  hpp_satuan     DECIMAL(14,4) NULL,          -- HPP per satuan jual
  harga_satuan   DECIMAL(14,2) NOT NULL DEFAULT 0,
  subtotal       DECIMAL(16,2) NOT NULL DEFAULT 0,
  hpp_detail     JSON         NULL,           -- snapshot perhitungan (harga bahan & parameter saat itu)
  sort_order     SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  KEY idx_quotation_items (quotation_id),
  CONSTRAINT fk_quotation_items_quotation FOREIGN KEY (quotation_id) REFERENCES quotations (id) ON DELETE CASCADE,
  CONSTRAINT fk_quotation_items_product FOREIGN KEY (product_id) REFERENCES customer_products (id) ON DELETE SET NULL,
  CONSTRAINT fk_quotation_items_material FOREIGN KEY (material_id) REFERENCES raw_materials (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
