-- PAP-MS: meeting punya judul sendiri, dan hanya lead/admin/super admin yang bisa membuat meeting

-- 1. Kolom judul (meeting lama diisi dari baris pertama deskripsi); deskripsi jadi opsional
ALTER TABLE meetings ADD COLUMN IF NOT EXISTS judul VARCHAR(200) NULL AFTER division_id;
UPDATE meetings SET judul = LEFT(TRIM(SUBSTRING_INDEX(deskripsi, '\n', 1)), 200) WHERE judul IS NULL OR judul = '';
ALTER TABLE meetings MODIFY judul VARCHAR(200) NOT NULL;
ALTER TABLE meetings MODIFY deskripsi TEXT NULL;

-- 2. Staff tidak lagi bisa membuat meeting (tetap bisa melihat & mengisi hasil meeting yang diikuti)
DELETE rp FROM role_permissions rp
JOIN roles r ON r.id = rp.role_id
JOIN permissions p ON p.id = rp.permission_id
WHERE r.code = 'staff' AND p.code = 'meeting.create';

UPDATE roles SET description = 'Melihat planning & meeting divisi, update progress, dan mengisi hasil meeting yang diikuti' WHERE code = 'staff';
