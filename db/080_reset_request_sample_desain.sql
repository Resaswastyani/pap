-- Persiapan launching: kosongkan seluruh data Request Sample & Request Desain (data uji coba).
-- Ikut terhapus: item & lampiran sample, file desain/referensi, riwayat status & lampiran catatannya, notifikasi terkait,
-- salinannya di Data Terhapus, serta produk di Data Produk yang dibuat dari request desain (beserta file desain finalnya).
-- Nomor request dimulai lagi dari 0001 (nomor dibentuk dari id).

-- Produk yang dibuat otomatis dari request desain (file produknya ikut terhapus, ON DELETE CASCADE)
DELETE cp FROM customer_products cp JOIN design_requests d ON d.product_id = cp.id
WHERE cp.keterangan LIKE 'Dari request desain %';

-- Produk yang sudah ada sebelumnya: hanya file desain final yang disalin dari request desain
DELETE pf FROM customer_product_files pf
JOIN design_requests d ON d.product_id = pf.product_id
JOIN design_request_files f ON f.design_id = d.id AND f.kind = 'desain' AND f.name = pf.name AND f.size = pf.size;

-- Lampiran catatan riwayat request (tabel request_logs hanya dipakai Request Sample & Desain)
DELETE FROM note_attachments WHERE owner_type = 'request_log';
DELETE FROM request_logs;
DELETE FROM notifications WHERE sample_id IS NOT NULL OR design_id IS NOT NULL;

UPDATE design_requests SET final_file_id = NULL;
DELETE FROM design_request_files;
DELETE FROM design_requests;
-- sample_request_items & sample_attachments ikut terhapus (ON DELETE CASCADE)
DELETE FROM sample_requests;

DELETE FROM deleted_records WHERE table_name IN ('sample_requests', 'design_requests');

ALTER TABLE sample_requests AUTO_INCREMENT = 1;
ALTER TABLE design_requests AUTO_INCREMENT = 1;
ALTER TABLE design_request_files AUTO_INCREMENT = 1;
