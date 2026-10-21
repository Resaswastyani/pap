-- PAP-MS Purchasing: tambah / ubah / hapus data di Accurate dari PAP-MS (supplier, PO pembelian, harga beli bahan).
-- Hak akses per menu lewat permission (Manajemen Role / Manajemen User). Bawaan: GM (role admin) dan semua user divisi Purchasing.

INSERT INTO permissions (code, name, module, sort_order) VALUES
  ('purchasing.supplier.manage', 'Supplier: tambah, ubah, hapus pemasok di Accurate', 'Purchasing', 61),
  ('purchasing.po.create',       'PO Pembelian: buat PO baru (dikirim ke Accurate)',  'Purchasing', 62),
  ('purchasing.po.update',       'PO Pembelian: ubah PO di Accurate',                 'Purchasing', 63),
  ('purchasing.po.delete',       'PO Pembelian: hapus PO di Accurate',                'Purchasing', 64),
  ('purchasing.price.update',    'Harga Bahan: ubah harga beli acuan di Accurate',    'Purchasing', 65)
ON DUPLICATE KEY UPDATE name = VALUES(name), module = VALUES(module), sort_order = VALUES(sort_order);

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code LIKE 'purchasing.%' WHERE r.code = 'admin';

-- User divisi Purchasing (semua level) mendapat permission sebagai tambahan per user
INSERT IGNORE INTO user_permissions (user_id, permission_id, allowed)
SELECT u.id, p.id, 1 FROM users u JOIN divisions d ON d.id = u.division_id JOIN permissions p ON p.code LIKE 'purchasing.%' WHERE d.code = 'purchasing';

-- Harga beli acuan barang di Accurate (field "Harga Beli" / vendorPrice)
ALTER TABLE accurate_items ADD COLUMN IF NOT EXISTS vendor_price DECIMAL(20,4) NULL AFTER min_quantity;

-- Riwayat perubahan harga beli acuan dari PAP-MS
CREATE TABLE IF NOT EXISTS purchase_price_logs (
  id               INT UNSIGNED NOT NULL AUTO_INCREMENT,
  item_accurate_id INT UNSIGNED NOT NULL,
  harga_lama       DECIMAL(20,4) NULL,
  harga_baru       DECIMAL(20,4) NOT NULL,
  catatan          VARCHAR(500) NULL,
  created_by       INT UNSIGNED NULL,
  created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_ppl_item (item_accurate_id, created_at),
  CONSTRAINT fk_ppl_user FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- PO yang dibuat / diubah dari PAP-MS
ALTER TABLE accurate_purchase_orders
  ADD COLUMN IF NOT EXISTS created_by INT UNSIGNED NULL,
  ADD COLUMN IF NOT EXISTS updated_by INT UNSIGNED NULL;
