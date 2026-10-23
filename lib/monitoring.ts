// Monitoring Top Management (Guidance "Kebutuhan Top Management"): analisa performa perusahaan, monitoring performa divisi,
// plan monitoring & koordinasi, dan KPI. Semua angka dibaca dari data yang sudah ada di PAP-MS / salinan Accurate.
import type { RowDataPacket } from 'mysql2'
import { fail } from '@/lib/api'
import { db } from '@/lib/db'
import { cashAccounts, monthEnd, plAmounts, plSummary, receivables, payables, shiftMonth } from '@/lib/accounting'
import { computeEmployeeKpi } from '@/lib/employee-kpi'
import { shipCandidates } from '@/lib/logistik'
import { listPermits } from '@/lib/permits'
import type { UserProfile } from '@/lib/users'

type Row = RowDataPacket & Record<string, unknown>
const n = (v: unknown) => Number(v ?? 0)

export function requireMonitoring(user: UserProfile) {
  if (!user.menus.includes('monitoring' as never)) fail(403, 'Anda tidak punya akses ke menu Monitoring.')
}
const todayWib = () => new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10)

// Satu bagian gagal (mis. Accurate tidak bisa dihubungi) tidak menggagalkan halaman
export async function section<T>(fn: () => Promise<T>): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  try {
    return { ok: true, data: await fn() }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Gagal memuat data.' }
  }
}

// ---------- Performa perusahaan ----------
export async function companyPerformance(periode: string) {
  const dari = `${periode}-01`
  const sampai = monthEnd(periode)
  const today = todayWib()
  const berjalan = today.slice(0, 7) === periode
  // Bulan berjalan dibandingkan pada rentang tanggal yang sama (1 s/d hari ini)
  const hari = berjalan ? Number(today.slice(8, 10)) : 31
  const prev = shiftMonth(periode, -1)
  const lastYear = `${Number(periode.slice(0, 4)) - 1}${periode.slice(4)}`
  const omzetOf = async (p: string) => {
    const [[r]] = await db.query<Row[]>(
      'SELECT COALESCE(SUM(total_amount), 0) AS omzet, COUNT(*) AS faktur, COUNT(DISTINCT customer_accurate_id) AS customer FROM accurate_sales_invoices WHERE trans_date BETWEEN ? AND ?',
      [`${p}-01`, `${p}-${String(Math.min(hari, Number(monthEnd(p).slice(8, 10)))).padStart(2, '0')}`],
    )
    return { omzet: n(r.omzet), faktur: n(r.faktur), customer: n(r.customer) }
  }
  const [now, before, yoy] = await Promise.all([omzetOf(periode), omzetOf(prev), omzetOf(lastYear)])
  const [[so]] = await db.query<Row[]>('SELECT COUNT(*) AS jumlah, COALESCE(SUM(total_amount), 0) AS nilai, COUNT(DISTINCT customer_accurate_id) AS customer FROM accurate_sales_orders WHERE trans_date BETWEEN ? AND ?', [dari, sampai])
  // Customer baru = order pertama di bulan ini
  const [[baru]] = await db.query<Row[]>(
    `SELECT COUNT(*) AS n FROM (SELECT customer_accurate_id, MIN(trans_date) AS first FROM accurate_sales_orders GROUP BY customer_accurate_id) f WHERE f.first BETWEEN ? AND ?`,
    [dari, sampai],
  )
  const [targets] = await db.query<Row[]>('SELECT kategori, nilai FROM finance_targets WHERE periode = ?', [periode])
  const target = Object.fromEntries(targets.map((t) => [String(t.kategori), n(t.nilai)]))
  const [trend] = await db.query<Row[]>(
    `SELECT m.bulan, COALESCE(i.omzet, 0) AS omzet, COALESCE(o.nilai, 0) AS so FROM
       (SELECT DATE_FORMAT(? - INTERVAL k MONTH, '%Y-%m') AS bulan FROM (SELECT 0 k UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4 UNION ALL SELECT 5
         UNION ALL SELECT 6 UNION ALL SELECT 7 UNION ALL SELECT 8 UNION ALL SELECT 9 UNION ALL SELECT 10 UNION ALL SELECT 11) ks) m
     LEFT JOIN (SELECT DATE_FORMAT(trans_date, '%Y-%m') AS bulan, SUM(total_amount) AS omzet FROM accurate_sales_invoices WHERE trans_date >= ? - INTERVAL 12 MONTH GROUP BY 1) i ON i.bulan = m.bulan
     LEFT JOIN (SELECT DATE_FORMAT(trans_date, '%Y-%m') AS bulan, SUM(total_amount) AS nilai FROM accurate_sales_orders WHERE trans_date >= ? - INTERVAL 12 MONTH GROUP BY 1) o ON o.bulan = m.bulan
     ORDER BY m.bulan`,
    [dari, dari, dari],
  )
  return {
    periode, berjalan, sampai_tanggal: berjalan ? today : sampai,
    penjualan: { ...now, bulan_lalu: before.omzet, tahun_lalu: yoy.omzet, target: target.pendapatan ?? null },
    so: { jumlah: n(so.jumlah), nilai: n(so.nilai), customer: n(so.customer), customer_baru: n(baru.n) },
    trend: trend.map((t) => ({ bulan: String(t.bulan), omzet: n(t.omzet), so: n(t.so) })),
    target,
  }
}

