-- PAP-MS: stok fisik (list-stock Accurate) di samping stok tersedia dijual (availableToSell)
ALTER TABLE accurate_items ADD COLUMN IF NOT EXISTS quantity_on_hand DECIMAL(18,4) NULL AFTER quantity;
