-- Menu Lembur dipindah dari tab Grade & Gaji ke sidebar SDM: divisi yang membuka Grade & Gaji ikut membuka Lembur
INSERT IGNORE INTO division_menus (division_id, menu_key)
SELECT division_id, 'lembur' FROM division_menus WHERE menu_key = 'grade-gaji';
