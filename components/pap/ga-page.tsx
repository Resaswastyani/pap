'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, ExternalLink, FileSpreadsheet, FileText, Plus, Printer, RefreshCw, Search, ShoppingBag, Smartphone, Trash2, Wallet, Wifi, X } from 'lucide-react'
import type { UserProfile } from '@/lib/users'
import { formatRupiah } from './accurate'
import { api, askReason, Field, formatDate, Modal, Notice, Pager, RowActions, usePaged, confirmDialog } from './ui'

// General Affair: Data GA (nomor HP, langganan, WiFi; dua arah dengan spreadsheet GA) & Pengajuan Pembelian GA

type Pay = Record<string, boolean>
type Phone = { id: number; no: number | null; nomor: string; ket: string | null; masa_aktif: string | null; provider: string | null; pembayaran: Pay }
type Sub = {
  id: number; no: number | null; nama: string; kategori: string | null; vendor: string | null; biaya: number | null; siklus: string | null; jatuh_tempo: string | null
  metode_bayar: string | null; status: string | null; penanggung_jawab: string | null; user_akun: string | null; catatan: string | null
}
type Wifi = {
  id: number; no: number | null; nama: string; provider: string | null; id_pelanggan: string | null; nama_pelanggan: string | null; biaya: number | null
  jatuh_tempo: string | null; tgl_tagihan: number | null; paket: string | null; call_center: string | null; catatan: string | null; pembayaran: Pay
}
type GaData = { hp: Phone[]; langganan: Sub[]; wifi: Wifi[]; synced_at: string | null; url: string; sync_error: string | null; can: { manage: boolean } }
type Jenis = 'hp' | 'langganan' | 'wifi'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des']
const todayIso = () => new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10)
const daysUntil = (iso: string) => Math.round((Date.parse(iso) - Date.parse(todayIso())) / 86_400_000)
const rp = (v: number | null) => (v === null ? '—' : formatRupiah(v))
const nowKey = () => todayIso().slice(0, 7)

function Tiles({ tiles }: { tiles: { label: string; value: string; note: string; icon: typeof Wifi; tone: string; active?: boolean; onClick?: () => void }[] }) {
  return (
    <div className="pap-stat-grid four">
      {tiles.map((t) => (
        <button key={t.label} className={`pap-stat-card pap-stat-button ${t.active ? 'active' : ''}`} onClick={t.onClick} disabled={!t.onClick}>
          <div><span>{t.label}</span><strong className="pap-stat-text">{t.value}</strong><small className="neutral">{t.note}</small></div>
          <div className={`pap-stat-icon ${t.tone}`}><t.icon /></div>
        </button>
      ))}
    </div>
  )
}

// Tanggal jatuh tempo / masa aktif dengan penanda dekat & lewat
function DueBadge({ date }: { date: string | null }) {
  if (!date) return <span className="pap-muted">—</span>
  const d = daysUntil(date)
  return (
    <>
      <div className="pap-nowrap">{formatDate(date)}</div>
      {d < 0 ? <span className="pap-status danger">lewat {-d} hari</span> : d <= 14 ? <span className="pap-status warning">{d === 0 ? 'hari ini' : `${d} hari lagi`}</span> : null}
    </>
  )
}

// Status bayar 12 bulan dalam satu tahun; klik untuk centang / hapus centang (ditulis ke spreadsheet)
function PayChips({ pay, year, onToggle, busy }: { pay: Pay; year: number; onToggle?: (bulan: string, lunas: boolean) => void; busy: string | null }) {
  const current = nowKey()
  return (
    <div className="ga-pay" role="group" aria-label={`Status bayar ${year}`}>
      {MONTHS.map((m, i) => {
        const key = `${year}-${String(i + 1).padStart(2, '0')}`
        const known = key in pay
        const lunas = !!pay[key]
        const due = !lunas && known && key <= current
        return (
          <button key={key} type="button" title={`${m} ${year}: ${!known ? 'kolom bulan belum ada di sheet' : lunas ? 'sudah dibayar' : 'belum dibayar'}`}
            className={`${lunas ? 'paid' : ''} ${due ? 'due' : ''} ${!known ? 'none' : ''}`} disabled={!onToggle || !known || !!busy}
            aria-pressed={lunas} onClick={() => onToggle?.(key, !lunas)}>
            {busy === key ? '…' : m.slice(0, 3)}
          </button>
        )
      })}
    </div>
  )
}

