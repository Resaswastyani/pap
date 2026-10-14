-- PAP-MS: lampiran hasil meeting (link atau file gambar/PDF/Word), opsional

CREATE TABLE IF NOT EXISTS meeting_files (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  meeting_id  INT UNSIGNED NOT NULL,
  type        ENUM('link','file') NOT NULL,
  name        VARCHAR(255) NOT NULL,
  url         VARCHAR(1000) NULL,
  mime        VARCHAR(150) NULL,
  size        INT UNSIGNED NULL,
  data        MEDIUMBLOB   NULL,
  uploaded_by INT UNSIGNED NOT NULL,
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_meeting_files_meeting (meeting_id),
  CONSTRAINT fk_meeting_files_meeting FOREIGN KEY (meeting_id) REFERENCES meetings (id) ON DELETE CASCADE,
  CONSTRAINT fk_meeting_files_user FOREIGN KEY (uploaded_by) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
