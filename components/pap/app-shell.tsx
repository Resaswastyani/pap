'use client'

import { useEffect, useRef, useState } from 'react'
import { MENU_KEYS } from '@/lib/menus'
import type { UserProfile } from '@/lib/users'
import { CustomerPage } from './customer-page'
import { MachinePage } from './machine-page'
import { HppPage } from './hpp-page'
import { MasterDataPage } from './master-data-page'
import { QuotationPage } from './quotation-page'
import { RepeatOrderPage } from './repeat-order-page'
import { MeetingPage } from './meeting-page'
import { NotificationCenter, unsubscribePush, type NotificationTarget } from './notifications'
import { PlanningPage } from './planning-page'
import { ProductPage } from './product-page'
import { ProductionPage } from './production-page'
import { ProspectPage } from './prospect-page'
import { DesignPage, SamplePage } from './request-page'
import { getCaptchaConfig, getRecaptchaToken, loadRecaptcha, primeCaptchaConfig } from './recaptcha'
import { RolesPage } from './roles-page'
import { StockPage } from './stock-page'
import { UsersPage } from './users-page'
import { VisitPage } from './visit-page'
import { Boxes, Package, Bell, CalendarDays, ChevronDown, ChevronRight, ClipboardList, Factory, LayoutDashboard, Menu, Moon, PackageCheck, Search, Settings, Sun, Users, X, LogOut, CheckCircle2, Clock3, AlertCircle, BarChart3, UserRound, FileText, Wrench, Handshake, UserCheck, ListChecks, UserCog, ShieldCheck, Eye, EyeOff, Target, MapPinned, FlaskConical, Palette, Database, Calculator, Repeat } from 'lucide-react'

type MenuItem = { label: string; icon: typeof LayoutDashboard; badge?: string }
const groups: { label: string; items: MenuItem[] }[] = [
  { label: 'RINGKASAN', items: [{ label: 'Dashboard', icon: LayoutDashboard }] },
  { label: 'MARKETING', items: [{ label: 'Prospek', icon: Target }, { label: 'Jadwal Visit', icon: MapPinned }, { label: 'Request Sample', icon: FlaskConical }, { label: 'Request Desain', icon: Palette }, { label: 'Customer', icon: Users }, { label: 'Repeat Order', icon: Repeat }, { label: 'Data Produk', icon: Package }, { label: 'Quotation', icon: ClipboardList }, { label: 'Tabel HPP', icon: Calculator }] },
  { label: 'PRODUKSI', items: [{ label: 'Surat Berita Kerja', icon: PackageCheck, badge: '6' }, { label: 'Jadwal Produksi', icon: CalendarDays }, { label: 'Stok', icon: Boxes }, { label: 'Data Mesin', icon: Factory }] },
  { label: 'SDM', items: [{ label: 'Karyawan', icon: UserRound }, { label: 'Absensi', icon: UserCheck }] },
  { label: 'KOLABORASI', items: [{ label: 'Planning', icon: ListChecks }, { label: 'Progress Kerja', icon: BarChart3 }, { label: 'Meeting', icon: Handshake }] },
  { label: 'SISTEM', items: [{ label: 'Master Data', icon: Database }, { label: 'Manajemen User', icon: UserCog }, { label: 'Manajemen Role', icon: ShieldCheck }, { label: 'Pengaturan', icon: Settings }] },
]

