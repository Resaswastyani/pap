'use client'

import { useCallback, useEffect, useState } from 'react'
import { ClipboardList, ExternalLink, FileSpreadsheet, Pencil, Plus, Printer, RefreshCw, Search, Trash2, Wrench } from 'lucide-react'
import type { UserProfile } from '@/lib/users'
import { BarList, ColumnChart } from './charts'
import { RepairPage } from './repair-page'
import { api, Field, formatDate, Modal, Notice } from './ui'

// Menu Kerusakan Mesin: Rekap kerusakan (Google Drive + form) dan Permintaan perbaikan (alur Produksi -> Teknik)
export function KerusakanMesinPage({ user, focusId }: { user: UserProfile; focusId?: number | null }) {
  const [tab, setTab] = useState<'rekap' | 'permintaan'>(focusId ? 'permintaan' : 'rekap')
  return (
    <>
      <div className="pap-segmented pap-view-switch" role="tablist" aria-label="Tampilan Kerusakan Mesin">
        <button className={tab === 'rekap' ? 'active' : ''} onClick={() => setTab('rekap')}><ClipboardList /> Rekap kerusakan</button>
        <button className={tab === 'permintaan' ? 'active' : ''} onClick={() => setTab('permintaan')}><Wrench /> Permintaan perbaikan</button>
      </div>
      {tab === 'rekap' ? <DamageLogView user={user} /> : <RepairPage user={user} focusId={focusId} />}
    </>
  )
}

type Damage = {
  id: number; source: 'sheet' | 'app'; sheet_row: number | null; no_laporan: number | null; tanggal: string | null; mesin: string | null; mesin_key: string | null
  mesin_label: string | null; komponen: string | null; kerusakan: string | null; tindakan: string | null; keterangan: string | null
  created_name: string | null; editable: boolean
}
type Data = {
  items: Damage[]
  stats: {
    baris: number; laporan: number; tahun_ini: number; bulan_ini: number; mesin: number; terakhir: string | null
    per_mesin: { key: string; label: string; jumlah: number; terakhir: string | null }[]; per_komponen: { komponen: string; jumlah: number }[]; per_bulan: { bulan: string; jumlah: number }[]
  }
  options: { machines: { key: string; label: string; jumlah: number }[]; components: string[]; years: number[] }
  synced_at: string | null
  can: { create: boolean; sync: boolean }
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des']
function lastMonths(count: number) {
  const now = new Date()
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (count - 1 - i), 1)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  })
}

