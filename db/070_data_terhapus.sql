-- PAP-MS: Tempat sampah (soft delete) untuk semua modul.
-- Saat data dihapus, baris beserta data turunannya (FK ON DELETE CASCADE) disalin ke sini sebagai JSON,
-- lalu baris asli dihapus. Pulihkan = sisipkan kembali salinan & sambungkan ulang referensi ON DELETE SET NULL.
CREATE TABLE IF NOT EXISTS deleted_records (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  modul VARCHAR(60) NOT NULL,
  label VARCHAR(255) NOT NULL,
  table_name VARCHAR(64) NOT NULL,
  record_id VARCHAR(64) NOT NULL,
  row_count INT UNSIGNED NOT NULL DEFAULT 1,
  size_bytes INT UNSIGNED NOT NULL DEFAULT 0,
  snapshot LONGTEXT NOT NULL,
  deleted_by INT UNSIGNED NULL,
  deleted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  restored_at DATETIME NULL,
  restored_by INT UNSIGNED NULL,
  KEY idx_deleted_open (restored_at, deleted_at),
  KEY idx_deleted_by (deleted_by),
  KEY idx_deleted_table (table_name, record_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
