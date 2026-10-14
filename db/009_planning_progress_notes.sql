-- PAP-MS: catatan progress planning
-- Setiap catatan menyimpan progress & status saat itu, isi teks (opsional), dan lampiran link/file.
-- Tanggal & waktu catatan otomatis (created_at). Lampiran catatan memakai planning_files dengan note_id.

CREATE TABLE IF NOT EXISTS planning_progress_notes (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  planning_id INT UNSIGNED NOT NULL,
  progress    TINYINT UNSIGNED NOT NULL,
  status      ENUM('belum_mulai','berjalan','selesai','ditunda','dibatalkan') NOT NULL,
  catatan     TEXT         NULL,
  created_by  INT UNSIGNED NOT NULL,
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_progress_notes_planning (planning_id, created_at),
  CONSTRAINT fk_progress_notes_planning FOREIGN KEY (planning_id) REFERENCES plannings (id) ON DELETE CASCADE,
  CONSTRAINT fk_progress_notes_user FOREIGN KEY (created_by) REFERENCES users (id),
  CONSTRAINT chk_progress_notes_progress CHECK (progress <= 100)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Lampiran planning (note_id NULL) atau lampiran catatan progress (note_id terisi)
ALTER TABLE planning_files ADD COLUMN IF NOT EXISTS note_id INT UNSIGNED NULL AFTER planning_id;
ALTER TABLE planning_files ADD KEY IF NOT EXISTS idx_planning_files_note (note_id);
ALTER TABLE planning_files ADD CONSTRAINT fk_planning_files_note FOREIGN KEY IF NOT EXISTS (note_id) REFERENCES planning_progress_notes (id) ON DELETE CASCADE;
