-- PAP-MS: log aktivitas seluruh sistem (login/logout, tambah/ubah/hapus data di semua modul,
-- ganti password, ubah permission) beserta perangkat yang dipakai pelaku.

DROP TABLE IF EXISTS user_activity_logs; -- versi awal (khusus Manajemen User), digantikan activity_logs

CREATE TABLE IF NOT EXISTS activity_logs (
  id           INT UNSIGNED NOT NULL AUTO_INCREMENT,
  actor_id     INT UNSIGNED NULL,           -- pengguna yang melakukan aktivitas
  actor_name   VARCHAR(150) NOT NULL,       -- disimpan agar log tetap terbaca bila akun dihapus (email untuk login gagal)
  module       VARCHAR(40)  NOT NULL,       -- Planning, Meeting, Customer, Manajemen User, Autentikasi, ...
  action       VARCHAR(20)  NOT NULL,       -- create, update, delete, password, permission, login, login_failed, logout, ...
  entity_type  VARCHAR(40)  NULL,
  entity_id    VARCHAR(40)  NULL,
  entity_label VARCHAR(200) NULL,
  description  VARCHAR(500) NOT NULL,
  changes      JSON         NULL,           -- [{ field, from, to }]
  method       VARCHAR(8)   NULL,
  path         VARCHAR(255) NULL,
  device       VARCHAR(150) NULL,           -- ringkasan: "Chrome 141 · Windows · Desktop"
  device_type  ENUM('desktop','mobile','tablet','lainnya') NULL,
  ip_address   VARCHAR(45)  NULL,
  user_agent   VARCHAR(500) NULL,
  created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_activity_created (created_at),
  KEY idx_activity_module (module, created_at),
  KEY idx_activity_actor (actor_id, created_at),
  KEY idx_activity_entity (entity_type, entity_id),
  CONSTRAINT fk_activity_actor FOREIGN KEY (actor_id) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
