-- PAP-MS: menu Order Bulanan (siapa saja customer yang order per bulan, dari Sales Order Accurate).
-- Dibuka untuk divisi yang punya menu Customer.
INSERT IGNORE INTO division_menus (division_id, menu_key)
SELECT division_id, 'order-bulanan' FROM division_menus WHERE menu_key = 'customer';
