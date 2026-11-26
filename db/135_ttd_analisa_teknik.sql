-- Tanda tangan digital Analisa Teknik / Rekomendasi Proses Produksi.
-- peran: 'pengaju' = Dept PPIC (dari Sales Order) / Marketing (dari Prospek), 'teknik' = Dept Tehnik, 'direksi' = Direksi / Opr Mgr.
-- Satu tanda tangan aktif per peran (yang lama otomatis dicabut saat ditandatangani ulang). token = id gambar publik (/api/ttd/<token>).
-- Tanda tangan tersimpan milik user memakai tabel user_signatures (sama dengan tanda tangan penawaran).
CREATE TABLE IF NOT EXISTS tech_analysis_signatures (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  analysis_id   INT UNSIGNED NOT NULL,
  peran         ENUM('pengaju','teknik','direksi') NOT NULL,
  nama          VARCHAR(150) NOT NULL,
  jabatan       VARCHAR(150) NULL,
  image         MEDIUMTEXT   NOT NULL,
  token         CHAR(32)     NOT NULL,
  signed_by     INT UNSIGNED NULL,
  signed_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ip            VARCHAR(64)  NULL,
  user_agent    VARCHAR(255) NULL,
  revoked_at    DATETIME     NULL,
  revoked_by    INT UNSIGNED NULL,
  revoke_reason VARCHAR(255) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_tasig_token (token),
  KEY idx_tasig_analysis (analysis_id, peran, revoked_at),
  CONSTRAINT fk_tasig_analysis FOREIGN KEY (analysis_id) REFERENCES prospect_tech_analyses (id) ON DELETE CASCADE,
  CONSTRAINT fk_tasig_user FOREIGN KEY (signed_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
