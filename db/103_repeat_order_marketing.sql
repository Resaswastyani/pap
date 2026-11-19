-- Repeat Order: seluruh user Marketing Maintenance & Marketing Development melihat semua customer (lib/repeat-order.ts);
-- pastikan menunya terbuka untuk kedua divisi.
INSERT IGNORE INTO division_menus (division_id, menu_key)
SELECT d.id, 'repeat-order' FROM divisions d WHERE d.code IN ('marketing_maintenance', 'marketing_development');