const data: Record<string, { eyebrow: string; title: string; description: string; stats: [string, string, string][]; rows: string[][] }> = {
  Dashboard: { eyebrow: 'Selamat datang kembali, Anto', title: 'Dashboard', description: 'Ringkasan aktivitas operasional PAP hari ini.', stats: [['Order aktif', '24', '+12% bulan ini'], ['Produksi berjalan', '8', '3 selesai hari ini'], ['Pengiriman', '17', '92% tepat waktu']], rows: [['PO-2026-081', 'PT Sinar Jaya', 'Kemasan makanan', 'Produksi', '13 Okt 2026'], ['PO-2026-080', 'CV Maju Bersama', 'Label botol', 'QC', '12 Okt 2026'], ['PO-2026-079', 'PT Nusantara', 'Karton corrugated', 'Selesai', '11 Okt 2026']] },
  Customer: { eyebrow: 'MARKETING', title: 'Customer', description: 'Kelola relasi dan data pelanggan PAP.', stats: [['Total customer', '128', '+8 baru'], ['Customer aktif', '96', '75% dari total'], ['Prospek', '32', 'Perlu follow-up']], rows: [['CUS-001', 'PT Sinar Jaya', 'Packaging', 'Aktif', 'Budi Santoso'], ['CUS-002', 'CV Maju Bersama', 'Food & Beverage', 'Aktif', 'Rina Wijaya'], ['CUS-003', 'PT Nusantara Abadi', 'Retail', 'Prospek', 'Dimas Pratama']] },
  Quotation: { eyebrow: 'MARKETING', title: 'Quotation', description: 'Pantau penawaran harga dan peluang bisnis.', stats: [['Penawaran aktif', '18', 'Rp 2,4 M nilai'], ['Menunggu approval', '7', 'Perlu ditindaklanjuti'], ['Win rate', '68%', '+4,2% bulan ini']], rows: [['QT-2026-044', 'PT Sinar Jaya', 'Rp 185.000.000', 'Menunggu', '13 Okt 2026'], ['QT-2026-043', 'CV Maju Bersama', 'Rp 72.500.000', 'Disetujui', '12 Okt 2026'], ['QT-2026-042', 'PT Nusantara', 'Rp 310.000.000', 'Draft', '11 Okt 2026']] },
  'Surat Berita Kerja': { eyebrow: 'PRODUKSI', title: 'Surat Berita Kerja', description: 'Daftar instruksi kerja yang sedang berjalan.', stats: [['Total SBK', '42', '6 perlu perhatian'], ['Sedang produksi', '18', '43% dari total'], ['Selesai', '24', '57% dari total']], rows: [['SBK-0261', 'Cetak pouch 500ml', 'Mesin Flexo 01', 'Berjalan', '15 Okt 2026'], ['SBK-0260', 'Die cut karton', 'Mesin Die Cut 02', 'Berjalan', '14 Okt 2026'], ['SBK-0259', 'Laminasi roll film', 'Mesin Lam 01', 'Selesai', '13 Okt 2026']] },
  'Jadwal Produksi': { eyebrow: 'PRODUKSI', title: 'Jadwal Produksi', description: 'Rencanakan kapasitas dan agenda produksi.', stats: [['Jadwal hari ini', '12', '4 prioritas tinggi'], ['Kapasitas terpakai', '78%', '+6% dari kemarin'], ['Mesin aktif', '9/11', '2 maintenance']], rows: [['07:00 - 10:00', 'Flexo 01', 'Cetak label Sinar Jaya', 'Anto Paul', 'Berjalan'], ['10:00 - 13:00', 'Die Cut 02', 'Karton Nusantara', 'Rizky Maulana', 'Terjadwal'], ['13:00 - 16:00', 'Laminasi 01', 'Pouch Maju Bersama', 'Sari Dewi', 'Terjadwal']] },
  'Data Mesin': { eyebrow: 'PRODUKSI', title: 'Data Mesin', description: 'Monitor kondisi dan performa mesin produksi.', stats: [['Total mesin', '11', '9 aktif'], ['OEE rata-rata', '86%', '+3,1% bulan ini'], ['Maintenance', '2', '1 terjadwal']], rows: [['MC-001', 'Flexo Printing 01', '86%', 'Aktif', '15 hari lagi'], ['MC-002', 'Die Cutting 02', '92%', 'Aktif', '42 hari lagi'], ['MC-003', 'Laminating 01', '0%', 'Maintenance', 'Selesai 14 Okt']] },
  Karyawan: { eyebrow: 'SDM', title: 'Karyawan', description: 'Data karyawan dan struktur organisasi PAP.', stats: [['Total karyawan', '86', '+3 bulan ini'], ['Hadir hari ini', '81', '94,2% kehadiran'], ['Cuti', '4', '1 izin sakit']], rows: [['EMP-001', 'Anto Paul', 'Operasional', 'Super Admin', 'Aktif'], ['EMP-002', 'Rizky Maulana', 'Produksi', 'Supervisor', 'Aktif'], ['EMP-003', 'Sari Dewi', 'Marketing', 'Sales Executive', 'Aktif']] },
  Absensi: { eyebrow: 'SDM', title: 'Absensi', description: 'Rekap kehadiran karyawan hari ini.', stats: [['Hadir', '81', '94,2%'], ['Terlambat', '5', '6% dari hadir'], ['Tidak hadir', '5', '2 cuti, 3 izin']], rows: [['08:01', 'Anto Paul', 'Operasional', 'Masuk', 'Tepat waktu'], ['08:17', 'Rizky Maulana', 'Produksi', 'Masuk', 'Terlambat'], ['07:55', 'Sari Dewi', 'Marketing', 'Masuk', 'Tepat waktu']] },
  'Progress Kerja': { eyebrow: 'KOLABORASI', title: 'Progress Kerja', description: 'Pantau tugas dan target lintas departemen.', stats: [['Tugas aktif', '38', '12 prioritas'], ['Selesai minggu ini', '24', '+18% produktif'], ['Overdue', '3', 'Perlu follow-up']], rows: [['PRJ-014', 'Finalisasi sample pouch', 'Marketing', '75%', '14 Okt 2026'], ['PRJ-013', 'Maintenance Flexo 01', 'Produksi', '40%', '15 Okt 2026'], ['PRJ-012', 'Review kontrak supplier', 'Finance', '100%', 'Selesai']] },
  Pengaturan: { eyebrow: 'SISTEM', title: 'Pengaturan', description: 'Kelola preferensi dan konfigurasi sistem.', stats: [['Pengguna aktif', '24', '3 admin'], ['Role tersedia', '6', 'Terakhir diubah 2 hari lalu'], ['Integrasi', '4', 'Semua terhubung']], rows: [['Profil perusahaan', 'PT Pandawa Amerta Packindo', 'Operasional', 'Diperbarui', '12 Okt 2026'], ['Notifikasi', 'Email & in-app', 'Sistem', 'Aktif', 'Default'], ['Keamanan', '2FA & session policy', 'Admin', 'Aktif', 'Direkomendasikan']] },
}

