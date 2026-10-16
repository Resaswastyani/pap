-- PAP-MS: Pemantauan repeat order (Marketing Maintenance)
-- Kolom lokal PAP-MS di tabel customers (tidak dikirim ke / ditimpa sinkron Accurate)
ALTER TABLE customers ADD COLUMN IF NOT EXISTS maintenance_to INT UNSIGNED NULL;      -- PIC Marketing Maintenance
ALTER TABLE customers ADD COLUMN IF NOT EXISTS next_followup_at DATETIME NULL;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS last_contact_at DATETIME NULL;
ALTER TABLE customers ADD CONSTRAINT fk_customers_maintenance FOREIGN KEY IF NOT EXISTS (maintenance_to) REFERENCES users (id) ON DELETE SET NULL;

-- Customer hasil handover prospek: PIC maintenance ikut dari prospek
UPDATE customers c JOIN prospects p ON p.customer_id = c.id
SET c.maintenance_to = p.maintenance_to
WHERE c.maintenance_to IS NULL AND p.maintenance_to IS NOT NULL;

-- Menu Repeat Order
INSERT IGNORE INTO division_menus (division_id, menu_key)
SELECT d.id, 'repeat-order' FROM divisions d
WHERE d.code IN ('marketing', 'marketing_development', 'marketing_maintenance', 'general_manager');

-- Notifikasi: pengingat repeat order / follow-up customer
ALTER TABLE notifications MODIFY type ENUM('meeting_baru','meeting_diubah','meeting_reminder','planning_pic','planning_baru','sistem','prospek_baru','visit_reminder','followup_due','sample_update','desain_update','repeat_order') NOT NULL;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS customer_id INT UNSIGNED NULL AFTER design_id;
ALTER TABLE notifications ADD CONSTRAINT fk_notifications_customer FOREIGN KEY IF NOT EXISTS (customer_id) REFERENCES customers (id) ON DELETE CASCADE;
