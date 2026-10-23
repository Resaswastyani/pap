-- PAP-MS: tabel expeditions (029: satu baris = ekspedisi + tujuan + tarif, dipakai Master Data & order Quotation) ikut diisi otomatis
-- dari keterangan SO Accurate. Baris sumber 'so' diperbarui sinkron; baris 'manual' tidak ditimpa.
ALTER TABLE expeditions
  ADD COLUMN IF NOT EXISTS nama_key VARCHAR(120) NULL AFTER nama,
  ADD COLUMN IF NOT EXISTS sumber   ENUM('manual','so') NOT NULL DEFAULT 'manual' AFTER keterangan,
  ADD COLUMN IF NOT EXISTS created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE expeditions ADD UNIQUE KEY IF NOT EXISTS uq_expedition_route (nama_key, tujuan);
