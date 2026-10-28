'use client'

import { useCallback, useEffect, useState } from 'react'
import { AlertCircle, Cog, Database, ExternalLink, FileImage, FileText, FolderOpen, Image as ImageIcon, Layers, Package, Pencil, Plus, RefreshCw, Search, Trash2, Truck, Users } from 'lucide-react'
import type { UserProfile } from '@/lib/users'
import { CustomerPage } from './customer-page'
import { ExpeditionList } from './expedition-list'
import { MachinePage } from './machine-page'
import { CustomerSelect, ProductPage, type CustomerOption } from './product-page'
import { api, Field, formatDate, formatSize, Modal, Notice, Pager, confirmDialog } from './ui'

type Tab = 'desain' | 'packaging' | 'produk' | 'customer' | 'mesin' | 'ekspedisi'
const TABS: { key: Tab; label: string; icon: typeof Database; menu?: string }[] = [
  { key: 'desain', label: 'Logo & Desain', icon: ImageIcon },
  { key: 'packaging', label: 'Produk Packaging', icon: Layers },
  { key: 'produk', label: 'Data Produk', icon: Package, menu: 'produk' },
  { key: 'customer', label: 'Customer', icon: Users, menu: 'customer' },
  { key: 'mesin', label: 'Data Mesin', icon: Cog, menu: 'data-mesin' },
  { key: 'ekspedisi', label: 'Ekspedisi', icon: Truck },
]

export function MasterDataPage({ user }: { user: UserProfile }) {
  const tabs = TABS.filter((t) => !t.menu || user.role.isAdmin || (user.menus as string[]).includes(t.menu))
  const [tab, setTab] = useState<Tab>(() => {
    try {
      const saved = localStorage.getItem('pap-master-tab') as Tab | null
      return saved && tabs.some((t) => t.key === saved) ? saved : 'desain'
    } catch {
      return 'desain'
    }
  })
  const pick = (key: Tab) => {
    setTab(key)
    try { localStorage.setItem('pap-master-tab', key) } catch {}
  }
  return (
    <>
      <div className="pap-master-tabs" role="tablist" aria-label="Master data">
        <span className="pap-master-title"><Database /> Master Data</span>
        {tabs.map(({ key, label, icon: Icon }) => (
          <button key={key} role="tab" aria-selected={tab === key} className={tab === key ? 'active' : ''} onClick={() => pick(key)}><Icon /> {label}</button>
        ))}
      </div>
      {tab === 'desain' && <DesignLibrary />}
      {tab === 'packaging' && <PackagingTypes />}
      {tab === 'produk' && <ProductPage user={user} />}
      {tab === 'customer' && <CustomerPage user={user} />}
      {tab === 'mesin' && <MachinePage user={user} />}
      {tab === 'ekspedisi' && <ExpeditionList />}
    </>
  )
}

// ================= Logo & Desain (Google Drive) =================
type DesignFile = {
  id: string; root_id: number; name: string; mime: string; size: number | null; modified_at: string | null; has_thumbnail: boolean
  web_link: string | null; bulan: string | null; brand: string | null; customer_id: number | null; customer_manual: number
  root_label: string; tahun: number | null; customer_name: string | null; customer_no: string | null
}
type Root = { id: number; label: string; kategori: 'logo' | 'cetak'; tahun: number | null; folder_id: string; aktif: number; last_error: string | null; files: number; last_scan: string | null; pending: number }
type DesignResponse = { items: DesignFile[]; total: number; pageSize: number; months: string[]; roots: Root[]; drive: { enabled: boolean; mode: 'oauth' | 'service' | null; email: string | null; connectedAt: string | null; oauthReady: boolean }; canManage: boolean }

const ext = (name: string) => name.split('.').pop()?.toUpperCase() ?? ''
const thumbUrl = (id: string, size = 400) => `/api/master/designs/${encodeURIComponent(id)}/thumb?s=${size}`

function Preview({ file, size }: { file: DesignFile; size: number }) {
  const [failed, setFailed] = useState(false)
  if ((file.has_thumbnail || file.mime.startsWith('image/') || file.mime === 'application/pdf') && !failed) {
    return <img src={thumbUrl(file.id, size)} alt={file.name} loading="lazy" onError={() => setFailed(true)} />
  }
  const Icon = file.mime === 'application/pdf' ? FileText : file.mime.startsWith('image/') ? FileImage : FileText
  return <div className="pap-design-noprev"><Icon /><b>{ext(file.name)}</b><small>Tanpa preview</small></div>
}

