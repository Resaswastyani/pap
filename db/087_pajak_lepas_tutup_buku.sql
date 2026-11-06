-- Pajak berdiri sendiri: angka PPN tidak lagi dibekukan oleh tutup buku Laporan Keuangan
DELETE FROM acc_closed_cache WHERE cache_key LIKE 'vat:%';
