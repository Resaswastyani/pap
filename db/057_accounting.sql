-- PAP-MS Accounting, Pajak & Finance (Guidance: divisi Accounting):
--   Ringkasan Keuangan (metrik finansial), Kas & Bank (transaksi harian + pencocokan saldo real), Piutang Customer,
--   Laporan Keuangan (laba rugi & neraca bulanan vs target management), Arus Kas & Forecast, Pajak (PPN & kewajiban lapor).
-- Angka keuangan dibaca dari Accurate; PAP-MS menyimpan pencocokan saldo, rencana kas, target, dan catatan pelaporan pajak.

-- Cache laporan Accurate (laba rugi / neraca / transaksi) agar halaman cepat
CREATE TABLE IF NOT EXISTS acc_report_cache (
  cache_key   VARCHAR(190) NOT NULL,
  data        LONGTEXT     NOT NULL,
  fetched_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (cache_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Pencocokan saldo Accurate dengan kondisi real kas & rekening koran
CREATE TABLE IF NOT EXISTS cash_reconciliations (
  id             INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  account_no     VARCHAR(50)   NOT NULL,
  account_name   VARCHAR(255)  NOT NULL,
  tanggal        DATE          NOT NULL,
  saldo_real     DECIMAL(20,2) NOT NULL,
  saldo_accurate DECIMAL(20,2) NOT NULL,
  catatan        VARCHAR(1000) NULL,
  created_by     INT UNSIGNED  NULL,
  created_at     DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_recon_account (account_no, tanggal),
  CONSTRAINT fk_recon_user FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Rencana kas masuk / keluar di luar faktur (gaji, cicilan, sewa, pajak, dll.) untuk forecasting
CREATE TABLE IF NOT EXISTS cash_plans (
  id          INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  jenis       ENUM('masuk','keluar') NOT NULL,
  kategori    VARCHAR(100)  NOT NULL,
  keterangan  VARCHAR(500)  NULL,
  tanggal     DATE          NOT NULL,               -- tanggal (pertama) jatuh tempo
  nominal     DECIMAL(20,2) NOT NULL,
  berulang    ENUM('sekali','mingguan','bulanan') NOT NULL DEFAULT 'sekali',
  sampai      DATE          NULL,                   -- akhir pengulangan (opsional)
  aktif       TINYINT(1)    NOT NULL DEFAULT 1,
  created_by  INT UNSIGNED  NULL,
  updated_at  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  created_at  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_cash_plans_date (aktif, tanggal),
  CONSTRAINT fk_cash_plans_user FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Target bulanan dari management (pemasukan, HPP, biaya, laba) untuk dibandingkan dengan realisasi Accurate
CREATE TABLE IF NOT EXISTS finance_targets (
  periode     CHAR(7)       NOT NULL,               -- YYYY-MM
  kategori    ENUM('pendapatan','hpp','biaya','laba_bersih') NOT NULL,
  nilai       DECIMAL(20,2) NOT NULL,
  updated_by  INT UNSIGNED  NULL,
  updated_at  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (periode, kategori),
  CONSTRAINT fk_fin_targets_user FOREIGN KEY (updated_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Kewajiban pajak per masa: setor (NTPN) & lapor (bukti penerimaan)
CREATE TABLE IF NOT EXISTS tax_filings (
  id          INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  masa        CHAR(7)       NOT NULL,               -- YYYY-MM
  jenis       VARCHAR(30)   NOT NULL,               -- ppn, pph21, pph23, pph4_2, pph25, lainnya
  nominal     DECIMAL(20,2) NULL,
  tgl_setor   DATE          NULL,
  ntpn        VARCHAR(40)   NULL,
  tgl_lapor   DATE          NULL,
  no_bukti    VARCHAR(80)   NULL,                   -- nomor bukti penerimaan elektronik (BPE)
  catatan     VARCHAR(1000) NULL,
  updated_by  INT UNSIGNED  NULL,
  updated_at  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_tax_filing (masa, jenis),
  CONSTRAINT fk_tax_filings_user FOREIGN KEY (updated_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Menu Accounting: divisi Accounting & GM
INSERT IGNORE INTO division_menus (division_id, menu_key)
SELECT d.id, m.menu_key FROM divisions d
JOIN (SELECT 'keuangan' AS menu_key UNION ALL SELECT 'kas-bank' UNION ALL SELECT 'piutang' UNION ALL SELECT 'laporan-keuangan'
      UNION ALL SELECT 'arus-kas' UNION ALL SELECT 'pajak') m
WHERE d.code IN ('accounting', 'general_manager');

-- Permission: kelola data Accounting (pencocokan saldo, rencana kas, pelaporan pajak); target diatur management
INSERT INTO permissions (code, name, module, sort_order) VALUES
  ('accounting.manage', 'Accounting: catat pencocokan saldo, rencana kas, dan pelaporan pajak', 'Accounting', 81),
  ('accounting.target', 'Accounting: atur target keuangan bulanan (management)',               'Accounting', 82)
ON DUPLICATE KEY UPDATE name = VALUES(name), module = VALUES(module), sort_order = VALUES(sort_order);

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code IN ('accounting.manage', 'accounting.target') WHERE r.code = 'admin';

INSERT IGNORE INTO user_permissions (user_id, permission_id, allowed)
SELECT u.id, p.id, 1 FROM users u JOIN divisions d ON d.id = u.division_id JOIN permissions p ON p.code = 'accounting.manage'
WHERE d.code = 'accounting';
