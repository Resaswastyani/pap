-- Request Desain: request baru diterima dulu oleh Lead Digital Marketing sebelum diambil Tim Desain.
ALTER TABLE design_requests
  MODIFY status ENUM('diajukan','diterima','dikerjakan','review','revisi','disetujui','batal') NOT NULL DEFAULT 'diajukan';

-- Request yang sudah menunggu Tim Desain sebelum aturan ini berlaku tetap bisa langsung diambil
UPDATE design_requests SET status = 'diterima' WHERE status = 'diajukan';
