-- Role "Hanya Lihat": tetap boleh MENGAJUKAN Izin / Cuti dan Tiket IT (tambah & ubah pengajuan sendiri).
-- Menu lain (Teknik, Jadwal Shift, Training, dll.) tetap hanya lihat.
DELETE d FROM role_menu_denials d JOIN roles r ON r.id = d.role_id
WHERE r.code = 'viewer' AND d.menu_key IN ('izin-cuti', 'tiket') AND d.action IN ('create', 'update');

-- Akun Kashif (divisi Teknik, role Hanya Lihat) dari data Karyawan: nama, email & NIP mengikuti menu Karyawan.
-- Dibuat hanya bila tepat satu karyawan bernama Kashif dan email-nya terisi, serta belum punya akun.
-- Password sengaja belum bisa dipakai login: admin mengaturnya di Manajemen User > Ubah user.
INSERT INTO users (name, email, password_hash, role_id, division_id, is_active, employee_nip)
SELECT e.nama, LOWER(TRIM(e.email)), '!belum-diatur', r.id, d.id, 1, e.nip
FROM employees e
JOIN roles r ON r.code = 'viewer'
JOIN divisions d ON d.code = 'teknik'
WHERE e.nama_key LIKE '%kashif%'
  AND TRIM(COALESCE(e.email, '')) <> ''
  AND (SELECT COUNT(*) FROM employees x WHERE x.nama_key LIKE '%kashif%') = 1
  AND NOT EXISTS (SELECT 1 FROM users u WHERE u.employee_nip = e.nip OR u.email = LOWER(TRIM(e.email)));
