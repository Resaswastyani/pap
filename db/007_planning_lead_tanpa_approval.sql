-- PAP-MS: planning hanya dibuat oleh lead (dan admin/super admin), tanpa approval
-- Staff tetap bisa melihat planning divisinya dan update progress.

-- 1. Staff tidak lagi bisa membuat planning
DELETE rp FROM role_permissions rp
JOIN roles r ON r.id = rp.role_id
JOIN permissions p ON p.id = rp.permission_id
WHERE r.code = 'staff' AND p.code = 'planning.create';

UPDATE permissions SET name = 'Buat planning' WHERE code = 'planning.create';

-- 2. Alur approval dihapus (role_permissions & user_permissions ikut terhapus lewat cascade)
DELETE FROM permissions WHERE code = 'planning.approve';

-- Semua planning langsung aktif; kolom approval dibiarkan sebagai riwayat
UPDATE plannings SET approval = 'disetujui', approval_note = NULL WHERE approval <> 'disetujui';
ALTER TABLE plannings ALTER COLUMN approval SET DEFAULT 'disetujui';

UPDATE roles SET description = 'General Manager: monitoring & kelola planning semua divisi' WHERE code = 'admin';
UPDATE roles SET description = 'Kepala divisi: membuat, mengelola, dan monitoring planning divisinya' WHERE code = 'lead';
UPDATE roles SET description = 'Melihat planning divisi dan update progress' WHERE code = 'staff';
