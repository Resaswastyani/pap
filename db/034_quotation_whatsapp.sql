-- PAP-MS: nomor WA customer terpisah dari nomor telepon di penawaran (dicetak atas-bawah: Telepon lalu WA)
ALTER TABLE quotations ADD COLUMN IF NOT EXISTS whatsapp VARCHAR(40) NULL AFTER telepon;