function DesignLibrary() {
  const [data, setData] = useState<DesignResponse | null>(null)
  const [root, setRoot] = useState(0)
  const [bulan, setBulan] = useState('')
  const [q, setQ] = useState('')
  const [kind, setKind] = useState('preview')
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [syncing, setSyncing] = useState(false)
  const [open, setOpen] = useState<DesignFile | null>(null)

  useEffect(() => {
    let result: string | null = null
    try {
      result = sessionStorage.getItem('pap-drive-result')
      sessionStorage.removeItem('pap-drive-result')
    } catch {}
    if (result?.startsWith('ok:')) setMessage(`Google Drive terhubung dengan akun ${result.slice(3)}. Klik "Sinkron Google Drive" untuk mengambil desain.`)
    else if (result?.startsWith('error:')) setError(result.slice(6))
  }, [])

  async function disconnect() {
    if (!(await confirmDialog('Putuskan akun Google? Desain yang sudah tersinkron tetap ada, tetapi tidak diperbarui sampai akun dihubungkan lagi.'))) return
    try {
      await api('/api/master/drive/oauth', { method: 'DELETE' })
      setMessage('Akun Google diputuskan.')
      load()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ page: String(page) })
      if (root) params.set('root', String(root))
      if (bulan) params.set('bulan', bulan)
      if (q.trim()) params.set('q', q.trim())
      if (kind) params.set('kind', kind)
      setData(await api<DesignResponse>(`/api/master/designs?${params}`))
      setError('')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [root, bulan, q, kind, page])
  useEffect(() => {
    const timer = setTimeout(load, q ? 300 : 0)
    return () => clearTimeout(timer)
  }, [load, q])
  useEffect(() => setPage(1), [root, bulan, q, kind])
  useEffect(() => setBulan(''), [root])

  async function sync() {
    setSyncing(true)
    setError('')
    try {
      const res = await api<{ folders: number; files: number; pending: number; errors: string[] }>('/api/master/drive', { method: 'POST' })
      if (res.errors.length) setError(res.errors.join(' · '))
      setMessage(`${res.folders} folder dipindai, ${res.files} file diperbarui.${res.pending ? ` Masih ada ${res.pending} folder, klik Sinkron lagi (atau tunggu cron).` : ''}`)
      load()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSyncing(false)
    }
  }

  const roots = data?.roots ?? []
  const lastScan = roots.map((r) => r.last_scan).filter(Boolean).sort().pop()

  return (
    <>
      <div className="pap-page-heading">
        <div>
          <p className="pap-eyebrow">MASTER DATA</p>
          <h1>Logo & Desain</h1>
          <span>Desain cetak & logo dari Google Drive (PAP logo desain, Cetak 2023–2026), lengkap dengan preview. Folder brand dicocokkan otomatis ke data customer.</span>
        </div>
        {data?.canManage && data.drive.enabled && <button className="pap-btn" onClick={sync} disabled={syncing}><RefreshCw className={syncing ? 'pap-spin' : ''} /> {syncing ? 'Menyinkronkan...' : 'Sinkron Google Drive'}</button>}
      </div>
      {data && !data.drive.enabled && !data.canManage && <Notice>Google Drive belum terhubung. Hubungi Admin.</Notice>}
      {data?.canManage && (
        <div className={`pap-drive-account ${data.drive.enabled ? 'on' : ''}`}>
          <div>
            <strong>{data.drive.enabled ? `Terhubung: ${data.drive.email}` : 'Google Drive belum terhubung'}</strong>
            <span>
              {data.drive.enabled
                ? `${data.drive.mode === 'oauth' ? 'Akun Google' : 'Service account'}${data.drive.connectedAt ? ` · sejak ${formatDate(data.drive.connectedAt, true)}` : ''} · terakhir disinkron ${lastScan ? formatDate(lastScan, true) : 'belum pernah'}. Folder desain harus dibagikan ke akun ini.`
                : data.drive.oauthReady
                  ? 'Klik "Hubungkan akun Google" lalu login dengan akun yang menerima share folder desain (mis. resaarrazy@gmail.com).'
                  : 'Isi GOOGLE_OAUTH_CLIENT_ID dan GOOGLE_OAUTH_CLIENT_SECRET di environment server (Vercel), lalu redeploy.'}
            </span>
          </div>
          {data.drive.oauthReady && <a className={data.drive.enabled ? 'pap-btn' : 'pap-primary-button'} href="/api/master/drive/oauth">{data.drive.mode === 'oauth' ? 'Ganti akun' : 'Hubungkan akun Google'}</a>}
          {data.drive.mode === 'oauth' && <button className="pap-btn danger" onClick={disconnect}>Putuskan</button>}
        </div>
      )}
      {message && <Notice kind="success" onClose={() => setMessage('')}>{message}</Notice>}
      {error && <Notice onClose={() => setError('')}>{error}</Notice>}

      <div className="pap-chip-tabs pap-root-tabs">
        <button className={root === 0 ? 'active' : ''} onClick={() => setRoot(0)}>Semua <b>{roots.reduce((n, r) => n + r.files, 0)}</b></button>
        {roots.map((r) => (
          <button key={r.id} className={`${root === r.id ? 'active' : ''} ${r.last_error ? 'todo' : ''}`} onClick={() => setRoot(r.id)} title={r.last_error ?? ''}>
            {r.last_error && <AlertCircle />}{r.label} <b>{r.files}</b>
          </button>
        ))}
      </div>
      {roots.filter((r) => r.last_error && (!root || r.id === root)).map((r) => <Notice key={r.id}>{r.label}: {r.last_error}</Notice>)}

      <div className="pap-table-card">
        <div className="pap-filters">
          <label className="pap-filter-search"><Search /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari brand, nama file, customer..." /></label>
          <select className="pap-select" value={bulan} onChange={(e) => setBulan(e.target.value)} aria-label="Filter bulan atau kategori">
            <option value="">Semua bulan / kategori</option>
            {(data?.months ?? []).map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
          <select className="pap-select" value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Jenis file">
            <option value="preview">Yang punya preview</option>
            <option value="gambar">Gambar (PNG/JPG)</option>
            <option value="pdf">PDF</option>
            <option value="sumber">File sumber (CDR/AI/...)</option>
            <option value="">Semua file</option>
          </select>
        </div>
        <div className={`pap-design-grid ${loading ? 'loading' : ''}`}>
          {(data?.items ?? []).map((f) => (
            <button key={f.id} className="pap-design-card" onClick={() => setOpen(f)}>
              <div className="pap-design-thumb"><Preview file={f} size={400} /><span className="pap-design-ext">{ext(f.name)}</span></div>
              <div className="pap-design-info">
                <strong title={f.brand ?? f.name}>{f.brand ?? f.name}</strong>
                <small title={f.name}>{f.name}</small>
                <small>{[f.root_label, f.bulan].filter(Boolean).join(' · ')}</small>
                {f.customer_name && <span className="pap-chip">{f.customer_name}</span>}
              </div>
            </button>
          ))}
        </div>
        {!loading && !data?.items.length && (
          <div className="pap-empty">{data?.drive.enabled ? (q || bulan || root ? 'Tidak ada desain yang cocok dengan filter.' : 'Belum ada desain. Admin dapat klik "Sinkron Google Drive".') : 'Desain akan tampil setelah Google Drive terhubung.'}</div>
        )}
        {loading && !data && <div className="pap-empty">Memuat desain...</div>}
        {data && <Pager page={page} pageSize={data.pageSize} total={data.total} onPage={setPage} noun="file desain" />}
      </div>
      {open && <DesignViewer file={open} canManage={!!data?.canManage} onClose={() => setOpen(null)} onChanged={() => { setOpen(null); load() }} />}
    </>
  )
}

