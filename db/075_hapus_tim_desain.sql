-- Divisi Tim Desain dihapus; tugasnya dialihkan ke Marketing Digital.
-- Anggota & data yang menunjuk divisi Tim Desain dipindah ke Marketing Digital, lalu divisinya dihapus.
UPDATE users u JOIN divisions t ON t.id = u.division_id AND t.code = 'tim_desain'
  JOIN divisions m ON m.code = 'marketing_digital' SET u.division_id = m.id;
UPDATE plannings p JOIN divisions t ON t.id = p.division_id AND t.code = 'tim_desain'
  JOIN divisions m ON m.code = 'marketing_digital' SET p.division_id = m.id;
UPDATE meetings x JOIN divisions t ON t.id = x.division_id AND t.code = 'tim_desain'
  JOIN divisions m ON m.code = 'marketing_digital' SET x.division_id = m.id;
UPDATE employees SET divisi = 'Marketing Digital' WHERE divisi = 'Tim Desain';
-- Menu divisi Tim Desain ikut terhapus (ON DELETE CASCADE)
DELETE FROM divisions WHERE code = 'tim_desain';
