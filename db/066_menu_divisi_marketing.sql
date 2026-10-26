-- PAP-MS: menu marketing dibedakan per divisi (Guidance alur prospek):
--   Marketing Digital      : mencari lead & konten  -> Prospek, Kalender Konten, Request Desain/Sample, Customer, Data Produk, Quotation, KPI
--   Marketing Development  : follow-up s/d order 1  -> Prospek, Jadwal Visit, Quotation, Request Sample/Desain, Customer, Data Produk, KPI, Dokumen Order
--   Marketing Maintenance  : customer & repeat order -> Customer, Repeat Order, Order Bulanan, Pengiriman, Ekspedisi, Dokumen Order, Quotation,
--                                                      Prospek (hasil handover), Jadwal Visit, KPI
-- Hanya menu marketing & logistik di bawah ini yang disetel ulang; menu umum (Dashboard, Stok, produksi, SDM, dll.) tidak berubah.
-- Selanjutnya menu per divisi bisa diubah Admin di Manajemen Role > Menu per divisi.

DELETE dm FROM division_menus dm
JOIN divisions d ON d.id = dm.division_id
WHERE d.code IN ('marketing_digital', 'marketing_development', 'marketing_maintenance')
  AND dm.menu_key IN ('prospek', 'visit', 'sample', 'desain', 'customer', 'order-bulanan', 'repeat-order', 'produk', 'quotation', 'dokumen-order', 'konten', 'kpi', 'pengiriman', 'ekspedisi');

INSERT IGNORE INTO division_menus (division_id, menu_key)
SELECT d.id, m.menu_key FROM divisions d
JOIN (
  SELECT 'marketing_digital' AS code, 'prospek' AS menu_key UNION ALL
  SELECT 'marketing_digital', 'konten' UNION ALL
  SELECT 'marketing_digital', 'desain' UNION ALL
  SELECT 'marketing_digital', 'sample' UNION ALL
  SELECT 'marketing_digital', 'customer' UNION ALL
  SELECT 'marketing_digital', 'produk' UNION ALL
  SELECT 'marketing_digital', 'quotation' UNION ALL
  SELECT 'marketing_digital', 'kpi' UNION ALL

  SELECT 'marketing_development', 'prospek' UNION ALL
  SELECT 'marketing_development', 'visit' UNION ALL
  SELECT 'marketing_development', 'quotation' UNION ALL
  SELECT 'marketing_development', 'sample' UNION ALL
  SELECT 'marketing_development', 'desain' UNION ALL
  SELECT 'marketing_development', 'customer' UNION ALL
  SELECT 'marketing_development', 'produk' UNION ALL
  SELECT 'marketing_development', 'kpi' UNION ALL
  SELECT 'marketing_development', 'dokumen-order' UNION ALL

  SELECT 'marketing_maintenance', 'customer' UNION ALL
  SELECT 'marketing_maintenance', 'repeat-order' UNION ALL
  SELECT 'marketing_maintenance', 'order-bulanan' UNION ALL
  SELECT 'marketing_maintenance', 'pengiriman' UNION ALL
  SELECT 'marketing_maintenance', 'ekspedisi' UNION ALL
  SELECT 'marketing_maintenance', 'dokumen-order' UNION ALL
  SELECT 'marketing_maintenance', 'quotation' UNION ALL
  SELECT 'marketing_maintenance', 'prospek' UNION ALL
  SELECT 'marketing_maintenance', 'visit' UNION ALL
  SELECT 'marketing_maintenance', 'kpi'
) m ON m.code = d.code;