export function DamageLogView({ user: _user }: { user: UserProfile }) {
  const [data, setData] = useState<Data | null>(null)
  const [q, setQ] = useState('')
  const [query, setQuery] = useState('')
  const [mesin, setMesin] = useState('')
  const [komponen, setKomponen] = useState('')
  const [tahun, setTahun] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [form, setForm] = useState<Damage | 'new' | null>(null)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [shown, setShown] = useState(50)

  useEffect(() => {
    const t = setTimeout(() => setQuery(q.trim()), 300)
    return () => clearTimeout(t)
  }, [q])

  const filterParams = useCallback(() => {
    const p = new URLSearchParams()
    if (query) p.set('q', query)
    if (mesin) p.set('mesin', mesin)
    if (komponen) p.set('komponen', komponen)
    if (tahun) p.set('tahun', tahun)
    return p
  }, [query, mesin, komponen, tahun])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setData(await api<Data>(`/api/repairs/log?${filterParams()}`))
      setShown(50)
      setError('')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [filterParams])
  useEffect(() => { load() }, [load])

  async function remove(item: Damage) {
    if (!confirm(`Hapus laporan kerusakan ${item.mesin ?? ''} tanggal ${formatDate(item.tanggal)}?`)) return
    try {
      await api(`/api/repairs/log/${item.id}`, { method: 'DELETE' })
      setMessage('Laporan kerusakan dihapus.')
      load()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const s = data?.stats
  const byMonth = new Map(s?.per_bulan.map((b) => [b.bulan, b.jumlah]))
  const months = lastMonths(12)
  const printUrl = (blank = false) => `/cetak/kerusakan?${blank ? 'kosong=1' : filterParams()}`
  const filtered = !!(query || mesin || komponen || tahun)
  // Rekap di Drive tidak punya kolom Tindakan: kolom tampil hanya bila ada isian tindakan (dari form)
  const hasTindakan = !!data?.items.some((d) => d.tindakan)

  return (
    <>
      <div className="pap-page-heading">
        <div>
          <p className="pap-eyebrow">PRODUKSI · TEKNIK</p>
          <h1>Rekap Kerusakan Mesin</h1>
          <span>Rekap kerusakan dari spreadsheet Laporan Kerusakan Mesin di Google Drive dan isian form aplikasi: mesin, komponen, kerusakan, dan tindakan perbaikannya.</span>
        </div>
        <div className="pap-inline-actions">
          <button className="pap-btn" onClick={() => setSheetOpen(true)}><FileSpreadsheet /> Google Drive</button>
          <a className="pap-btn" href={printUrl(true)} target="_blank" rel="noreferrer"><Printer /> Form kosong</a>
          {data?.can.create && <button className="pap-primary-button" onClick={() => setForm('new')}><Plus /> Isi form kerusakan</button>}
        </div>
      </div>
      {message && <Notice kind="success" onClose={() => setMessage('')}>{message}</Notice>}
      <div className="pap-sync-bar">
        <div className="pap-sync-items">
          <span className="pap-sync-title">Google Drive</span>
          <span className="pap-sync-item">Laporan Kerusakan Mesin: {data?.synced_at ? `sinkron ${formatDate(data.synced_at, true)}` : 'belum pernah sinkron'}</span>
          {s?.terakhir && <span className="pap-sync-item">Kerusakan terakhir {formatDate(s.terakhir)}</span>}
        </div>
        {data?.can.sync && <button className="pap-btn" onClick={() => setSheetOpen(true)}><RefreshCw /> Sinkron</button>}
      </div>
      <div className="pap-stat-grid four">
        {([
          ['Total laporan', s?.laporan ?? 0, `${s?.baris ?? 0} kerusakan tercatat${filtered ? ' (sesuai filter)' : ''}`],
          ['Tahun ini', s?.tahun_ini ?? 0, 'Kerusakan sejak Januari'],
          ['Bulan ini', s?.bulan_ini ?? 0, 'Kerusakan bulan berjalan'],
          ['Mesin terdampak', s?.mesin ?? 0, s?.per_mesin[0] ? `Terbanyak: ${s.per_mesin[0].label}` : '—'],
        ] as [string, number, string][]).map(([label, value, note], i) => (
          <div key={label} className="pap-stat-card">
            <div><span>{label}</span><strong>{value.toLocaleString('id-ID')}</strong><small className="neutral">{note}</small></div>
            <div className={`pap-stat-icon ${i === 2 && value ? 'stat-2' : 'stat-1'}`}>{i === 3 ? <Wrench /> : <ClipboardList />}</div>
          </div>
        ))}
      </div>
      <div className="pap-damage-cards">
        <section className="pap-table-card pap-dash-card">
          <div className="pap-card-head"><div><h2>Kerusakan per bulan</h2><p>12 bulan terakhir · semua mesin</p></div></div>
          <ColumnChart
            ariaLabel="Jumlah kerusakan mesin per bulan, 12 bulan terakhir"
            format={(v) => v.toLocaleString('id-ID')}
            data={months.map((m, i) => ({ key: m, label: `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(2, 4)}`, value: byMonth.get(m) ?? 0, partial: i === 11 }))}
          />
        </section>
        <section className="pap-table-card pap-dash-card">
          <div className="pap-card-head"><div><h2>Mesin paling sering rusak</h2><p>Klik untuk menyaring daftar</p></div></div>
          <div className="pap-dash-body">
            {s?.per_mesin.length
              ? <BarList items={s.per_mesin.map((m) => ({ key: m.key, label: m.label, value: m.jumlah, onClick: () => setMesin(mesin === m.key ? '' : m.key) }))} />
              : <p className="pap-muted">Belum ada data.</p>}
            {!!s?.per_komponen.length && (
              <>
                <h3 className="pap-damage-subtitle">Komponen</h3>
                <BarList items={s.per_komponen.map((k) => ({ key: k.komponen, label: k.komponen, value: k.jumlah, tone: 'muted' as const, onClick: () => setKomponen(komponen === k.komponen ? '' : k.komponen) }))} />
              </>
            )}
          </div>
        </section>
      </div>
      <div className="pap-table-card">
        <div className="pap-card-head">
          <div><h2>Daftar kerusakan</h2><p>Terbaru di atas · data dari Google Drive diubah di spreadsheet lalu sinkron ulang</p></div>
          <a className="pap-btn" href={printUrl()} target="_blank" rel="noreferrer"><Printer /> Cetak laporan</a>
        </div>
        <div className="pap-filters">
          <label className="pap-filter-search"><Search /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari mesin, komponen, kerusakan, tindakan..." /></label>
          <select className="pap-select" value={mesin} onChange={(e) => setMesin(e.target.value)} aria-label="Filter mesin">
            <option value="">Semua mesin</option>
            {data?.options.machines.map((m) => <option key={m.key} value={m.key}>{m.label} ({m.jumlah})</option>)}
          </select>
          <select className="pap-select" value={komponen} onChange={(e) => setKomponen(e.target.value)} aria-label="Filter komponen">
            <option value="">Semua komponen</option>
            {data?.options.components.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <select className="pap-select" value={tahun} onChange={(e) => setTahun(e.target.value)} aria-label="Filter tahun">
            <option value="">Semua tahun</option>
            {data?.options.years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
        {error && <div className="pap-card-notice"><Notice onClose={() => setError('')}>{error}</Notice></div>}
        <div className="pap-table-wrap">
          <table className="pap-plan-table">
            <thead><tr><th>Mesin</th><th>Tanggal</th><th>Kerusakan</th>{hasTindakan && <th>Tindakan</th>}<th>Keterangan</th><th>Sumber</th><th aria-label="Aksi" /></tr></thead>
            <tbody>
              {(data?.items ?? []).slice(0, shown).map((d) => (
                <tr key={d.id}>
                  <td><div className="pap-cell-title">{d.mesin_label ?? d.mesin ?? '—'}</div>{d.komponen && <div className="pap-cell-sub">{d.komponen}</div>}</td>
                  <td className="pap-nowrap">{formatDate(d.tanggal)}</td>
                  <td className="pap-damage-text">{d.kerusakan ?? '—'}</td>
                  {hasTindakan && <td className="pap-damage-text">{d.tindakan ?? '—'}</td>}
                  <td className="pap-damage-text">{d.keterangan ?? '—'}</td>
                  <td className="pap-nowrap">{d.source === 'sheet' ? <span className="pap-status info">Drive{d.no_laporan ? ` · No ${d.no_laporan}` : ''}</span> : <span className="pap-status success">Form{d.created_name ? ` · ${d.created_name}` : ''}</span>}</td>
                  <td className="pap-nowrap">
                    {d.editable && (
                      <span className="pap-inline-actions">
                        <button className="pap-icon-button" onClick={() => setForm(d)} aria-label="Ubah"><Pencil /></button>
                        <button className="pap-icon-button" onClick={() => remove(d)} aria-label="Hapus"><Trash2 /></button>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!loading && !data?.items.length && <div className="pap-empty">{filtered ? 'Tidak ada kerusakan yang cocok dengan filter.' : 'Belum ada data. Klik "Google Drive" lalu Sinkron untuk mengambil rekap dari spreadsheet, atau isi form kerusakan.'}</div>}
          {loading && !data && <div className="pap-empty">Memuat rekap kerusakan...</div>}
          {(data?.items.length ?? 0) > shown && <div className="pap-load-more"><button className="pap-btn" onClick={() => setShown(shown + 50)}>Tampilkan 50 lagi ({(data?.items.length ?? 0) - shown} tersisa)</button></div>}
        </div>
      </div>
      {form && (
        <DamageForm
          item={form === 'new' ? null : form}
          machines={data?.options.machines.map((m) => m.label) ?? []}
          components={data?.options.components ?? []}
          onClose={() => setForm(null)}
          onSaved={(text) => { setForm(null); setMessage(text); load() }}
        />
      )}
      {sheetOpen && <DamageSheetSync onClose={() => setSheetOpen(false)} onImported={(text) => { setSheetOpen(false); setMessage(text); load() }} />}
    </>
  )
}

// Form Laporan Kerusakan Mesin, kolom sama dengan tab FORM KERUSAKAN di spreadsheet
function DamageForm({ item, machines, components, onClose, onSaved }: { item: Damage | null; machines: string[]; components: string[]; onClose: () => void; onSaved: (text: string) => void }) {
  const today = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10)
  const [v, setV] = useState({
    tanggal: item?.tanggal?.slice(0, 10) ?? today, mesin: item?.mesin ?? '', komponen: item?.komponen ?? '',
    kerusakan: item?.kerusakan ?? '', tindakan: item?.tindakan ?? '', keterangan: item?.keterangan ?? '',
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV({ ...v, [k]: e.target.value })

  async function save() {
    setBusy(true)
    setError('')
    try {
      await api(item ? `/api/repairs/log/${item.id}` : '/api/repairs/log', { method: item ? 'PUT' : 'POST', json: v })
      onSaved(item ? 'Laporan kerusakan diperbarui.' : 'Laporan kerusakan disimpan.')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title={item ? 'Ubah laporan kerusakan' : 'Laporan Kerusakan Mesin'}
      subtitle="Isi sesuai form laporan kerusakan: tanggal, nama mesin, kerusakan, tindakan, dan keterangan."
      onClose={onClose}
      footer={<><button className="pap-btn" onClick={onClose}>Batal</button><button className="pap-primary-button" disabled={busy} onClick={save}>{busy ? 'Menyimpan...' : 'Simpan'}</button></>}
    >
      {error && <Notice onClose={() => setError('')}>{error}</Notice>}
      <div className="pap-form-grid">
        <Field label="Tanggal"><input className="pap-input" type="date" value={v.tanggal} onChange={set('tanggal')} /></Field>
        <Field label="Nama mesin">
          <input className="pap-input" list="pap-damage-machines" value={v.mesin} onChange={set('mesin')} placeholder="Mis. Cutseal HD" />
          <datalist id="pap-damage-machines">{machines.map((m) => <option key={m} value={m} />)}</datalist>
        </Field>
        <Field label="Komponen" hint="Opsional, mis. EPC, Kelistrikan, Pisau Potong" full>
          <input className="pap-input" list="pap-damage-components" value={v.komponen} onChange={set('komponen')} />
          <datalist id="pap-damage-components">{components.map((c) => <option key={c} value={c} />)}</datalist>
        </Field>
        <Field label="Kerusakan" full><textarea className="pap-input" rows={3} value={v.kerusakan} onChange={set('kerusakan')} placeholder="Gejala / kerusakan yang terjadi" /></Field>
        <Field label="Tindakan" full><textarea className="pap-input" rows={3} value={v.tindakan} onChange={set('tindakan')} placeholder="Perbaikan yang dilakukan" /></Field>
        <Field label="Keterangan" full><textarea className="pap-input" rows={2} value={v.keterangan} onChange={set('keterangan')} placeholder="Sparepart, catatan lain" /></Field>
      </div>
    </Modal>
  )
}

// ---------- Sinkron dari spreadsheet Laporan Kerusakan Mesin di Google Drive ----------
type SheetPreview = {
  url: string; account: string | null; canSync: boolean; baris: number; laporan: number
  tabs: { title: string; rows: number; used: boolean; note: string | null }[]
  contoh?: { tanggal: string | null; mesin: string | null; kerusakan: string | null }[]
}

function DamageSheetSync({ onClose, onImported }: { onClose: () => void; onImported: (message: string) => void }) {
  const [data, setData] = useState<SheetPreview | null>(null)
  const [url, setUrl] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const preview = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await api<SheetPreview & { error?: string }>('/api/repairs/log/sheet')
      setData(res)
      setUrl(res.url)
      if (res.error) setError(res.error)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => { preview() }, [preview])

  async function saveUrl() {
    setBusy(true)
    setError('')
    try {
      await api('/api/repairs/log/sheet', { method: 'PUT', json: { url } })
      await preview()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  async function sync() {
    setBusy(true)
    setError('')
    try {
      const res = await api<{ baris: number; laporan: number }>('/api/repairs/log/sheet', { method: 'POST' })
      onImported(`Sinkron rekap kerusakan selesai: ${res.laporan} laporan, ${res.baris} kerusakan.`)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const canSync = data?.canSync ?? false

  return (
    <Modal
      title="Rekap Kerusakan dari Google Drive"
      subtitle={data?.account ? `Dibaca dengan akun Google ${data.account} (sama dengan Master Data > Logo & Desain)` : 'Memakai akun Google yang terhubung di Master Data > Logo & Desain'}
      wide
      onClose={onClose}
      footer={<><button className="pap-btn" disabled={loading || busy} onClick={preview}><RefreshCw /> Muat ulang</button><span className="pap-spacer" /><button className="pap-btn" onClick={onClose}>Tutup</button>{canSync && <button className="pap-primary-button" disabled={loading || busy || !data?.baris} onClick={sync}>{busy ? 'Menyinkronkan...' : 'Sinkron sekarang'}</button>}</>}
    >
      {error && <Notice onClose={() => setError('')}>{error}</Notice>}
      <Field label="Link spreadsheet Laporan Kerusakan Mesin">
        <div className="pap-inline-actions">
          <input className="pap-input" value={url} disabled={!!data && !canSync} onChange={(e) => setUrl(e.target.value)} placeholder="https://docs.google.com/spreadsheets/d/..." />
          {url && <a className="pap-icon-button" href={url} target="_blank" rel="noreferrer" aria-label="Buka spreadsheet"><ExternalLink /></a>}
          {(!data || canSync) && url && url !== data?.url && <button className="pap-btn" disabled={busy} onClick={saveUrl}>Simpan link</button>}
        </div>
      </Field>
      <p className="pap-muted">Spreadsheet (Google Sheet atau file Excel di Drive) harus bisa dibuka akun Google tersebut (bagikan sebagai Viewer). Tab berjudul “REKAP” dibaca dengan kolom NO, TANGGAL, MESIN, Komponen, KERUSAKAN, TINDAKAN (bila ada), KETERANGAN. Baris tanpa NO melanjutkan laporan di atasnya. Sinkron otomatis berjalan bersama sinkron Google Drive (±30 menit).</p>
      {loading ? <p className="pap-muted">Membaca spreadsheet...</p> : data && (
        <>
          <ul className="pap-dash-agenda">
            {data.tabs.map((t) => (
              <li key={t.title}><div className="pap-sync-tab"><FileSpreadsheet /><span><b>{t.title}</b> · {t.note ?? `${t.rows} baris kerusakan`}{t.used ? ' · dipakai' : ''}</span></div></li>
            ))}
          </ul>
          {data.baris > 0 && <p><b>{data.laporan}</b> laporan, <b>{data.baris}</b> baris kerusakan siap disinkron.</p>}
          {!!data.contoh?.length && (
            <div className="pap-muted">Terbaru: {data.contoh.map((c, i) => <div key={i}>{formatDate(c.tanggal)} · {c.mesin ?? '—'} · {c.kerusakan ?? '—'}</div>)}</div>
          )}
        </>
      )}
      {!canSync && data && <p className="pap-muted">Sinkron dijalankan Teknik, kepala Produksi/PPIC, dan GM.</p>}
    </Modal>
  )
}