// ================================================================
// DATA GA
// ================================================================
export function GaDataPage(_props: { user: UserProfile }) {
  const [data, setData] = useState<GaData | null>(null)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [tab, setTab] = useState<Jenis>('hp')
  const [q, setQ] = useState('')
  const [year, setYear] = useState(() => Number(todayIso().slice(0, 4)))
  const [form, setForm] = useState<{ jenis: Jenis; item: Phone | Sub | Wifi | null } | null>(null)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [payBusy, setPayBusy] = useState<string | null>(null)
  const load = useCallback(() => api<GaData>('/api/ga/data').then((r) => { setData(r); setError('') }).catch((e) => setError(e.message)), [])
  useEffect(() => { load() }, [load])
  const manage = data?.can.manage ?? false

  async function sync() {
    setSyncing(true)
    setError('')
    try {
      const r = await api<{ hp: number; langganan: number; wifi: number }>('/api/ga/sheet', { method: 'POST' })
      setMessage(`Sinkron selesai: ${r.hp} nomor HP, ${r.langganan} langganan, ${r.wifi} WiFi.`)
      await load()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSyncing(false)
    }
  }
  async function remove(jenis: Jenis, id: number, label: string) {
    if (!(await confirmDialog(`Hapus ${label} dari spreadsheet GA? Barisnya ikut terhapus di Google Sheet dan tidak masuk Data Terhapus.`))) return false
    try {
      await api(`/api/ga/data/${id}?jenis=${jenis}`, { method: 'DELETE' })
      setMessage(`${label} dihapus dari spreadsheet.`)
      await load()
      return true
    } catch (e) {
      setError((e as Error).message)
      return false
    }
  }
  async function togglePay(jenis: 'hp' | 'wifi', id: number, bulan: string, lunas: boolean) {
    setPayBusy(`${jenis}:${id}:${bulan}`)
    setError('')
    try {
      await api(`/api/ga/data/${id}?jenis=${jenis}`, { method: 'PATCH', json: { bayar: { bulan, lunas } } })
      await load()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setPayBusy(null)
    }
  }

  const term = q.trim().toLowerCase()
  const match = (...v: (string | null | undefined)[]) => !term || v.some((x) => x?.toLowerCase().includes(term))
  const phones = (data?.hp ?? []).filter((p) => match(p.nomor, p.ket, p.provider))
  const subs = (data?.langganan ?? []).filter((s) => match(s.nama, s.kategori, s.vendor, s.penanggung_jawab, s.user_akun, s.catatan))
  const wifis = (data?.wifi ?? []).filter((w) => match(w.nama, w.provider, w.id_pelanggan, w.nama_pelanggan, w.paket, w.catatan))
  const shown = tab === 'hp' ? phones : tab === 'langganan' ? subs : wifis
  const paged = usePaged<Phone | Sub | Wifi>(shown, [tab, q])
  const years = useMemo(() => {
    const set = new Set<number>([Number(todayIso().slice(0, 4))])
    for (const r of [...(data?.hp ?? []), ...(data?.wifi ?? [])]) Object.keys(r.pembayaran).forEach((k) => set.add(Number(k.slice(0, 4))))
    return [...set].sort((a, b) => b - a)
  }, [data])

  // Ringkasan
  const subsAktif = (data?.langganan ?? []).filter((s) => !/tidak|non|berhenti|mati/i.test(s.status ?? ''))
  const perBulan = subsAktif.reduce((sum, s) => sum + (s.biaya ?? 0) / (/tahun/i.test(s.siklus ?? '') ? 12 : 1), 0)
  const dueSoon = [
    ...subsAktif.filter((s) => s.jatuh_tempo && daysUntil(s.jatuh_tempo) <= 30),
    ...(data?.hp ?? []).filter((p) => p.masa_aktif && daysUntil(p.masa_aktif) <= 30),
  ]
  const wifiBelum = (data?.wifi ?? []).filter((w) => nowKey() in w.pembayaran && !w.pembayaran[nowKey()])
  const hpBelum = (data?.hp ?? []).filter((p) => nowKey() in p.pembayaran && !p.pembayaran[nowKey()])

  const label = { hp: 'nomor HP', langganan: 'langganan', wifi: 'WiFi' }[tab]
  return (
    <>
      <div className="pap-page-heading">
        <div>
          <p className="pap-eyebrow">GENERAL AFFAIR · GOOGLE DRIVE</p>
          <h1>Data GA</h1>
          <span>Nomor HP kantor, langganan aplikasi, dan WiFi dari spreadsheet GA. Perubahan di sini langsung ditulis ke spreadsheet; perubahan di spreadsheet ikut masuk otomatis.</span>
        </div>
      </div>
      <div className="pap-sync-bar">
        <div className="pap-sync-items">
          <span className="pap-sync-title">Google Drive</span>
          <span className="pap-sync-item">Spreadsheet GA: {data?.synced_at ? `sinkron ${formatDate(data.synced_at, true)}` : 'belum pernah sinkron'} · otomatis tiap ±10 menit saat dibuka</span>
        </div>
        <div className="pap-inline-actions">
          {data?.url && <a className="pap-btn" href={data.url} target="_blank" rel="noreferrer"><ExternalLink /> Buka sheet</a>}
          <button className="pap-btn" onClick={() => setSheetOpen(true)}><FileSpreadsheet /> Sumber data</button>
          {manage && <button className="pap-btn" onClick={sync} disabled={syncing}><RefreshCw /> {syncing ? 'Sinkron...' : 'Sinkron'}</button>}
        </div>
      </div>
      {data?.sync_error && <Notice>Sinkron otomatis gagal: {data.sync_error}</Notice>}
      {message && <Notice kind="success" onClose={() => setMessage('')}>{message}</Notice>}
      {error && <Notice onClose={() => setError('')}>{error}</Notice>}
      <Tiles tiles={[
        { label: 'Nomor HP', value: `${data?.hp.length ?? 0}`, note: hpBelum.length ? `${hpBelum.length} belum bayar bulan ini` : 'Semua sudah bayar bulan ini', icon: Smartphone, tone: hpBelum.length ? 'stat-2' : 'stat-0', active: tab === 'hp', onClick: () => setTab('hp') },
        { label: 'Langganan aktif', value: `${subsAktif.length}`, note: `±${formatRupiah(Math.round(perBulan))} / bulan`, icon: Wallet, tone: 'stat-1', active: tab === 'langganan', onClick: () => setTab('langganan') },
        { label: 'WiFi', value: `${data?.wifi.length ?? 0}`, note: wifiBelum.length ? `${wifiBelum.length} tagihan bulan ini belum dibayar` : 'Tagihan bulan ini beres', icon: Wifi, tone: wifiBelum.length ? 'stat-2' : 'stat-0', active: tab === 'wifi', onClick: () => setTab('wifi') },
        { label: 'Jatuh tempo ≤ 30 hari', value: `${dueSoon.length}`, note: 'langganan & masa aktif nomor', icon: AlertTriangle, tone: dueSoon.length ? 'stat-2' : 'stat-3' },
      ]} />
      <div className="pap-segmented pap-page-tabs" role="tablist" aria-label="Data GA">
        <button role="tab" aria-selected={tab === 'hp'} className={tab === 'hp' ? 'active' : ''} onClick={() => setTab('hp')}><Smartphone /> Nomor HP</button>
        <button role="tab" aria-selected={tab === 'langganan'} className={tab === 'langganan' ? 'active' : ''} onClick={() => setTab('langganan')}><Wallet /> Langganan</button>
        <button role="tab" aria-selected={tab === 'wifi'} className={tab === 'wifi' ? 'active' : ''} onClick={() => setTab('wifi')}><Wifi /> WiFi</button>
      </div>
      <div className="pap-table-card">
        <div className="pap-card-head">
          <div><h2>{tab === 'hp' ? 'Nomor HP kantor' : tab === 'langganan' ? 'Langganan aplikasi & layanan' : 'WiFi kantor'}</h2><p>{shown.length} {label}{tab !== 'langganan' ? ' · klik bulan untuk menandai sudah / belum dibayar' : ''}</p></div>
          {manage && <button className="pap-primary-button" onClick={() => setForm({ jenis: tab, item: null })}><Plus /> Tambah {label}</button>}
        </div>
        <div className="pap-filters">
          <label className="pap-filter-search"><Search /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Cari ${label}...`} /></label>
          {tab !== 'langganan' && (
            <select className="pap-select" value={year} onChange={(e) => setYear(Number(e.target.value))} aria-label="Tahun status bayar">
              {years.map((y) => <option key={y} value={y}>Status bayar {y}</option>)}
            </select>
          )}
        </div>
        <div className="pap-table-wrap">
          <table>
            {tab === 'hp' && <>
              <thead><tr><th>Nomor</th><th>Provider</th><th>Masa aktif</th><th>Bayar {year}</th>{manage && <th className="pap-actions-col">Aksi</th>}</tr></thead>
              <tbody>
                {(paged.items as Phone[]).map((p) => (
                  <tr key={p.id}>
                    <td><div className="pap-cell-title pap-nowrap">{p.nomor}</div><div className="pap-cell-sub">{p.no ? `#${p.no} · ` : ''}{p.ket ?? '—'}</div></td>
                    <td>{p.provider ?? '—'}</td>
                    <td><DueBadge date={p.masa_aktif} /></td>
                    <td><PayChips pay={p.pembayaran} year={year} busy={payBusy?.startsWith(`hp:${p.id}:`) ? payBusy.split(':')[2] : payBusy ? 'x' : null} onToggle={manage ? (b, l) => togglePay('hp', p.id, b, l) : undefined} /></td>
                    {manage && <td><RowActions label={p.nomor} onEdit={() => setForm({ jenis: 'hp', item: p })} onDelete={() => remove('hp', p.id, p.nomor)} /></td>}
                  </tr>
                ))}
              </tbody>
            </>}
            {tab === 'langganan' && <>
              <thead><tr><th>Layanan</th><th>Vendor</th><th className="pap-num">Biaya</th><th>Jatuh tempo</th><th>Pembayaran</th><th>Penanggung jawab</th>{manage && <th className="pap-actions-col">Aksi</th>}</tr></thead>
              <tbody>
                {(paged.items as Sub[]).map((s) => (
                  <tr key={s.id}>
                    <td><div className="pap-cell-title">{s.nama}</div><div className="pap-cell-sub">{[s.kategori, s.status].filter(Boolean).join(' · ')}{s.catatan ? ` · ${s.catatan}` : ''}</div></td>
                    <td>{s.vendor ?? '—'}</td>
                    <td className="pap-num pap-nowrap">{rp(s.biaya)}<div className="pap-cell-sub">{s.siklus ?? ''}</div></td>
                    <td><DueBadge date={s.jatuh_tempo} /></td>
                    <td>{s.metode_bayar ?? '—'}</td>
                    <td>{s.penanggung_jawab ?? '—'}<div className="pap-cell-sub">{s.user_akun ?? ''}</div></td>
                    {manage && <td><RowActions label={s.nama} onEdit={() => setForm({ jenis: 'langganan', item: s })} onDelete={() => remove('langganan', s.id, s.nama)} /></td>}
                  </tr>
                ))}
              </tbody>
            </>}
            {tab === 'wifi' && <>
              <thead><tr><th>WiFi</th><th>Pelanggan</th><th className="pap-num">Biaya</th><th>Jatuh tempo</th><th>Bayar {year}</th>{manage && <th className="pap-actions-col">Aksi</th>}</tr></thead>
              <tbody>
                {(paged.items as Wifi[]).map((w) => (
                  <tr key={w.id}>
                    <td><div className="pap-cell-title">{w.nama}</div><div className="pap-cell-sub">{[w.provider, w.catatan].filter(Boolean).join(' · ')}</div>{w.paket && <div className="pap-cell-sub">{w.paket}</div>}</td>
                    <td>{w.nama_pelanggan ?? '—'}<div className="pap-cell-sub">ID {w.id_pelanggan ?? '—'}{w.call_center ? ` · CS ${w.call_center}` : ''}</div></td>
                    <td className="pap-num pap-nowrap">{rp(w.biaya)}<div className="pap-cell-sub">/ bulan</div></td>
                    <td className="pap-nowrap">{w.jatuh_tempo ?? '—'}</td>
                    <td>{Object.keys(w.pembayaran).length ? <PayChips pay={w.pembayaran} year={year} busy={payBusy?.startsWith(`wifi:${w.id}:`) ? payBusy.split(':')[2] : payBusy ? 'x' : null} onToggle={manage ? (b, l) => togglePay('wifi', w.id, b, l) : undefined} /> : <span className="pap-muted">Tidak ada di tabel bayar</span>}</td>
                    {manage && <td><RowActions label={w.nama} onEdit={() => setForm({ jenis: 'wifi', item: w })} onDelete={() => remove('wifi', w.id, w.nama)} /></td>}
                  </tr>
                ))}
              </tbody>
            </>}
          </table>
          {data && !shown.length && <div className="pap-empty">{term ? `Tidak ada ${label} yang cocok.` : `Belum ada data ${label}.${manage ? ' Klik "Sinkron" untuk mengambil dari spreadsheet GA.' : ''}`}</div>}
          {!data && !error && <div className="pap-empty">Memuat data GA...</div>}
          <Pager {...paged.pager} noun={label} />
        </div>
      </div>
      {form && <GaForm jenis={form.jenis} item={form.item} onClose={() => setForm(null)} onSaved={(t) => { setForm(null); setMessage(t); load() }}
        onDelete={form.item ? async () => { const it = form.item as { id: number; nomor?: string; nama?: string }; if (await remove(form.jenis, it.id, it.nomor ?? it.nama ?? 'data')) setForm(null) } : undefined} />}
      {sheetOpen && <GaSheetDialog manage={manage} onClose={() => setSheetOpen(false)} onSynced={(t) => { setSheetOpen(false); setMessage(t); load() }} />}
    </>
  )
}

