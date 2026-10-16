-- PAP-MS: KPI marketing (target bulanan per sales) + waktu keputusan quotation

-- Menu KPI Marketing
INSERT IGNORE INTO division_menus (division_id, menu_key)
SELECT d.id, 'kpi' FROM divisions d
WHERE d.code IN ('marketing', 'marketing_digital', 'marketing_development', 'marketing_maintenance', 'general_manager');

-- Target KPI per user per bulan (periode 'YYYY-MM'); metric sesuai lib/kpi.ts
CREATE TABLE IF NOT EXISTS kpi_targets (
  user_id     INT UNSIGNED NOT NULL,
  periode     CHAR(7)      NOT NULL,
  metric      VARCHAR(30)  NOT NULL,
  target      DECIMAL(16,2) NOT NULL DEFAULT 0,
  updated_by  INT UNSIGNED NULL,
  updated_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, periode, metric),
  CONSTRAINT fk_kpi_targets_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Kapan quotation diterima / ditolak (untuk KPI closing per bulan)
ALTER TABLE quotations ADD COLUMN IF NOT EXISTS closed_at DATETIME NULL AFTER sent_at;