type User = UserProfile

// Menu yang sudah memakai data asli (bukan template dummy)
const PAGE_GROUP: Record<string, string> = { Prospek: 'MARKETING', 'Jadwal Visit': 'MARKETING', 'Request Sample': 'MARKETING', 'Request Desain': 'MARKETING', Customer: 'MARKETING', 'Data Produk': 'MARKETING', Quotation: 'MARKETING', 'Tabel HPP': 'MARKETING', 'Repeat Order': 'MARKETING', Stok: 'PRODUKSI', 'Jadwal Produksi': 'PRODUKSI', 'Data Mesin': 'PRODUKSI', Planning: 'KOLABORASI', Meeting: 'KOLABORASI', 'Master Data': 'SISTEM', 'Manajemen User': 'SISTEM', 'Manajemen Role': 'SISTEM' }

const canOpen = (user: User, label: string) => user.menus.includes(MENU_KEYS[label as keyof typeof MENU_KEYS])

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase()

function Login({ onLogin }: { onLogin: (user: User) => void }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  // Kotak "I'm not a robot" (v2) selalu tampil bila key v2 diset; token sekali pakai
  const [challenge, setChallenge] = useState(false)
  const [v2Token, setV2Token] = useState('')
  const challengeRef = useRef<HTMLDivElement>(null)
  const widgetId = useRef<number | null>(null)

  useEffect(() => {
    getCaptchaConfig().then(({ v2SiteKey }) => setChallenge(!!v2SiteKey))
    loadRecaptcha().catch(() => {})
  }, [])

  useEffect(() => {
    if (!challenge || !challengeRef.current || widgetId.current !== null) return
    Promise.all([loadRecaptcha(), getCaptchaConfig()]).then(([grecaptcha, { v2SiteKey }]) => {
      if (!challengeRef.current || widgetId.current !== null) return
      widgetId.current = grecaptcha.render(challengeRef.current, { sitekey: v2SiteKey, callback: setV2Token, 'expired-callback': () => setV2Token('') })
    }).catch((e: Error) => setError(e.message))
  }, [challenge])

  async function login(credentials: { email: string; password: string }) {
    setLoading(true)
    setError('')
    try {
      const captchaToken = challenge ? undefined : await getRecaptchaToken('login')
      const res = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...credentials, captchaToken, captchaV2Token: challenge ? v2Token : undefined }) })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        if (challenge && widgetId.current !== null) {
          window.grecaptcha?.reset(widgetId.current)
          setV2Token('')
        }
        return setError(json.error ?? 'Gagal masuk. Coba lagi.')
      }
      onLogin(json.user)
    } catch (e) {
      setError(e instanceof Error && e.message.includes('reCAPTCHA') ? e.message : 'Tidak dapat terhubung ke server.')
    } finally {
      setLoading(false)
    }
  }
  return <main className="pap-auth"><section className="pap-auth-hero" aria-label="PT. Pandawa Amerta Packindo"><div className="pap-auth-hero-content"><span className="pap-auth-hero-logo"><img src="/logo-mark.png" alt="" /></span><p className="pap-auth-tagline">Focus on Quality</p><h2>PT. Pandawa Amerta Packindo</h2><p className="pap-auth-sub">Flexible Plastic Packaging Manufacture</p><p className="pap-auth-desc">Produsen kantong plastik HD, PP, dan PE dari biji plastik melalui proses blow, cetak rotogravure, hingga bag making (gusset, cut seal, dan side seal). Melayani produk custom B2B dari berbagai sektor usaha, plastik laundry, serta mika rigid.</p></div></section><section className="pap-auth-panel"><div className="pap-login-card"><img className="pap-login-logo" src="/logo-pap.png" alt="PT. Pandawa Amerta Packindo — Flexible Plastic Packaging Manufacture" /><p className="pap-eyebrow">PAP MANAGEMENT SYSTEM</p><form onSubmit={(e) => { e.preventDefault(); login({ email, password }) }}><label>Email<input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="nama@perusahaan.com" /></label><label>Password<span className="pap-password-field"><input type={showPassword ? 'text' : 'password'} autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" /><button type="button" className="pap-password-toggle" onClick={() => setShowPassword((v) => !v)} aria-label={showPassword ? 'Sembunyikan password' : 'Tampilkan password'} aria-pressed={showPassword}>{showPassword ? <EyeOff /> : <Eye />}</button></span></label><a className="pap-forgot-link" href="/lupa-password">Lupa password?</a>{challenge && <div className="pap-captcha" ref={challengeRef} />}{error && <p className="pap-login-error" role="alert">{error}</p>}<button type="submit" className="pap-primary-button pap-login-button" disabled={loading || (challenge && !v2Token)}>{loading ? 'Memproses...' : 'Masuk'} <ChevronRight /></button></form></div></section></main>
}

