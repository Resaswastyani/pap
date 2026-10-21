-- PAP-MS: Kapasitas Produksi (dokumen "KAPASITAS PRODUKSI PAP Des 2025 – Non Mika"), menu Rencana Produksi & penghapusan menu SPK.
-- Kapasitas efektif = kapasitas maksimal x efisiensi (70%). Dipakai Marketing untuk menata order per jenis plastik
-- dan Produksi untuk pengaturan kerja & delivery.

CREATE TABLE IF NOT EXISTS production_capacities (
  id                 INT UNSIGNED NOT NULL AUTO_INCREMENT,
  jenis_plastik      VARCHAR(60)  NOT NULL,             -- HD/PE, PP
  lebar_maks_cm      DECIMAL(7,1) NULL,
  kapasitas_maks_ton DECIMAL(10,2) NOT NULL,
  efisiensi_pct      DECIMAL(5,2) NOT NULL DEFAULT 70,
  mesin              VARCHAR(255) NOT NULL,             -- mis. "Mesin Blow HD/PE Besar"
  jumlah_mesin       TINYINT UNSIGNED NOT NULL DEFAULT 1,
  catatan            VARCHAR(500) NULL,
  urut               SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  updated_by         INT UNSIGNED NULL,
  created_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_capacity_jenis (jenis_plastik, urut),
  CONSTRAINT fk_capacity_user FOREIGN KEY (updated_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Isi dokumen Des 2025 (hanya bila tabel masih kosong)
INSERT INTO production_capacities (jenis_plastik, lebar_maks_cm, kapasitas_maks_ton, efisiensi_pct, mesin, jumlah_mesin, urut)
SELECT * FROM (
  SELECT 'HD/PE' AS jenis_plastik, 65 AS lebar, 30 AS maks, 70 AS eff, 'Mesin Blow HD/PE Besar' AS mesin, 1 AS jumlah, 1 AS urut UNION ALL
  SELECT 'HD/PE', 40, 20, 70, 'Mesin Blow HD/PE Kecil double screw', 1, 2 UNION ALL
  SELECT 'PP', 65, 30, 70, 'Mesin Blow PP Besar', 1, 3 UNION ALL
  SELECT 'PP', 35, 20, 70, 'Mesin Blow PP Kecil', 2, 4
) AS seed WHERE NOT EXISTS (SELECT 1 FROM production_capacities);

-- Keterangan dokumen (judul, tanggal, catatan, penanda tangan)
INSERT IGNORE INTO app_settings (`key`, value) VALUES
  ('kapasitas.info', '{"judul":"KAPASITAS PRODUKSI PAP Des 2025 – Non Mika","tanggal":"2025-12-10","catatan":"Data ini digunakan Dept Marketing untuk menata order sesuai jenis plastiknya.\\nData ini digunakan Dept Produksi untuk pengaturan kerja dan delivery.","ttd":["Sebastian","Dewi","Wibowo"]}');

-- Menu Kapasitas Produksi: divisi yang membuka Rencana Produksi
INSERT IGNORE INTO division_menus (division_id, menu_key)
SELECT division_id, 'kapasitas-produksi' FROM division_menus WHERE menu_key = 'jadwal-produksi';

-- Menu SPK dihapus
DELETE FROM division_menus WHERE menu_key = 'sbk';

-- MC Gusset lini HD tanpa Buffer (sinkron Data Mesin dari sheet juga mengikuti aturan ini)
UPDATE machines SET nama = REPLACE(nama, 'MC Gusset & Buffer', 'MC Gusset') WHERE kode = 'HD-GUSSET-BUFFER' AND nama LIKE 'MC Gusset & Buffer%';
