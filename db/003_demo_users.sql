-- PAP-MS: akun demo per role (password semua: demo1234)
-- Lewati file ini di production.

INSERT INTO users (name, email, password_hash, role_id)
SELECT d.name, d.email, '$2b$10$5v6/kGFq5U6k69qObc2H2.hclBEIBXQXKVC.Ej0hvoNG.9yeMlmRu', r.id
FROM (
  SELECT 'Sari Dewi' AS name, 'marketing@pap-ms.id' AS email, 'marketing' AS code UNION ALL
  SELECT 'Lina Kartika', 'accounting@pap-ms.id', 'accounting' UNION ALL
  SELECT 'Rizky Maulana', 'ppic@pap-ms.id', 'ppic' UNION ALL
  SELECT 'Budi Hartono', 'purchasing@pap-ms.id', 'purchasing' UNION ALL
  SELECT 'Joko Susilo', 'produksi@pap-ms.id', 'produksi' UNION ALL
  SELECT 'Hendra Wijaya', 'gm@pap-ms.id', 'general_manager' UNION ALL
  SELECT 'Dimas Pratama', 'it@pap-ms.id', 'staff_it'
) AS d
JOIN roles r ON r.code = d.code
ON DUPLICATE KEY UPDATE role_id = VALUES(role_id);
