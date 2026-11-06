-- Nilai penjualan bersih per faktur, sama dengan "Pendapatan" di Laba Rugi Accurate / laporan Penjualan per Pelanggan:
-- subTotal − diskon − PPN (bila harga termasuk PPN); tidak termasuk PPN (harga belum termasuk PPN) dan biaya lain / ongkir.
-- Diisi saat sinkron Accurate; faktur lama diisi sekali otomatis (lib/invoice-net.ts). NULL = belum terisi (pakai total_amount).
ALTER TABLE accurate_sales_invoices ADD COLUMN IF NOT EXISTS net_amount DECIMAL(18,2) NULL AFTER total_amount;
