-- PAP-MS: lampiran Prospek & Request Sample (semua format file maks 2 MB, atau link)

CREATE TABLE IF NOT EXISTS prospect_attachments (
  id           INT UNSIGNED NOT NULL AUTO_INCREMENT,
  prospect_id  INT UNSIGNED NOT NULL,
  kind         ENUM('file','link') NOT NULL,
  name         VARCHAR(255) NOT NULL,       -- nama file / judul link
  url          VARCHAR(1000) NULL,          -- untuk link
  mime         VARCHAR(150) NULL,
  size         INT UNSIGNED NULL,
  data         MEDIUMBLOB   NULL,           -- untuk file (maks 2 MB)
  uploaded_by  INT UNSIGNED NOT NULL,
  created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_prospect_attachments (prospect_id),
  CONSTRAINT fk_prospect_attachments_prospect FOREIGN KEY (prospect_id) REFERENCES prospects (id) ON DELETE CASCADE,
  CONSTRAINT fk_prospect_attachments_user FOREIGN KEY (uploaded_by) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sample_attachments (
  id           INT UNSIGNED NOT NULL AUTO_INCREMENT,
  sample_id    INT UNSIGNED NOT NULL,
  kind         ENUM('file','link') NOT NULL,
  name         VARCHAR(255) NOT NULL,
  url          VARCHAR(1000) NULL,
  mime         VARCHAR(150) NULL,
  size         INT UNSIGNED NULL,
  data         MEDIUMBLOB   NULL,
  uploaded_by  INT UNSIGNED NOT NULL,
  created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_sample_attachments (sample_id),
  CONSTRAINT fk_sample_attachments_sample FOREIGN KEY (sample_id) REFERENCES sample_requests (id) ON DELETE CASCADE,
  CONSTRAINT fk_sample_attachments_user FOREIGN KEY (uploaded_by) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