function GaForm({ jenis, item, onClose, onSaved, onDelete }: { jenis: Jenis; item: Phone | Sub | Wifi | null; onClose: () => void; onSaved: (text: string) => void; onDelete?: () => Promise<void> }) {
  const it = (item ?? {}) as Record<string, unknown>
  const s = (k: string) => (it[k] === null || it[k] === undefined ? '' : String(it[k]))
  const [v, setV] = useState<Record<string, string>>((): Record<string, string> => (
    jenis === 'hp' ? { nomor: s('nomor'), ket: s('ket'), masa_aktif: s('masa_aktif'), provider: s('provider') }
      : jenis === 'langganan' ? {
        nama: s('nama'), kategori: s('kategori'), vendor: s('vendor'), biaya: s('biaya'), siklus: s('siklus') || 'Bulanan', jatuh_tempo: s('jatuh_tempo'),
        metode_bayar: s('metode_bayar'), status: s('status') || 'Aktif', penanggung_jawab: s('penanggung_jawab'), user_akun: s('user_akun'), catatan: s('catatan'),
      }
        : { nama: s('nama'), provider: s('provider'), id_pelanggan: s('id_pelanggan'), nama_pelanggan: s('nama_pelanggan'), biaya: s('biaya'), tgl_tagihan: s('tgl_tagihan'), paket: s('paket'), call_center: s('call_center'), catatan: s('catatan') }
  ))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setV({ ...v, [k]: e.target.value })
  const input = (k: string, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}, full = false) => (
    <Field label={label} full={full}><input className="pap-input" value={v[k]} onChange={set(k)} {...props} /></Field>
  )
  const noun = { hp: 'nomor HP', langganan: 'langganan', wifi: 'WiFi' }[jenis]
  async function save(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await api(item ? `/api/ga/data/${(item as { id: number }).id}?jenis=${jenis}` : '/api/ga/data', { method: item ? 'PATCH' : 'POST', json: { ...v, jenis } })
      onSaved(item ? `Perubahan ${noun} disimpan ke spreadsheet.` : `${noun.charAt(0).toUpperCase() + noun.slice(1)} ditambahkan ke spreadsheet.`)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal title={item ? `Ubah ${noun}` : `Tambah ${noun}`} subtitle="Disimpan langsung ke spreadsheet GA di Google Drive" wide={jenis !== 'hp'} onClose={onClose}
      footer={<>{onDelete && <button type="button" className="pap-btn pap-btn-danger" disabled={busy} onClick={onDelete}><Trash2 /> Hapus</button>}<span className="pap-spacer" /><button type="button" className="pap-btn" onClick={onClose}>Batal</button><button className="pap-primary-button" form="ga-form" disabled={busy}>{busy ? 'Menyimpan ke sheet...' : 'Simpan'}</button></>}>
      {error && <Notice onClose={() => setError('')}>{error}</Notice>}
      <form id="ga-form" className="pap-form-grid" onSubmit={save}>
        {jenis === 'hp' && <>
          {input('nomor', 'Nomor HP', { required: true, inputMode: 'tel', placeholder: '0895-xxxx-xxxx' })}
          {input('provider', 'Provider', { placeholder: 'Tri (3), Telkomsel, ...', list: 'ga-provider' })}
          {input('ket', 'Keterangan / pemakai', { placeholder: 'Mkt Laundry 1, HRD, Back up, ...' })}
          {input('masa_aktif', 'Masa aktif', { type: 'date' })}
        </>}
        {jenis === 'langganan' && <>
          {input('nama', 'Nama layanan / aplikasi', { required: true }, true)}
          {input('kategori', 'Kategori', { list: 'ga-kategori', placeholder: 'IT/Infrastructure, Design, ...' })}
          {input('vendor', 'Vendor / provider')}
          {input('biaya', 'Biaya (Rp)', { type: 'number', min: 0, step: 'any' })}
          <Field label="Siklus tagihan"><select className="pap-select" value={v.siklus} onChange={set('siklus')}><option>Bulanan</option><option>Tahunan</option><option>Sekali bayar</option></select></Field>
          {input('jatuh_tempo', 'Tanggal jatuh tempo', { type: 'date' })}
          {input('metode_bayar', 'Metode pembayaran', { placeholder: 'BCA, VA BCA, Gopay, ...' })}
          <Field label="Status"><select className="pap-select" value={v.status} onChange={set('status')}><option>Aktif</option><option>Tidak aktif</option></select></Field>
          {input('penanggung_jawab', 'Penanggung jawab')}
          {input('user_akun', 'User / akun login')}
          <Field label="Catatan" full><textarea className="pap-input" rows={2} value={v.catatan} onChange={set('catatan')} /></Field>
        </>}
        {jenis === 'wifi' && <>
          {input('nama', 'Nama WiFi', { required: true })}
          {input('provider', 'Provider', { list: 'ga-provider', placeholder: 'Indibiz, indihome, my republic, ...' })}
          {input('id_pelanggan', 'ID pelanggan', { inputMode: 'numeric' })}
          {input('nama_pelanggan', 'Nama pelanggan')}
          {input('biaya', 'Biaya per bulan (Rp)', { type: 'number', min: 0, step: 'any' })}
          {input('tgl_tagihan', 'Jatuh tempo tiap tanggal', { type: 'number', min: 1, max: 31 })}
          {input('paket', 'Paket', {}, true)}
          {input('call_center', 'Call center')}
          {input('catatan', 'Catatan / lokasi')}
        </>}
        <datalist id="ga-provider">{['Tri (3)', 'Telkomsel', 'Indosat Ooredoo', 'XL', 'Smartfren', 'Indibiz', 'indihome', 'my republic', 'Biznet'].map((p) => <option key={p} value={p} />)}</datalist>
        <datalist id="ga-kategori">{['IT/Infrastructure', 'Design', 'Productivity', 'Marketing', 'Finance'].map((p) => <option key={p} value={p} />)}</datalist>
      </form>
      {jenis === 'wifi' && !item && <p className="pap-muted">WiFi baru juga ditambahkan ke setiap tabel status bayar bulanan di tab WIFI.</p>}
    </Modal>
  )
}

