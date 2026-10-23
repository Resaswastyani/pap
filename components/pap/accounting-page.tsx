'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  AlertTriangle, ArrowDownLeft, ArrowUpRight, Banknote, CalendarClock, CheckCircle2, Landmark, Pencil, Plus, Printer, RefreshCw, Scale, Search, Target, Trash2, TrendingDown, TrendingUp, Wallet,
} from 'lucide-react'
import type { UserProfile } from '@/lib/users'
import { formatNumber, formatRupiah } from './accurate'
import { MonthNav, monthLabel, useDebounced } from './accurate-production'
import { BarList, ColumnChart } from './charts'
import { api, Field, formatDate, Modal, Notice, Pager, usePaged } from './ui'

// Accounting, Pajak & Finance (Guidance): angka dari Accurate, catatan Accounting di PAP-MS.

const short = (v: number) => (Math.abs(v) >= 1e9 ? `Rp ${formatNumber(v / 1e9, 2)} M` : Math.abs(v) >= 1e6 ? `Rp ${formatNumber(v / 1e6, 1)} jt` : formatRupiah(v))
const pct = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `${formatNumber(v, 1)}%`)
const thisMonth = () => new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 7)
const today = () => new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10)
const addDays = (d: string, n: number) => new Date(Date.parse(d) + n * 86400e3).toISOString().slice(0, 10)

