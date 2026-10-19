-- PAP-MS: Jadwal Shift format baru (KDKARYAWAN | NAMA | TGLAWAL | TGLAKHIR | Hari1..Hari31 berisi Shift1 / Shift2 / Shift3 / OFF / Normal1 / Driver1)
-- keterangan = JSON tabel "Keterangan" di sheet: [{kode, label, jam}], mis. Shift 1 = 7.00-15.00, Normal1 = 9.00-17.00
ALTER TABLE shift_schedules ADD COLUMN IF NOT EXISTS keterangan TEXT NULL AFTER sheet_tab;
-- Kode non-shift (normal1, driver1, ...) lebih panjang dari 1 karakter per tanggal
ALTER TABLE shift_schedule_rows MODIFY jadwal TEXT NOT NULL;
