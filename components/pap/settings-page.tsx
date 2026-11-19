'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Activity, AlertCircle, Bell, BellOff, Building2, Camera, CheckCircle2, Clock, Cloud, Copy, Cpu, Database, ExternalLink, FileSpreadsheet, FolderOpen, HardDrive, KeyRound, Monitor, Moon, Play, Plug, RefreshCw, Server, ShieldCheck, Sun, Trash2, UserRound, Wrench } from 'lucide-react'
import { menuName } from '@/lib/menus'
import type { UserProfile } from '@/lib/users'
import { avatarImage } from './compress'
import { subscribePush, unsubscribePush } from './notifications'
import { api, Field, formatDate, Notice, PasswordInput } from './ui'

export type ThemeMode = 'light' | 'dark' | 'system'
type Tab = 'akun' | 'perusahaan' | 'integrasi' | 'sistem' | 'it'

const isManagement = (user: UserProfile) => user.role.isAdmin || user.division.code === 'general_manager'
// Tab IT: Super Admin / admin & divisi Staff IT
const canSeeIt = (user: UserProfile) => user.role.isAdmin || user.division.code === 'staff_it'

// Menu Pengaturan: Akun saya (semua pengguna); Perusahaan & dokumen, Integrasi, Info sistem (Admin / GM)
export function SettingsPage({ user, theme, onTheme, onNavigate, onProfileChanged }: { user: UserProfile; theme: ThemeMode; onTheme: (mode: ThemeMode) => void; onNavigate: (menu: string) => void; onProfileChanged?: () => void }) {
  const admin = isManagement(user)
  const it = canSeeIt(user)
  const [tab, setTab] = useState<Tab>('akun')
  const tabs: [Tab, string, typeof UserRound][] = [
    ['akun', 'Akun saya', UserRound],
    ...(admin ? ([['perusahaan', 'Perusahaan & dokumen', Building2], ['integrasi', 'Integrasi', Plug], ['sistem', 'Info sistem', Server]] as [Tab, string, typeof UserRound][]) : []),
    ...(it ? ([['it', 'IT', Wrench]] as [Tab, string, typeof UserRound][]) : []),
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
      {tab === 'akun' && <AccountTab user={user} theme={theme} onTheme={onTheme} onProfileChanged={onProfileChanged} />}
      {tab === 'perusahaan' && admin && <CompanyTab />}
      {tab === 'integrasi' && admin && <IntegrationTab onNavigate={onNavigate} />}
      {tab === 'sistem' && admin && <SystemTab />}
      {tab === 'it' && it && <ItTab />}
    </>
  )
}