// Keuangan dari Accurate (cache laporan Accounting): laba rugi bulan, kas, piutang, hutang
export async function financeSnapshot(periode: string) {
  const sampai = monthEnd(periode) < todayWib() ? monthEnd(periode) : todayWib()
  const [pl, kas, ar, ap] = await Promise.all([
    plAmounts(`${periode}-01`, sampai).then(plSummary),
    cashAccounts().then((a) => a.filter((x) => !x.is_parent).reduce((t, x) => t + x.balance, 0)),
    receivables(),
    payables(),
  ])
  const today = todayWib()
  return {
    laba_rugi: pl, kas,
    piutang: { total: ar.reduce((t, r) => t + r.sisa, 0), jatuh_tempo: ar.filter((r) => r.umur > 0).reduce((t, r) => t + r.sisa, 0), lewat_60: ar.filter((r) => r.umur > 60).reduce((t, r) => t + r.sisa, 0), faktur: ar.length },
    hutang: { total: ap.reduce((t, r) => t + r.sisa, 0), jatuh_tempo: ap.filter((r) => r.jatuh_tempo && r.jatuh_tempo < today).reduce((t, r) => t + r.sisa, 0), faktur: ap.length },
  }
}

// ---------- Performa per divisi ----------
type Tone = 'ok' | 'warn' | 'bad'
type Metric = { label: string; value: string; tone?: Tone; hint?: string }
type Division = { key: string; nama: string; menu: string; metrics: Metric[]; status: Tone; catatan: string[] }
const fmt = (v: number) => v.toLocaleString('id-ID')
const rp = (v: number) => (Math.abs(v) >= 1e9 ? `Rp ${(v / 1e9).toLocaleString('id-ID', { maximumFractionDigits: 2 })} M` : Math.abs(v) >= 1e6 ? `Rp ${(v / 1e6).toLocaleString('id-ID', { maximumFractionDigits: 1 })} jt` : `Rp ${fmt(Math.round(v))}`)
const worst = (m: Metric[]): Tone => (m.some((x) => x.tone === 'bad') ? 'bad' : m.some((x) => x.tone === 'warn') ? 'warn' : 'ok')
const div = (key: string, nama: string, menu: string, metrics: Metric[], catatan: string[] = []): Division => ({ key, nama, menu, metrics, status: worst(metrics), catatan })

