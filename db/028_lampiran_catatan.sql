-- PAP-MS: lampiran catatan (semua format file maks 2 MB, atau link) untuk:
--   activity     = follow-up Prospek & Repeat Order (marketing_activities)
--   request_log  = catatan status Request Sample & Request Desain (request_logs)
--   stage        = catatan tahap Jadwal Produksi (production_stages)
--   job          = catatan PPIC pada job produksi (production_jobs)

CREATE TABLE IF NOT EXISTS note_attachments (
  id           INT UNSIGNED NOT NULL AUTO_INCREMENT,
  owner_type   ENUM('activity','request_log','stage','job') NOT NULL,
  owner_id     INT UNSIGNED NOT NULL,
  kind         ENUM('file','link') NOT NULL,
  name         VARCHAR(255) NOT NULL,
  url          VARCHAR(1000) NULL,
  mime         VARCHAR(150) NULL,
  size         INT UNSIGNED NULL,
  data         MEDIUMBLOB   NULL,
  uploaded_by  INT UNSIGNED NOT NULL,
  created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_note_attachments_owner (owner_type, owner_id),
  CONSTRAINT fk_note_attachments_user FOREIGN KEY (uploaded_by) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
