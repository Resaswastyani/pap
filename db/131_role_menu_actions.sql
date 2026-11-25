-- Matriks akses Menu x Aksi per role (Manajemen Role > Akses menu & aksi).
-- Aksi: view (lihat / buka menu), create (tambah), update (ubah, termasuk aksi status), delete (hapus).
-- Bawaan SEMUA diizinkan; tabel ini hanya menyimpan aksi yang DICABUT untuk role tertentu, sehingga menu baru
-- otomatis terbuka sesuai pengaturan menu per divisi. Super Admin selalu boleh semua.
CREATE TABLE IF NOT EXISTS role_menu_denials (
  role_id    INT UNSIGNED NOT NULL,
  menu_key   VARCHAR(60)  NOT NULL,
  action     ENUM('view','create','update','delete') NOT NULL,
  created_by INT UNSIGNED NULL,
  created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (role_id, menu_key, action),
  CONSTRAINT fk_rmd_role FOREIGN KEY (role_id) REFERENCES roles (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
