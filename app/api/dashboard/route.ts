import type { RowDataPacket } from 'mysql2'
import { NextResponse } from 'next/server'
import { handle, requireUser } from '@/lib/api'
import { db } from '@/lib/db'
import { computeKpi, loadTargets, readPeriode } from '@/lib/kpi'
import { canSupervise, prospectScope } from '@/lib/marketing'
import { canViewAllDivisions } from '@/lib/planning'
import { canApproveQuotation, QUOTATION_APPROVAL_REQUIRED } from '@/lib/quotations'
import { REPEAT_BASE, seesAllCustomers } from '@/lib/repeat-order'
import { designScope, designTodoSql, sampleScope, sampleTodoSql } from '@/lib/requests'
import { sectorSql } from '@/lib/sectors'

type Row = RowDataPacket & Record<string, unknown>
const n = (v: unknown) => Number(v ?? 0)

// Ringkasan beranda sesuai menu yang dimiliki user (setiap bagian hanya dihitung bila relevan)
export const GET = handle(async () => {
  const user = await requireUser()
  const has = (menu: string) => (user.menus as string[]).includes(menu)
  const out: Record<string, unknown> = {}
  const tasks: Promise<void>[] = []

  // ---- Marketing: pekerjaan hari ini ----
  if (has('prospek')) {
    tasks.push((async () => {
      const own = '(p.assigned_to = ? OR p.maintenance_to = ? OR (p.assigned_to IS NULL AND p.created_by = ?))'
      const scope = prospectScope(user)
      const [[c]] = await db.query<Row[]>(
        `SELECT COALESCE(SUM(${own} AND p.next_followup_at < CURDATE() + INTERVAL 1 DAY AND p.status NOT IN ('gagal', 'handover')), 0) AS followup_saya,
           COALESCE(SUM(${own} AND p.next_followup_at < CURDATE() AND p.status NOT IN ('gagal', 'handover')), 0) AS followup_terlambat,
           COALESCE(SUM(p.status NOT IN ('gagal', 'handover')), 0) AS prospek_aktif,
           COALESCE(SUM(p.status = 'baru' AND p.assigned_to IS NULL), 0) AS belum_dibagi
         FROM prospects p WHERE ${scope.sql}`,
        [user.id, user.id, user.id, user.id, user.id, user.id, ...scope.params],
      )
      const [visits] = await db.query<Row[]>(
        `SELECT v.id, v.jadwal, v.jenis, COALESCE(p.nama_usaha, c.name) AS target, v.alamat FROM visits v JOIN visit_sales vs ON vs.visit_id = v.id AND vs.user_id = ?
         LEFT JOIN prospects p ON p.id = v.prospect_id LEFT JOIN customers c ON c.id = v.customer_id
         WHERE v.status = 'terjadwal' AND DATE(v.jadwal) = CURDATE() ORDER BY v.jadwal LIMIT 6`,
        [user.id],
      )
      const [followups] = await db.query<Row[]>(
        `SELECT p.id, p.nama_usaha, p.next_followup_at, p.status FROM prospects p
         WHERE (p.assigned_to = ? OR p.maintenance_to = ? OR (p.assigned_to IS NULL AND p.created_by = ?))
           AND p.next_followup_at < CURDATE() + INTERVAL 1 DAY AND p.status NOT IN ('gagal', 'handover') ORDER BY p.next_followup_at LIMIT 6`,
        [user.id, user.id, user.id],
      )
      // Corong prospek per tahap (cakupan sama dengan menu Prospek)
      const [funnel] = await db.query<Row[]>(`SELECT p.status, COUNT(*) AS jumlah FROM prospects p WHERE ${scope.sql} GROUP BY p.status`, scope.params)
      out.marketing = {
        funnel: Object.fromEntries(funnel.map((f) => [f.status, n(f.jumlah)])),
        followup_saya: n(c.followup_saya), followup_terlambat: n(c.followup_terlambat), prospek_aktif: n(c.prospek_aktif), belum_dibagi: n(c.belum_dibagi),
        visits, followups, tim: canSupervise(user),
      }
    })())
  }
  if (has('quotation')) {
    tasks.push((async () => {
      const all = canSupervise(user) || ['general_manager', 'accounting'].includes(user.division.code)
      const [[q]] = await db.query<Row[]>(
        `SELECT COALESCE(SUM(status = 'dikirim'), 0) AS menunggu, COALESCE(SUM(IF(status = 'dikirim', total, 0)), 0) AS nilai_menunggu,
           COALESCE(SUM(status = 'draft'), 0) AS draft, COALESCE(SUM(status = 'draft' AND approval = 'menunggu'), 0) AS persetujuan,
           COALESCE(SUM(status = 'diterima' AND closed_at >= DATE_FORMAT(CURDATE(), '%Y-%m-01')), 0) AS diterima_bulan_ini
         FROM quotations ${all ? '' : 'WHERE created_by = ?'}`,
        all ? [] : [user.id],
      )
      out.quotation = { menunggu: n(q.menunggu), nilai_menunggu: n(q.nilai_menunggu), draft: n(q.draft), diterima_bulan_ini: n(q.diterima_bulan_ini),
        // Penyetuju (Kepala Marketing / GM) melihat penawaran yang menunggu persetujuannya
        persetujuan: QUOTATION_APPROVAL_REQUIRED && canApproveQuotation(user) ? n(q.persetujuan) : 0 }
    })())
  }
  if (has('repeat-order')) {
    tasks.push((async () => {
      const all = seesAllCustomers(user)
      const [[r]] = await db.query<Row[]>(
        `SELECT COALESCE(SUM(status = 'waktunya'), 0) AS waktunya, COALESCE(SUM(status = 'berisiko'), 0) AS berisiko,
           COALESCE(SUM(next_followup_at < CURDATE() + INTERVAL 1 DAY), 0) AS followup
         FROM (${REPEAT_BASE}) x ${all ? '' : 'WHERE x.maintenance_to = ?'}`,
        all ? [] : [user.id],
      )
      // Customer yang paling perlu dihubungi (berisiko berhenti order dulu, lalu yang sudah waktunya order ulang)
      const [list] = await db.query<Row[]>(
        `SELECT x.id, x.name, x.bill_city, x.status, x.last_order, x.perkiraan_order, x.hari_terlambat, x.order_count, x.maintenance_name
         FROM (${REPEAT_BASE}) x WHERE x.status IN ('berisiko', 'waktunya') ${all ? '' : 'AND x.maintenance_to = ?'}
         ORDER BY x.status = 'berisiko' DESC, x.hari_terlambat DESC LIMIT 6`,
        all ? [] : [user.id],
      )
      out.repeat = {
        waktunya: n(r.waktunya), berisiko: n(r.berisiko), followup: n(r.followup), tim: all,
        list: list.map((c) => ({ ...c, hari_terlambat: n(c.hari_terlambat), order_count: n(c.order_count) })),
      }
    })())
  }
  // ---- Marketing Digital: lead masuk, sumber lead, dan jadwal konten ----
  if (user.division.code === 'marketing_digital' && has('prospek')) {
    tasks.push((async () => {
      const [[l]] = await db.query<Row[]>(
        `SELECT COALESCE(SUM(created_at >= CURDATE() - INTERVAL WEEKDAY(CURDATE()) DAY), 0) AS minggu_ini,
           COALESCE(SUM(created_at >= DATE_FORMAT(CURDATE(), '%Y-%m-01')), 0) AS bulan_ini,
           COALESCE(SUM(status = 'baru' AND assigned_to IS NULL), 0) AS belum_dibagi
         FROM prospects`,
      )
      const [sumber] = await db.query<Row[]>(
        `SELECT COALESCE(NULLIF(TRIM(sumber), ''), 'Tanpa sumber') AS sumber, COUNT(*) AS jumlah FROM prospects
         WHERE created_at >= CURDATE() - INTERVAL 30 DAY GROUP BY 1 ORDER BY jumlah DESC LIMIT 6`,
      )
      out.leads = { minggu_ini: n(l.minggu_ini), bulan_ini: n(l.bulan_ini), belum_dibagi: n(l.belum_dibagi), sumber: sumber.map((s) => ({ sumber: s.sumber, jumlah: n(s.jumlah) })) }
    })())
  }
  if (user.division.code === 'marketing_digital' && has('konten')) {
    tasks.push((async () => {
      const [items] = await db.query<Row[]>(
        `SELECT id, judul, platform, jenis, jadwal_tayang, status FROM content_plans
         WHERE status <> 'batal' AND jadwal_tayang >= CURDATE() AND jadwal_tayang < CURDATE() + INTERVAL 8 DAY ORDER BY jadwal_tayang LIMIT 6`,
      )
      const [[c]] = await db.query<Row[]>(
        `SELECT COALESCE(SUM(status = 'tayang'), 0) AS tayang, COALESCE(SUM(status IN ('ide', 'produksi', 'siap')), 0) AS rencana, COALESCE(SUM(leads), 0) AS leads
         FROM content_plans WHERE status <> 'batal' AND jadwal_tayang >= DATE_FORMAT(CURDATE(), '%Y-%m-01') AND jadwal_tayang < DATE_FORMAT(CURDATE(), '%Y-%m-01') + INTERVAL 1 MONTH`,
      )
      out.konten = { items, tayang: n(c.tayang), rencana: n(c.rencana), leads: n(c.leads) }
    })())
  }

  if (has('kpi')) {
    tasks.push((async () => {
      const periode = readPeriode(null)
      const [kpi, targets] = await Promise.all([computeKpi([user.id], periode), loadTargets([user.id], periode)])
      out.kpi = { periode, nilai: kpi.get(user.id), target: targets.get(user.id) ?? {} }
    })())
  }

  // ---- Penjualan dari Accurate (manajemen, accounting, lead marketing) ----
  if (user.role.isAdmin || ['general_manager', 'accounting'].includes(user.division.code) || canSupervise(user)) {
    tasks.push((async () => {
      const [months] = await db.query<Row[]>(
        `SELECT DATE_FORMAT(trans_date, '%Y-%m') AS bulan, SUM(total_amount) AS omzet, COUNT(*) AS faktur, COUNT(DISTINCT customer_accurate_id) AS customer
         FROM accurate_sales_invoices WHERE trans_date >= DATE_FORMAT(CURDATE() - INTERVAL 11 MONTH, '%Y-%m-01') GROUP BY bulan ORDER BY bulan`,
      )
      // Omzet per sektor customer (kategori Accurate) per bulan
      const [sectors] = await db.query<Row[]>(
        `SELECT DATE_FORMAT(i.trans_date, '%Y-%m') AS bulan, ${sectorSql('c.category')} AS sektor, SUM(i.total_amount) AS omzet, COUNT(*) AS faktur,
           COUNT(DISTINCT i.customer_accurate_id) AS customer
         FROM accurate_sales_invoices i LEFT JOIN customers c ON c.accurate_id = i.customer_accurate_id
         WHERE i.trans_date >= DATE_FORMAT(CURDATE() - INTERVAL 11 MONTH, '%Y-%m-01') GROUP BY bulan, sektor`,
      )
      const [top] = await db.query<Row[]>(
        `SELECT COALESCE(c.name, i.customer_accurate_id) AS name, SUM(i.total_amount) AS omzet FROM accurate_sales_invoices i
         LEFT JOIN customers c ON c.accurate_id = i.customer_accurate_id
         WHERE i.trans_date >= DATE_FORMAT(CURDATE(), '%Y-%m-01') GROUP BY i.customer_accurate_id ORDER BY omzet DESC LIMIT 5`,
      )
      // Top 5 customer bulan ini per sektor (untuk filter sektor di dashboard)
      const [topSector] = await db.query<Row[]>(
        `SELECT sektor, name, omzet FROM (
           SELECT ${sectorSql('MAX(c.category)')} AS sektor, COALESCE(MAX(c.name), i.customer_accurate_id) AS name, SUM(i.total_amount) AS omzet,
             ROW_NUMBER() OVER (PARTITION BY ${sectorSql('MAX(c.category)')} ORDER BY SUM(i.total_amount) DESC) AS rn
           FROM accurate_sales_invoices i LEFT JOIN customers c ON c.accurate_id = i.customer_accurate_id
           WHERE i.trans_date >= DATE_FORMAT(CURDATE(), '%Y-%m-01') GROUP BY i.customer_accurate_id
         ) x WHERE rn <= 5 ORDER BY sektor, omzet DESC`,
      )
      const [[so]] = await db.query<Row[]>(
        `SELECT COUNT(*) AS jumlah, COALESCE(SUM(total_amount), 0) AS nilai FROM accurate_sales_orders WHERE trans_date >= DATE_FORMAT(CURDATE(), '%Y-%m-01')`,
      )
      // Pembanding adil: bulan lalu pada rentang tanggal yang sama (1 s/d hari ini)
      const [[mtd]] = await db.query<Row[]>(
        `SELECT COALESCE(SUM(total_amount), 0) AS omzet FROM accurate_sales_invoices
         WHERE trans_date >= DATE_FORMAT(CURDATE() - INTERVAL 1 MONTH, '%Y-%m-01') AND trans_date <= CURDATE() - INTERVAL 1 MONTH`,
      )
      out.penjualan = {
        omzet_bulan_lalu_sd_hari_ini: n(mtd.omzet),
        bulan: months.map((m) => ({ bulan: m.bulan, omzet: n(m.omzet), faktur: n(m.faktur), customer: n(m.customer) })),
        sektor: sectors.map((r) => ({ bulan: r.bulan, sektor: r.sektor, omzet: n(r.omzet), faktur: n(r.faktur), customer: n(r.customer) })),
        top: top.map((t) => ({ name: t.name, omzet: n(t.omzet) })),
        top_sektor: topSector.map((t) => ({ sektor: t.sektor, name: t.name, omzet: n(t.omzet) })),
        so: { jumlah: n(so.jumlah), nilai: n(so.nilai) },
      }
    })())
  }

  // ---- Produksi ----
  if (has('jadwal-produksi')) {
    tasks.push((async () => {
      const [[p]] = await db.query<Row[]>(
        `SELECT COALESCE(SUM(status = 'menunggu'), 0) AS menunggu, COALESCE(SUM(status = 'dijadwalkan'), 0) AS dijadwalkan,
           COALESCE(SUM(status = 'berjalan'), 0) AS berjalan,
           COALESCE(SUM(status NOT IN ('selesai', 'batal') AND due_date < CURDATE()), 0) AS terlambat,
           COALESCE(SUM(status = 'selesai' AND updated_at >= DATE_FORMAT(CURDATE(), '%Y-%m-01')), 0) AS selesai_bulan_ini
         FROM production_jobs`,
      )
      const [due] = await db.query<Row[]>(
        `SELECT j.id, j.nomor, j.item_name, j.due_date, j.status, c.name AS customer FROM production_jobs j LEFT JOIN customers c ON c.id = j.customer_id
         WHERE j.status NOT IN ('selesai', 'batal') AND j.due_date >= CURDATE() ORDER BY j.due_date LIMIT 5`,
      )
      // Gantt: job aktif yang tahapnya terjadwal atau tanggal kirimnya jatuh di jendela 4 minggu (H-7 s/d H+21)
      const [jobs] = await db.query<Row[]>(
        `SELECT j.id, j.nomor, j.item_name, j.due_date, j.status, j.prioritas, c.name AS customer, so.trans_date AS so_date
         FROM production_jobs j LEFT JOIN customers c ON c.id = j.customer_id LEFT JOIN accurate_sales_orders so ON so.accurate_id = j.so_accurate_id
         WHERE j.status NOT IN ('selesai', 'batal') AND (
           (j.due_date >= CURDATE() - INTERVAL 7 DAY AND j.due_date < CURDATE() + INTERVAL 21 DAY)
           OR EXISTS (SELECT 1 FROM production_stages s WHERE s.job_id = j.id AND s.status <> 'dilewati'
             AND s.plan_start < CURDATE() + INTERVAL 21 DAY AND COALESCE(s.plan_end, s.plan_start) >= CURDATE() - INTERVAL 7 DAY))
         ORDER BY j.status = 'berjalan' DESC, j.due_date IS NULL, j.due_date, j.id LIMIT 12`,
      )
      const [stages] = jobs.length
        ? await db.query<Row[]>(
          `SELECT id, job_id, tahap, plan_start, plan_end, status, progress FROM production_stages
           WHERE job_id IN (?) AND status <> 'dilewati' AND plan_start IS NOT NULL ORDER BY job_id, urutan`,
          [jobs.map((j) => j.id)],
        )
        : [[] as Row[]]
      const gantt = jobs.map((j) => ({ ...j, stages: stages.filter((s) => s.job_id === j.id).map((s) => ({ ...s, progress: n(s.progress) })) }))
      out.produksi = { gantt, menunggu: n(p.menunggu), dijadwalkan: n(p.dijadwalkan), berjalan: n(p.berjalan), terlambat: n(p.terlambat), selesai_bulan_ini: n(p.selesai_bulan_ini), jatuh_tempo: due }
    })())
  }
  if (has('sample')) {
    tasks.push((async () => {
      const scope = sampleScope(user)
      const todo = sampleTodoSql(user)
      const [[s]] = await db.query<Row[]>(
        `SELECT COALESCE(SUM(${todo.sql}), 0) AS todo, COALESCE(SUM(s.status NOT IN ('disetujui', 'batal')), 0) AS aktif FROM sample_requests s WHERE ${scope.sql}`,
        [...todo.params, ...scope.params],
      )
      out.sample = { todo: n(s.todo), aktif: n(s.aktif) }
    })())
  }
  if (has('desain')) {
    tasks.push((async () => {
      const scope = designScope(user)
      const todo = designTodoSql(user)
      const [[d]] = await db.query<Row[]>(
        `SELECT COALESCE(SUM(${todo.sql}), 0) AS todo, COALESCE(SUM(d.status NOT IN ('disetujui', 'batal')), 0) AS aktif FROM design_requests d WHERE ${scope.sql}`,
        [...todo.params, ...scope.params],
      )
      out.desain = { todo: n(d.todo), aktif: n(d.aktif) }
    })())
  }

  // ---- Kolaborasi: meeting & planning saya ----
  if (has('meeting')) {
    tasks.push((async () => {
      const [rows] = await db.query<Row[]>(
        `SELECT m.id, m.judul, m.waktu, m.tempat FROM meetings m JOIN meeting_participants mp ON mp.meeting_id = m.id AND mp.user_id = ?
         WHERE m.status = 'terjadwal' AND m.waktu >= NOW() - INTERVAL 1 HOUR AND m.waktu < CURDATE() + INTERVAL 7 DAY ORDER BY m.waktu LIMIT 5`,
        [user.id],
      )
      out.meetings = rows
    })())
  }
  if (has('planning')) {
    tasks.push((async () => {
      const [rows] = await db.query<Row[]>(
        `SELECT p.id, p.judul, p.tanggal_selesai, p.progress, p.status FROM plannings p JOIN planning_pics pp ON pp.planning_id = p.id AND pp.user_id = ?
         WHERE p.status IN ('belum_mulai', 'berjalan') ORDER BY p.tanggal_selesai LIMIT 5`,
        [user.id],
      )
      out.plannings = rows.map((r) => ({ ...r, progress: n(r.progress) }))
      // Gantt planning: semua divisi bila punya planning.view_all, selain itu divisi sendiri + yang saya PIC-i
      const all = canViewAllDivisions(user)
      const [gantt] = await db.query<Row[]>(
        `SELECT p.id, p.judul, p.tanggal_mulai, p.tanggal_selesai, p.progress, p.status, d.name AS divisi FROM plannings p JOIN divisions d ON d.id = p.division_id
         WHERE p.status IN ('belum_mulai', 'berjalan') AND p.approval <> 'ditolak'
           AND p.tanggal_mulai < CURDATE() + INTERVAL 21 DAY AND p.tanggal_selesai >= CURDATE() - INTERVAL 7 DAY
           ${all ? '' : 'AND (p.division_id = ? OR EXISTS (SELECT 1 FROM planning_pics pp WHERE pp.planning_id = p.id AND pp.user_id = ?))'}
         ORDER BY p.tanggal_selesai, p.id LIMIT 10`,
        all ? [] : [user.division.id, user.id],
      )
      out.planningGantt = gantt.map((r) => ({ ...r, progress: n(r.progress) }))
    })())
  }

  await Promise.all(tasks)
  // Fokus tampilan dashboard divisi marketing (urutan kartu)
  const fokus = ({ marketing_digital: 'digital', marketing_development: 'development', marketing_maintenance: 'maintenance' } as Record<string, string>)[user.division.code] ?? null
  return NextResponse.json({ ...out, fokus })
})
