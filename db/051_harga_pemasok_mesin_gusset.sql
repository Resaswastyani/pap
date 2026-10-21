-- PAP-MS: CRUD Harga Pemasok Accurate dari menu Harga Bahan, dan kata "Buffer" dihapus dari nama & kode MC Gusset (lini PP & HD).

INSERT INTO permissions (code, name, module, sort_order) VALUES
  ('purchasing.price.create', 'Harga Bahan: tambah harga pemasok di Accurate', 'Purchasing', 66),
  ('purchasing.price.delete', 'Harga Bahan: hapus harga pemasok di Accurate',  'Purchasing', 67)
ON DUPLICATE KEY UPDATE name = VALUES(name), module = VALUES(module), sort_order = VALUES(sort_order);
UPDATE permissions SET name = 'Harga Bahan: ubah harga pemasok & harga beli acuan di Accurate' WHERE code = 'purchasing.price.update';

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code IN ('purchasing.price.create', 'purchasing.price.delete') WHERE r.code = 'admin';

INSERT IGNORE INTO user_permissions (user_id, permission_id, allowed)
SELECT u.id, p.id, 1 FROM users u JOIN divisions d ON d.id = u.division_id JOIN permissions p ON p.code IN ('purchasing.price.create', 'purchasing.price.delete')
WHERE d.code = 'purchasing';

-- MC Gusset & Buffer -> MC Gusset (sinkron Data Mesin & Lembar Perawatan memakai kode baru)
UPDATE machines SET nama = REPLACE(nama, 'MC Gusset & Buffer', 'MC Gusset') WHERE nama LIKE 'MC Gusset & Buffer%';
UPDATE machines SET kode = REPLACE(kode, '-GUSSET-BUFFER', '-GUSSET') WHERE kode LIKE '%-GUSSET-BUFFER';