function GaSheetDialog({ manage, onClose, onSynced }: { manage: boolean; onClose: () => void; onSynced: (text: string) => void }) {
  const [info, setInfo] = useState<{ url: string; account: string | null; tabs: string[]; dipakai: string | null; contoh: string[]; error?: string } | null>(null)
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const load = useCallback(() => api<NonNullable<typeof info>>('/api/ga/sheet').then((r) => { setInfo(r); setUrl(r.url) }).catch((e) => setError(e.message)), [])
  useEffect(() => { load() }, [load])
  async function run(fn: () => Promise<void>) {
    setBusy(true)
    setError('')
    try { await fn() } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }
  return (
    <Modal title="Sumber data GA" subtitle="Spreadsheet PAP - GA - List No HP, Subscription, WIFI" wide onClose={onClose}
      footer={<><span className="pap-spacer" /><button className="pap-btn" onClick={onClose}>Tutup</button>{manage && <button className="pap-primary-button" disabled={busy} onClick={() => run(async () => { const r = await api<{ hp: number; langganan: number; wifi: number }>('/api/ga/sheet', { method: 'POST' }); onSynced(`Sinkron selesai: ${r.hp} nomor HP, ${r.langganan} langganan, ${r.wifi} WiFi.`) })}><RefreshCw /> Sinkron sekarang</button>}</>}>
      {error && <Notice onClose={() => setError('')}>{error}</Notice>}
      {manage && (
        <Field label="Link Google Spreadsheet" hint="Akun Google yang terhubung (Master Data > Logo & Desain) harus punya akses Editor agar tambah / ubah dari PAP-MS bisa ditulis ke sheet." full>
          <div className="pap-inline-actions">
            <input className="pap-input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://docs.google.com/spreadsheets/d/..." />
            <button className="pap-btn" disabled={busy || !url.trim() || url === info?.url} onClick={() => run(async () => { await api('/api/ga/sheet', { method: 'PUT', json: { url } }); await load() })}>Simpan link</button>
          </div>
        </Field>
      )}
      {!info && !error && <p className="pap-muted">Membaca spreadsheet...</p>}
      {info && (
        <div className="pap-detail-list">
          <p><b>Akun Google:</b> {info.account ?? 'belum terhubung'}</p>
          {info.error ? <Notice>{info.error}</Notice> : <>
            <p><b>Tab dibaca:</b> {info.dipakai || '—'} <span className="pap-muted">(semua tab: {info.tabs.join(', ') || '—'})</span></p>
            <p><b>Isi:</b> {info.contoh.join(' · ')}</p>
          </>}
        </div>
      )}
    </Modal>
  )
}

