'use client'

import { useCallback, useEffect, useState } from 'react'
import { AlertCircle, Bell, BellOff, Building2, CheckCircle2, Cloud, Database, ExternalLink, FileSpreadsheet, FolderOpen, KeyRound, Monitor, Moon, Plug, RefreshCw, Server, Sun, UserRound } from 'lucide-react'
import type { UserProfile } from '@/lib/users'
import { subscribePush, unsubscribePush } from './notifications'
import { api, Field, formatDate, Notice, PasswordInput } from './ui'

export type ThemeMode = 'light' | 'dark' | 'system'
type Tab = 'akun' | 'perusahaan' | 'integrasi' | 'sistem'

const isManagement = (user: UserProfile) => user.role.isAdmin || user.division.code === 'general_manager'

// Menu Pengaturan: Akun saya (semua pengguna); Perusahaan & dokumen, Integrasi, Info sistem (Admin / GM)
export function SettingsPage({ user, theme, onTheme, onNavigate }: { user: UserProfile; theme: ThemeMode; onTheme: (mode: ThemeMode) => void; onNavigate: (menu: string) => void }) {
  const admin = isManagement(user)
  const [tab, setTab] = useState<Tab>('akun')
  const tabs: [Tab, string, typeof UserRound][] = [
    ['akun', 'Akun saya', UserRound],
    ...(admin ? ([['perusahaan', 'Perusahaan & dokumen', Building2], ['integrasi', 'Integrasi', Plug], ['sistem', 'Info sistem', Server]] as [Tab, string, typeof UserRound][]) : []),
  ]
  return (
    <>
      <div className="pap-page-heading">
        <div>
          <p className="pap-eyebrow">SISTEM</p>
          <h1>Pengaturan</h1>
          <span>{admin ? 'Akun Anda, profil perusahaan untuk dokumen, sumber data Google Drive & Accurate, dan informasi sistem.' : 'Profil akun, sandi, tampilan, dan notifikasi HP Anda.'}</span>
        </div>
      </div>
      {tabs.length > 1 && (
        <div className="pap-segmented pap-view-switch pap-settings-tabs" role="tablist" aria-label="Bagian pengaturan">
          {tabs.map(([key, label, Icon]) => <button key={key} role="tab" aria-selected={tab === key} className={tab === key ? 'active' : ''} onClick={() => setTab(key)}><Icon /> {label}</button>)}
        </div>
      )}
      {tab === 'akun' && <AccountTab user={user} theme={theme} onTheme={onTheme} />}
      {tab === 'perusahaan' && admin && <CompanyTab />}
      {tab === 'integrasi' && admin && <IntegrationTab onNavigate={onNavigate} />}
      {tab === 'sistem' && admin && <SystemTab />}
    </>
  )
}

// ---------------- Akun saya ----------------
function AccountTab({ user, theme, onTheme }: { user: UserProfile; theme: ThemeMode; onTheme: (mode: ThemeMode) => void }) {
  const initials = user.name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase()
  return (
    <div className="pap-settings-grid">
      <section className="pap-table-card pap-settings-card">
        <div className="pap-card-head"><div><h2>Profil</h2><p>Perubahan nama, email, divisi, atau role dilakukan Staff IT di Manajemen User.</p></div></div>
        <div className="pap-settings-body pap-account-profile">
          <div className="pap-avatar pap-account-avatar">{initials}</div>
          <dl className="pap-detail-grid">
            <div><dt>Nama</dt><dd>{user.name}</dd></div>
            <div><dt>Email</dt><dd>{user.email}</dd></div>
            <div><dt>Role</dt><dd>{user.role.name}</dd></div>
            <div><dt>Divisi</dt><dd>{user.division.name}</dd></div>
          </dl>
        </div>
      </section>
      <PasswordCard />
      <section className="pap-table-card pap-settings-card">
        <div className="pap-card-head"><div><h2>Tampilan</h2><p>Tema tersimpan di perangkat ini.</p></div></div>
        <div className="pap-settings-body">
          <div className="pap-segmented pap-theme-choice" role="radiogroup" aria-label="Tema">
            {([['light', 'Terang', Sun], ['dark', 'Gelap', Moon], ['system', 'Ikuti perangkat', Monitor]] as [ThemeMode, string, typeof Sun][]).map(([key, label, Icon]) => (
              <button key={key} role="radio" aria-checked={theme === key} className={theme === key ? 'active' : ''} onClick={() => onTheme(key)}><Icon /> {label}</button>
            ))}
          </div>
        </div>
      </section>
      <PushCard />
    </div>
  )
}

