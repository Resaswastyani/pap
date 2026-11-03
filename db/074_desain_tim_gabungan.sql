-- Request Desain: status "Diterima Lead DM" dihapus. Request baru tetap "Diajukan"; Lead Digital Marketing menerima
-- (langsung "Dikerjakan" dan ditugaskan ke anggota tim Marketing Digital / Tim Desain) atau menolak.
UPDATE design_requests SET status = 'diajukan' WHERE status = 'diterima';
ALTER TABLE design_requests
  MODIFY status ENUM('diajukan','dikerjakan','review','revisi','disetujui','batal') NOT NULL DEFAULT 'diajukan';
