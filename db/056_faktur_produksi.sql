-- PAP-MS: menu Faktur Produksi — faktur penjualan Accurate untuk pesanan (SO) yang produksinya selesai.
-- Faktur dibuat / diubah / dihapus langsung di Accurate (sales-invoice); daftar faktur disalin dari sinkron Accurate.

ALTER TABLE accurate_sales_invoices
  ADD COLUMN IF NOT EXISTS due_date   DATE          NULL AFTER trans_date,
  ADD COLUMN IF NOT EXISTS owing      DECIMAL(18,2) NULL AFTER total_amount,
  ADD COLUMN IF NOT EXISTS created_by INT UNSIGNED  NULL,
  ADD COLUMN IF NOT EXISTS updated_by INT UNSIGNED  NULL;

-- Menu: Marketing (pembuat faktur), Accounting, GM
INSERT IGNORE INTO division_menus (division_id, menu_key)
SELECT d.id, 'faktur-produksi' FROM divisions d
WHERE d.code IN ('marketing', 'marketing_development', 'marketing_digital', 'marketing_maintenance', 'accounting', 'general_manager');

INSERT INTO permissions (code, name, module, sort_order) VALUES
  ('faktur.create', 'Faktur Produksi: buat faktur penjualan di Accurate', 'Faktur Produksi', 71),
  ('faktur.update', 'Faktur Produksi: ubah faktur penjualan di Accurate', 'Faktur Produksi', 72),
  ('faktur.delete', 'Faktur Produksi: hapus faktur penjualan di Accurate', 'Faktur Produksi', 73)
ON DUPLICATE KEY UPDATE name = VALUES(name), module = VALUES(module), sort_order = VALUES(sort_order);

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code LIKE 'faktur.%' WHERE r.code = 'admin';

-- Bawaan per user: divisi Marketing & Accounting
INSERT IGNORE INTO user_permissions (user_id, permission_id, allowed)
SELECT u.id, p.id, 1 FROM users u JOIN divisions d ON d.id = u.division_id JOIN permissions p ON p.code LIKE 'faktur.%'
WHERE d.code IN ('marketing', 'marketing_development', 'marketing_digital', 'marketing_maintenance', 'accounting');