export function AppShell() {
  const [user, setUser] = useState<User | null>(null)
  const [checking, setChecking] = useState(true)
  const [active, setActive] = useState('Dashboard')
  const [mobileOpen, setMobileOpen] = useState(false)
  const [dark, setDark] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const [focus, setFocus] = useState<{ key: number; meetingId: number | null; planningId: number | null; prospectId: number | null; visitId: number | null; sampleId: number | null; designId: number | null; customerId: number | null }>({ key: 0, meetingId: null, planningId: null, prospectId: null, visitId: null, sampleId: null, designId: null, customerId: null })
  const openRef = useRef<(target: NotificationTarget) => void>(() => {})

  // Klik pop-up sistem: dari service worker (tab terbuka) atau ?meeting= / ?planning= (tab baru)
  useEffect(() => {
    if (!user) return
    const params = new URLSearchParams(window.location.search)
    const meetingId = Number(params.get('meeting')) || null
    const planningId = Number(params.get('planning')) || null
    const prospectId = Number(params.get('prospek')) || null
    const visitId = Number(params.get('visit')) || null
    const sampleId = Number(params.get('sample')) || null
    const designId = Number(params.get('desain')) || null
    const customerId = Number(params.get('customer')) || null
    // Kembali dari halaman izin Google (Hubungkan akun Google di Master Data)
    const drive = params.get('drive')
    if (drive) {
      try {
        sessionStorage.setItem('pap-drive-result', drive)
        localStorage.setItem('pap-master-tab', 'desain')
      } catch {}
      setActive('Master Data')
      window.history.replaceState(null, '', window.location.pathname)
    }
    if (meetingId || planningId || prospectId || visitId || sampleId || designId || customerId) {
      openRef.current({ meetingId, planningId, prospectId, visitId, sampleId, designId, customerId })
      window.history.replaceState(null, '', window.location.pathname)
    }
    const onMessage = (e: MessageEvent) => e.data?.type === 'pap-open' && openRef.current({ meetingId: e.data.meetingId, planningId: e.data.planningId, prospectId: e.data.prospectId, visitId: e.data.visitId, sampleId: e.data.sampleId, designId: e.data.designId, customerId: e.data.customerId })
    navigator.serviceWorker?.addEventListener('message', onMessage)
    return () => navigator.serviceWorker?.removeEventListener('message', onMessage)
  }, [user])

  useEffect(() => {
    fetch('/api/auth/me').then((res) => res.json()).then((json) => {
      // Belum login: langsung muat reCAPTCHA sebelum form login dirender
      if (!json.user && json.captcha) {
        primeCaptchaConfig(json.captcha)
        loadRecaptcha().catch(() => {})
      }
      setUser(json.user ?? null)
    }).catch(() => setUser(null)).finally(() => setChecking(false))
  }, [])
  async function logout() {
    // Perangkat ini berhenti menerima notifikasi akun yang logout
    await unsubscribePush()
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {})
    setUser(null)
    setProfileOpen(false)
    setActive('Dashboard')
  }
  if (checking) return <main className="pap-login"><span className="pap-login-loading">Memuat...</span></main>
  if (!user) return <Login onLogin={setUser} />
  const current = active === 'Dashboard' ? { ...data.Dashboard, eyebrow: `Selamat datang kembali, ${user.name.split(' ')[0]}` } : data[active] ?? { ...data.Dashboard, eyebrow: PAGE_GROUP[active] ?? '', title: active }
  const userInitials = initials(user.name)
  const visibleGroups = groups.map((group) => ({ ...group, items: group.items.filter((item) => canOpen(user, item.label)) })).filter((group) => group.items.length > 0)
  const go = (label: string) => { if (canOpen(user, label)) setActive(label) }
  // Buka detail meeting/planning/prospek/visit dari notifikasi atau tautan antar menu
  function openTarget(target: NotificationTarget) {
    const label = target.meetingId ? 'Meeting' : target.planningId ? 'Planning' : target.visitId ? 'Jadwal Visit' : target.sampleId ? 'Request Sample' : target.designId ? 'Request Desain' : target.customerId ? 'Repeat Order' : target.prospectId ? 'Prospek' : null
    if (!user || !label || !canOpen(user, label)) return
    setActive(label)
    setMobileOpen(false)
    setFocus({
      key: Date.now(),
      meetingId: label === 'Meeting' ? target.meetingId ?? null : null,
      planningId: label === 'Planning' ? target.planningId ?? null : null,
      prospectId: label === 'Prospek' ? target.prospectId ?? null : null,
      visitId: label === 'Jadwal Visit' ? target.visitId ?? null : null,
      sampleId: label === 'Request Sample' ? target.sampleId ?? null : null,
      designId: label === 'Request Desain' ? target.designId ?? null : null,
      customerId: label === 'Repeat Order' ? target.customerId ?? null : null,
    })
  }
  openRef.current = openTarget
  return <div className={dark ? 'pap-shell dark' : 'pap-shell'}><aside className={`pap-sidebar ${mobileOpen ? 'pap-sidebar-open' : ''}`}><div className="pap-brand"><span className="pap-brand-logo"><img src="/logo-mark.png" alt="" /></span><span className="pap-brand-text"><span>PAP<span className="pap-brand-muted">-MS</span></span><small>Focus on Quality</small></span><button className="pap-mobile-close" onClick={() => setMobileOpen(false)} aria-label="Tutup menu"><X /></button></div><nav className="pap-nav" aria-label="Navigasi utama">{visibleGroups.map((group) => <div className="pap-nav-group" key={group.label}><p>{group.label}</p>{group.items.map(({ label, icon: Icon, badge }) => <button className={`pap-nav-item ${label === active ? 'active' : ''}`} key={label} onClick={() => { setActive(label); setMobileOpen(false) }}><Icon /><span>{label}</span>{badge && <span className="pap-nav-badge">{badge}</span>}</button>)}</div>)}</nav><div className="pap-sidebar-bottom"><div className="pap-upgrade"><div className="pap-upgrade-icon"><Factory /></div><strong>Focus on Quality</strong><span>Flexible Plastic Packaging Manufacture.</span>{canOpen(user, 'Pengaturan') && <button onClick={() => setActive('Pengaturan')}>Buka pengaturan <ChevronRight /></button>}</div><div className="pap-user"><div className="pap-avatar">{userInitials}</div><div><strong>{user.name}</strong><span>{user.role.name} · {user.division.name}</span></div><button className="pap-user-logout" onClick={logout} aria-label="Keluar" title="Keluar"><LogOut /></button></div></div></aside>{mobileOpen && <button className="pap-overlay" onClick={() => setMobileOpen(false)} aria-label="Tutup menu" />}<main className="pap-main"><header className="pap-topbar"><button className="pap-mobile-menu" onClick={() => setMobileOpen(true)} aria-label="Buka menu"><Menu /></button><div className="pap-breadcrumb"><span>{active === 'Dashboard' ? 'Ringkasan' : current.eyebrow.charAt(0) + current.eyebrow.slice(1).toLowerCase()}</span><ChevronRight /><strong>{active}</strong></div><div className="pap-search"><Search /><span>Cari data...</span></div><div className="pap-top-actions"><button className="pap-icon-button pap-theme-toggle" onClick={() => setDark(!dark)} aria-label="Ganti tema">{dark ? <Sun /> : <Moon />}</button><NotificationCenter userId={user.id} onOpen={openTarget} /><button className="pap-top-avatar" onClick={() => setProfileOpen(!profileOpen)}>{userInitials}</button><button className="pap-chevron" onClick={() => setProfileOpen(!profileOpen)} aria-label="Menu profil"><ChevronDown /></button>{profileOpen && <div className="pap-profile-menu"><strong>{user.name}</strong><span>{user.email}</span><button onClick={logout}><LogOut /> Keluar</button></div>}</div></header><section className="pap-content">{active === 'Repeat Order' ? <RepeatOrderPage key={`ro-${focus.key}`} user={user} focusId={focus.customerId} /> : active === 'Quotation' ? <QuotationPage user={user} /> : active === 'Tabel HPP' ? <HppPage user={user} /> : active === 'Master Data' ? <MasterDataPage user={user} /> : active === 'Request Sample' ? <SamplePage key={`s-${focus.key}`} user={user} focusId={focus.sampleId} /> : active === 'Request Desain' ? <DesignPage key={`d-${focus.key}`} user={user} focusId={focus.designId} /> : active === 'Prospek' ? <ProspectPage key={`pr-${focus.key}`} user={user} focusId={focus.prospectId} /> : active === 'Jadwal Visit' ? <VisitPage key={`v-${focus.key}`} user={user} focusId={focus.visitId} onOpenProspect={(id) => openTarget({ prospectId: id })} /> : active === 'Customer' ? <CustomerPage user={user} /> : active === 'Data Produk' ? <ProductPage user={user} /> : active === 'Stok' ? <StockPage user={user} /> : active === 'Jadwal Produksi' ? <ProductionPage user={user} /> : active === 'Data Mesin' ? <MachinePage user={user} /> : active === 'Planning' ? <PlanningPage key={`p-${focus.key}`} user={user} focusId={focus.planningId} onOpenMeeting={(id) => openTarget({ meetingId: id })} /> : active === 'Meeting' ? <MeetingPage key={`m-${focus.key}`} user={user} focusId={focus.meetingId} onOpenPlanning={(id) => openTarget({ planningId: id })} /> : active === 'Manajemen User' ? <UsersPage user={user} /> : active === 'Manajemen Role' ? <RolesPage /> : <><div className="pap-page-heading"><div><p className="pap-eyebrow">{current.eyebrow}</p><h1>{current.title}</h1><span>{current.description}</span></div><button className="pap-date-button"><CalendarDays /> 13 Okt 2026 <ChevronDown /></button></div><div className="pap-stat-grid">{current.stats.map(([label, value, note], index) => <div className="pap-stat-card" key={label}><div><span>{label}</span><strong>{value}</strong><small className={index === 1 ? 'neutral' : ''}>{note}</small></div><div className={`pap-stat-icon stat-${index}`}><CheckCircle2 /></div></div>)}</div><div className="pap-table-card"><div className="pap-card-head"><div><h2>Data {active}</h2><p>Data dummy untuk akun demo</p></div><button className="pap-primary-button"><span>+</span> Tambah data</button></div><div className="pap-table-toolbar"><div className="pap-table-search"><Search /><span>Cari data...</span></div><button className="pap-filter-button"><Clock3 /> Terbaru</button></div><div className="pap-table-wrap"><table><thead><tr>{['ID / Waktu', 'Nama / Deskripsi', 'Kategori', 'Status', 'Keterangan'].map((head) => <th key={head}>{head}</th>)}</tr></thead><tbody>{current.rows.map((row) => <tr key={row[0]}>{row.map((cell, index) => <td key={cell}>{index === 3 ? <span className={`pap-status ${cell.toLowerCase().includes('selesai') || cell.toLowerCase().includes('aktif') || cell.toLowerCase().includes('tepat') || cell === '100%' ? 'success' : cell.toLowerCase().includes('pending') || cell.toLowerCase().includes('menunggu') || cell.toLowerCase().includes('berjalan') ? 'warning' : 'info'}`}>{cell}</span> : cell}</td>)}</tr>)}</tbody></table></div></div></>}</section></main><nav className="pap-bottom-nav"><button className="active" onClick={() => go('Dashboard')}><LayoutDashboard /><span>Beranda</span></button><button onClick={() => go('Planning')}><ListChecks /><span>Planning</span></button><button className="pap-bottom-fab"><span>+</span><span>Lapor</span></button><button onClick={() => go('Meeting')}><CalendarDays /><span>Meeting</span></button><button onClick={() => setMobileOpen(true)}><Menu /><span>Menu</span></button></nav></div>
}

export default AppShell
