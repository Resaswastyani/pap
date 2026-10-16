-- PAP-MS: lampiran laporan visit (file dan link), selain catatan hasil kunjungan
CREATE TABLE IF NOT EXISTS visit_attachments (
  id           INT UNSIGNED NOT NULL AUTO_INCREMENT,
  visit_id     INT UNSIGNED NOT NULL,
  kind         ENUM('file','link') NOT NULL,
  name         VARCHAR(255) NOT NULL,       -- nama file / judul link
  url          VARCHAR(1000) NULL,          -- untuk link
  mime         VARCHAR(150) NULL,
  size         INT UNSIGNED NULL,
  data         MEDIUMBLOB   NULL,           -- untuk file (maks 4 MB)
  uploaded_by  INT UNSIGNED NOT NULL,
  created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_visit_attachments (visit_id),
  CONSTRAINT fk_visit_attachments_visit FOREIGN KEY (visit_id) REFERENCES visits (id) ON DELETE CASCADE,
  CONSTRAINT fk_visit_attachments_user FOREIGN KEY (uploaded_by) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