function DesignViewer({ file, canManage, onClose, onChanged }: { file: DesignFile; canManage: boolean; onClose: () => void; onChanged: () => void }) {
  const [customer, setCustomer] = useState<CustomerOption | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function link(customerId: number | null) {
    setBusy(true)
    try {
      await api(`/api/master/designs/${encodeURIComponent(file.id)}`, { method: 'PATCH', json: { customer_id: customerId } })
      onChanged()
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }
  return (
    <Modal title={file.brand ?? file.name} subtitle={[file.root_label, file.bulan, file.name].filter(Boolean).join(' · ')} wide onClose={onClose}
      footer={<><span className="pap-spacer" />{file.web_link && <a className="pap-primary-button" href={file.web_link} target="_blank" rel="noreferrer"><ExternalLink /> Buka di Google Drive</a>}</>}
    >
      {error && <Notice onClose={() => setError('')}>{error}</Notice>}
      <div className="pap-design-large"><Preview file={file} size={1400} /></div>
      <dl className="pap-detail-grid">
        <div><dt>File</dt><dd>{file.name}</dd></div>
        <div><dt>Ukuran / diubah</dt><dd>{formatSize(file.size) || '—'} · {formatDate(file.modified_at, true)}</dd></div>
        <div><dt>Sumber</dt><dd><FolderOpen className="pap-inline-icon" /> {[file.root_label, file.bulan, file.brand].filter(Boolean).join(' / ')}</dd></div>
        <div><dt>Customer</dt><dd>{file.customer_name ? `${file.customer_name}${file.customer_no ? ` (${file.customer_no})` : ''}${file.customer_manual ? ' · manual' : ' · otomatis'}` : 'Belum terhubung'}</dd></div>
      </dl>
      {canManage && (
        <div className="pap-inline-panel">
          <strong>Hubungkan folder &quot;{file.brand ?? '—'}&quot; ke customer</strong>
          <p className="pap-muted">Semua file di folder brand yang sama ikut terhubung.</p>
          <CustomerSelect value={customer} onChange={setCustomer} />
          <div className="pap-inline-actions">
            {file.customer_id && <button className="pap-btn" disabled={busy} onClick={() => link(null)}>Lepas / cocokkan otomatis</button>}
            <button className="pap-primary-button" disabled={busy || !customer} onClick={() => link(customer!.id)}>Hubungkan</button>
          </div>
        </div>
      )}
    </Modal>
  )
}

// ================= Produk packaging =================
type Packaging = { id: number; kode: string; nama: string; bahan: string | null; proses: string | null; ketebalan: string | null; kegunaan: string | null; keterangan: string | null; status: 'aktif' | 'nonaktif'; updated_by_name: string | null; updated_at: string; product_count: number }

function PackagingTypes() {
  const [items, setItems] = useState<Packaging[]>([])
  const [canManage, setCanManage] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [form, setForm] = useState<Packaging | 'new' | null>(null)
  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api<{ items: Packaging[]; canManage: boolean }>('/api/master/packaging')
      setItems(res.items)
      setCanManage(res.canManage)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => { load() }, [load])
  return (
    <>
      <div className="pap-page-heading">
        <div>
          <p className="pap-eyebrow">MASTER DATA</p>
          <h1>Produk Packaging</h1>
          <span>Jenis produk packaging PAP: kantong HD, PE, PP, plastik laundry, roll, mika, dan lainnya.</span>
        </div>
        {canManage && <button className="pap-primary-button" onClick={() => setForm('new')}><Plus /> Tambah jenis</button>}
      </div>
      {message && <Notice kind="success" onClose={() => setMessage('')}>{message}</Notice>}
      {error && <Notice onClose={() => setError('')}>{error}</Notice>}
      <div className="pap-table-card">
        <div className="pap-card-head"><div><h2>Daftar produk packaging</h2><p>{canManage ? 'Admin & Super Admin dapat menambah dan mengubah.' : 'Hanya melihat. Perubahan dilakukan Admin.'}</p></div></div>
        <div className="pap-table-wrap">
          <table>
            <thead><tr><th>Kode</th><th>Produk</th><th>Bahan</th><th>Proses</th><th>Ketebalan</th><th>Kegunaan</th><th className="pap-num">Data produk</th><th>Status</th>{canManage && <th aria-label="Aksi" />}</tr></thead>
            <tbody>
              {items.map((t) => (
                <tr key={t.id}>
                  <td><span className="pap-chip">{t.kode}</span></td>
                  <td><div className="pap-cell-title">{t.nama}</div>{t.keterangan && <div className="pap-cell-sub pap-clamp">{t.keterangan}</div>}</td>
                  <td>{t.bahan ?? '—'}</td>
                  <td>{t.proses ?? '—'}</td>
                  <td>{t.ketebalan ?? '—'}</td>
                  <td><div className="pap-clamp">{t.kegunaan ?? '—'}</div></td>
                  <td className="pap-num">{t.product_count}</td>
                  <td><span className={`pap-status ${t.status === 'aktif' ? 'success' : 'neutral'}`}>{t.status === 'aktif' ? 'Aktif' : 'Nonaktif'}</span></td>
                  {canManage && <td><button className="pap-icon-button" aria-label={`Edit ${t.nama}`} onClick={() => setForm(t)}><Pencil /></button></td>}
                </tr>
              ))}
            </tbody>
          </table>
          {!loading && !items.length && <div className="pap-empty">Belum ada produk packaging.</div>}
        </div>
      </div>
      {form && <PackagingForm initial={form === 'new' ? null : form} onClose={() => setForm(null)} onSaved={(text) => { setForm(null); setMessage(text); load() }} />}
    </>
  )
}