export async function divisionPerformance(periode: string) {
  const dari = `${periode}-01`
  const sampai = monthEnd(periode)
  const today = todayWib()
  const q = async (sql: string, args: unknown[] = []) => (await db.query<Row[]>(sql, args))[0][0] ?? {}
  const [mk, qt, so, fgs, pr, po, rep, mt, att, emp, lv, kpi, plan] = await Promise.all([
    q(`SELECT SUM(created_at BETWEEN ? AND ? + INTERVAL 1 DAY) AS lead, SUM(status = 'order_pertama' AND updated_at BETWEEN ? AND ? + INTERVAL 1 DAY) AS closing,
         SUM(next_followup_at < CURDATE() AND status NOT IN ('gagal', 'handover', 'order_pertama')) AS followup_telat FROM prospects`, [dari, sampai, dari, sampai]),
    q(`SELECT SUM(status = 'dikirim') AS menunggu, SUM(status = 'diterima' AND closed_at BETWEEN ? AND ? + INTERVAL 1 DAY) AS diterima,
         COALESCE(SUM(IF(status = 'diterima' AND closed_at BETWEEN ? AND ? + INTERVAL 1 DAY, total, 0)), 0) AS nilai_diterima FROM quotations`, [dari, sampai, dari, sampai]),
    q(`SELECT SUM(status IN ('Menunggu diproses', 'Sebagian diproses')) AS terbuka, COALESCE(SUM(IF(status IN ('Menunggu diproses', 'Sebagian diproses'), total_amount, 0)), 0) AS nilai_terbuka,
         SUM(status IN ('Menunggu diproses', 'Sebagian diproses') AND ship_date < CURDATE() AND trans_date >= CURDATE() - INTERVAL 120 DAY) AS lewat_kirim FROM accurate_sales_orders`),
    q('SELECT COUNT(*) AS slip FROM accurate_finished_good_slips WHERE trans_date BETWEEN ? AND ?', [dari, sampai]),
    q("SELECT SUM(status = 'diajukan') AS menunggu, SUM(status = 'diajukan' AND created_at < NOW() - INTERVAL 3 DAY) AS lama, SUM(status = 'disetujui') AS belum_po FROM purchase_requests"),
    q("SELECT COUNT(*) AS terbuka, SUM(ship_date < CURDATE()) AS terlambat FROM accurate_purchase_orders po WHERE COALESCE(po.percent_shipped, 0) < 100 AND COALESCE(po.status, '') NOT IN ('CLOSED', 'FULLRECEIVED') AND po.trans_date >= CURDATE() - INTERVAL 180 DAY"),
    q("SELECT SUM(status IN ('baru', 'dikerjakan', 'menunggu_part')) AS terbuka, SUM(status IN ('baru', 'dikerjakan', 'menunggu_part') AND mesin_berhenti = 1) AS berhenti, SUM(status = 'selesai' AND selesai_at BETWEEN ? AND ? + INTERVAL 1 DAY) AS selesai FROM machine_repairs", [dari, sampai]),
    q('SELECT SUM(aktif = 1 AND berikutnya < CURDATE()) AS terlambat, SUM(aktif = 1 AND berikutnya BETWEEN CURDATE() AND CURDATE() + INTERVAL 7 DAY) AS minggu_ini FROM maintenance_plans'),
    q(`SELECT SUM(status IN ('hadir', 'terlambat', 'tanpa_scan', 'dinas')) AS hadir, SUM(status IN ('hadir', 'terlambat', 'tanpa_scan', 'dinas', 'tidak_hadir', 'izin', 'sakit')) AS kerja,
         SUM(status = 'terlambat') AS telat, SUM(status = 'tidak_hadir') AS alpa FROM attendance_days WHERE tanggal BETWEEN ? AND LEAST(?, CURDATE())`, [dari, sampai]),
    q("SELECT COUNT(*) AS aktif, SUM(status_karyawan = 'Masa Percobaan') AS percobaan FROM employees WHERE tgl_berhenti IS NULL"),
    q("SELECT SUM(status = 'diajukan') AS menunggu, SUM(status = 'disetujui' AND CURDATE() BETWEEN tanggal_mulai AND tanggal_selesai) AS hari_ini FROM leave_requests"),
    computeEmployeeKpi(periode).catch(() => null),
    q("SELECT COUNT(*) AS aktif, SUM(tanggal_selesai < CURDATE()) AS terlambat, ROUND(AVG(progress)) AS progress FROM plannings WHERE status IN ('belum_mulai', 'berjalan', 'ditunda')"),
  ])
  const [ship, permits] = await Promise.all([shipCandidates().catch(() => []), listPermits().catch(() => [])])
  const [[shipStat]] = await db.query<Row[]>(
    `SELECT SUM(status = 'dikirim') AS jalan, SUM(status = 'dikirim' AND target_tiba < CURDATE()) AS telat_tiba,
       SUM(status = 'diterima' AND tanggal_diterima >= CURDATE() - INTERVAL 30 DAY AND target_tiba IS NOT NULL) AS bertarget,
       SUM(status = 'diterima' AND tanggal_diterima >= CURDATE() - INTERVAL 30 DAY AND target_tiba IS NOT NULL AND tanggal_diterima <= target_tiba) AS tepat FROM shipments`,
  )
  const [ar] = await Promise.all([receivables().catch(() => null)])
  const telatKirim = ship.filter((c) => c.terlambat).length
  const hadirPct = n(att.kerja) ? Math.round((n(att.hadir) / n(att.kerja)) * 1000) / 10 : null
  const kpiScored = kpi?.items.filter((x) => x.skor !== null) ?? []
  const kpiAvg = kpiScored.length ? Math.round((kpiScored.reduce((t, x) => t + x.skor!, 0) / kpiScored.length) * 10) / 10 : null
  const pembinaan = kpi?.items.filter((x) => x.predikat && ['D', 'E'].includes(x.predikat.kode)).length ?? 0
  const izinHabis = permits.filter((p) => p.status === 'kadaluarsa').length
  const izinSegera = permits.filter((p) => p.status === 'segera_habis').length
  const tepatPct = n(shipStat.bertarget) ? Math.round((n(shipStat.tepat) / n(shipStat.bertarget)) * 100) : null
  const arDue = ar ? ar.filter((r) => r.umur > 0).reduce((t, r) => t + r.sisa, 0) : null
  const ar60 = ar ? ar.filter((r) => r.umur > 60).reduce((t, r) => t + r.sisa, 0) : null

  return [
    div('marketing', 'Marketing', 'Prospek', [
      { label: 'Lead baru', value: fmt(n(mk.lead)) },
      { label: 'Closing (order pertama)', value: fmt(n(mk.closing)) },
      { label: 'Penawaran diterima', value: `${fmt(n(qt.diterima))} · ${rp(n(qt.nilai_diterima))}` },
      { label: 'Follow-up terlambat', value: fmt(n(mk.followup_telat)), tone: n(mk.followup_telat) > 20 ? 'bad' : n(mk.followup_telat) > 5 ? 'warn' : 'ok' },
    ]),
    div('ppic', 'PPIC & Produksi', 'Rencana Produksi', [
      { label: 'SO belum selesai', value: `${fmt(n(so.terbuka))} · ${rp(n(so.nilai_terbuka))}` },
      { label: 'SO lewat tanggal kirim', value: fmt(n(so.lewat_kirim)), tone: n(so.lewat_kirim) > 10 ? 'bad' : n(so.lewat_kirim) > 0 ? 'warn' : 'ok', hint: 'Status Accurate masih menunggu / sebagian diproses' },
      { label: 'Penyelesaian barang jadi', value: `${fmt(n(fgs.slip))} slip` },
      { label: 'KPI operator rata-rata', value: kpiAvg === null ? '—' : String(kpiAvg).replace('.', ','), tone: kpiAvg !== null && kpiAvg < 70 ? 'warn' : 'ok' },
    ]),
    div('purchasing', 'Purchasing', 'Pengajuan Pembelian', [
      { label: 'Pengajuan menunggu', value: fmt(n(pr.menunggu)), tone: n(pr.lama) ? 'warn' : 'ok', hint: n(pr.lama) ? `${n(pr.lama)} lebih dari 3 hari` : undefined },
      { label: 'Disetujui belum PO', value: fmt(n(pr.belum_po)), tone: n(pr.belum_po) > 5 ? 'warn' : 'ok' },
      { label: 'PO terbuka', value: fmt(n(po.terbuka)) },
      { label: 'PO lewat tanggal terima', value: fmt(n(po.terlambat)), tone: n(po.terlambat) > 10 ? 'bad' : n(po.terlambat) ? 'warn' : 'ok' },
    ]),
    div('teknik', 'Teknik', 'Kerusakan Mesin', [
      { label: 'Kerusakan terbuka', value: fmt(n(rep.terbuka)), tone: n(rep.terbuka) > 5 ? 'warn' : 'ok' },
      { label: 'Mesin berhenti', value: fmt(n(rep.berhenti)), tone: n(rep.berhenti) ? 'bad' : 'ok' },
      { label: 'Perawatan terlambat', value: fmt(n(mt.terlambat)), tone: n(mt.terlambat) > 3 ? 'bad' : n(mt.terlambat) ? 'warn' : 'ok' },
      { label: 'Perbaikan selesai', value: fmt(n(rep.selesai)) },
    ]),
    div('logistik', 'Inventory & Logistik', 'Pengiriman', [
      { label: 'SO perlu dikirim', value: fmt(ship.length) },
      { label: 'Lewat tanggal kirim', value: fmt(telatKirim), tone: telatKirim > 10 ? 'bad' : telatKirim ? 'warn' : 'ok' },
      { label: 'Dalam perjalanan', value: fmt(n(shipStat.jalan)), tone: n(shipStat.telat_tiba) ? 'warn' : 'ok', hint: n(shipStat.telat_tiba) ? `${n(shipStat.telat_tiba)} terlambat tiba` : undefined },
      { label: 'Tepat waktu (30 hari)', value: tepatPct === null ? '—' : `${tepatPct}%`, tone: tepatPct !== null && tepatPct < 80 ? 'warn' : 'ok' },
    ]),
    div('accounting', 'Accounting & Finance', 'Piutang Customer', [
      { label: 'Piutang jatuh tempo', value: arDue === null ? '—' : rp(arDue), tone: arDue === null ? undefined : ar60! > 0 ? 'warn' : 'ok' },
      { label: 'Piutang > 60 hari', value: ar60 === null ? '—' : rp(ar60), tone: ar60 === null ? undefined : ar60 > 50e6 ? 'bad' : ar60 > 0 ? 'warn' : 'ok' },
    ], ar === null ? ['Data piutang Accurate tidak bisa dimuat'] : []),
    div('sdm', 'SDM', 'Absensi', [
      { label: 'Karyawan aktif', value: `${fmt(n(emp.aktif))}${n(emp.percobaan) ? ` (${n(emp.percobaan)} percobaan)` : ''}` },
      { label: 'Kehadiran bulan ini', value: hadirPct === null ? '—' : `${String(hadirPct).replace('.', ',')}%`, tone: hadirPct !== null && hadirPct < 85 ? 'bad' : hadirPct !== null && hadirPct < 92 ? 'warn' : 'ok', hint: `${fmt(n(att.alpa))} hari tidak hadir · ${fmt(n(att.telat))} terlambat` },
      { label: 'Izin menunggu / hari ini', value: `${fmt(n(lv.menunggu))} / ${fmt(n(lv.hari_ini))}`, tone: n(lv.menunggu) > 5 ? 'warn' : 'ok' },
      { label: 'Perlu pembinaan (KPI)', value: fmt(pembinaan), tone: pembinaan > 5 ? 'warn' : 'ok' },
      { label: 'Perizinan perusahaan', value: izinHabis ? `${izinHabis} kedaluwarsa` : izinSegera ? `${izinSegera} segera habis` : permits.length ? 'Semua berlaku' : 'Belum dicatat', tone: izinHabis ? 'bad' : izinSegera ? 'warn' : 'ok' },
    ]),
    div('planning', 'Planning lintas divisi', 'Planning', [
      { label: 'Planning aktif', value: fmt(n(plan.aktif)) },
      { label: 'Progress rata-rata', value: plan.progress === null || plan.progress === undefined ? '—' : `${n(plan.progress)}%` },
      { label: 'Lewat target selesai', value: fmt(n(plan.terlambat)), tone: n(plan.terlambat) > 3 ? 'bad' : n(plan.terlambat) ? 'warn' : 'ok' },
    ]),
  ]
}

