-- PAP-MS: persetujuan quotation oleh Kepala Marketing / GM sebelum dikirim ke customer
-- Alur (status tetap 'draft' sampai dikirim):
--   approval NULL -(sales ajukan)-> menunggu -(Lead marketing / GM)-> disetujui | ditolak -(sales perbaiki & ajukan ulang)-> menunggu
-- Penawaran buatan Lead marketing / GM tidak perlu diajukan (otomatis disetujui saat dikirim).

-- 1. Kolom persetujuan
ALTER TABLE quotations ADD COLUMN IF NOT EXISTS approval ENUM('menunggu','disetujui','ditolak') NULL AFTER status;
ALTER TABLE quotations ADD COLUMN IF NOT EXISTS approval_note VARCHAR(500) NULL AFTER approval;
ALTER TABLE quotations ADD COLUMN IF NOT EXISTS approved_by INT UNSIGNED NULL AFTER approval_note;
ALTER TABLE quotations ADD COLUMN IF NOT EXISTS approved_at DATETIME NULL AFTER approved_by;
ALTER TABLE quotations ADD CONSTRAINT fk_quotations_approved_by FOREIGN KEY IF NOT EXISTS (approved_by) REFERENCES users (id) ON DELETE SET NULL;

-- Penawaran yang sudah terkirim sebelum aturan ini dianggap sudah disetujui
UPDATE quotations SET approval = 'disetujui' WHERE status <> 'draft' AND approval IS NULL;

-- 2. Notifikasi persetujuan quotation (klik membuka detail quotation)
ALTER TABLE notifications MODIFY type ENUM('meeting_baru','meeting_diubah','meeting_reminder','planning_pic','planning_baru','sistem','prospek_baru','visit_reminder','followup_due','sample_update','desain_update','repeat_order','pembayaran','quotation') NOT NULL;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS quotation_id INT UNSIGNED NULL AFTER payment_id;
ALTER TABLE notifications ADD CONSTRAINT fk_notifications_quotation FOREIGN KEY IF NOT EXISTS (quotation_id) REFERENCES quotations (id) ON DELETE CASCADE;
