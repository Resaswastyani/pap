-- PPN digunggung mengikuti template Coretax "Retail XML" (RetailInvoiceBulk, lampiran I.A.5 / I.A.9 / I.B):
-- TrxCode, BuyerName (= customer), BuyerIdOpt, BuyerIdNumber, GoodServiceOpt, SerialNo, TransactionDate (= tanggal),
-- TaxBaseSellingPrice (= dpp), OtherTaxBaseSellingPrice (= dpp_nilai_lain), VAT (= ppn), STLG, Info.
-- NPWP penjual (TIN) disimpan di app_settings `pajak.npwp` (diisi dari menu Pajak / ikut terisi saat unggah Excel).
ALTER TABLE tax_digunggung
  ADD COLUMN IF NOT EXISTS trx_code         VARCHAR(10)   NOT NULL DEFAULT 'Normal' AFTER nomor,          -- Normal = I.A.5, 07/08 = I.A.9, NoVAT = I.B
  ADD COLUMN IF NOT EXISTS buyer_id_opt     VARCHAR(5)    NOT NULL DEFAULT 'NIK' AFTER customer,          -- NIK / TIN (NPWP)
  ADD COLUMN IF NOT EXISTS buyer_id_number  VARCHAR(30)   NOT NULL DEFAULT '0000000000000000' AFTER buyer_id_opt,
  ADD COLUMN IF NOT EXISTS good_service_opt CHAR(1)       NOT NULL DEFAULT 'A' AFTER buyer_id_number,     -- A = Barang, B = Jasa
  ADD COLUMN IF NOT EXISTS serial_no        VARCHAR(60)   NULL AFTER good_service_opt,                    -- nomor transaksi (bebas)
  ADD COLUMN IF NOT EXISTS stlg             DECIMAL(18,2) NOT NULL DEFAULT 0 AFTER ppn,                   -- PPnBM
  ADD COLUMN IF NOT EXISTS info             VARCHAR(255)  NULL AFTER stlg;
ALTER TABLE tax_digunggung ADD KEY IF NOT EXISTS idx_tax_digunggung_serial (masa, serial_no);
