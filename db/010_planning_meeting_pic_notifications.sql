-- PAP-MS: planning dari meeting, PIC planning, dan notifikasi

-- 1. Planning bisa lahir dari sebuah meeting (meeting dihapus -> tautan dikosongkan)
ALTER TABLE plannings ADD COLUMN IF NOT EXISTS meeting_id INT UNSIGNED NULL AFTER division_id;
ALTER TABLE plannings ADD KEY IF NOT EXISTS idx_plannings_meeting (meeting_id);
ALTER TABLE plannings ADD CONSTRAINT fk_plannings_meeting FOREIGN KEY IF NOT EXISTS (meeting_id) REFERENCES meetings (id) ON DELETE SET NULL;

-- 2. Person in charge (PIC) planning; pembuat planning selalu ikut sebagai PIC
CREATE TABLE IF NOT EXISTS planning_pics (
  planning_id INT UNSIGNED NOT NULL,
  user_id     INT UNSIGNED NOT NULL,
  PRIMARY KEY (planning_id, user_id),
  KEY idx_planning_pics_user (user_id),
  CONSTRAINT fk_planning_pics_planning FOREIGN KEY (planning_id) REFERENCES plannings (id) ON DELETE CASCADE,
  CONSTRAINT fk_planning_pics_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO planning_pics (planning_id, user_id) SELECT id, created_by FROM plannings;

-- 3. Notifikasi per user. ref_key mencegah notifikasi ganda (mis. reminder yang sama)
CREATE TABLE IF NOT EXISTS notifications (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id     INT UNSIGNED NOT NULL,
  type        ENUM('meeting_baru','meeting_diubah','meeting_reminder','planning_pic') NOT NULL,
  title       VARCHAR(200) NOT NULL,
  body        VARCHAR(500) NULL,
  meeting_id  INT UNSIGNED NULL,
  planning_id INT UNSIGNED NULL,
  ref_key     VARCHAR(120) NOT NULL,
  read_at     DATETIME     NULL,
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_notifications_ref (user_id, ref_key),
  KEY idx_notifications_user (user_id, read_at, id),
  CONSTRAINT fk_notifications_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_notifications_meeting FOREIGN KEY (meeting_id) REFERENCES meetings (id) ON DELETE CASCADE,
  CONSTRAINT fk_notifications_planning FOREIGN KEY (planning_id) REFERENCES plannings (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
