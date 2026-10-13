-- PAP-MS: skema tabel login
-- Jalankan semua file db/*.sql berurutan: `pnpm db:setup`,
-- atau import manual satu per satu lewat phpMyAdmin.

CREATE TABLE IF NOT EXISTS users (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  name          VARCHAR(100) NOT NULL,
  email         VARCHAR(150) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role          VARCHAR(50)  NOT NULL DEFAULT 'Staff',
  is_active     TINYINT(1)   NOT NULL DEFAULT 1,
  last_login_at DATETIME     NULL,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Akun demo: demo@pap-ms.id / demo1234 (hash bcrypt)
INSERT INTO users (name, email, password_hash, role)
VALUES ('Anto Paul', 'demo@pap-ms.id', '$2b$10$5v6/kGFq5U6k69qObc2H2.hclBEIBXQXKVC.Ej0hvoNG.9yeMlmRu', 'Super Admin')
ON DUPLICATE KEY UPDATE email = email;
