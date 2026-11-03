-- Foto profil: setiap user boleh mengganti foto profilnya sendiri (Pengaturan > Akun saya).
-- Disimpan terpisah dari tabel users agar query user tidak ikut membaca data gambar.
CREATE TABLE IF NOT EXISTS user_avatars (
  user_id    INT UNSIGNED NOT NULL,
  data       MEDIUMBLOB   NOT NULL,
  mime       VARCHAR(50)  NOT NULL,
  updated_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id),
  CONSTRAINT fk_user_avatars_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