// ---------------- Akun saya ----------------
function AccountTab({ user, theme, onTheme, onProfileChanged }: { user: UserProfile; theme: ThemeMode; onTheme: (mode: ThemeMode) => void; onProfileChanged?: () => void }) {
  const initials = user.name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase()
  const photoInput = useRef<HTMLInputElement>(null)
  const [photoBusy, setPhotoBusy] = useState(false)
  const [photoError, setPhotoError] = useState('')
  // Semua user boleh mengganti foto profilnya sendiri
  async function changePhoto(file: File | undefined, remove = false) {
    if (!file && !remove) return
    setPhotoBusy(true)
    setPhotoError('')
    try {
      if (remove) await api('/api/account/avatar', { method: 'DELETE' })
      else {
        const body = new FormData()
        body.set('file', await avatarImage(file!))
        await api('/api/account/avatar', { method: 'POST', body })
      }
      onProfileChanged?.()
    } catch (e) {
      setPhotoError((e as Error).message)
    } finally {
      setPhotoBusy(false)
    }
  }
  return (
    <div className="pap-settings-grid">
      <section className="pap-table-card pap-settings-card">
        <div className="pap-card-head"><div><h2>Profil</h2><p>Perubahan nama, email, divisi, atau role dilakukan Staff IT di Manajemen User.</p></div></div>
        {photoError && <Notice onClose={() => setPhotoError('')}>{photoError}</Notice>}
        <div className="pap-settings-body pap-account-profile">
          <div className="pap-account-photo">
            <div className="pap-avatar pap-account-avatar">{user.avatar ? <img src={`/api/account/avatar/${user.id}?v=${user.avatar}`} alt={`Foto profil ${user.name}`} /> : initials}</div>
            <input ref={photoInput} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => { changePhoto(e.target.files?.[0]); e.target.value = '' }} />
            <button type="button" className="pap-btn" disabled={photoBusy} onClick={() => photoInput.current?.click()}><Camera /> {photoBusy ? 'Menyimpan...' : user.avatar ? 'Ganti foto' : 'Unggah foto'}</button>
            {user.avatar && <button type="button" className="pap-btn danger" disabled={photoBusy} onClick={() => changePhoto(undefined, true)}><Trash2 /> Hapus foto</button>}
          </div>
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
                  <td><button type="button" className="pap-link-button" onClick={() => onNavigate(s.menu)}>{menuName(s.menu)}</button></td>
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

// ---------------- IT: server, cron, Google Cloud, reCAPTCHA ----------------
type CronRun = { at: string; ok: boolean; status: number; ms: number; detail: string | null; manual?: boolean }
type CronItem = { name: string; label: string; every: number; note: string; url: string; health: 'ok' | 'stale' | 'error' | 'unknown'; last: CronRun | null; history?: CronRun[] }
// Waktu ISO (UTC) -> tanggal & jam WIB, mis. "19 Nov 2026 10:44"
const wibDateTime = (iso: string) => new Date(iso).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).replace(/\./g, ':')
type ItData = {
  url: string
  server: { host: string; platform: string; node: string; versi: string | null; lingkungan: string | null; uptime: number; app_uptime: number; cpus: number; load: number[]; mem_total: number; mem_free: number; app_rss: number; app_heap: number; disk: { total: number; free: number } | null; network: { rx: number; tx: number } | null }
  database: { versi: string; ukuran: number; tabel: number }
  crons: CronItem[]
  cron_secret: boolean
  google: { oauth: boolean; service_account: { email: string | null; project: string | null } | null; drive: { mode: string; email: string } | null; project: string | null }
  recaptcha: { mode: 'v2' | 'v3' | null; min_score: number | null }
  accurate: boolean
  ai?: { provider: string; label: string; model: string; configured: boolean; source: 'env' | 'pengaturan' | null }[]
}
const bytes = (n: number | null | undefined) => {
  if (n === null || n === undefined) return '—'
  const u = ['B', 'KB', 'MB', 'GB', 'TB']
  let v = n
  let i = 0
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++ }
  return `${v.toLocaleString('id-ID', { maximumFractionDigits: v < 10 ? 1 : 0 })} ${u[i]}`
}
const durasi = (sec: number) => {
  const d = Math.floor(sec / 86400)
  const h = Math.floor((sec % 86400) / 3600)
  const m = Math.floor((sec % 3600) / 60)
  return d ? `${d} hari ${h} jam` : h ? `${h} jam ${m} menit` : `${m} menit`
}
const sejak = (iso: string) => {
  const min = Math.round((Date.now() - Date.parse(iso)) / 60000)
  return min < 1 ? 'baru saja' : min < 60 ? `${min} menit lalu` : min < 1440 ? `${Math.round(min / 60)} jam lalu` : `${Math.round(min / 1440)} hari lalu`
}
const HEALTH: Record<CronItem['health'], [string, string]> = { ok: ['success', 'Normal'], stale: ['warning', 'Terlambat'], error: ['danger', 'Gagal'], unknown: ['neutral', 'Belum tercatat'] }
const pct = (used: number, total: number) => (total ? Math.round((used / total) * 100) : 0)

function ItLinks({ links }: { links: [string, string][] }) {
  return <div className="pap-it-links">{links.map(([label, href]) => <a key={href} className="pap-btn" href={href} target="_blank" rel="noreferrer"><ExternalLink /> {label}</a>)}</div>
}

