-- PAP-MS: Meeting (pengganti menu "Planning Meeting")
-- Meeting boleh terhubung ke satu planning (planning_id) atau berdiri sendiri (meeting dadakan).
-- Peserta disimpan di meeting_participants (satu meeting, banyak user).

CREATE TABLE IF NOT EXISTS meetings (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  nomor         VARCHAR(30)  NULL,
  planning_id   INT UNSIGNED NULL,
  division_id   INT UNSIGNED NOT NULL, -- divisi pembuat (untuk cakupan akses)
  waktu         DATETIME     NOT NULL,
  deskripsi     TEXT         NOT NULL,
  tempat        VARCHAR(500) NULL,     -- nama ruangan atau link meeting
  status        ENUM('terjadwal','berlangsung','selesai','dibatalkan') NOT NULL DEFAULT 'terjadwal',
  hasil_meeting TEXT         NULL,
  created_by    INT UNSIGNED NOT NULL,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_meetings_nomor (nomor),
  KEY idx_meetings_waktu (waktu),
  KEY idx_meetings_planning (planning_id),
  KEY idx_meetings_division (division_id, status),
  CONSTRAINT fk_meetings_planning FOREIGN KEY (planning_id) REFERENCES plannings (id) ON DELETE SET NULL,
  CONSTRAINT fk_meetings_division FOREIGN KEY (division_id) REFERENCES divisions (id),
  CONSTRAINT fk_meetings_created_by FOREIGN KEY (created_by) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS meeting_participants (
  meeting_id INT UNSIGNED NOT NULL,
  user_id    INT UNSIGNED NOT NULL,
  PRIMARY KEY (meeting_id, user_id),
  KEY idx_meeting_participants_user (user_id),
  CONSTRAINT fk_meeting_participants_meeting FOREIGN KEY (meeting_id) REFERENCES meetings (id) ON DELETE CASCADE,
  CONSTRAINT fk_meeting_participants_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Menu "Planning Meeting" (per divisi) diganti menu "Meeting" (lewat permission meeting.view)
DELETE FROM division_menus WHERE menu_key = 'planning-meeting';

INSERT INTO permissions (code, name, module, sort_order) VALUES
  ('meeting.view',     'Lihat meeting divisi sendiri & yang diikuti', 'Meeting', 11),
  ('meeting.view_all', 'Lihat meeting semua divisi',                  'Meeting', 12),
  ('meeting.create',   'Buat meeting',                                'Meeting', 13),
  ('meeting.manage',   'Kelola (edit & hapus) semua meeting',         'Meeting', 14)
ON DUPLICATE KEY UPDATE name = VALUES(name), module = VALUES(module), sort_order = VALUES(sort_order);

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p JOIN (
  SELECT 'staff' AS role_code, 'meeting.view' AS perm UNION ALL
  SELECT 'staff', 'meeting.create' UNION ALL
  SELECT 'lead', 'meeting.view' UNION ALL
  SELECT 'lead', 'meeting.create' UNION ALL
  SELECT 'lead', 'meeting.manage' UNION ALL
  SELECT 'admin', 'meeting.view' UNION ALL
  SELECT 'admin', 'meeting.view_all' UNION ALL
  SELECT 'admin', 'meeting.create' UNION ALL
  SELECT 'admin', 'meeting.manage'
) AS m ON m.role_code = r.code AND m.perm = p.code;
