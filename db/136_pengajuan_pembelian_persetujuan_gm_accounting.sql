-- Pengajuan Pembelian wajib disetujui GM DAN Accounting sebelum dipesan Purchasing.
-- Status tetap 'diajukan' sampai kedua persetujuan masuk, lalu otomatis menjadi 'disetujui'.
ALTER TABLE purchase_requests
  ADD COLUMN gm_approved_by INT UNSIGNED NULL AFTER processed_at,
  ADD COLUMN gm_approved_at DATETIME NULL AFTER gm_approved_by,
  ADD COLUMN acc_approved_by INT UNSIGNED NULL AFTER gm_approved_at,
  ADD COLUMN acc_approved_at DATETIME NULL AFTER acc_approved_by;

-- Accounting perlu membuka menu Pengajuan Pembelian untuk menyetujui
INSERT IGNORE INTO division_menus (division_id, menu_key)
SELECT d.id, 'pengajuan-pembelian' FROM divisions d WHERE d.code IN ('accounting', 'general_manager');
