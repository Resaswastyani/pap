-- Prospek bisa dipegang lebih dari satu sales. prospects.assigned_to tetap = sales utama (urutan pertama),
-- daftar lengkapnya (termasuk sales utama) di prospect_sales.
CREATE TABLE IF NOT EXISTS prospect_sales (
  prospect_id INT UNSIGNED NOT NULL,
  user_id     INT UNSIGNED NOT NULL,
  urut        TINYINT UNSIGNED NOT NULL DEFAULT 0,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (prospect_id, user_id),
  KEY idx_prospect_sales_user (user_id),
  CONSTRAINT fk_prospect_sales_prospect FOREIGN KEY (prospect_id) REFERENCES prospects (id) ON DELETE CASCADE,
  CONSTRAINT fk_prospect_sales_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO prospect_sales (prospect_id, user_id, urut) SELECT id, assigned_to, 0 FROM prospects WHERE assigned_to IS NOT NULL;
