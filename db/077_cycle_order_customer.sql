-- Cycle order per customer (Customer & Repeat Order).
-- cycle_auto_days  : dianalisis otomatis dari faktur Accurate = median jarak antar tanggal order (12 jarak terakhir,
--                    jarak < 3 hari dianggap kiriman susulan dan diabaikan). NULL bila baru 1x order.
-- cycle_manual_*   : diisi manual oleh tim (mis. customer baru 1x order). Bila diisi, dipakai menggantikan hasil otomatis.
-- Status pasif / repeat order mengikuti cycle masing-masing customer (lihat lib/customers.ts).
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS cycle_auto_days    SMALLINT UNSIGNED NULL AFTER maintenance_to,
  ADD COLUMN IF NOT EXISTS cycle_auto_gaps    SMALLINT UNSIGNED NULL AFTER cycle_auto_days,
  ADD COLUMN IF NOT EXISTS cycle_analyzed_at  DATETIME NULL AFTER cycle_auto_gaps,
  ADD COLUMN IF NOT EXISTS cycle_manual_days  SMALLINT UNSIGNED NULL AFTER cycle_analyzed_at,
  ADD COLUMN IF NOT EXISTS cycle_manual_unit  ENUM('hari','bulan') NULL AFTER cycle_manual_days,
  ADD COLUMN IF NOT EXISTS cycle_manual_by    INT UNSIGNED NULL AFTER cycle_manual_unit,
  ADD COLUMN IF NOT EXISTS cycle_manual_at    DATETIME NULL AFTER cycle_manual_by;

-- Analisis awal (selanjutnya diperbarui otomatis oleh aplikasi saat ada faktur baru)
UPDATE customers c LEFT JOIN (
  SELECT customer_accurate_id, COUNT(*) AS gaps, ROUND(MAX(med)) AS median FROM (
    SELECT customer_accurate_id, gap, MEDIAN(gap) OVER (PARTITION BY customer_accurate_id) AS med FROM (
      SELECT customer_accurate_id, gap, ROW_NUMBER() OVER (PARTITION BY customer_accurate_id ORDER BY d DESC) AS rn FROM (
        SELECT customer_accurate_id, d, DATEDIFF(d, LAG(d) OVER (PARTITION BY customer_accurate_id ORDER BY d)) AS gap
        FROM (SELECT DISTINCT customer_accurate_id, trans_date AS d FROM accurate_sales_invoices WHERE trans_date IS NOT NULL AND customer_accurate_id IS NOT NULL) a
      ) b WHERE gap >= 3
    ) r WHERE rn <= 12
  ) m GROUP BY customer_accurate_id
) x ON x.customer_accurate_id = c.accurate_id
SET c.cycle_auto_days = x.median, c.cycle_auto_gaps = x.gaps, c.cycle_analyzed_at = NOW();