function Heading({ title, children, actions }: { title: string; children: string; actions?: React.ReactNode }) {
  return (
    <div className="pap-page-heading">
      <div><p className="pap-eyebrow">ACCOUNTING · ACCURATE</p><h1>{title}</h1><span>{children}</span></div>
      {actions && <div className="pap-inline-actions pap-wrap">{actions}</div>}
    </div>
  )
}
type Tile = { label: string; value: string; note: string; icon: typeof Wallet; tone: string }
function Tiles({ tiles }: { tiles: Tile[] }) {
  return (
    <div className="pap-stat-grid four">
      {tiles.map((t) => (
        <div key={t.label} className="pap-stat-card">
          <div><span>{t.label}</span><strong className="pap-stat-text">{t.value}</strong><small className="neutral">{t.note}</small></div>
          <div className={`pap-stat-icon ${t.tone}`}><t.icon /></div>
        </div>
      ))}
    </div>
  )
}
function useLoad<T>(url: string | null) {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const load = useCallback(async (refresh = false) => {
    if (!url) return
    setLoading(true)
    try {
      setData(await api<T>(`${url}${refresh ? `${url.includes('?') ? '&' : '?'}refresh=1` : ''}`))
      setError('')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [url])
  useEffect(() => { load() }, [load])
  return { data, loading, error, setError, load }
}
const Loading = ({ text = 'Memuat data dari Accurate...' }: { text?: string }) => <div className="pap-empty">{text}</div>
const RefreshButton = ({ onClick, loading }: { onClick: () => void; loading: boolean }) => <button className="pap-btn" disabled={loading} onClick={onClick}><RefreshCw /> {loading ? 'Memuat...' : 'Ambil ulang dari Accurate'}</button>

// ---------- Ringkasan Keuangan (metrik finansial) ----------
type Pl = { pendapatan: number; hpp: number; laba_kotor: number; biaya: number; laba_usaha: number; pendapatan_lain: number; biaya_lain: number; laba_bersih: number; margin_kotor: number | null; margin_bersih: number | null }
type Bs = { aset: number; aset_lancar: number; kas_bank: number; piutang: number; persediaan: number; liabilitas: number; liabilitas_lancar: number; hutang_usaha: number; ekuitas: number; laba_berjalan: number; current_ratio: number | null; debt_to_equity: number | null }
type Summary = {
  periode: string; sampai: string; pl: Pl; ytd: Pl; bs: Bs; trend: { periode: string; pendapatan: number; hpp: number; biaya: number; laba_bersih: number }[]; prev?: { pendapatan: number; laba_bersih: number }
  kas: { total: number; akun: number }; piutang: { total: number; faktur: number; lewat_tempo: number; aging: { key: string; label: string; nilai: number }[] }; hutang: { total: number; faktur: number; lewat_tempo: number }
  dso: number | null; dpo: number | null; targets: Record<string, number>
}
const change = (cur: number, prev?: number) => (prev ? `${cur >= prev ? '▲' : '▼'} ${formatNumber(Math.abs(((cur - prev) / Math.abs(prev)) * 100), 1)}% dari bulan lalu` : '')

export function FinanceSummaryPage(_props: { user: UserProfile }) {
  const [periode, setPeriode] = useState(thisMonth())
  const { data, loading, error, setError, load } = useLoad<Summary>(`/api/accounting/summary?periode=${periode}`)
  const d = data
  return (
    <>
      <Heading title="Ringkasan Keuangan" actions={<><MonthNav periode={periode} onChange={setPeriode} /><RefreshButton loading={loading} onClick={() => load(true)} /></>}>
        Metrik finansial dari Accurate: pendapatan, laba, posisi kas, piutang & hutang, serta rasio keuangan. Dipakai untuk memastikan pemasukan dan pengeluaran sesuai target management.
      </Heading>
      {error && <Notice onClose={() => setError('')}>{error}</Notice>}
      {!d ? <Loading /> : (
        <>
          <Tiles tiles={[
            { label: `Pendapatan ${monthLabel(d.periode)}`, value: short(d.pl.pendapatan), note: d.periode === thisMonth() ? `berjalan, s.d. ${formatDate(d.sampai)}` : change(d.pl.pendapatan, d.prev?.pendapatan) || `s.d. ${formatDate(d.sampai)}`, icon: TrendingUp, tone: 'stat-1' },
            { label: 'Laba bersih', value: short(d.pl.laba_bersih), note: `Margin ${pct(d.pl.margin_bersih)} · kotor ${pct(d.pl.margin_kotor)}`, icon: d.pl.laba_bersih >= 0 ? TrendingUp : TrendingDown, tone: d.pl.laba_bersih >= 0 ? 'stat-0' : 'stat-3' },
            { label: 'Saldo kas & bank', value: short(d.kas.total), note: `${d.kas.akun} akun · saldo Accurate hari ini`, icon: Wallet, tone: d.kas.total >= 0 ? 'stat-1' : 'stat-3' },
            { label: 'Piutang customer', value: short(d.piutang.total), note: `${d.piutang.faktur} faktur · ${short(d.piutang.lewat_tempo)} lewat tempo`, icon: Banknote, tone: d.piutang.lewat_tempo ? 'stat-2' : 'stat-0' },
          ]} />
          <div className="pap-acc-grid">
            <section className="pap-table-card pap-acc-panel">
              <h2>Pendapatan 12 bulan</h2>
              <ColumnChart ariaLabel="Pendapatan 12 bulan" format={(v) => formatRupiah(v)} axisFormat={(v) => `${formatNumber(v / 1e6, 0)} jt`}
                data={d.trend.map((t) => ({ key: t.periode, label: monthLabel(t.periode).slice(0, 3), value: Math.max(0, t.pendapatan), partial: t.periode === thisMonth(), detail: <span>{monthLabel(t.periode)} · laba bersih {formatRupiah(t.laba_bersih)}</span> }))} />
            </section>
            <section className="pap-table-card pap-acc-panel">
              <h2>Rasio & metrik</h2>
              <dl className="pap-acc-metrics">
                <div><dt>Margin laba kotor</dt><dd>{pct(d.pl.margin_kotor)}</dd></div>
                <div><dt>Margin laba bersih</dt><dd>{pct(d.pl.margin_bersih)}</dd></div>
                <div><dt>Current ratio</dt><dd>{d.bs.current_ratio ?? '—'}</dd></div>
                <div><dt>Hari piutang tertagih (DSO)</dt><dd>{d.dso === null ? '—' : `${d.dso} hari`}</dd></div>
                <div><dt>Hari hutang dibayar (DPO)</dt><dd>{d.dpo === null ? '—' : `${d.dpo} hari`}</dd></div>
                <div><dt>Hutang supplier</dt><dd>{short(d.hutang.total)}<small>{short(d.hutang.lewat_tempo)} lewat tempo</small></dd></div>
                <div><dt>Laba s.d. {monthLabel(d.periode)}</dt><dd>{short(d.ytd.laba_bersih)}<small>pendapatan {short(d.ytd.pendapatan)}</small></dd></div>
              </dl>
            </section>
          </div>
          <div className="pap-acc-grid">
            <section className="pap-table-card pap-acc-panel">
              <h2>Realisasi vs target {monthLabel(d.periode)}</h2>
              <TargetRows pl={d.pl} targets={d.targets} />
            </section>
            <section className="pap-table-card pap-acc-panel">
              <h2>Umur piutang</h2>
              <BarList items={d.piutang.aging.map((a) => ({ key: a.key, label: a.label, value: a.nilai, display: short(a.nilai), tone: a.key === 'belum' ? 's1' : a.key === 'lebih_90' ? 'critical' : 'muted' }))} />
            </section>
          </div>
        </>
      )}
    </>
  )
}

const TARGET_ROWS: { key: 'pendapatan' | 'hpp' | 'biaya' | 'laba_bersih'; label: string; actual: (p: Pl) => number; higherBetter: boolean }[] = [
  { key: 'pendapatan', label: 'Pendapatan', actual: (p) => p.pendapatan, higherBetter: true },
  { key: 'hpp', label: 'Harga pokok penjualan', actual: (p) => p.hpp, higherBetter: false },
  { key: 'biaya', label: 'Biaya (usaha + lain-lain)', actual: (p) => p.biaya + p.biaya_lain, higherBetter: false },
  { key: 'laba_bersih', label: 'Laba bersih', actual: (p) => p.laba_bersih, higherBetter: true },
]
function TargetRows({ pl, targets }: { pl: Pl; targets: Record<string, number> }) {
  if (!Object.keys(targets).length) return <p className="pap-muted">Belum ada target untuk bulan ini. Management dapat mengisi target di menu Laporan Keuangan.</p>
  return (
    <div className="pap-acc-targets">
      {TARGET_ROWS.filter((r) => targets[r.key] !== undefined).map((r) => {
        const actual = r.actual(pl)
        const target = targets[r.key]
        const ratio = target ? Math.round((actual / target) * 100) : 0
        const ok = r.higherBetter ? actual >= target : actual <= target
        return (
          <div key={r.key}>
            <div className="pap-acc-target-head"><span>{r.label}</span><span className={ok ? 'pap-text-success' : 'pap-text-danger'}>{ratio}%</span></div>
            <div className="pap-acc-bar"><span style={{ width: `${Math.min(100, Math.max(0, ratio))}%` }} className={ok ? '' : 'warn'} /></div>
            <small className="pap-muted">{formatRupiah(actual)} dari target {formatRupiah(target)}</small>
          </div>
        )
      })}
    </div>
  )
}

// ---------- Kas & Bank ----------
type CashAccount = { id: number; no: string; name: string; balance: number; parent: string | null; is_parent: boolean }
type CashTx = { id: string; tanggal: string; jenis: 'masuk' | 'keluar'; sumber: string; nomor: string; pihak: string | null; keterangan: string | null; akun: string | null; akun_no: string | null; nominal: number }
type Recon = { id: number; account_no: string; account_name: string; tanggal: string; saldo_real: number; saldo_accurate: number; selisih: number; catatan: string | null; created_name: string | null }
type CashRes = { dari: string; sampai: string; accounts: CashAccount[]; transaksi: CashTx[]; total: { masuk: number; keluar: number }; recons: Recon[]; can: { manage: boolean } }

export function CashBankPage(_props: { user: UserProfile }) {
  const [range, setRange] = useState({ dari: addDays(today(), -6), sampai: today() })
  const [akun, setAkun] = useState('')
  const [jenis, setJenis] = useState('')
  const [q, setQ] = useState('')
  const query = useDebounced(q)
  const { data, loading, error, setError, load } = useLoad<CashRes>(`/api/accounting/cash?dari=${range.dari}&sampai=${range.sampai}`)
  const [reconOpen, setReconOpen] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const tx = (data?.transaksi ?? []).filter((t) => (!akun || t.akun_no === akun) && (!jenis || t.jenis === jenis)
    && (!query || `${t.nomor} ${t.pihak ?? ''} ${t.keterangan ?? ''} ${t.sumber}`.toLowerCase().includes(query.toLowerCase())))
  const paged = usePaged(tx, [akun, jenis, query, range.dari, range.sampai])
  // Ringkasan per hari
  const days = [...new Set(tx.map((t) => t.tanggal))].sort().reverse()
  const leaves = (data?.accounts ?? []).filter((a) => !a.is_parent)
  async function removeRecon(r: Recon) {
    if (!window.confirm(`Hapus catatan pencocokan ${r.account_name} ${formatDate(r.tanggal)}?`)) return
    try {
      await api(`/api/accounting/cash/${r.id}`, { method: 'DELETE' })
      load()
    } catch (e) {
      setError((e as Error).message)
    }
  }
  return (
    <>
      <Heading title="Kas & Bank" actions={<RefreshButton loading={loading} onClick={() => load(true)} />}>
        Pencatatan transaksi harian (pemasukan & pengeluaran) dari Accurate, saldo setiap akun kas/bank, dan pencocokan dengan saldo real kas fisik serta rekening koran.
      </Heading>
      {message && <Notice kind="success" onClose={() => setMessage('')}>{message}</Notice>}
      {error && <Notice onClose={() => setError('')}>{error}</Notice>}
      {data && (
        <Tiles tiles={[
          { label: 'Saldo kas & bank', value: short(leaves.reduce((s, a) => s + a.balance, 0)), note: `${leaves.length} akun · hari ini`, icon: Wallet, tone: 'stat-1' },
          { label: 'Pemasukan', value: short(data.total.masuk), note: `${formatDate(data.dari)} – ${formatDate(data.sampai)}`, icon: ArrowDownLeft, tone: 'stat-0' },
          { label: 'Pengeluaran', value: short(data.total.keluar), note: `${formatDate(data.dari)} – ${formatDate(data.sampai)}`, icon: ArrowUpRight, tone: 'stat-2' },
          { label: 'Arus bersih', value: short(data.total.masuk - data.total.keluar), note: `${data.transaksi.length} transaksi`, icon: Scale, tone: data.total.masuk >= data.total.keluar ? 'stat-0' : 'stat-3' },
        ]} />
      )}
      <div className="pap-table-card">
        <div className="pap-card-head"><div><h2>Saldo per akun & pencocokan</h2><p>Saldo dari Accurate. Catat saldo real (hitung kas fisik / rekening koran) untuk melihat selisihnya.</p></div></div>
        <div className="pap-table-wrap">
          <table>
            <thead><tr><th>Akun</th><th className="pap-num">Saldo Accurate</th><th>Pencocokan terakhir</th>{data?.can.manage && <th />}</tr></thead>
            <tbody>
              {(data?.accounts ?? []).map((a) => {
                const last = data?.recons.find((r) => r.account_no === a.no)
                return (
                  <tr key={a.id} className={a.is_parent ? 'pap-group-row' : ''}>
                    <td><div className={a.is_parent ? 'pap-cell-title' : a.parent ? 'pap-acc-indent' : ''}>{a.name}</div><div className="pap-cell-sub">{a.no}</div></td>
                    <td className={`pap-num pap-nowrap ${a.balance < 0 ? 'pap-text-danger' : ''}`}>{a.is_parent ? <b>{formatRupiah(a.balance)}</b> : formatRupiah(a.balance)}</td>
                    <td>{last ? <>{formatDate(last.tanggal)} · <span className={Math.abs(last.selisih) < 1 ? 'pap-text-success' : 'pap-text-danger'}>{Math.abs(last.selisih) < 1 ? 'cocok' : `selisih ${formatRupiah(last.selisih)}`}</span></> : <span className="pap-muted">—</span>}</td>
                    {data?.can.manage && <td>{!a.is_parent && <button className="pap-btn" onClick={() => setReconOpen(a.no)}><CheckCircle2 /> Cocokkan</button>}</td>}
                  </tr>
                )
              })}
            </tbody>
          </table>
          {!data && <Loading />}
        </div>
      </div>

      <div className="pap-table-card pap-acc-spaced">
        <div className="pap-card-head">
          <div><h2>Transaksi harian</h2><p>Penerimaan customer, pembayaran supplier, penerimaan & pengeluaran lain di Accurate.</p></div>
          <div className="pap-inline-actions pap-wrap">
            <input className="pap-input" type="date" value={range.dari} max={range.sampai} onChange={(e) => setRange({ ...range, dari: e.target.value })} aria-label="Dari tanggal" />
            <input className="pap-input" type="date" value={range.sampai} min={range.dari} max={today()} onChange={(e) => setRange({ ...range, sampai: e.target.value })} aria-label="Sampai tanggal" />
          </div>
        </div>
        <div className="pap-filters">
          <label className="pap-filter-search"><Search /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari nomor, pihak, keterangan..." /></label>
          <select className="pap-select" value={jenis} onChange={(e) => setJenis(e.target.value)} aria-label="Jenis"><option value="">Masuk & keluar</option><option value="masuk">Pemasukan</option><option value="keluar">Pengeluaran</option></select>
          <select className="pap-select" value={akun} onChange={(e) => setAkun(e.target.value)} aria-label="Akun"><option value="">Semua akun</option>{leaves.map((a) => <option key={a.no} value={a.no}>{a.name}</option>)}</select>
        </div>
        {days.length > 0 && (
          <div className="pap-acc-days">
            {days.slice(0, 14).map((d) => {
              const rows = tx.filter((t) => t.tanggal === d)
              const masuk = rows.filter((t) => t.jenis === 'masuk').reduce((s, t) => s + t.nominal, 0)
              const keluar = rows.filter((t) => t.jenis === 'keluar').reduce((s, t) => s + t.nominal, 0)
              return <div key={d}><b>{formatDate(d)}</b><span className="pap-text-success">+{short(masuk)}</span><span className="pap-text-danger">−{short(keluar)}</span></div>
            })}
          </div>
        )}
        <div className="pap-table-wrap">
          <table>
            <thead><tr><th>Tanggal</th><th>Transaksi</th><th>Akun</th><th className="pap-num">Masuk</th><th className="pap-num">Keluar</th></tr></thead>
            <tbody>
              {paged.items.map((t) => (
                <tr key={t.id}>
                  <td className="pap-nowrap">{formatDate(t.tanggal)}</td>
                  <td><div className="pap-cell-title">{t.pihak ?? t.keterangan ?? t.sumber}</div><div className="pap-cell-sub">{t.sumber} · {t.nomor}{t.pihak && t.keterangan ? ` · ${t.keterangan}` : ''}</div></td>
                  <td>{t.akun ?? '—'}</td>
                  <td className="pap-num pap-nowrap pap-text-success">{t.jenis === 'masuk' ? formatRupiah(t.nominal) : ''}</td>
                  <td className="pap-num pap-nowrap pap-text-danger">{t.jenis === 'keluar' ? formatRupiah(t.nominal) : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {data && !tx.length && <div className="pap-empty">Tidak ada transaksi pada rentang ini.</div>}
          {loading && !data && <Loading />}
          <Pager {...paged.pager} noun="transaksi" />
        </div>
      </div>

      {data && data.recons.length > 0 && (
        <div className="pap-table-card pap-acc-spaced">
          <div className="pap-card-head"><div><h2>Riwayat pencocokan saldo</h2><p>Saldo Accurate per tanggal pencocokan dibanding saldo real.</p></div></div>
          <div className="pap-table-wrap">
            <table>
              <thead><tr><th>Tanggal</th><th>Akun</th><th className="pap-num">Saldo real</th><th className="pap-num">Saldo Accurate</th><th className="pap-num">Selisih</th><th>Catatan</th>{data.can.manage && <th />}</tr></thead>
              <tbody>
                {data.recons.map((r) => (
                  <tr key={r.id}>
                    <td className="pap-nowrap">{formatDate(r.tanggal)}</td>
                    <td>{r.account_name}<div className="pap-cell-sub">{r.created_name}</div></td>
                    <td className="pap-num pap-nowrap">{formatRupiah(r.saldo_real)}</td>
                    <td className="pap-num pap-nowrap">{formatRupiah(r.saldo_accurate)}</td>
                    <td className={`pap-num pap-nowrap ${Math.abs(r.selisih) < 1 ? 'pap-text-success' : 'pap-text-danger'}`}><b>{Math.abs(r.selisih) < 1 ? 'Cocok' : formatRupiah(r.selisih)}</b></td>
                    <td>{r.catatan ?? '—'}</td>
                    {data.can.manage && <td><button className="pap-icon-button" aria-label="Hapus" onClick={() => removeRecon(r)}><Trash2 /></button></td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {reconOpen && data && <ReconForm account={data.accounts.find((a) => a.no === reconOpen)!} onClose={() => setReconOpen(null)} onSaved={(text) => { setReconOpen(null); setMessage(text); load() }} />}
    </>
  )
}

function ReconForm({ account, onClose, onSaved }: { account: CashAccount; onClose: () => void; onSaved: (text: string) => void }) {
  const [v, setV] = useState({ tanggal: today(), saldo_real: '', catatan: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function save(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const res = await api<{ saldo_accurate: number; selisih: number }>('/api/accounting/cash', { method: 'POST', json: { account_no: account.no, ...v } })
      onSaved(Math.abs(res.selisih) < 1 ? `${account.name}: saldo cocok dengan Accurate (${formatRupiah(res.saldo_accurate)}).` : `${account.name}: selisih ${formatRupiah(res.selisih)} terhadap saldo Accurate ${formatRupiah(res.saldo_accurate)}.`)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal title={`Cocokkan saldo ${account.name}`} subtitle="Masukkan saldo real per tanggal (hitung kas fisik / saldo rekening koran)" onClose={onClose}
      footer={<><span className="pap-spacer" /><button className="pap-btn" onClick={onClose}>Batal</button><button className="pap-primary-button" form="recon-form" disabled={busy}>{busy ? 'Mencocokkan...' : 'Simpan pencocokan'}</button></>}>
      <form id="recon-form" className="pap-form-grid" onSubmit={save}>
        {error && <div className="full"><Notice onClose={() => setError('')}>{error}</Notice></div>}
        <Field label="Tanggal saldo"><input className="pap-input" type="date" required max={today()} value={v.tanggal} onChange={(e) => setV({ ...v, tanggal: e.target.value })} /></Field>
        <Field label="Saldo real (Rp)"><input className="pap-input pap-num" inputMode="decimal" required value={v.saldo_real} onChange={(e) => setV({ ...v, saldo_real: e.target.value })} /></Field>
        <Field label="Catatan (opsional)" full><input className="pap-input" maxLength={1000} value={v.catatan} onChange={(e) => setV({ ...v, catatan: e.target.value })} placeholder="Mis. rekening koran BCA per 22 Okt, biaya admin belum dicatat" /></Field>
      </form>
    </Modal>
  )
}

// ---------- Piutang Customer ----------
type Ar = { id: number; number: string; tanggal: string | null; jatuh_tempo: string | null; customer: string | null; customer_no: string | null; total: number; sisa: number; umur: number }
type ArRes = { piutang: Ar[]; aging: { key: string; label: string; nilai: number; faktur: number }[]; per_customer: { customer: string; customer_no: string | null; faktur: number; sisa: number; lewat_tempo: number; umur_max: number }[]; hutang: { id: number; number: string; jatuh_tempo: string | null; vendor: string | null; sisa: number; umur: number }[] }

export function ReceivablePage(_props: { user: UserProfile }) {
  const { data, loading, error, setError, load } = useLoad<ArRes>('/api/accounting/receivables')
  const [view, setView] = useState<'faktur' | 'customer' | 'hutang'>('faktur')
  const [q, setQ] = useState('')
  const term = q.trim().toLowerCase()
  const ar = (data?.piutang ?? []).filter((r) => !term || `${r.number} ${r.customer ?? ''}`.toLowerCase().includes(term))
  const ap = (data?.hutang ?? []).filter((r) => !term || `${r.number} ${r.vendor ?? ''}`.toLowerCase().includes(term))
  const paged = usePaged(ar, [term])
  const pagedAp = usePaged(ap, [term])
  const total = (data?.piutang ?? []).reduce((s, r) => s + r.sisa, 0)
  return (
    <>
      <Heading title="Piutang Customer" actions={<RefreshButton loading={loading} onClick={() => load(true)} />}>
        Memastikan pembayaran customer: faktur penjualan Accurate yang belum lunas, umur piutang, dan ringkasan per customer. Hutang supplier jatuh tempo ditampilkan untuk perencanaan pembayaran.
      </Heading>
      {error && <Notice onClose={() => setError('')}>{error}</Notice>}
      {data && (
        <div className="pap-stat-grid pap-acc-aging">
          {data.aging.map((a) => (
            <div key={a.key} className="pap-stat-card"><div><span>{a.label}</span><strong className="pap-stat-text">{short(a.nilai)}</strong><small className={a.key === 'lebih_90' && a.nilai ? 'pap-text-danger' : 'neutral'}>{a.faktur} faktur · {total ? Math.round((a.nilai / total) * 100) : 0}%</small></div></div>
          ))}
        </div>
      )}
      <div className="pap-table-card">
        <div className="pap-card-head">
          <div className="pap-segmented" role="tablist">
            <button role="tab" aria-selected={view === 'faktur'} className={view === 'faktur' ? 'active' : ''} onClick={() => setView('faktur')}>Faktur belum lunas ({data?.piutang.length ?? 0})</button>
            <button role="tab" aria-selected={view === 'customer'} className={view === 'customer' ? 'active' : ''} onClick={() => setView('customer')}>Per customer</button>
            <button role="tab" aria-selected={view === 'hutang'} className={view === 'hutang' ? 'active' : ''} onClick={() => setView('hutang')}>Hutang supplier ({data?.hutang.length ?? 0})</button>
          </div>
          <label className="pap-filter-search"><Search /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari nomor / nama..." /></label>
        </div>
        <div className="pap-table-wrap">
          {view === 'faktur' && (
            <table>
              <thead><tr><th>Faktur</th><th>Customer</th><th>Jatuh tempo</th><th className="pap-num">Total</th><th className="pap-num">Sisa</th></tr></thead>
              <tbody>
                {paged.items.map((r) => (
                  <tr key={r.id}>
                    <td className="pap-nowrap"><div className="pap-cell-title">{r.number}</div><div className="pap-cell-sub">{formatDate(r.tanggal)}</div></td>
                    <td>{r.customer ?? '—'}<div className="pap-cell-sub">{r.customer_no}</div></td>
                    <td className="pap-nowrap">{formatDate(r.jatuh_tempo)}<div className={`pap-cell-sub ${r.umur > 0 ? 'pap-text-danger' : ''}`}>{r.umur > 0 ? `lewat ${r.umur} hari` : r.umur === 0 ? 'hari ini' : `${-r.umur} hari lagi`}</div></td>
                    <td className="pap-num pap-nowrap">{formatRupiah(r.total)}</td>
                    <td className="pap-num pap-nowrap"><strong>{formatRupiah(r.sisa)}</strong></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {view === 'customer' && (
            <table>
              <thead><tr><th>Customer</th><th className="pap-num">Faktur</th><th className="pap-num">Sisa piutang</th><th className="pap-num">Lewat tempo</th><th className="pap-num">Umur terlama</th></tr></thead>
              <tbody>
                {(data?.per_customer ?? []).filter((c) => !term || c.customer.toLowerCase().includes(term)).map((c) => (
                  <tr key={c.customer_no ?? c.customer}>
                    <td>{c.customer}<div className="pap-cell-sub">{c.customer_no}</div></td>
                    <td className="pap-num">{c.faktur}</td>
                    <td className="pap-num pap-nowrap"><strong>{formatRupiah(c.sisa)}</strong></td>
                    <td className="pap-num pap-nowrap pap-text-danger">{c.lewat_tempo ? formatRupiah(c.lewat_tempo) : '—'}</td>
                    <td className="pap-num pap-nowrap">{c.umur_max > 0 ? `${c.umur_max} hari` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {view === 'hutang' && (
            <table>
              <thead><tr><th>Faktur pembelian</th><th>Supplier</th><th>Jatuh tempo</th><th className="pap-num">Sisa hutang</th></tr></thead>
              <tbody>
                {pagedAp.items.map((r) => (
                  <tr key={r.id}>
                    <td className="pap-nowrap">{r.number}</td>
                    <td>{r.vendor ?? '—'}</td>
                    <td className="pap-nowrap">{formatDate(r.jatuh_tempo)}<div className={`pap-cell-sub ${r.umur > 0 ? 'pap-text-danger' : ''}`}>{r.umur > 0 ? `lewat ${r.umur} hari` : `${-r.umur} hari lagi`}</div></td>
                    <td className="pap-num pap-nowrap"><strong>{formatRupiah(r.sisa)}</strong></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {!data && !error && <Loading />}
          {data && view === 'faktur' && !ar.length && <div className="pap-empty">Tidak ada piutang.</div>}
          {view === 'faktur' && <Pager {...paged.pager} noun="faktur" />}
          {view === 'hutang' && <Pager {...pagedAp.pager} noun="faktur" />}
        </div>
      </div>
    </>
  )
}

// ---------- Laporan Keuangan ----------
type Group = { type: string; label: string; total: number; accounts: { no: string; name: string; amount: number }[] }
type ReportRes = {
  periode: string; dari: string; sampai: string; jenis: 'bulan' | 'ytd'
  laba_rugi: { ringkasan: Pl; sebelumnya: Pl | null; kelompok: Group[] }; neraca: { ringkasan: Bs; aset: Group[]; kewajiban: Group[] }
  targets: Record<string, number>; can: { target: boolean }
}

export function FinancialReportPage(_props: { user: UserProfile }) {
  const [periode, setPeriode] = useState(thisMonth())
  const [jenis, setJenis] = useState<'bulan' | 'ytd'>('bulan')
  const [tab, setTab] = useState<'lr' | 'neraca'>('lr')
  const { data, loading, error, setError, load } = useLoad<ReportRes>(`/api/accounting/reports?periode=${periode}&jenis=${jenis}`)
  const [targetOpen, setTargetOpen] = useState(false)
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const d = data
  const pl = d?.laba_rugi.ringkasan
  const bs = d?.neraca.ringkasan
  const GroupRows = ({ groups }: { groups: Group[] }) => (
    <>
      {groups.map((g) => (
        <tbody key={g.type}>
          <tr className="pap-group-row pap-row-link" onClick={() => setOpen({ ...open, [g.type]: !open[g.type] })}>
            <td><b>{open[g.type] ? '▾' : '▸'} {g.label}</b> <span className="pap-muted">({g.accounts.length} akun)</span></td>
            <td className="pap-num pap-nowrap"><b>{formatRupiah(g.total)}</b></td>
          </tr>
          {open[g.type] && g.accounts.map((a) => (
            <tr key={a.no}><td className="pap-acc-indent">{a.name}<div className="pap-cell-sub">{a.no}</div></td><td className="pap-num pap-nowrap">{formatRupiah(a.amount)}</td></tr>
          ))}
        </tbody>
      ))}
    </>
  )
  return (
    <>
      <Heading title="Laporan Keuangan" actions={<>
        <MonthNav periode={periode} onChange={setPeriode} />
        <a className="pap-btn" href={`/cetak/laporan-keuangan?periode=${periode}&jenis=${jenis}`} target="_blank" rel="noreferrer"><Printer /> Cetak</a>
        {d?.can.target && <button className="pap-btn" onClick={() => setTargetOpen(true)}><Target /> Target bulan ini</button>}
        <RefreshButton loading={loading} onClick={() => load(true)} />
      </>}>
        Financial statement bulanan dari Accurate: laba rugi dan neraca, dibandingkan dengan bulan lalu dan target management.
      </Heading>
      {error && <Notice onClose={() => setError('')}>{error}</Notice>}
      <div className="pap-inline-actions pap-wrap pap-page-tabs">
        <div className="pap-segmented" role="tablist">
          <button role="tab" aria-selected={tab === 'lr'} className={tab === 'lr' ? 'active' : ''} onClick={() => setTab('lr')}>Laba rugi</button>
          <button role="tab" aria-selected={tab === 'neraca'} className={tab === 'neraca' ? 'active' : ''} onClick={() => setTab('neraca')}>Neraca</button>
        </div>
        {tab === 'lr' && (
          <div className="pap-segmented" role="tablist">
            <button role="tab" aria-selected={jenis === 'bulan'} className={jenis === 'bulan' ? 'active' : ''} onClick={() => setJenis('bulan')}>{monthLabel(periode)}</button>
            <button role="tab" aria-selected={jenis === 'ytd'} className={jenis === 'ytd' ? 'active' : ''} onClick={() => setJenis('ytd')}>Jan – {monthLabel(periode).split(' ')[0]} {periode.slice(0, 4)}</button>
          </div>
        )}
      </div>
      {!d || !pl || !bs ? <Loading /> : tab === 'lr' ? (
        <div className="pap-acc-grid wide-left">
          <section className="pap-table-card">
            <div className="pap-card-head"><div><h2>Laba rugi</h2><p>{formatDate(d.dari)} – {formatDate(d.sampai)}. Klik kelompok untuk melihat rincian akun.</p></div></div>
            <div className="pap-table-wrap">
              <table className="pap-fin-list">
                <GroupRows groups={d.laba_rugi.kelompok} />
                <tbody>
                  <tr className="pap-total-row"><td><b>Laba kotor</b></td><td className="pap-num pap-nowrap"><b>{formatRupiah(pl.laba_kotor)}</b></td></tr>
                  <tr className="pap-total-row"><td><b>Laba usaha</b></td><td className="pap-num pap-nowrap"><b>{formatRupiah(pl.laba_usaha)}</b></td></tr>
                  <tr className="pap-total-row"><td><b>Laba bersih</b></td><td className={`pap-num pap-nowrap ${pl.laba_bersih < 0 ? 'pap-text-danger' : ''}`}><b>{formatRupiah(pl.laba_bersih)}</b></td></tr>
                </tbody>
              </table>
            </div>
          </section>
          <section className="pap-table-card pap-acc-panel">
            <h2>Dibanding bulan lalu</h2>
            {d.laba_rugi.sebelumnya ? (
              <dl className="pap-acc-metrics">
                {([['Pendapatan', 'pendapatan'], ['HPP', 'hpp'], ['Beban usaha', 'biaya'], ['Laba bersih', 'laba_bersih']] as const).map(([label, k]) => {
                  const cur = pl[k]
                  const prev = d.laba_rugi.sebelumnya![k]
                  return <div key={k}><dt>{label}</dt><dd>{short(cur)}<small>{prev ? `${cur >= prev ? '▲' : '▼'} ${formatNumber(Math.abs(((cur - prev) / Math.abs(prev)) * 100), 1)}% (bln lalu ${short(prev)})` : 'bln lalu —'}</small></dd></div>
                })}
              </dl>
            ) : <p className="pap-muted">Perbandingan tersedia untuk tampilan per bulan.</p>}
            <h2 className="pap-acc-subtitle">Target management</h2>
            {jenis === 'bulan' ? <TargetRows pl={pl} targets={d.targets} /> : <p className="pap-muted">Target dibandingkan per bulan.</p>}
          </section>
        </div>
      ) : (
        <div className="pap-acc-grid">
          <section className="pap-table-card">
            <div className="pap-card-head"><div><h2>Aset</h2><p>Per {formatDate(d.sampai)}</p></div><b>{formatRupiah(bs.aset)}</b></div>
            <div className="pap-table-wrap"><table className="pap-fin-list"><GroupRows groups={d.neraca.aset} /></table></div>
          </section>
          <section className="pap-table-card">
            <div className="pap-card-head"><div><h2>Kewajiban & ekuitas</h2><p>Laba tahun berjalan = aset − kewajiban − ekuitas</p></div><b>{formatRupiah(bs.liabilitas + bs.ekuitas + bs.laba_berjalan)}</b></div>
            <div className="pap-table-wrap">
              <table className="pap-fin-list">
                <GroupRows groups={d.neraca.kewajiban} />
                <tbody><tr className="pap-group-row"><td><b>Laba tahun berjalan (belum tutup buku)</b></td><td className="pap-num pap-nowrap"><b>{formatRupiah(bs.laba_berjalan)}</b></td></tr></tbody>
              </table>
            </div>
            <dl className="pap-acc-metrics pap-acc-pad">
              <div><dt>Current ratio</dt><dd>{bs.current_ratio ?? '—'}</dd></div>
              <div><dt>Debt to equity</dt><dd>{bs.debt_to_equity ?? '—'}</dd></div>
            </dl>
          </section>
        </div>
      )}
      {targetOpen && d && <TargetForm periode={periode} targets={d.targets} onClose={() => setTargetOpen(false)} onSaved={() => { setTargetOpen(false); load() }} />}
    </>
  )
}

function TargetForm({ periode, targets, onClose, onSaved }: { periode: string; targets: Record<string, number>; onClose: () => void; onSaved: () => void }) {
  const [v, setV] = useState<Record<string, string>>(Object.fromEntries(TARGET_ROWS.map((r) => [r.key, targets[r.key]?.toString() ?? ''])))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function save(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    try {
      await api('/api/accounting/reports', { method: 'PUT', json: { periode, ...v } })
      onSaved()
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
    }
  }
  return (
    <Modal title={`Target keuangan ${monthLabel(periode)}`} subtitle="Kosongkan untuk menghapus target" onClose={onClose}
      footer={<><span className="pap-spacer" /><button className="pap-btn" onClick={onClose}>Batal</button><button className="pap-primary-button" form="target-form" disabled={busy}>Simpan target</button></>}>
      <form id="target-form" className="pap-form-grid" onSubmit={save}>
        {error && <div className="full"><Notice onClose={() => setError('')}>{error}</Notice></div>}
        {TARGET_ROWS.map((r) => <Field key={r.key} label={`${r.label} (Rp)`}><input className="pap-input pap-num" inputMode="decimal" value={v[r.key]} onChange={(e) => setV({ ...v, [r.key]: e.target.value })} /></Field>)}
      </form>
    </Modal>
  )
}

// ---------- Arus Kas & Forecast ----------
type Week = { minggu: number; dari: string; sampai: string; saldo_awal: number; piutang: number; rencana_masuk: number; hutang: number; rencana_keluar: number; masuk: number; keluar: number; saldo_akhir: number; rincian: string[] }
type CashPlan = { id: number; jenis: 'masuk' | 'keluar'; kategori: string; keterangan: string | null; tanggal: string; nominal: number; berulang: 'sekali' | 'mingguan' | 'bulanan'; sampai: string | null; aktif: boolean; created_name: string | null }
type ForecastRes = { saldo_awal: number; sampai: string; minggu: Week[]; terendah: number; plans: CashPlan[]; can: { manage: boolean } }
const PLAN_CATEGORIES = ['Gaji & upah', 'Cicilan / KTA', 'Sewa', 'Listrik & utilitas', 'Pajak', 'Bahan baku', 'Penerimaan lain', 'Lainnya']

export function CashFlowPage(_props: { user: UserProfile }) {
  const { data, loading, error, setError, load } = useLoad<ForecastRes>('/api/accounting/forecast')
  const [form, setForm] = useState<CashPlan | 'baru' | null>(null)
  async function remove(p: CashPlan) {
    if (!window.confirm(`Hapus rencana ${p.kategori}?`)) return
    try {
      await api(`/api/accounting/plans/${p.id}`, { method: 'DELETE' })
      load()
    } catch (e) {
      setError((e as Error).message)
    }
  }
  const d = data
  return (
    <>
      <Heading title="Arus Kas & Forecast" actions={d?.can.manage ? <button className="pap-primary-button" onClick={() => setForm('baru')}><Plus /> Tambah rencana kas</button> : undefined}>
        Pengelolaan arus kas 13 minggu ke depan: saldo kas & bank hari ini, piutang customer dan hutang supplier sesuai jatuh tempo, ditambah rencana kas rutin (gaji, cicilan, sewa, pajak).
      </Heading>
      {error && <Notice onClose={() => setError('')}>{error}</Notice>}
      {!d ? <Loading /> : (
        <>
          <Tiles tiles={[
            { label: 'Saldo kas & bank hari ini', value: short(d.saldo_awal), note: 'Dari Accurate', icon: Wallet, tone: d.saldo_awal >= 0 ? 'stat-1' : 'stat-3' },
            { label: 'Total masuk (13 minggu)', value: short(d.minggu.reduce((s, w) => s + w.masuk, 0)), note: 'Piutang + rencana masuk', icon: ArrowDownLeft, tone: 'stat-0' },
            { label: 'Total keluar (13 minggu)', value: short(d.minggu.reduce((s, w) => s + w.keluar, 0)), note: 'Hutang + rencana keluar', icon: ArrowUpRight, tone: 'stat-2' },
            { label: 'Saldo terendah', value: short(d.terendah), note: d.terendah < 0 ? 'Perlu pendanaan / penjadwalan ulang' : 'Kas mencukupi', icon: d.terendah < 0 ? AlertTriangle : CheckCircle2, tone: d.terendah < 0 ? 'stat-3' : 'stat-0' },
          ]} />
          <div className="pap-table-card">
            <div className="pap-card-head"><div><h2>Forecast mingguan</h2><p>Piutang & hutang yang sudah lewat jatuh tempo dimasukkan ke minggu pertama.</p></div></div>
            <div className="pap-table-wrap">
              <table className="pap-forecast-table">
                <thead><tr><th>Minggu</th><th className="pap-num">Saldo awal</th><th className="pap-num">Piutang</th><th className="pap-num">Rencana masuk</th><th className="pap-num">Hutang</th><th className="pap-num">Rencana keluar</th><th className="pap-num">Saldo akhir</th></tr></thead>
                <tbody>
                  {d.minggu.map((w) => (
                    <tr key={w.minggu} title={w.rincian.join('\n')}>
                      <td className="pap-nowrap"><b>M{w.minggu}</b> <span className="pap-cell-sub">{formatDate(w.dari)} – {formatDate(w.sampai)}</span></td>
                      <td className="pap-num pap-nowrap">{short(w.saldo_awal)}</td>
                      <td className="pap-num pap-nowrap pap-text-success">{w.piutang ? short(w.piutang) : '—'}</td>
                      <td className="pap-num pap-nowrap pap-text-success">{w.rencana_masuk ? short(w.rencana_masuk) : '—'}</td>
                      <td className="pap-num pap-nowrap pap-text-danger">{w.hutang ? short(w.hutang) : '—'}</td>
                      <td className="pap-num pap-nowrap pap-text-danger">{w.rencana_keluar ? short(w.rencana_keluar) : '—'}</td>
                      <td className={`pap-num pap-nowrap ${w.saldo_akhir < 0 ? 'pap-text-danger' : ''}`}><b>{short(w.saldo_akhir)}</b></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div className="pap-table-card pap-acc-spaced">
            <div className="pap-card-head"><div><h2>Rencana kas</h2><p>Pemasukan & pengeluaran di luar faktur, bisa berulang mingguan / bulanan.</p></div></div>
            <div className="pap-table-wrap">
              <table>
                <thead><tr><th>Rencana</th><th>Jadwal</th><th className="pap-num">Nominal</th>{d.can.manage && <th />}</tr></thead>
                <tbody>
                  {d.plans.map((p) => (
                    <tr key={p.id} className={p.aktif ? '' : 'pap-muted'}>
                      <td><div className="pap-cell-title">{p.jenis === 'masuk' ? '+' : '−'} {p.kategori}{!p.aktif && ' (nonaktif)'}</div><div className="pap-cell-sub">{p.keterangan}</div></td>
                      <td className="pap-nowrap">{p.berulang === 'sekali' ? formatDate(p.tanggal) : `${p.berulang === 'mingguan' ? 'Tiap minggu' : `Tiap tgl ${Number(String(p.tanggal).slice(8, 10))}`} mulai ${formatDate(p.tanggal)}${p.sampai ? ` s.d. ${formatDate(p.sampai)}` : ''}`}</td>
                      <td className={`pap-num pap-nowrap ${p.jenis === 'masuk' ? 'pap-text-success' : 'pap-text-danger'}`}>{formatRupiah(p.nominal)}</td>
                      {d.can.manage && <td className="pap-nowrap"><button className="pap-icon-button" aria-label="Ubah" onClick={() => setForm(p)}><Pencil /></button><button className="pap-icon-button" aria-label="Hapus" onClick={() => remove(p)}><Trash2 /></button></td>}
                    </tr>
                  ))}
                </tbody>
              </table>
              {!d.plans.length && <div className="pap-empty">Belum ada rencana kas. Tambahkan gaji, cicilan, sewa, dan pengeluaran rutin agar forecast lebih akurat.</div>}
            </div>
          </div>
        </>
      )}
      {loading && d && <p className="pap-muted">Memperbarui...</p>}
      {form && <PlanForm item={form === 'baru' ? null : form} onClose={() => setForm(null)} onSaved={() => { setForm(null); load() }} />}
    </>
  )
}

function PlanForm({ item, onClose, onSaved }: { item: CashPlan | null; onClose: () => void; onSaved: () => void }) {
  const [v, setV] = useState({
    jenis: item?.jenis ?? 'keluar', kategori: item?.kategori ?? '', keterangan: item?.keterangan ?? '', tanggal: item?.tanggal?.slice(0, 10) ?? today(),
    nominal: item?.nominal.toString() ?? '', berulang: item?.berulang ?? 'bulanan', sampai: item?.sampai?.slice(0, 10) ?? '', aktif: item?.aktif ?? true,
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function save(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    try {
      await api(item ? `/api/accounting/plans/${item.id}` : '/api/accounting/forecast', { method: item ? 'PUT' : 'POST', json: v })
      onSaved()
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
    }
  }
  return (
    <Modal title={item ? 'Ubah rencana kas' : 'Tambah rencana kas'} onClose={onClose}
      footer={<><span className="pap-spacer" /><button className="pap-btn" onClick={onClose}>Batal</button><button className="pap-primary-button" form="plan-form" disabled={busy}>Simpan</button></>}>
      <form id="plan-form" className="pap-form-grid" onSubmit={save}>
        {error && <div className="full"><Notice onClose={() => setError('')}>{error}</Notice></div>}
        <Field label="Jenis">
          <select className="pap-select" value={v.jenis} onChange={(e) => setV({ ...v, jenis: e.target.value as 'masuk' | 'keluar' })}><option value="keluar">Pengeluaran</option><option value="masuk">Pemasukan</option></select>
        </Field>
        <Field label="Kategori">
          <input className="pap-input" list="pap-plan-cat" required maxLength={100} value={v.kategori} onChange={(e) => setV({ ...v, kategori: e.target.value })} />
          <datalist id="pap-plan-cat">{PLAN_CATEGORIES.map((c) => <option key={c} value={c} />)}</datalist>
        </Field>
        <Field label="Nominal (Rp)"><input className="pap-input pap-num" inputMode="decimal" required value={v.nominal} onChange={(e) => setV({ ...v, nominal: e.target.value })} /></Field>
        <Field label="Berulang">
          <select className="pap-select" value={v.berulang} onChange={(e) => setV({ ...v, berulang: e.target.value as CashPlan['berulang'] })}><option value="sekali">Sekali</option><option value="mingguan">Tiap minggu</option><option value="bulanan">Tiap bulan</option></select>
        </Field>
        <Field label={v.berulang === 'sekali' ? 'Tanggal' : 'Mulai tanggal'}><input className="pap-input" type="date" required value={v.tanggal} onChange={(e) => setV({ ...v, tanggal: e.target.value })} /></Field>
        {v.berulang !== 'sekali' && <Field label="Sampai (opsional)"><input className="pap-input" type="date" value={v.sampai} min={v.tanggal} onChange={(e) => setV({ ...v, sampai: e.target.value })} /></Field>}
        <Field label="Keterangan" full><input className="pap-input" maxLength={500} value={v.keterangan} onChange={(e) => setV({ ...v, keterangan: e.target.value })} /></Field>
        {item && <label className="pap-check full"><input type="checkbox" checked={v.aktif} onChange={(e) => setV({ ...v, aktif: e.target.checked })} /><span>Aktif (dihitung di forecast)</span></label>}
      </form>
    </Modal>
  )
}

// ---------- Pajak ----------
type VatRow = { id: number; number: string; tanggal: string | null; pihak: string | null; dpp: number; ppn: number; faktur_pajak: string | null }
type Duty = { id: number | null; jenis: string; label: string; batas_setor: string | null; batas_lapor: string | null; status: 'belum' | 'sudah_setor' | 'selesai' | 'terlambat'; nominal: number | null; tgl_setor: string | null; ntpn: string | null; tgl_lapor: string | null; no_bukti: string | null; catatan: string | null; updated_name: string | null }
type TaxRes = { masa: string; vat: { keluaran: VatRow[]; masukan: VatRow[]; total: { dpp_keluaran: number; ppn_keluaran: number; dpp_masukan: number; ppn_masukan: number; kurang_bayar: number } }; kewajiban: Duty[]; tanpa_faktur_pajak: number; can: { manage: boolean } }
const DUTY: Record<Duty['status'], [string, string]> = { belum: ['Belum', 'neutral'], sudah_setor: ['Sudah setor', 'info'], selesai: ['Sudah lapor', 'success'], terlambat: ['Terlambat', 'danger'] }

export function TaxPage(_props: { user: UserProfile }) {
  const [masa, setMasa] = useState(() => { const m = thisMonth(); const d = new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 2, 1)); return d.toISOString().slice(0, 7) })
  const { data, loading, error, setError, load } = useLoad<TaxRes>(`/api/accounting/tax?masa=${masa}`)
  const [view, setView] = useState<'keluaran' | 'masukan'>('keluaran')
  const [edit, setEdit] = useState<Duty | null>(null)
  const rows = data?.vat[view] ?? []
  const paged = usePaged(rows, [view, masa])
  const t = data?.vat.total
  return (
    <>
      <Heading title="Pajak" actions={<><MonthNav periode={masa} onChange={setMasa} /><RefreshButton loading={loading} onClick={() => load(true)} /></>}>
        Pelaporan perpajakan rutin: PPN keluaran (faktur penjualan) dan masukan (faktur pembelian) per masa dari Accurate, serta status setor (NTPN) dan lapor setiap jenis pajak.
      </Heading>
      {error && <Notice onClose={() => setError('')}>{error}</Notice>}
      {!data || !t ? <Loading /> : (
        <>
          <Tiles tiles={[
            { label: `PPN keluaran ${monthLabel(masa)}`, value: short(t.ppn_keluaran), note: `DPP ${short(t.dpp_keluaran)} · ${data.vat.keluaran.length} faktur`, icon: ArrowUpRight, tone: 'stat-1' },
            { label: 'PPN masukan', value: short(t.ppn_masukan), note: `DPP ${short(t.dpp_masukan)} · ${data.vat.masukan.length} faktur`, icon: ArrowDownLeft, tone: 'stat-0' },
            { label: t.kurang_bayar >= 0 ? 'PPN kurang bayar' : 'PPN lebih bayar', value: short(Math.abs(t.kurang_bayar)), note: 'Keluaran − masukan (perkiraan)', icon: Landmark, tone: t.kurang_bayar > 0 ? 'stat-2' : 'stat-0' },
            { label: 'Tanpa nomor faktur pajak', value: `${data.tanpa_faktur_pajak}`, note: 'Faktur penjualan ber-PPN di Accurate', icon: AlertTriangle, tone: data.tanpa_faktur_pajak ? 'stat-3' : 'stat-0' },
          ]} />
          <div className="pap-table-card">
            <div className="pap-card-head"><div><h2>Kewajiban masa {monthLabel(masa)}</h2><p>Batas setor & lapor pada bulan berikutnya. Catat tanggal setor, NTPN, tanggal lapor, dan nomor bukti penerimaan.</p></div></div>
            <div className="pap-table-wrap">
              <table>
                <thead><tr><th>Jenis</th><th>Batas setor / lapor</th><th className="pap-num">Nominal</th><th>Setor</th><th>Lapor</th><th>Status</th>{data.can.manage && <th />}</tr></thead>
                <tbody>
                  {data.kewajiban.map((k) => (
                    <tr key={k.jenis}>
                      <td><div className="pap-cell-title">{k.label}</div>{k.catatan && <div className="pap-cell-sub">{k.catatan}</div>}</td>
                      <td className="pap-nowrap">{k.batas_setor ? <>{formatDate(k.batas_setor)}<div className="pap-cell-sub">lapor {formatDate(k.batas_lapor)}</div></> : '—'}</td>
                      <td className="pap-num pap-nowrap">{k.nominal === null ? '—' : formatRupiah(k.nominal)}</td>
                      <td className="pap-nowrap">{k.tgl_setor ? <>{formatDate(k.tgl_setor)}<div className="pap-cell-sub">NTPN {k.ntpn ?? '—'}</div></> : '—'}</td>
                      <td className="pap-nowrap">{k.tgl_lapor ? <>{formatDate(k.tgl_lapor)}<div className="pap-cell-sub">{k.no_bukti ?? ''}</div></> : '—'}</td>
                      <td><span className={`pap-status ${DUTY[k.status][1]}`}>{DUTY[k.status][0]}</span>{k.updated_name && <div className="pap-cell-sub">{k.updated_name}</div>}</td>
                      {data.can.manage && <td><button className="pap-btn" onClick={() => setEdit(k)}><CalendarClock /> Catat</button></td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div className="pap-table-card pap-acc-spaced">
            <div className="pap-card-head">
              <div className="pap-segmented" role="tablist">
                <button role="tab" aria-selected={view === 'keluaran'} className={view === 'keluaran' ? 'active' : ''} onClick={() => setView('keluaran')}>PPN keluaran ({data.vat.keluaran.length})</button>
                <button role="tab" aria-selected={view === 'masukan'} className={view === 'masukan' ? 'active' : ''} onClick={() => setView('masukan')}>PPN masukan ({data.vat.masukan.length})</button>
              </div>
            </div>
            <div className="pap-table-wrap">
              <table>
                <thead><tr><th>Faktur</th><th>{view === 'keluaran' ? 'Customer' : 'Supplier'}</th><th>No. faktur pajak</th><th className="pap-num">DPP</th><th className="pap-num">PPN</th></tr></thead>
                <tbody>
                  {paged.items.map((r) => (
                    <tr key={r.id}>
                      <td className="pap-nowrap"><div className="pap-cell-title">{r.number}</div><div className="pap-cell-sub">{formatDate(r.tanggal)}</div></td>
                      <td>{r.pihak ?? '—'}</td>
                      <td>{r.faktur_pajak ?? <span className="pap-text-warning">Belum ada</span>}</td>
                      <td className="pap-num pap-nowrap">{formatRupiah(r.dpp)}</td>
                      <td className="pap-num pap-nowrap"><strong>{formatRupiah(r.ppn)}</strong></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!rows.length && <div className="pap-empty">Tidak ada faktur ber-PPN pada masa ini.</div>}
              <Pager {...paged.pager} noun="faktur" />
            </div>
          </div>
        </>
      )}
      {edit && <FilingForm masa={masa} duty={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load() }} />}
    </>
  )
}

function FilingForm({ masa, duty, onClose, onSaved }: { masa: string; duty: Duty; onClose: () => void; onSaved: () => void }) {
  const [v, setV] = useState({ nominal: duty.nominal?.toString() ?? '', tgl_setor: duty.tgl_setor?.slice(0, 10) ?? '', ntpn: duty.ntpn ?? '', tgl_lapor: duty.tgl_lapor?.slice(0, 10) ?? '', no_bukti: duty.no_bukti ?? '', catatan: duty.catatan ?? '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function save(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    try {
      await api('/api/accounting/tax', { method: 'PUT', json: { masa, jenis: duty.jenis, ...v } })
      onSaved()
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
    }
  }
  async function reset() {
    if (!duty.id || !window.confirm(`Hapus catatan ${duty.label} masa ${monthLabel(masa)}?`)) return
    try {
      await api(`/api/accounting/tax/${duty.id}`, { method: 'DELETE' })
      onSaved()
    } catch (err) {
      setError((err as Error).message)
    }
  }
  return (
    <Modal title={`${duty.label} · masa ${monthLabel(masa)}`} subtitle={duty.batas_setor ? `Batas setor ${formatDate(duty.batas_setor)} · lapor ${formatDate(duty.batas_lapor)}` : undefined} onClose={onClose}
      footer={<>{duty.id && <button className="pap-btn danger" onClick={reset}><Trash2 /> Hapus catatan</button>}<span className="pap-spacer" /><button className="pap-btn" onClick={onClose}>Batal</button><button className="pap-primary-button" form="filing-form" disabled={busy}>Simpan</button></>}>
      <form id="filing-form" className="pap-form-grid" onSubmit={save}>
        {error && <div className="full"><Notice onClose={() => setError('')}>{error}</Notice></div>}
        <Field label="Nominal pajak (Rp)" full><input className="pap-input pap-num" inputMode="decimal" value={v.nominal} onChange={(e) => setV({ ...v, nominal: e.target.value })} /></Field>
        <Field label="Tanggal setor"><input className="pap-input" type="date" value={v.tgl_setor} onChange={(e) => setV({ ...v, tgl_setor: e.target.value })} /></Field>
        <Field label="NTPN"><input className="pap-input" maxLength={40} value={v.ntpn} onChange={(e) => setV({ ...v, ntpn: e.target.value })} /></Field>
        <Field label="Tanggal lapor"><input className="pap-input" type="date" value={v.tgl_lapor} onChange={(e) => setV({ ...v, tgl_lapor: e.target.value })} /></Field>
        <Field label="No. bukti penerimaan (BPE)"><input className="pap-input" maxLength={80} value={v.no_bukti} onChange={(e) => setV({ ...v, no_bukti: e.target.value })} /></Field>
        <Field label="Catatan" full><input className="pap-input" maxLength={1000} value={v.catatan} onChange={(e) => setV({ ...v, catatan: e.target.value })} /></Field>
      </form>
    </Modal>
  )
}