// ================================================================
// PENGAJUAN PEMBELIAN GA
// ================================================================
type PrStatus = 'diajukan' | 'disetujui' | 'dibeli' | 'selesai' | 'ditolak' | 'batal'
type Pr = {
  id: number; nomor: string; judul: string; kategori: string; prioritas: 'darurat' | 'tinggi' | 'normal'; dibutuhkan: string | null; keperluan: string | null; status: PrStatus
  vendor: string | null; catatan_ga: string | null; requested_by: number; requested_name: string; requested_division: string; approved_name: string | null; approved_at: string | null
  bought_at: string | null; created_at: string; item_count: number; item_names: string | null; total_estimasi: number | null; total_realisasi: number | null
}
type PrItem = { id?: number; nama: string; jumlah: number | string; satuan: string; harga_estimasi: number | string | null; harga_realisasi?: number | null; catatan: string | null }

const PR_STATUS: Record<PrStatus, [string, string]> = {
  diajukan: ['Diajukan', 'warning'], disetujui: ['Disetujui', 'info'], dibeli: ['Dibeli', 'info'], selesai: ['Selesai', 'success'], ditolak: ['Ditolak', 'danger'], batal: ['Dibatalkan', 'neutral'],
}
const PRIORITY: Record<Pr['prioritas'], [string, string]> = { darurat: ['Darurat', 'danger'], tinggi: ['Tinggi', 'warning'], normal: ['Normal', 'neutral'] }
const CATEGORIES = ['ATK', 'Kebersihan', 'Konsumsi', 'Pulsa / paket data', 'Langganan aplikasi', 'Internet / WiFi', 'Perlengkapan kantor', 'Perbaikan gedung', 'Lainnya']