function PackagingForm({ initial, onClose, onSaved }: { initial: Packaging | null; onClose: () => void; onSaved: (message: string) => void }) {
  const [values, setValues] = useState({
    kode: initial?.kode ?? '', nama: initial?.nama ?? '', bahan: initial?.bahan ?? '', proses: initial?.proses ?? '',
    ketebalan: initial?.ketebalan ?? '', kegunaan: initial?.kegunaan ?? '', keterangan: initial?.keterangan ?? '', status: initial?.status ?? 'aktif',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const set = (key: keyof typeof values) => (e: { target: { value: string } }) => setValues((v) => ({ ...v, [key]: e.target.value }))
  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError('')
    try {
      if (initial) await api(`/api/master/packaging/${initial.id}`, { method: 'PATCH', json: values })
      else await api('/api/master/packaging', { method: 'POST', json: values })
      onSaved(initial ? 'Produk packaging diperbarui.' : 'Produk packaging ditambahkan.')
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }
  async function remove() {
    if (!initial || !(await confirmDialog(`Hapus ${initial.nama}?`))) return
    try {
      await api(`/api/master/packaging/${initial.id}`, { method: 'DELETE' })
      onSaved('Produk packaging dihapus.')
    } catch (err) {
      setError((err as Error).message)
    }
  }
  return (
    <Modal title={initial ? 'Edit produk packaging' : 'Tambah produk packaging'} onClose={onClose}
      footer={<>{initial && <button type="button" className="pap-btn danger" onClick={remove}><Trash2 /> Hapus</button>}<span className="pap-spacer" /><button type="button" className="pap-btn" onClick={onClose}>Batal</button><button type="submit" form="packaging-form" className="pap-primary-button" disabled={saving}>{saving ? 'Menyimpan...' : 'Simpan'}</button></>}
    >
      <form id="packaging-form" className="pap-form-grid" onSubmit={submit}>
        {error && <div className="full"><Notice onClose={() => setError('')}>{error}</Notice></div>}
        <Field label="Kode"><input className="pap-input" required maxLength={30} value={values.kode} onChange={set('kode')} placeholder="HD" /></Field>
        <Field label="Nama produk"><input className="pap-input" required maxLength={150} value={values.nama} onChange={set('nama')} placeholder="Kantong HD" /></Field>
        <Field label="Bahan"><input className="pap-input" maxLength={150} value={values.bahan} onChange={set('bahan')} placeholder="HDPE" /></Field>
        <Field label="Proses"><input className="pap-input" maxLength={255} value={values.proses} onChange={set('proses')} placeholder="Blow, Cetak, Bag making" /></Field>
        <Field label="Ketebalan umum"><input className="pap-input" maxLength={100} value={values.ketebalan} onChange={set('ketebalan')} placeholder="15–80 mikron" /></Field>
        <Field label="Status">
          <select className="pap-select" value={values.status} onChange={set('status')}><option value="aktif">Aktif</option><option value="nonaktif">Nonaktif</option></select>
        </Field>
        <Field label="Kegunaan" full><input className="pap-input" maxLength={500} value={values.kegunaan} onChange={set('kegunaan')} /></Field>
        <Field label="Keterangan" full><textarea className="pap-input" rows={2} maxLength={5000} value={values.keterangan} onChange={set('keterangan')} /></Field>
      </form>
    </Modal>
  )
}
