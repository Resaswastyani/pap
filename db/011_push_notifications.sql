-- PAP-MS: notifikasi untuk pembuat planning & Web Push ke HP/desktop

-- 1. Jenis notifikasi baru: konfirmasi ke pembuat planning
ALTER TABLE notifications MODIFY type ENUM('meeting_baru','meeting_diubah','meeting_reminder','planning_pic','planning_baru') NOT NULL;

-- 2. Langganan Web Push per perangkat (satu user bisa punya banyak perangkat).
--    last_notification_id: notifikasi terakhir yang sudah ditampilkan di perangkat ini.
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id                   INT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id              INT UNSIGNED NOT NULL,
  endpoint             VARCHAR(1000) NOT NULL,
  endpoint_hash        CHAR(64)     NOT NULL,
  p256dh               VARCHAR(255) NULL,
  auth                 VARCHAR(255) NULL,
  user_agent           VARCHAR(255) NULL,
  last_notification_id INT UNSIGNED NOT NULL DEFAULT 0,
  created_at           DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at           DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_push_endpoint (endpoint_hash),
  KEY idx_push_user (user_id),
  CONSTRAINT fk_push_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
