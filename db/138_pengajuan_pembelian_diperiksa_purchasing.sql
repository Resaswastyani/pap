-- Pengajuan Pembelian dari Teknik / PPIC diperiksa Purchasing dulu (supplier, harga, catatan),
-- baru diteruskan ke GM lalu Accounting. Pengajuan yang dibuat Purchasing sendiri otomatis dianggap sudah diperiksa.
ALTER TABLE purchase_requests
  ADD COLUMN checked_by INT UNSIGNED NULL AFTER processed_at,
  ADD COLUMN checked_at DATETIME NULL AFTER checked_by;

-- Pengajuan yang sudah lewat tahap pemeriksaan (disetujui GM, atau sudah diproses) dianggap sudah diperiksa
UPDATE purchase_requests SET checked_by = COALESCE(processed_by, gm_approved_by), checked_at = COALESCE(processed_at, gm_approved_at, updated_at)
WHERE checked_at IS NULL AND (status <> 'diajukan' OR gm_approved_by IS NOT NULL);

-- Pengajuan buatan Purchasing sendiri yang masih menunggu: sudah diperiksa oleh pembuatnya
UPDATE purchase_requests p
JOIN users u ON u.id = p.requested_by
JOIN divisions d ON d.id = u.division_id
SET p.checked_by = p.requested_by, p.checked_at = p.created_at
WHERE p.checked_at IS NULL AND p.status = 'diajukan' AND d.code = 'purchasing';