// ---------- Plan monitoring & koordinasi ----------
export async function planMonitoring() {
  const [byDiv] = await db.query<Row[]>(
    `SELECT d.name AS divisi, COUNT(p.id) AS aktif, SUM(p.tanggal_selesai < CURDATE()) AS terlambat, ROUND(AVG(p.progress)) AS progress
     FROM plannings p JOIN divisions d ON d.id = p.division_id WHERE p.status IN ('belum_mulai', 'berjalan', 'ditunda') GROUP BY d.id, d.name ORDER BY terlambat DESC, aktif DESC`,
  )
  const [late] = await db.query<Row[]>(
    `SELECT p.id, p.nomor, p.judul, d.name AS divisi, DATE_FORMAT(p.tanggal_selesai, '%Y-%m-%d') AS selesai, p.progress, p.status, DATEDIFF(CURDATE(), p.tanggal_selesai) AS lewat
     FROM plannings p JOIN divisions d ON d.id = p.division_id WHERE p.status IN ('belum_mulai', 'berjalan', 'ditunda') AND p.tanggal_selesai < CURDATE()
     ORDER BY p.tanggal_selesai LIMIT 15`,
  )
  const [meetings] = await db.query<Row[]>(
    `SELECT m.id, m.judul, DATE_FORMAT(m.waktu, '%Y-%m-%d %H:%i') AS waktu, m.tempat, (SELECT COUNT(*) FROM meeting_participants mp WHERE mp.meeting_id = m.id) AS peserta
     FROM meetings m WHERE m.waktu BETWEEN NOW() AND NOW() + INTERVAL 7 DAY ORDER BY m.waktu LIMIT 10`,
  )
  return {
    divisi: byDiv.map((r) => ({ divisi: String(r.divisi), aktif: n(r.aktif), terlambat: n(r.terlambat), progress: n(r.progress) })),
    terlambat: late.map((r) => ({ id: n(r.id), nomor: (r.nomor as string) ?? null, judul: String(r.judul), divisi: String(r.divisi), selesai: String(r.selesai), progress: n(r.progress), status: String(r.status), lewat: n(r.lewat) })),
    meeting: meetings.map((r) => ({ id: n(r.id), judul: String(r.judul), waktu: String(r.waktu), tempat: (r.tempat as string) ?? null, peserta: n(r.peserta) })),
  }
}

