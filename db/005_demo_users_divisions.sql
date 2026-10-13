-- PAP-MS: akun demo per divisi & level (password semua: demo1234)
-- Lewati file ini di production.

INSERT INTO users (name, email, password_hash, role_id, division_id)
SELECT d.name, d.email, '$2b$10$5v6/kGFq5U6k69qObc2H2.hclBEIBXQXKVC.Ej0hvoNG.9yeMlmRu', r.id, dv.id
FROM (
  SELECT 'Ayu Lestari' AS name, 'marketing.staff@pap-ms.id' AS email, 'staff' AS role_code, 'marketing' AS division_code UNION ALL
  SELECT 'Andi Saputra', 'produksi.staff@pap-ms.id', 'staff', 'produksi' UNION ALL
  SELECT 'Fajar Nugroho', 'teknik@pap-ms.id', 'lead', 'teknik' UNION ALL
  SELECT 'Rudi Hermawan', 'teknik.staff@pap-ms.id', 'staff', 'teknik' UNION ALL
  SELECT 'Wulan Sari', 'ppic.staff@pap-ms.id', 'staff', 'ppic' UNION ALL
  SELECT 'Eko Prasetyo', 'purchasing.staff@pap-ms.id', 'staff', 'purchasing' UNION ALL
  SELECT 'Nina Marlina', 'accounting.staff@pap-ms.id', 'staff', 'accounting' UNION ALL
  SELECT 'Maya Anggraini', 'hrd@pap-ms.id', 'lead', 'hrd' UNION ALL
  SELECT 'Taufik Hidayat', 'ga@pap-ms.id', 'lead', 'general_affair'
) AS d
JOIN roles r ON r.code = d.role_code
JOIN divisions dv ON dv.code = d.division_code
ON DUPLICATE KEY UPDATE role_id = VALUES(role_id), division_id = VALUES(division_id);
