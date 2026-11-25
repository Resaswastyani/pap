-- Divisi "Kashif": menu sama dengan divisi Teknik (Analisa Teknik, Jadwal Shift, Training, Izin / Cuti, Tiket, menu mesin, dll.).
-- Dipakai bersama role "Hanya Lihat": semua menu hanya dilihat, kecuali mengajukan Izin / Cuti & Tiket IT.
-- Menu divisi ini bisa diubah di Manajemen Role > Menu per divisi.
INSERT INTO divisions (code, name, has_levels, sort_order)
SELECT 'kashif', 'Kashif', 0, COALESCE(MAX(sort_order), 0) + 1 FROM divisions
WHERE NOT EXISTS (SELECT 1 FROM divisions WHERE code = 'kashif');

INSERT IGNORE INTO division_menus (division_id, menu_key)
SELECT k.id, t.menu_key FROM divisions k
JOIN division_menus t ON t.division_id = (SELECT id FROM divisions WHERE code = 'teknik')
WHERE k.code = 'kashif';