export function GaRequestPage({ user, focusId }: { user: UserProfile; focusId?: number | null }) {
  const [data, setData] = useState<{ items: Pr[]; can: { process: boolean } } | null>(null)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [status, setStatus] = useState<'aktif' | PrStatus | 'semua'>('aktif')
  const [q, setQ] = useState('')
  const [form, setForm] = useState<{ id: number | null } | null>(null)
  const [detail, setDetail] = useState<number | null>(focusId ?? null)
  const load = useCallback(() => api<NonNullable<typeof data>>('/api/ga/requests').then((r) => { setData(r); setError('') }).catch((e) => setError(e.message)), [])
  useEffect(() => { load() }, [load])
  const items = data?.items ?? []
  const count = (s: PrStatus) => items.filter((i) => i.status === s).length
  const term = q.trim().toLowerCase()
  const shown = items.filter((i) => (status === 'semua' ? true : status === 'aktif' ? ['diajukan', 'disetujui', 'dibeli'].includes(i.status) : i.status === status)
    && (!term || [i.nomor, i.judul, i.kategori, i.item_names, i.requested_name].some((x) => x?.toLowerCase().includes(term))))
  const paged = usePaged(shown, [status, q])
  const toggle = (s: PrStatus) => setStatus(status === s ? 'aktif' : s)
  const changed = (text: string) => { setMessage(text); setForm(null); setDetail(null); load() }

  return (
    <>
      <div className="pap-page-heading">
        <div>
          <p className="pap-eyebrow">GENERAL AFFAIR</p>
          <h1>Pengajuan Pembelian GA</h1>
          <span>Kebutuhan umum kantor (ATK, kebersihan, pulsa, langganan, perlengkapan, perbaikan gedung) diajukan ke General Affair. Terpisah dari Pengajuan Pembelian di Purchasing.</span>
        </div>
        <button className="pap-primary-button" onClick={() => setForm({ id: null })}><Plus /> Ajukan pembelian</button>
      </div>
      {message && <Notice kind="success" onClose={() => setMessage('')}>{message}</Notice>}
      {error && <Notice onClose={() => setError('')}>{error}</Notice>}
      <Tiles tiles={[
        { label: 'Menunggu persetujuan', value: `${count('diajukan')}`, note: `${items.filter((i) => i.status === 'diajukan' && i.prioritas === 'darurat').length} darurat`, icon: AlertTriangle, tone: count('diajukan') ? 'stat-2' : 'stat-0', active: status === 'diajukan', onClick: () => toggle('diajukan') },
        { label: 'Disetujui, belum dibeli', value: `${count('disetujui')}`, note: 'perlu dibelikan GA', icon: ShoppingBag, tone: 'stat-1', active: status === 'disetujui', onClick: () => toggle('disetujui') },
        { label: 'Sudah dibeli', value: `${count('dibeli')}`, note: 'menunggu diserahkan', icon: Wallet, tone: 'stat-1', active: status === 'dibeli', onClick: () => toggle('dibeli') },
        { label: 'Selesai', value: `${count('selesai')}`, note: `${count('ditolak')} ditolak · ${count('batal')} batal`, icon: CheckCircle2, tone: 'stat-0', active: status === 'selesai', onClick: () => toggle('selesai') },
      ]} />
      <div className="pap-table-card">
        <div className="pap-card-head"><div><h2>Daftar pengajuan</h2><p>{shown.length} pengajuan{data?.can.process ? ' · semua divisi' : ' · pengajuan Anda'}</p></div></div>
        <div className="pap-filters">
          <label className="pap-filter-search"><Search /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari nomor, judul, barang, pengaju..." /></label>
          <select className="pap-select" value={status} onChange={(e) => setStatus(e.target.value as typeof status)} aria-label="Filter status">
            <option value="aktif">Belum selesai</option>
            {(Object.keys(PR_STATUS) as PrStatus[]).map((s) => <option key={s} value={s}>{PR_STATUS[s][0]}</option>)}
            <option value="semua">Semua</option>
          </select>
        </div>
        <div className="pap-table-wrap">
          <table>
            <thead><tr><th>Pengajuan</th><th>Kategori</th><th>Barang</th><th className="pap-num">Perkiraan</th><th>Dibutuhkan</th><th>Status</th></tr></thead>
            <tbody>
              {paged.items.map((p) => (
                <tr key={p.id} className="pap-row-link" onClick={() => setDetail(p.id)}>
                  <td><div className="pap-cell-title">{p.judul}</div><div className="pap-cell-sub">{p.nomor} · {p.requested_name} ({p.requested_division}) · {formatDate(p.created_at)}</div></td>
                  <td>{p.kategori}{p.prioritas !== 'normal' && <div><span className={`pap-status ${PRIORITY[p.prioritas][1]}`}>{PRIORITY[p.prioritas][0]}</span></div>}</td>
                  <td>{p.item_names ?? '—'}<div className="pap-cell-sub">{p.item_count} barang</div></td>
                  <td className="pap-num pap-nowrap">{rp(p.total_realisasi ?? p.total_estimasi)}{p.total_realisasi !== null && <div className="pap-cell-sub">realisasi</div>}</td>
                  <td><DueBadge date={['diajukan', 'disetujui'].includes(p.status) ? p.dibutuhkan : null} />{!['diajukan', 'disetujui'].includes(p.status) && p.dibutuhkan ? formatDate(p.dibutuhkan) : null}</td>
                  <td><span className={`pap-status ${PR_STATUS[p.status][1]}`}>{PR_STATUS[p.status][0]}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
          {data && !shown.length && <div className="pap-empty">{items.length ? 'Tidak ada pengajuan yang cocok.' : 'Belum ada pengajuan pembelian GA.'}</div>}
          {!data && !error && <div className="pap-empty">Memuat pengajuan...</div>}
          <Pager {...paged.pager} noun="pengajuan" />
        </div>
      </div>
      {form && <GaPrForm id={form.id} onClose={() => setForm(null)} onSaved={changed} />}
      {detail && <GaPrDetail id={detail} userId={user.id} onClose={() => setDetail(null)} onEdit={(id) => { setDetail(null); setForm({ id }) }} onChanged={changed} />}
    </>
  )
}

const emptyItem = (): PrItem => ({ nama: '', jumlah: 1, satuan: 'pcs', harga_estimasi: '', catatan: '' })

function GaPrForm({ id, onClose, onSaved }: { id: number | null; onClose: () => void; onSaved: (text: string) => void }) {
  const [v, setV] = useState({ judul: '', kategori: '', prioritas: 'normal', dibutuhkan: '', keperluan: '' })
  const [items, setItems] = useState<PrItem[]>([emptyItem()])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    if (!id) return
    api<{ item: Pr; items: PrItem[] }>(`/api/ga/requests/${id}`).then((r) => {
      setV({ judul: r.item.judul, kategori: r.item.kategori, prioritas: r.item.prioritas, dibutuhkan: r.item.dibutuhkan ?? '', keperluan: r.item.keperluan ?? '' })
      setItems(r.items.map((i) => ({ ...i, harga_estimasi: i.harga_estimasi ?? '' })))
    }).catch((e) => setError(e.message))
  }, [id])
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setV({ ...v, [k]: e.target.value })
  const setItem = (i: number, k: keyof PrItem, value: string) => setItems(items.map((it, j) => (j === i ? { ...it, [k]: value } : it)))
  const total = items.reduce((sum, i) => sum + (Number(i.jumlah) || 0) * (Number(i.harga_estimasi) || 0), 0)
  async function save(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const json = { ...v, items: items.map((i) => ({ ...i, harga_estimasi: i.harga_estimasi === '' ? null : i.harga_estimasi })) }
      await api(id ? `/api/ga/requests/${id}` : '/api/ga/requests', { method: id ? 'PATCH' : 'POST', json })
      onSaved(id ? 'Pengajuan diperbarui.' : 'Pengajuan dikirim ke General Affair.')
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal title={id ? 'Ubah pengajuan GA' : 'Ajukan pembelian ke GA'} subtitle="Kebutuhan umum kantor; diproses General Affair" wide onClose={onClose}
      footer={<><span className="pap-spacer" /><button type="button" className="pap-btn" onClick={onClose}>Batal</button><button className="pap-primary-button" form="ga-pr-form" disabled={busy}>{busy ? 'Menyimpan...' : id ? 'Simpan' : 'Kirim pengajuan'}</button></>}>
      {error && <Notice onClose={() => setError('')}>{error}</Notice>}
      <form id="ga-pr-form" className="pap-form-grid" onSubmit={save}>
        <Field label="Judul pengajuan" full><input className="pap-input" required maxLength={200} value={v.judul} onChange={set('judul')} placeholder="Mis. ATK bulan November, isi ulang galon, perpanjang Canva Pro" /></Field>
        <Field label="Kategori"><select className="pap-select" required value={v.kategori} onChange={set('kategori')}><option value="">Pilih kategori</option>{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select></Field>
        <Field label="Prioritas"><select className="pap-select" value={v.prioritas} onChange={set('prioritas')}><option value="normal">Normal</option><option value="tinggi">Tinggi</option><option value="darurat">Darurat (GM ikut diberi tahu)</option></select></Field>
        <Field label="Dibutuhkan tanggal"><input className="pap-input" type="date" value={v.dibutuhkan} onChange={set('dibutuhkan')} /></Field>
        <Field label="Keperluan" full><textarea className="pap-input" rows={2} maxLength={5000} value={v.keperluan} onChange={set('keperluan')} placeholder="Untuk apa / ruangan / divisi pemakai" /></Field>
        <div className="pap-field full">
          <span>Barang / jasa</span>
          <div className="ga-items">
            {items.map((it, i) => (
              <div key={i} className="ga-item-row">
                <input className="pap-input" required placeholder="Nama barang / jasa" value={it.nama} onChange={(e) => setItem(i, 'nama', e.target.value)} aria-label={`Nama barang ${i + 1}`} />
                <input className="pap-input" type="number" min={0.01} step="any" required value={it.jumlah} onChange={(e) => setItem(i, 'jumlah', e.target.value)} aria-label={`Jumlah barang ${i + 1}`} />
                <input className="pap-input" placeholder="Satuan" value={it.satuan} onChange={(e) => setItem(i, 'satuan', e.target.value)} aria-label={`Satuan barang ${i + 1}`} />
                <input className="pap-input" type="number" min={0} step="any" placeholder="Perkiraan harga satuan" value={it.harga_estimasi ?? ''} onChange={(e) => setItem(i, 'harga_estimasi', e.target.value)} aria-label={`Perkiraan harga barang ${i + 1}`} />
                <button type="button" className="pap-icon-button" disabled={items.length === 1} onClick={() => setItems(items.filter((_, j) => j !== i))} aria-label={`Hapus barang ${i + 1}`}><X /></button>
              </div>
            ))}
            <div className="pap-inline-actions pap-wrap">
              <button type="button" className="pap-btn" onClick={() => setItems([...items, emptyItem()])}><Plus /> Tambah barang</button>
              <span className="pap-spacer" />
              <span className="pap-muted">Perkiraan total: <b>{formatRupiah(total)}</b></span>
            </div>
          </div>
        </div>
      </form>
    </Modal>
  )
}

function GaPrDetail({ id, userId, onClose, onEdit, onChanged }: { id: number; userId: number; onClose: () => void; onEdit: (id: number) => void; onChanged: (text: string) => void }) {
  const [data, setData] = useState<{ item: Pr; items: PrItem[]; can: { process: boolean; edit: boolean; cancel: boolean } } | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [buy, setBuy] = useState<{ vendor: string; bought_at: string; harga: Record<number, string> } | null>(null)
  useEffect(() => { api<NonNullable<typeof data>>(`/api/ga/requests/${id}`).then(setData).catch((e) => setError(e.message)) }, [id])
  async function act(json: Record<string, unknown>, text: string) {
    setBusy(true)
    setError('')
    try {
      await api(`/api/ga/requests/${id}`, { method: 'PATCH', json })
      onChanged(text)
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }
  async function remove() {
    if (!(await confirmDialog('Hapus pengajuan ini?'))) return
    try {
      await api(`/api/ga/requests/${id}`, { method: 'DELETE' })
      onChanged('Pengajuan dihapus.')
    } catch (e) {
      setError((e as Error).message)
    }
  }
  if (!data) return <Modal title="Pengajuan GA" onClose={onClose}>{error ? <Notice>{error}</Notice> : <p className="pap-muted">Memuat...</p>}</Modal>
  const p = data.item
  const s = p.status
  const totalEst = data.items.reduce((sum, i) => sum + Number(i.jumlah) * (Number(i.harga_estimasi) || 0), 0)
  const mine = p.requested_by === userId
  return (
    <Modal title={`${p.nomor} · ${p.judul}`} subtitle={`${p.kategori} · diajukan ${p.requested_name} (${p.requested_division}), ${formatDate(p.created_at, true)}`} wide onClose={onClose}
      footer={<>
        {(data.can.process || (mine && s === 'diajukan')) && <button className="pap-btn danger" disabled={busy} onClick={remove}><Trash2 /> Hapus</button>}
        {data.can.cancel && <button className="pap-btn danger" disabled={busy} onClick={async () => { const a = await askReason({ title: 'Batalkan pengajuan GA', label: 'Alasan pembatalan', confirmLabel: 'Batalkan pengajuan' }); if (a) act({ status: 'batal', catatan: a }, 'Pengajuan dibatalkan.') }}>Batalkan</button>}
        <span className="pap-spacer" />
        <a className="pap-btn" href={`/cetak/pengajuan-ga/${p.id}`} target="_blank" rel="noreferrer"><Printer /> Cetak / PDF</a>
        <a className="pap-btn" href={`/api/ga/requests/${p.id}/word`}><FileText /> Word</a>
        {data.can.edit && <button className="pap-btn" onClick={() => onEdit(p.id)}>Ubah</button>}
        <button className="pap-btn" onClick={onClose}>Tutup</button>
      </>}>
      {error && <Notice onClose={() => setError('')}>{error}</Notice>}
      <div className="pap-detail-badges">
        <span className={`pap-status ${PR_STATUS[s][1]}`}>{PR_STATUS[s][0]}</span>
        <span className={`pap-status ${PRIORITY[p.prioritas][1]}`}>Prioritas {PRIORITY[p.prioritas][0].toLowerCase()}</span>
        {p.dibutuhkan && <span className="pap-status neutral">Dibutuhkan {formatDate(p.dibutuhkan)}</span>}
      </div>
      {p.keperluan && <p className="pap-prewrap">{p.keperluan}</p>}
      <div className="pap-table-wrap">
        <table>
          <thead><tr><th>Barang / jasa</th><th className="pap-num">Jumlah</th><th className="pap-num">Perkiraan / satuan</th><th className="pap-num">Realisasi / satuan</th></tr></thead>
          <tbody>
            {data.items.map((i) => (
              <tr key={i.id}>
                <td>{i.nama}{i.catatan && <div className="pap-cell-sub">{i.catatan}</div>}</td>
                <td className="pap-num pap-nowrap">{Number(i.jumlah).toLocaleString('id-ID')} {i.satuan}</td>
                <td className="pap-num">{rp(i.harga_estimasi === null || i.harga_estimasi === '' ? null : Number(i.harga_estimasi))}</td>
                <td className="pap-num">{buy ? <input className="pap-input" type="number" min={0} step="any" value={buy.harga[i.id!] ?? ''} onChange={(e) => setBuy({ ...buy, harga: { ...buy.harga, [i.id!]: e.target.value } })} aria-label={`Harga realisasi ${i.nama}`} /> : rp(i.harga_realisasi ?? null)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="pap-muted">Perkiraan total {formatRupiah(totalEst)}{p.total_realisasi !== null ? ` · realisasi ${formatRupiah(p.total_realisasi)}` : ''}{p.vendor ? ` · dibeli di ${p.vendor}` : ''}{p.bought_at ? `, ${formatDate(p.bought_at)}` : ''}</p>
      {p.approved_name && <p className="pap-muted">{s === 'ditolak' ? 'Ditolak' : 'Disetujui'} oleh {p.approved_name}{p.approved_at ? `, ${formatDate(p.approved_at, true)}` : ''}</p>}
      {p.catatan_ga && <Notice kind={s === 'ditolak' || s === 'batal' ? undefined : 'success'}>Catatan: {p.catatan_ga}</Notice>}

      {data.can.process && s === 'diajukan' && (
        <div className="pap-inline-panel">
          <strong>General Affair: tanggapi pengajuan</strong>
          <div className="pap-inline-actions pap-wrap">
            <button className="pap-btn danger" disabled={busy} onClick={async () => { const a = await askReason({ title: 'Tolak pengajuan GA', label: 'Alasan ditolak', placeholder: 'Mis. stok masih ada, belum ada anggaran', confirmLabel: 'Tolak pengajuan' }); if (a) act({ status: 'ditolak', catatan: a }, 'Pengajuan ditolak, pengaju diberi tahu.') }}>Tolak</button>
            <span className="pap-spacer" />
            <button className="pap-primary-button" disabled={busy} onClick={() => act({ status: 'disetujui' }, 'Pengajuan disetujui, pengaju diberi tahu.')}><CheckCircle2 /> Setujui</button>
          </div>
        </div>
      )}
      {data.can.process && s === 'disetujui' && (
        <div className="pap-inline-panel">
          <strong>Catat pembelian</strong>
          {buy ? (
            <>
              <div className="pap-form-grid">
                <Field label="Dibeli di (toko / penyedia)"><input className="pap-input" value={buy.vendor} onChange={(e) => setBuy({ ...buy, vendor: e.target.value })} /></Field>
                <Field label="Tanggal beli"><input className="pap-input" type="date" value={buy.bought_at} onChange={(e) => setBuy({ ...buy, bought_at: e.target.value })} /></Field>
              </div>
              <p className="pap-muted">Isi harga realisasi per satuan di tabel di atas.</p>
              <div className="pap-inline-actions pap-wrap">
                <button className="pap-btn" disabled={busy} onClick={() => setBuy(null)}>Batal</button>
                <span className="pap-spacer" />
                <button className="pap-primary-button" disabled={busy} onClick={() => act({ status: 'dibeli', vendor: buy.vendor, bought_at: buy.bought_at, realisasi: Object.entries(buy.harga).map(([k, h]) => ({ id: Number(k), harga_realisasi: h === '' ? null : Number(h) })) }, 'Pembelian dicatat, pengaju diberi tahu.')}><ShoppingBag /> Tandai dibeli</button>
              </div>
            </>
          ) : (
            <div className="pap-inline-actions"><button className="pap-primary-button" onClick={() => setBuy({ vendor: '', bought_at: todayIso(), harga: Object.fromEntries(data.items.map((i) => [i.id!, i.harga_estimasi === null ? '' : String(i.harga_estimasi)])) })}><ShoppingBag /> Sudah dibeli...</button></div>
          )}
        </div>
      )}
      {data.can.process && s === 'dibeli' && (
        <div className="pap-inline-panel">
          <strong>Serahkan barang ke pengaju</strong>
          <div className="pap-inline-actions"><button className="pap-primary-button" disabled={busy} onClick={() => act({ status: 'selesai' }, 'Pengajuan selesai.')}><CheckCircle2 /> Tandai selesai (sudah diserahkan)</button></div>
        </div>
      )}
    </Modal>
  )
}
