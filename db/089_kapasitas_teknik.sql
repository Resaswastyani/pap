-- Divisi Teknik ikut mengelola Kapasitas Produksi (tambah, ubah, hapus baris kapasitas per mesin): pastikan menunya terbuka.
INSERT IGNORE INTO division_menus (division_id, menu_key)
SELECT d.id, 'kapasitas-produksi' FROM divisions d WHERE d.code = 'teknik';