function ItTab() {
  const [data, setData] = useState<ItData | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null)
  const load = useCallback(() => { api<ItData>('/api/settings/it').then(setData).catch((e) => setError(e.message)) }, [])
  useEffect(() => { load() }, [load])

  async function act(key: string, json: Record<string, string>) {
    setBusy(key)
    setResult(null)
    try {
      setResult(await api<{ ok: boolean; message: string }>('/api/settings/it', { method: 'POST', json }))
      load()
    } catch (e) {
      setResult({ ok: false, message: (e as Error).message })
    } finally {
      setBusy('')
    }
  }
  const copy = (text: string) => { navigator.clipboard?.writeText(text).then(() => setResult({ ok: true, message: `Disalin: ${text}` })).catch(() => {}) }

  const sv = data?.server
  const memUsed = sv ? sv.mem_total - sv.mem_free : 0
  const diskUsed = sv?.disk ? sv.disk.total - sv.disk.free : 0
  const project = data?.google.project
  const gcp = (path: string) => `https://console.cloud.google.com/${path}${project ? `${path.includes('?') ? '&' : '?'}project=${encodeURIComponent(project)}` : ''}`
  const testBtn = (key: string, label: string, target: string) => (
    <button type="button" className="pap-btn" disabled={!!busy} onClick={() => act(key, { action: 'test', target })}>{busy === key ? <RefreshCw className="pap-spin" /> : <ShieldCheck />} {busy === key ? 'Menguji...' : label}</button>
  )

  return (
    <>
      {error && <Notice onClose={() => setError('')}>{error}</Notice>}
      {result && <Notice kind={result.ok ? 'success' : 'error'} onClose={() => setResult(null)}>{result.message}</Notice>}
      <div className="pap-stat-grid four">
        {([
          ['Memori server', sv ? `${pct(memUsed, sv.mem_total)}%` : '—', sv ? `${bytes(memUsed)} dari ${bytes(sv.mem_total)} terpakai` : '', Cpu],
          ['Disk', sv?.disk ? `${pct(diskUsed, sv.disk.total)}%` : '—', sv?.disk ? `${bytes(diskUsed)} dari ${bytes(sv.disk.total)}` : 'tidak terbaca', HardDrive],
          ['Data transfer', sv?.network ? bytes(sv.network.rx + sv.network.tx) : '—', sv?.network ? `↓ ${bytes(sv.network.rx)} · ↑ ${bytes(sv.network.tx)} sejak server menyala` : 'tidak terbaca', Activity],
          ['Server menyala', sv ? durasi(sv.uptime) : '—', sv ? `aplikasi ${durasi(sv.app_uptime)} · beban ${sv.load[0]}` : '', Clock],
        ] as [string, string, string, typeof Cpu][]).map(([label, value, note, Icon]) => (
          <div key={label} className="pap-stat-card"><div><span>{label}</span><strong className="pap-stat-text">{value}</strong><small className="neutral">{note}</small></div><div className="pap-stat-icon stat-1"><Icon /></div></div>
        ))}
      </div>

      <div className="pap-settings-grid pap-it-grid">
        <section className="pap-table-card pap-settings-card">
          <div className="pap-card-head"><div><h2>Server Hostinger (VPS)</h2><p>Sumber daya server tempat SIMPAP berjalan.</p></div><button type="button" className="pap-icon-button" onClick={load} aria-label="Muat ulang" title="Muat ulang"><RefreshCw /></button></div>
          <div className="pap-settings-body">
            <dl className="pap-detail-grid">
              <div><dt>Host</dt><dd>{sv?.host ?? '—'}</dd></div>
              <div><dt>Sistem operasi</dt><dd>{sv?.platform ?? '—'}</dd></div>
              <div><dt>CPU · beban 1/5/15 mnt</dt><dd>{sv ? `${sv.cpus} core · ${sv.load.join(' / ')}` : '—'}</dd></div>
              <div><dt>Memori aplikasi</dt><dd>{sv ? `${bytes(sv.app_rss)} (heap ${bytes(sv.app_heap)})` : '—'}</dd></div>
              <div><dt>Node.js · versi aplikasi</dt><dd>{sv ? `${sv.node} · ${sv.versi ?? 'lokal'}` : '—'}</dd></div>
              <div><dt>Database</dt><dd>{data ? `MariaDB ${data.database.versi.split('-')[0]} · ${bytes(data.database.ukuran)} · ${data.database.tabel} tabel` : '—'}</dd></div>
            </dl>
            <p className="pap-muted pap-it-note">Kuota data transfer bulanan & tagihan VPS dilihat di hPanel Hostinger; angka di atas dihitung sejak server terakhir menyala.</p>
            <div className="pap-it-links">
              {testBtn('db', 'Tes database', 'database')}
              <a className="pap-btn" href="https://hpanel.hostinger.com/vps" target="_blank" rel="noreferrer"><ExternalLink /> hPanel VPS</a>
              <a className="pap-btn" href="https://hpanel.hostinger.com/domains" target="_blank" rel="noreferrer"><ExternalLink /> Domain & DNS</a>
              {data && <a className="pap-btn" href={data.url} target="_blank" rel="noreferrer"><ExternalLink /> Buka situs</a>}
            </div>
          </div>
        </section>

        <section className="pap-table-card pap-settings-card">
          <div className="pap-card-head"><div><h2>Cronjob</h2><p>Dipanggil otomatis oleh cron-job.org. Status dari panggilan terakhir.</p></div></div>
          <div className="pap-settings-body">
            {data && !data.cron_secret && <Notice>CRON_SECRET belum diisi di server; semua cron akan ditolak.</Notice>}
            <ul className="pap-it-crons">
              {(data?.crons ?? []).map((c) => {
                const [tone, text] = HEALTH[c.health]
                return (
                  <li key={c.name}>
                    <div className="pap-it-cron-head">
                      <strong>{c.label}</strong>
                      <span className={`pap-status ${tone}`}>{text}</span>
                    </div>
                    <small className="pap-muted">{c.note}</small>
                    <small>{c.last ? <>Terakhir {sejak(c.last.at)} ({wibDateTime(c.last.at)}) · HTTP {c.last.status} · {(c.last.ms / 1000).toFixed(1)} dtk{c.last.manual ? ' · manual' : ''}{c.last.detail ? <> · <span className={c.last.ok ? '' : 'pap-text-danger'}>{c.last.detail}</span></> : null}</> : 'Belum ada panggilan tercatat sejak fitur ini dipasang.'}</small>
                    {c.last?.status === 401 && <small className="pap-text-danger">Ditolak 401: kunci di cron-job.org tidak sama dengan CRON_SECRET di server.</small>}
                    {!!c.history?.length && (
                      <details className="pap-it-history">
                        <summary>Riwayat {c.history.length} panggilan terakhir</summary>
                        <ul>
                          {c.history.map((h, i) => (
                            <li key={i}>
                              <span className={`pap-status ${h.ok ? 'success' : 'danger'}`}>{h.ok ? 'OK' : 'Gagal'}</span>
                              <span>{wibDateTime(h.at)}</span>
                              <span className="pap-muted">HTTP {h.status} · {(h.ms / 1000).toFixed(1)} dtk{h.manual ? ' · manual' : ''}</span>
                              {h.detail && <span className={h.ok ? 'pap-muted' : 'pap-text-danger'}>{h.detail}</span>}
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
                    <div className="pap-it-cron-actions">
                      <code title={c.url}>{c.url}</code>
                      <button type="button" className="pap-icon-button" onClick={() => copy(c.url)} aria-label="Salin URL" title="Salin URL"><Copy /></button>
                      <button type="button" className="pap-btn" disabled={!!busy} onClick={() => act(`cron-${c.name}`, { action: 'cron', name: c.name })}>{busy === `cron-${c.name}` ? <RefreshCw className="pap-spin" /> : <Play />} {busy === `cron-${c.name}` ? 'Menjalankan...' : 'Jalankan sekarang'}</button>
                    </div>
                  </li>
                )
              })}
              {!data && !error && <li className="pap-muted">Memuat...</li>}
            </ul>
            <p className="pap-muted pap-it-note">Di cron-job.org pakai URL di atas (bukan alamat lama Vercel / domain yang dialihkan) dan header <code>Authorization: Bearer &lt;CRON_SECRET&gt;</code>.</p>
            <ItLinks links={[['Dashboard cron-job.org', 'https://console.cron-job.org/jobs']]} />
          </div>
        </section>

        <section className="pap-table-card pap-settings-card">
          <div className="pap-card-head"><div><h2>Google Cloud</h2><p>Akses Google Drive, Sheets & login Google.</p></div></div>
          <div className="pap-settings-body">
            <ul className="pap-config-list">
              <li>{data?.google.drive ? <CheckCircle2 className="pap-ok-icon" /> : <AlertCircle className="pap-text-danger" />}<span>Akun Drive yang dipakai</span><b>{data?.google.drive ? `${data.google.drive.email} (${data.google.drive.mode === 'oauth' ? 'akun Google' : 'service account'})` : 'Belum terhubung'}</b></li>
              <li>{data?.google.oauth ? <CheckCircle2 className="pap-ok-icon" /> : <AlertCircle className="pap-text-danger" />}<span>OAuth client</span><b>{data?.google.oauth ? 'Aktif' : 'Belum diisi'}</b></li>
              <li>{data?.google.service_account ? <CheckCircle2 className="pap-ok-icon" /> : <AlertCircle className="pap-text-muted" />}<span>Service account</span><b>{data?.google.service_account?.email ?? 'Tidak dipakai'}</b></li>
              <li><Cloud className="pap-text-muted" /><span>Project</span><b>{project ?? '—'}</b></li>
            </ul>
            <div className="pap-it-links">
              {testBtn('google', 'Tes koneksi Google', 'google')}
              <a className="pap-btn" href={gcp('apis/dashboard')} target="_blank" rel="noreferrer"><ExternalLink /> API & kuota</a>
              <a className="pap-btn" href={gcp('apis/credentials')} target="_blank" rel="noreferrer"><ExternalLink /> Kredensial</a>
              <a className="pap-btn" href={gcp('apis/library/sheets.googleapis.com')} target="_blank" rel="noreferrer"><ExternalLink /> Sheets API</a>
              <a className="pap-btn" href={gcp('apis/library/drive.googleapis.com')} target="_blank" rel="noreferrer"><ExternalLink /> Drive API</a>
              <a className="pap-btn" href={gcp('billing')} target="_blank" rel="noreferrer"><ExternalLink /> Billing</a>
            </div>
          </div>
        </section>

        <section className="pap-table-card pap-settings-card">
          <div className="pap-card-head"><div><h2>PAP AI</h2><p>Model dipilih otomatis: analisis data ke Claude, pertanyaan ringan ke Gemini; bila satu gagal, pindah ke yang lain.</p></div></div>
          <div className="pap-settings-body">
            <ul className="pap-it-ai">
              {(data?.ai ?? []).map((a) => <AiProviderRow key={a.provider} info={a} busy={busy} onAct={act} />)}
            </ul>
            <p className="pap-muted pap-it-note">Kunci API disimpan terenkripsi di server dan tidak pernah ditampilkan lagi. Biaya dihitung per pemakaian oleh masing-masing penyedia.</p>
            <ItLinks links={[['Kunci Claude (Anthropic)', 'https://console.anthropic.com/settings/keys'], ['Kunci ChatGPT (OpenAI)', 'https://platform.openai.com/api-keys'], ['Kunci Gemini (Google)', 'https://aistudio.google.com/app/apikey']]} />
          </div>
        </section>

        <section className="pap-table-card pap-settings-card">
          <div className="pap-card-head"><div><h2>reCAPTCHA login</h2><p>Perlindungan halaman login dari bot.</p></div></div>
          <div className="pap-settings-body">
            <ul className="pap-config-list">
              <li>{data?.recaptcha.mode ? <CheckCircle2 className="pap-ok-icon" /> : <AlertCircle className="pap-text-danger" />}<span>Status</span><b>{data ? (data.recaptcha.mode === 'v2' ? 'Aktif · v2 (kotak "I\'m not a robot")' : data.recaptcha.mode === 'v3' ? `Aktif · v3 (skor min. ${data.recaptcha.min_score})` : 'Nonaktif') : '—'}</b></li>
              <li><KeyRound className="pap-text-muted" /><span>Domain terdaftar harus mencakup</span><b>{data ? new URL(data.url).hostname : '—'}</b></li>
            </ul>
            <div className="pap-it-links">
              {testBtn('recaptcha', 'Tes kunci reCAPTCHA', 'recaptcha')}
              <a className="pap-btn" href="https://www.google.com/recaptcha/admin" target="_blank" rel="noreferrer"><ExternalLink /> Konsol reCAPTCHA</a>
            </div>
          </div>
        </section>
      </div>
    </>
  )
}

// Satu baris penyedia AI: status, kunci (isi / hapus), model, tes koneksi
function AiProviderRow({ info, busy, onAct }: { info: NonNullable<ItData['ai']>[number]; busy: string; onAct: (key: string, json: Record<string, string>) => Promise<void> }) {
  const [editing, setEditing] = useState(false)
  const [key, setKey] = useState('')
  const [model, setModel] = useState(info.model)
  const id = `ai-${info.provider}`
  async function save(clear = false) {
    await onAct(`${id}-save`, { action: 'ai', provider: info.provider, ...(clear ? { key: '' } : key ? { key } : {}), model })
    setKey('')
    setEditing(false)
  }
  return (
    <li>
      <div className="pap-it-ai-head">
        {info.configured ? <CheckCircle2 className="pap-ok-icon" /> : <AlertCircle className="pap-text-muted" />}
        <strong>{info.label}</strong>
        <span className="pap-muted">{info.model}</span>
        <span className={`pap-status ${info.configured ? 'success' : 'neutral'}`}>{info.configured ? (info.source === 'env' ? 'Aktif (server)' : 'Aktif') : 'Belum diisi'}</span>
      </div>
      {editing ? (
        <div className="pap-it-ai-form">
          {info.source !== 'env' && <input className="pap-input" type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} placeholder={info.configured ? 'Kunci baru (kosongkan bila tetap)' : 'Tempel kunci API'} aria-label={`Kunci API ${info.label}`} />}
          <input className="pap-input" value={model} onChange={(e) => setModel(e.target.value)} placeholder="Nama model" aria-label={`Model ${info.label}`} />
          <div className="pap-inline-actions">
            <button type="button" className="pap-btn" onClick={() => setEditing(false)}>Batal</button>
            {info.configured && info.source !== 'env' && <button type="button" className="pap-btn danger" disabled={!!busy} onClick={() => save(true)}>Hapus kunci</button>}
            <button type="button" className="pap-primary-button" disabled={!!busy} onClick={() => save()}>Simpan</button>
          </div>
        </div>
      ) : (
        <div className="pap-inline-actions">
          <button type="button" className="pap-btn" onClick={() => setEditing(true)}><KeyRound /> {info.configured ? 'Ubah' : 'Isi kunci'}</button>
          {info.configured && <button type="button" className="pap-btn" disabled={!!busy} onClick={() => onAct(id, { action: 'test', target: id })}>{busy === id ? <RefreshCw className="pap-spin" /> : <ShieldCheck />} Tes</button>}
        </div>
      )}
    </li>
  )
}
