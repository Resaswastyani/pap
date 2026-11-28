-- Tanda tangan digital saat GM / Accounting menyetujui Pengajuan Pembelian.
-- Gambar (PNG/JPEG data URL) disimpan di pengajuan; token = id gambar publik (/api/ttd/<token>) untuk halaman cetak & Word.
-- Dikosongkan lagi bila isi pengajuan diubah (persetujuan diulang).
ALTER TABLE purchase_requests
  ADD COLUMN gm_ttd_nama     VARCHAR(150) NULL AFTER gm_approved_at,
  ADD COLUMN gm_ttd_jabatan  VARCHAR(150) NULL AFTER gm_ttd_nama,
  ADD COLUMN gm_ttd_image    MEDIUMTEXT   NULL AFTER gm_ttd_jabatan,
  ADD COLUMN gm_ttd_token    CHAR(32)     NULL AFTER gm_ttd_image,
  ADD COLUMN acc_ttd_nama    VARCHAR(150) NULL AFTER acc_approved_at,
  ADD COLUMN acc_ttd_jabatan VARCHAR(150) NULL AFTER acc_ttd_nama,
  ADD COLUMN acc_ttd_image   MEDIUMTEXT   NULL AFTER acc_ttd_jabatan,
  ADD COLUMN acc_ttd_token   CHAR(32)     NULL AFTER acc_ttd_image,
  ADD UNIQUE KEY uq_pr_gm_ttd (gm_ttd_token),
  ADD UNIQUE KEY uq_pr_acc_ttd (acc_ttd_token);