function PasswordCard() {
  const [v, setV] = useState({ current: '', password: '', confirm: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV({ ...v, [k]: e.target.value })
  async function save(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setMessage('')
    if (v.password.length < 8) return setError('Sandi baru minimal 8 karakter.')
    if (v.password !== v.confirm) return setError('Konfirmasi sandi baru tidak sama.')
    setBusy(true)
    try {
      await api('/api/account/password', { method: 'POST', json: v })
      setV({ current: '', password: '', confirm: '' })
      setMessage('Sandi berhasil diganti. Gunakan sandi baru saat masuk berikutnya.')
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <form className="pap-table-card pap-settings-card" onSubmit={save}>
      <div className="pap-card-head"><div><h2><KeyRound className="pap-inline-icon pap-settings-title-icon" /> Ganti sandi</h2><p>Masukkan sandi lama, lalu sandi baru minimal 8 karakter.</p></div></div>
      <div className="pap-settings-body">
        {error && <Notice onClose={() => setError('')}>{error}</Notice>}
        {message && <Notice kind="success" onClose={() => setMessage('')}>{message}</Notice>}
        <div className="pap-form-grid">
          <Field label="Sandi lama" full><PasswordInput autoComplete="current-password" value={v.current} onChange={set('current')} required /></Field>
          <Field label="Sandi baru"><PasswordInput autoComplete="new-password" value={v.password} onChange={set('password')} required minLength={8} /></Field>
          <Field label="Ulangi sandi baru"><PasswordInput autoComplete="new-password" value={v.confirm} onChange={set('confirm')} required minLength={8} /></Field>
        </div>
        <p className="pap-muted pap-settings-note">Lupa sandi? Sandi tidak bisa direset sendiri. <a href="/lupa-password" target="_blank" rel="noreferrer">Hubungi Staff IT</a>.</p>
      </div>
      <div className="pap-settings-foot"><button className="pap-primary-button" disabled={busy || !v.current || !v.password || !v.confirm}>{busy ? 'Menyimpan...' : 'Ganti sandi'}</button></div>
    </form>
  )
}

function PushCard() {
  const supported = typeof window !== 'undefined' && 'Notification' in window && 'serviceWorker' in navigator && 'PushManager' in window
  const [state, setState] = useState<'loading' | 'on' | 'off' | 'blocked' | 'unsupported'>('loading')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const check = useCallback(async () => {
    if (!supported) return setState('unsupported')
    if (Notification.permission === 'denied') return setState('blocked')
    const reg = await navigator.serviceWorker.getRegistration().catch(() => undefined)
    const sub = await reg?.pushManager.getSubscription().catch(() => null)
    setState(sub && Notification.permission === 'granted' ? 'on' : 'off')
  }, [supported])
  useEffect(() => { check() }, [check])
  async function enable() {
    setBusy(true)
    setError('')
    try {
      if (Notification.permission !== 'granted' && (await Notification.requestPermission()) !== 'granted') return check()
      await subscribePush()
      await check()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  async function disable() {
    setBusy(true)
    await unsubscribePush()
    await check()
    setBusy(false)
  }
  const ios = typeof navigator !== 'undefined' && /iphone|ipad|ipod/i.test(navigator.userAgent)
  return (
    <section className="pap-table-card pap-settings-card">
      <div className="pap-card-head"><div><h2>Notifikasi HP</h2><p>Pop-up notifikasi di perangkat ini walau aplikasi ditutup.</p></div></div>
      <div className="pap-settings-body">
        {error && <Notice onClose={() => setError('')}>{error}</Notice>}
        <p className="pap-settings-status">
          {state === 'on' && <><CheckCircle2 className="pap-ok-icon" /> Aktif di perangkat ini</>}
          {state === 'off' && <><BellOff /> Belum aktif di perangkat ini</>}
          {state === 'blocked' && <><AlertCircle className="pap-text-danger" /> Diblokir di pengaturan browser. Izinkan notifikasi untuk situs ini, lalu muat ulang.</>}
          {state === 'unsupported' && <><AlertCircle /> Browser ini tidak mendukung notifikasi{ios ? ' (di iPhone, buka aplikasi dari ikon Home Screen)' : ''}.</>}
          {state === 'loading' && 'Memeriksa...'}
        </p>
      </div>
      <div className="pap-settings-foot">
        {state === 'off' && <button className="pap-primary-button" disabled={busy} onClick={enable}><Bell /> Aktifkan notifikasi</button>}
        {state === 'on' && <button className="pap-btn" disabled={busy} onClick={disable}><BellOff /> Matikan di perangkat ini</button>}
      </div>
    </section>
  )
}

// ---------------- Perusahaan & dokumen ----------------
const DOC_FIELDS: [string, string, 'input' | 'area', string?, boolean?][] = [
  ['nama', 'Nama perusahaan', 'input'],
  ['email', 'Email', 'input'],
  ['alamat', 'Alamat', 'area', '', true],
  ['telepon', 'Telepon / WA (satu per baris, bisa dipilih di penawaran)', 'area', '+62895-3269-45000 (Laundry)'],
  ['penandatangan', 'Penandatangan (nama & jabatan)', 'input', 'Kosongkan = nama sales pembuat'],
  ['rekening', 'Rekening pembayaran (satu per baris, jadi pilihan di penawaran)', 'area', 'Satu rekening per baris', true],
  ['syarat', 'Syarat & ketentuan default penawaran', 'area', '', true],
]

function CompanyTab() {
  const [values, setValues] = useState<Record<string, string> | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  useEffect(() => { api<{ doc: Record<string, string> }>('/api/settings/company').then((r) => setValues(r.doc)).catch((e) => setError(e.message)) }, [])
  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (!values) return
    setBusy(true)
    setError('')
    try {
      const res = await api<{ doc: Record<string, string> }>('/api/settings/company', { method: 'PATCH', json: values })
      setValues(res.doc)
      setMessage('Profil perusahaan & data dokumen disimpan.')
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <form className="pap-table-card pap-settings-card" onSubmit={save}>
      <div className="pap-card-head"><div><h2>Profil perusahaan & dokumen</h2><p>Dipakai di kop surat penawaran, surat order, proforma, SO, dan semua halaman cetak (PDF & Word).</p></div></div>
      <div className="pap-settings-body">
        {error && <Notice onClose={() => setError('')}>{error}</Notice>}
        {message && <Notice kind="success" onClose={() => setMessage('')}>{message}</Notice>}
        {!values ? <p className="pap-muted">{error ? '' : 'Memuat...'}</p> : (
          <div className="pap-form-grid">
            {DOC_FIELDS.map(([key, label, kind, placeholder, full]) => (
              <Field key={key} label={label} full={full}>
                {kind === 'area'
                  ? <textarea className="pap-input" rows={key === 'alamat' ? 2 : 4} value={values[key] ?? ''} placeholder={placeholder} onChange={(e) => setValues({ ...values, [key]: e.target.value })} />
                  : <input className="pap-input" value={values[key] ?? ''} placeholder={placeholder} onChange={(e) => setValues({ ...values, [key]: e.target.value })} />}
              </Field>
            ))}
          </div>
        )}
      </div>
      <div className="pap-settings-foot"><button className="pap-primary-button" disabled={busy || !values}>{busy ? 'Menyimpan...' : 'Simpan'}</button></div>
    </form>
  )
}

// ---------------- Integrasi & Info sistem ----------------
type Source = { key: string; label: string; menu: string; jenis: 'sheet' | 'folder'; sync: string | null; url: string | null; synced_at: string | null }
type SystemData = {
  sources: Source[]
  drive: { email: string; mode: string; connected_at: string | null; connected_by: string | null } | null
  accurate: { enabled: boolean; status: { entity: string; last_success: string | null; status: string; message: string | null }[] }
  info: { user_aktif: number; user_total: number; role: number; divisi: number; migrasi: number; migrasi_terakhir: string | null; migrasi_at: string | null; waktu_db: string; zona_db: string; versi: string | null; lingkungan: string | null }
  config: { label: string; ok: boolean }[]
}

function useSystemData() {
  const [data, setData] = useState<SystemData | null>(null)
  const [error, setError] = useState('')
  const load = useCallback(() => { api<SystemData>('/api/settings/system').then(setData).catch((e) => setError(e.message)) }, [])
  useEffect(() => { load() }, [load])
  return { data, error, setError, load }
}

function IntegrationTab({ onNavigate }: { onNavigate: (menu: string) => void }) {
  const { data, error, setError, load } = useSystemData()
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  async function sync(s: Source) {
    if (!s.sync) return
    setBusy(s.key)
    setError('')
    setMessage('')
    try {
      await api(s.sync, { method: 'POST' })
      setMessage(`${s.label}: sinkron selesai.`)
      load()
    } catch (e) {
      setError(`${s.label}: ${(e as Error).message}`)
    } finally {
      setBusy(null)
    }
  }
  const failed = data?.accurate.status.filter((s) => s.status === 'gagal') ?? []
  const lastAccurate = data?.accurate.status.map((s) => s.last_success).filter(Boolean).sort().at(-1) ?? null
  return (
    <>
      {error && <Notice onClose={() => setError('')}>{error}</Notice>}
      {message && <Notice kind="success" onClose={() => setMessage('')}>{message}</Notice>}
      <div className="pap-settings-grid">
        <section className="pap-table-card pap-settings-card">
          <div className="pap-card-head"><div><h2><Cloud className="pap-inline-icon pap-settings-title-icon" /> Google Drive</h2><p>Akun yang membaca spreadsheet & folder di bawah (diatur di Master Data &gt; Logo & Desain).</p></div></div>
          <div className="pap-settings-body">
            {!data ? <p className="pap-muted">Memuat...</p> : data.drive ? (
              <p className="pap-settings-status"><CheckCircle2 className="pap-ok-icon" /> Terhubung: <b>{data.drive.email}</b>{data.drive.mode === 'service' ? ' (service account)' : ''}{data.drive.connected_at ? ` · sejak ${formatDate(data.drive.connected_at, true)}` : ''}</p>
            ) : <p className="pap-settings-status"><AlertCircle className="pap-text-danger" /> Belum terhubung. Sinkron dari Google Drive tidak berjalan.</p>}
          </div>
          <div className="pap-settings-foot"><button type="button" className="pap-btn" onClick={() => onNavigate('Master Data')}>Kelola di Master Data</button></div>
        </section>
        <section className="pap-table-card pap-settings-card">
          <div className="pap-card-head"><div><h2><Database className="pap-inline-icon pap-settings-title-icon" /> Accurate Online</h2><p>Customer, faktur, SO, stok, produksi, purchasing (sinkron otomatis tiap ±15 menit).</p></div></div>
          <div className="pap-settings-body">
            {!data ? <p className="pap-muted">Memuat...</p> : !data.accurate.enabled ? (
              <p className="pap-settings-status"><AlertCircle className="pap-text-danger" /> Belum dikonfigurasi (ACCURATE_API_TOKEN di server).</p>
            ) : (
              <>
                <p className="pap-settings-status">{failed.length ? <><AlertCircle className="pap-text-danger" /> {failed.length} data gagal sinkron</> : <><CheckCircle2 className="pap-ok-icon" /> Semua data sinkron normal</>}{lastAccurate ? ` · terakhir ${formatDate(lastAccurate, true)}` : ''}</p>
                {failed.map((f) => <p key={f.entity} className="pap-muted pap-settings-note">{f.entity}: {f.message ?? 'gagal'}</p>)}
              </>
            )}
          </div>
        </section>
      </div>
      <section className="pap-table-card">
        <div className="pap-card-head"><div><h2>Sumber data Google Drive</h2><p>Spreadsheet & folder yang dibaca tiap modul. Link diganti dari menu masing-masing; sinkron otomatis tiap ±30 menit.</p></div><button type="button" className="pap-btn" onClick={load}><RefreshCw /> Muat ulang</button></div>
        <div className="pap-table-wrap">
          <table>
            <thead><tr><th>Sumber</th><th>Menu</th><th>Sinkron terakhir</th><th>Link</th><th aria-label="Aksi" /></tr></thead>
            <tbody>
              {(data?.sources ?? []).map((s) => (
                <tr key={s.key}>
                  <td><div className="pap-cell-title">{s.jenis === 'folder' ? <FolderOpen className="pap-inline-icon" /> : <FileSpreadsheet className="pap-inline-icon" />} {s.label}</div><div className="pap-cell-sub">{s.jenis === 'folder' ? 'Folder Drive' : 'Spreadsheet'}</div></td>
                  <td><button type="button" className="pap-link-button" onClick={() => onNavigate(s.menu)}>{s.menu}</button></td>
                  <td className="pap-nowrap">{s.synced_at ? formatDate(s.synced_at, true) : <span className="pap-muted">—</span>}</td>
                  <td>{s.url ? <a href={s.url} target="_blank" rel="noreferrer" className="pap-nowrap">Buka <ExternalLink className="pap-inline-icon" /></a> : <span className="pap-muted">Belum diatur</span>}</td>
                  <td className="pap-nowrap">{s.sync && s.url && <button type="button" className="pap-btn" disabled={busy !== null} onClick={() => sync(s)}><RefreshCw className={busy === s.key ? 'pap-spin' : ''} /> {busy === s.key ? 'Sinkron...' : 'Sinkron'}</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!data && !error && <div className="pap-empty">Memuat...</div>}
        </div>
      </section>
    </>
  )
}

function SystemTab() {
  const { data, error, setError } = useSystemData()
  const i = data?.info
  return (
    <>
      {error && <Notice onClose={() => setError('')}>{error}</Notice>}
      <div className="pap-stat-grid four">
        {([
          ['Pengguna aktif', i ? `${i.user_aktif}` : '—', i ? `dari ${i.user_total} akun` : ''],
          ['Role & divisi', i ? `${i.role} · ${i.divisi}` : '—', 'role · divisi'],
          ['Migrasi database', i ? `${i.migrasi}` : '—', i?.migrasi_terakhir ?? ''],
          ['Versi aplikasi', i?.versi ?? 'lokal', i?.lingkungan ?? ''],
        ] as [string, string, string][]).map(([label, value, note]) => (
          <div key={label} className="pap-stat-card"><div><span>{label}</span><strong className="pap-stat-text">{value}</strong><small className="neutral">{note}</small></div></div>
        ))}
      </div>
      <div className="pap-settings-grid">
        <section className="pap-table-card pap-settings-card">
          <div className="pap-card-head"><div><h2>Database</h2><p>MySQL Hostinger</p></div></div>
          <div className="pap-settings-body">
            <dl className="pap-detail-grid">
              <div><dt>Waktu server DB</dt><dd>{i ? formatDate(i.waktu_db, true) : '—'}</dd></div>
              <div><dt>Zona waktu</dt><dd>{i?.zona_db ?? '—'}</dd></div>
              <div><dt>Migrasi terakhir</dt><dd>{i?.migrasi_terakhir ?? '—'}</dd></div>
              <div><dt>Dipasang</dt><dd>{i?.migrasi_at ? formatDate(i.migrasi_at, true) : '—'}</dd></div>
            </dl>
          </div>
        </section>
        <section className="pap-table-card pap-settings-card">
          <div className="pap-card-head"><div><h2>Konfigurasi server</h2><p>Hanya status terisi/tidak; nilai rahasia tidak ditampilkan.</p></div></div>
          <div className="pap-settings-body">
            <ul className="pap-config-list">
              {(data?.config ?? []).map((c) => <li key={c.label}>{c.ok ? <CheckCircle2 className="pap-ok-icon" /> : <AlertCircle className="pap-text-danger" />}<span>{c.label}</span><b>{c.ok ? 'Aktif' : 'Belum diisi'}</b></li>)}
            </ul>
          </div>
        </section>
      </div>
    </>
  )
}
