-- PAP-MS: jenis notifikasi "sistem" (mis. notifikasi uji dari tombol "Kirim notifikasi uji")
ALTER TABLE notifications MODIFY type ENUM('meeting_baru','meeting_diubah','meeting_reminder','planning_pic','planning_baru','sistem') NOT NULL;
