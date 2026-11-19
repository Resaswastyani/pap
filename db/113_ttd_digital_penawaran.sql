-- Tanda tangan digital dokumen penawaran / surat order / proforma.
-- peran 'perusahaan' = "Hormat kami" (PT. Pandawa Amerta Packindo); 'customer' = "Disetujui" oleh customer.
-- Setiap tanda tangan menyimpan sidik isi dokumen (doc_hash); bila isi penawaran berubah setelah ditandatangani,
-- tanda tangan otomatis tidak berlaku dan tidak dicetak. token = kode verifikasi publik (/verifikasi/ttd/<token>).
CREATE TABLE IF NOT EXISTS quotation_signatures (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  quotation_id  INT UNSIGNED NOT NULL,
  peran         ENUM('perusahaan','customer') NOT NULL,
  nama          VARCHAR(150) NOT NULL,
  jabatan       VARCHAR(150) NULL,
  image         MEDIUMTEXT   NOT NULL,              -- PNG (data URL) hasil gambar / unggahan tanda tangan
  token         CHAR(32)     NOT NULL,
  doc_hash      CHAR(64)     NOT NULL,              -- SHA-256 isi dokumen saat ditandatangani
  signed_by     INT UNSIGNED NULL,                  -- user SIMPAP yang menyimpan tanda tangan
  signed_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ip            VARCHAR(64)  NULL,
  user_agent    VARCHAR(255) NULL,
  revoked_at    DATETIME     NULL,
  revoked_by    INT UNSIGNED NULL,
  revoke_reason VARCHAR(255) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_qsig_token (token),
  KEY idx_qsig_quotation (quotation_id, peran, revoked_at),
  CONSTRAINT fk_qsig_quotation FOREIGN KEY (quotation_id) REFERENCES quotations (id) ON DELETE CASCADE,
  CONSTRAINT fk_qsig_user FOREIGN KEY (signed_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Tanda tangan tersimpan milik user (dipakai ulang tanpa menggambar lagi)
CREATE TABLE IF NOT EXISTS user_signatures (
  user_id    INT UNSIGNED NOT NULL,
  image      MEDIUMTEXT   NOT NULL,
  jabatan    VARCHAR(150) NULL,
  updated_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id),
  CONSTRAINT fk_usig_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
