-- PAP-MS: tulis balik ke Google Sheet (Rekap Kerusakan, Lembar Perawatan, Data Mesin).
-- Rekap kerusakan menyimpan nama tab asal baris agar baris bisa ditemukan lagi saat diubah / dihapus dari SIMPAP.
ALTER TABLE machine_damage_logs ADD COLUMN IF NOT EXISTS sheet_tab VARCHAR(120) NULL AFTER source;
