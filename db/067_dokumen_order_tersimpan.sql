-- Dokumen Order tersimpan: Surat Order & Proforma Invoice yang bisa dibuat (dari SO Accurate atau manual),
-- diubah, dan dihapus di PAP-MS. Isi disalin dari SO saat dibuat, lalu bebas diedit tanpa mengubah SO di Accurate.
CREATE TABLE IF NOT EXISTS order_documents (
  id              INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  jenis           ENUM('order','proforma') NOT NULL,
  nomor           VARCHAR(60)   NOT NULL,
  tanggal         DATE          NOT NULL,
  so_accurate_id  INT           NULL,                       -- SO sumber (boleh kosong untuk dokumen manual)
  so_number       VARCHAR(60)   NULL,
  kepada          VARCHAR(255)  NOT NULL,                   -- nama customer
  customer_no     VARCHAR(60)   NULL,
  kontak          VARCHAR(150)  NULL,
  telepon         VARCHAR(100)  NULL,
  alamat          TEXT          NULL,
  po_number       VARCHAR(100)  NULL,
  ship_date       DATE          NULL,
  ekspedisi       VARCHAR(255)  NULL,
  items           JSON          NOT NULL,                   -- [{ nama, qty, unit, harga, disc_pct, catatan }]
  expenses        JSON          NULL,                       -- [{ nama, amount }] biaya lain (ongkir, dll.)
  diskon          DECIMAL(18,2) NOT NULL DEFAULT 0,
  ppn_mode        ENUM('none','exclusive','inclusive') NOT NULL DEFAULT 'none',
  ppn_rate        DECIMAL(5,2)  NOT NULL DEFAULT 11,
  terbayar        DECIMAL(18,2) NOT NULL DEFAULT 0,         -- uang muka yang sudah diterima
  dp_persen       DECIMAL(5,2)  NULL,                       -- proforma: tagih DP x%; kosong = tagih total / sisa
  catatan         TEXT          NULL,
  rekening        TEXT          NULL,                       -- proforma: rekening pembayaran
  penandatangan   VARCHAR(150)  NULL,
  created_by      INT UNSIGNED  NOT NULL,
  updated_by      INT UNSIGNED  NULL,
  created_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_order_doc_nomor (jenis, nomor),
  KEY idx_order_doc_so (so_accurate_id),
  KEY idx_order_doc_tanggal (tanggal)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
