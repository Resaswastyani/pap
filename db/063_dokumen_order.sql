-- Dokumen Order: Surat Order & Proforma Invoice langsung dari Sales Order Accurate
INSERT IGNORE INTO division_menus (division_id, menu_key)
SELECT d.id, 'dokumen-order' FROM divisions d
WHERE d.code IN ('marketing', 'marketing_development', 'marketing_maintenance', 'marketing_digital', 'accounting', 'general_manager', 'ppic', 'inventory_logistik');