// ---------- KPI ----------
export async function kpiOverview(periode: string) {
  const dari = `${periode}-01`
  const sampai = monthEnd(periode)
  const kpi = await computeEmployeeKpi(periode)
  const byDiv = new Map<string, { n: number; total: number; pembinaan: number }>()
  for (const x of kpi.items) {
    if (x.skor === null) continue
    const k = x.divisi ?? 'Tanpa divisi'
    const g = byDiv.get(k) ?? { n: 0, total: 0, pembinaan: 0 }
    g.n++
    g.total += x.skor
    if (x.predikat && ['D', 'E'].includes(x.predikat.kode)) g.pembinaan++
    byDiv.set(k, g)
  }
  // KPI marketing per sales: lead, visit, closing, nilai deal (cakupan sama dengan menu KPI Marketing)
  const [sales] = await db.query<Row[]>(
    `SELECT u.id, u.name,
       (SELECT COUNT(*) FROM prospects p WHERE p.assigned_to = u.id AND p.created_at BETWEEN ? AND ? + INTERVAL 1 DAY) AS lead,
       (SELECT COUNT(*) FROM visits v JOIN visit_sales vs ON vs.visit_id = v.id WHERE vs.user_id = u.id AND v.checkin_at BETWEEN ? AND ? + INTERVAL 1 DAY) AS visit,
       (SELECT COALESCE(SUM(q.total), 0) FROM quotations q WHERE q.created_by = u.id AND q.status = 'diterima' AND q.closed_at BETWEEN ? AND ? + INTERVAL 1 DAY) AS nilai
     FROM users u JOIN divisions d ON d.id = u.division_id
     WHERE u.is_active = 1 AND d.code IN ('marketing', 'marketing_development', 'marketing_maintenance', 'marketing_digital') ORDER BY u.name`,
    [dari, sampai, dari, sampai, dari, sampai],
  ).catch(() => [[] as Row[]])
  return {
    karyawan: [...byDiv.entries()].map(([divisi, g]) => ({ divisi, dinilai: g.n, rata: Math.round((g.total / g.n) * 10) / 10, pembinaan: g.pembinaan })).sort((a, b) => b.dinilai - a.dinilai),
    terbaik: kpi.items.filter((x) => x.skor !== null).sort((a, b) => b.skor! - a.skor!).slice(0, 5).map((x) => ({ nama: x.nama, divisi: x.divisi, skor: x.skor })),
    pembinaan: kpi.items.filter((x) => x.predikat && ['D', 'E'].includes(x.predikat.kode)).sort((a, b) => a.skor! - b.skor!).slice(0, 8).map((x) => ({ nama: x.nama, divisi: x.divisi, skor: x.skor, tindak_lanjut: x.tindak_lanjut })),
    marketing: sales.map((s) => ({ nama: String(s.name), lead: n(s.lead), visit: n(s.visit), nilai: n(s.nilai) })),
  }
}
