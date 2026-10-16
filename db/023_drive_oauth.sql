-- PAP-MS: akses Google Drive atas nama akun Google (mis. akun yang menerima share folder desain).
-- Refresh token disimpan terenkripsi (AES-256-GCM, kunci turunan AUTH_SECRET). Hanya satu akun aktif.
CREATE TABLE IF NOT EXISTS drive_auth (
  id             TINYINT UNSIGNED NOT NULL,   -- selalu 1
  email          VARCHAR(200) NOT NULL,
  refresh_token  TEXT         NOT NULL,       -- terenkripsi
  connected_by   INT UNSIGNED NULL,
  connected_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  CONSTRAINT fk_drive_auth_user FOREIGN KEY (connected_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
