-- Jenis lampiran catatan: tambah tiket kendala & laporan kerusakan (sebelumnya belum terdaftar sehingga lampiran tidak tersimpan)
ALTER TABLE note_attachments MODIFY owner_type ENUM('activity','request_log','stage','job','repair','maintenance_log','purchase_request','ticket','damage_log') NOT NULL;

-- Isi kunci lampiran untuk baris rekap kerusakan yang sudah ada (sama dengan rumus di lib/damage-log.ts damageRefKeys):
-- baris spreadsheet ber-NO -> "no:<no>#<urutan di laporan itu>", isian form -> "app:<id>".
-- Baris spreadsheet tanpa NO terisi otomatis pada sinkron berikutnya.
UPDATE machine_damage_logs d
  JOIN (
    SELECT id, CONCAT('no:', no_laporan, '#', ROW_NUMBER() OVER (PARTITION BY no_laporan ORDER BY sheet_row, id) - 1) AS k
    FROM machine_damage_logs WHERE source = 'sheet' AND no_laporan IS NOT NULL
  ) x ON x.id = d.id
SET d.ref_key = x.k
WHERE d.ref_key IS NULL;

UPDATE machine_damage_logs SET ref_key = CONCAT('app:', id) WHERE source = 'app' AND ref_key IS NULL;

INSERT IGNORE INTO damage_attachment_refs (ref_key) SELECT ref_key FROM machine_damage_logs WHERE ref_key IS NOT NULL;
