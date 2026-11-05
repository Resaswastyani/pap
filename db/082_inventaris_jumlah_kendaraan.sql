-- Inventaris: jumlah unit per baris (mis. 4 handphone sejenis) dan data khusus kendaraan (pajak & uji KIR)
ALTER TABLE ga_inventaris
  ADD COLUMN IF NOT EXISTS jumlah             INT UNSIGNED NOT NULL DEFAULT 1 AFTER nomor_seri,
  ADD COLUMN IF NOT EXISTS tahun              SMALLINT UNSIGNED NULL AFTER tanggal_beli,  -- tahun pembuatan (kendaraan)
  ADD COLUMN IF NOT EXISTS pajak_tahunan      DATE NULL AFTER tahun,                     -- jatuh tempo pajak tahunan (STNK)
  ADD COLUMN IF NOT EXISTS pajak_lima_tahunan DATE NULL AFTER pajak_tahunan,             -- jatuh tempo pajak 5 tahunan (ganti plat)
  ADD COLUMN IF NOT EXISTS uji_kir            DATE NULL AFTER pajak_lima_tahunan;        -- jatuh tempo uji KIR (kendaraan niaga)
