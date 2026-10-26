'use client'

import { useCallback, useEffect, useState } from 'react'
import { BookOpenCheck, CalendarCheck, ExternalLink, FileSpreadsheet, Pencil, Plus, Printer, RefreshCw, Search, Trash2 } from 'lucide-react'
import type { UserProfile } from '@/lib/users'
import { MaintenancePage } from './maintenance-page'
import { api, Field, formatDate, Modal, Notice, useQuickActionWatch } from './ui'

// Menu Perawatan Mesin: Jadwal & checkup (dari aplikasi) dan Lembar perawatan (dari Google Drive)
export function PerawatanMesinPage({ user, focusId }: { user: UserProfile; focusId?: number | null }) {
  const [tab, setTab] = useState<'jadwal' | 'lembar'>('jadwal')
  // Aksi cepat "Catat checkup" dijalankan di tab Jadwal & checkup
  useQuickActionWatch((name) => { if (name === 'checkup-perawatan') setTab('jadwal') })
  return (
    <>
      <div className="pap-segmented pap-view-switch" role="tablist" aria-label="Tampilan Perawatan Mesin">
        <button className={tab === 'jadwal' ? 'active' : ''} onClick={() => setTab('jadwal')}><CalendarCheck /> Jadwal &amp; checkup</button>
        <button className={tab === 'lembar' ? 'active' : ''} onClick={() => setTab('lembar')}><BookOpenCheck /> Lembar perawatan</button>
      </div>
      {tab === 'jadwal' ? <MaintenancePage user={user} focusId={focusId} /> : <MaintenanceSheetView />}
    </>
  )
}

type SheetMachine = { tab: string; mesin: string; machine_id: number | null; machine_nama: string | null; machine_kode: string | null; parts: number; langkah: number }
type Step = { id: number; part_no: number | null; part: string; kelompok: string | null; langkah_urut: number; langkah: string; keterangan: string | null }
type PartImage = { id: number; part_no: number | null; part: string; urut: number }
type Data = { tab: string | null; machines: SheetMachine[]; items: Step[]; images: PartImage[]; synced_at: string | null; can: { sync: boolean; edit?: boolean } }

function MaintenanceSheetView() {
  const [data, setData] = useState<Data | null>(null)
  const [tab, setTab] = useState('')
  const [q, setQ] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [sheetOpen, setSheetOpen] = useState(false)
  // Ubah langkah / tambah langkah ke part / part baru (ditulis ke spreadsheet)
  const [stepForm, setStepForm] = useState<{ step: Step } | { part: string; kelompok: string | null; baru?: boolean } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api<Data>(`/api/maintenance/checklist${tab ? `?tab=${encodeURIComponent(tab)}` : ''}`)
      setData(res)
      if (res.tab && res.tab !== tab) setTab(res.tab)
      setError('')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [tab])
  useEffect(() => { load() }, [load])

  const current = data?.machines.find((m) => m.tab === data.tab)
  const canEdit = !!data?.can.edit
  async function removeStep(s: Step) {
    if (!window.confirm(`Hapus langkah "${s.langkah.slice(0, 60)}" dari spreadsheet Lembar Perawatan?`)) return
    try {
      await api(`/api/maintenance/checklist/${s.id}`, { method: 'DELETE' })
      setMessage('Langkah dihapus dari spreadsheet.')
      load()
    } catch (e) {
      setError((e as Error).message)
    }
  }
  // Kelompokkan langkah per part; pencarian menyaring part/langkah
  const term = q.trim().toLowerCase()
  const parts: { key: string; no: number | null; part: string; kelompok: string | null; steps: Step[] }[] = []
  for (const s of data?.items ?? []) {
    const last = parts.at(-1)
    if (last && last.part === s.part && last.no === s.part_no) last.steps.push(s)
    else parts.push({ key: `${s.part_no}-${s.part}-${s.id}`, no: s.part_no, part: s.part, kelompok: s.kelompok, steps: [s] })
  }
  const shown = term
    ? parts.map((p) => (`${p.part} ${p.kelompok ?? ''}`.toLowerCase().includes(term) ? p : { ...p, steps: p.steps.filter((s) => s.langkah.toLowerCase().includes(term)) })).filter((p) => p.steps.length)
    : parts

  return (
    <>
      <div className="pap-page-heading">
        <div>
          <p className="pap-eyebrow">TEKNIK · GOOGLE DRIVE</p>
          <h1>Lembar Perawatan Mesin</h1>
          <span>Daftar part dan langkah maintenance tiap mesin dari spreadsheet Lembar Perawatan Mesin di Google Drive. Cetak lembar untuk diisi checklist saat perawatan.</span>
        </div>
        <div className="pap-inline-actions">
          <button className="pap-btn" onClick={() => setSheetOpen(true)}><FileSpreadsheet /> Google Drive</button>
          {data?.tab && <a className="pap-primary-button" href={`/cetak/lembar-perawatan?tab=${encodeURIComponent(data.tab)}`} target="_blank" rel="noreferrer"><Printer /> Cetak lembar</a>}
        </div>
      </div>
      {message && <Notice kind="success" onClose={() => setMessage('')}>{message}</Notice>}
      <div className="pap-sync-bar">
        <div className="pap-sync-items">
          <span className="pap-sync-title">Google Drive</span>
          <span className="pap-sync-item">Lembar Perawatan Mesin: {data?.synced_at ? `sinkron ${formatDate(data.synced_at, true)}` : 'belum pernah sinkron'}</span>
          {!!data?.machines.length && <span className="pap-sync-item">{data.machines.length} mesin · {data.machines.reduce((n, m) => n + m.langkah, 0)} langkah</span>}
        </div>
        {data?.can.sync && <button className="pap-btn" onClick={() => setSheetOpen(true)}><RefreshCw /> Sinkron</button>}
      </div>
      {error && <Notice onClose={() => setError('')}>{error}</Notice>}
      {!loading && !data?.machines.length ? (
        <div className="pap-table-card"><div className="pap-empty">Belum ada lembar perawatan. Klik &quot;Google Drive&quot; lalu Sinkron untuk mengambil dari spreadsheet.</div></div>
      ) : (
        <div className="pap-msheet">
          <aside className="pap-table-card pap-msheet-machines">
            <div className="pap-card-head"><div><h2>Mesin</h2><p>{data?.machines.length ?? 0} lembar</p></div></div>
            <select className="pap-select pap-msheet-select" value={tab} onChange={(e) => setTab(e.target.value)} aria-label="Pilih mesin">
              {data?.machines.map((m) => <option key={m.tab} value={m.tab}>{m.mesin} ({m.langkah} langkah)</option>)}
            </select>
            <ul className="pap-msheet-list">
              {data?.machines.map((m) => (
                <li key={m.tab}>
                  <button className={m.tab === data.tab ? 'active' : ''} onClick={() => setTab(m.tab)}>
                    <b>{m.mesin}</b>
                    <small>{m.parts} part · {m.langkah} langkah{m.machine_kode ? ` · ${m.machine_kode}` : ''}</small>
                  </button>
                </li>
              ))}
            </ul>
          </aside>
          <section className="pap-table-card pap-msheet-body">
            <div className="pap-card-head">
              <div>
                <h2>{current?.mesin ?? 'Memuat...'}</h2>
                <p>{current ? `${current.parts} part · ${current.langkah} langkah maintenance${current.machine_nama ? ` · Data Mesin: ${current.machine_nama}` : ''}` : ''}{canEdit ? ' · tambah / ubah / hapus langsung tersimpan di spreadsheet' : ''}</p>
              </div>
              {canEdit && data?.tab && <button className="pap-btn" onClick={() => setStepForm({ part: '', kelompok: null, baru: true })}><Plus /> Part baru</button>}
            </div>
            <div className="pap-filters">
              <label className="pap-filter-search"><Search /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari part, kelompok, atau langkah..." /></label>
            </div>
            <div className="pap-msheet-parts">
              {shown.map((p, i) => {
                const pics = (data?.images ?? []).filter((g) => g.part === p.part && g.part_no === p.no)
                return (
                  <article key={p.key} className="pap-msheet-part">
                    <header>
                      <span className="pap-msheet-no">{p.no ?? i + 1}</span>
                      <div><b>{p.part}</b>{p.kelompok && <span className="pap-chip">{p.kelompok}</span>}</div>
                      {canEdit && <button className="pap-icon-button" title="Tambah langkah" aria-label={`Tambah langkah ${p.part}`} onClick={() => setStepForm({ part: p.part, kelompok: p.kelompok })}><Plus /></button>}
                    </header>
                    <div className={pics.length ? 'pap-msheet-content with-pic' : 'pap-msheet-content'}>
                      {!!pics.length && (
                        <div className="pap-msheet-pics">
                          {pics.map((g) => (
                            <a key={g.id} href={`/api/maintenance/sheet-image/${g.id}`} target="_blank" rel="noreferrer" title={`Buka gambar ${p.part}`}>
                              <img src={`/api/maintenance/sheet-image/${g.id}`} alt={p.part} loading="lazy" />
                            </a>
                          ))}
                        </div>
                      )}
                      <ol>
                        {p.steps.map((s) => (
                          <li key={s.id}>
                            {s.langkah}{s.keterangan && <small className="pap-muted"> — {s.keterangan}</small>}
                            {canEdit && (
                              <span className="pap-checkpoint-actions">
                                <button className="pap-icon-button" title="Ubah" aria-label="Ubah langkah" onClick={() => setStepForm({ step: s })}><Pencil /></button>
                                <button className="pap-icon-button" title="Hapus" aria-label="Hapus langkah" onClick={() => removeStep(s)}><Trash2 /></button>
                              </span>
                            )}
                          </li>
                        ))}
                      </ol>
                    </div>
                  </article>
                )
              })}
              {!loading && data?.machines.length && !shown.length && <div className="pap-empty">Tidak ada part atau langkah yang cocok.</div>}
              {loading && !data && <div className="pap-empty">Memuat lembar perawatan...</div>}
            </div>
          </section>
        </div>
      )}
      {stepForm && data?.tab && <StepForm tab={data.tab} target={stepForm} onClose={() => setStepForm(null)} onSaved={(t) => { setStepForm(null); setMessage(t); load() }} />}
      {sheetOpen && <MaintenanceSheetSync onClose={() => setSheetOpen(false)} onImported={(text) => { setSheetOpen(false); setMessage(text); load() }} />}
    </>
  )
}

// ---------- Sinkron dari spreadsheet Lembar Perawatan Mesin di Google Drive ----------
type SheetPreview = { url: string; account: string | null; canSync: boolean; tabs: { title: string; mesin: string | null; parts: number; langkah: number }[] }

function MaintenanceSheetSync({ onClose, onImported }: { onClose: () => void; onImported: (message: string) => void }) {
  const [data, setData] = useState<SheetPreview | null>(null)
  const [url, setUrl] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const preview = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await api<SheetPreview & { error?: string }>('/api/maintenance/sheet')
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
      await api('/api/maintenance/sheet', { method: 'PUT', json: { url } })
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
      const res = await api<{ mesin: number; part: number; langkah: number }>('/api/maintenance/sheet', { method: 'POST' })
      onImported(`Sinkron lembar perawatan selesai: ${res.mesin} mesin, ${res.part} part, ${res.langkah} langkah.`)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const canSync = data?.canSync ?? false
  const ready = data?.tabs.filter((t) => t.langkah) ?? []

  return (
    <Modal
      title="Lembar Perawatan dari Google Drive"
      subtitle={data?.account ? `Dibaca dengan akun Google ${data.account} (sama dengan Master Data > Logo & Desain)` : 'Memakai akun Google yang terhubung di Master Data > Logo & Desain'}
      wide
      onClose={onClose}
      footer={<><button className="pap-btn" disabled={loading || busy} onClick={preview}><RefreshCw /> Muat ulang</button><span className="pap-spacer" /><button className="pap-btn" onClick={onClose}>Tutup</button>{canSync && <button className="pap-primary-button" disabled={loading || busy || !ready.length} onClick={sync}>{busy ? 'Menyinkronkan...' : 'Sinkron sekarang'}</button>}</>}
    >
      {error && <Notice onClose={() => setError('')}>{error}</Notice>}
      <Field label="Link spreadsheet Lembar Perawatan Mesin">
        <div className="pap-inline-actions">
          <input className="pap-input" value={url} disabled={!!data && !canSync} onChange={(e) => setUrl(e.target.value)} placeholder="https://docs.google.com/spreadsheets/d/..." />
          {url && <a className="pap-icon-button" href={url} target="_blank" rel="noreferrer" aria-label="Buka spreadsheet"><ExternalLink /></a>}
          {(!data || canSync) && url && url !== data?.url && <button className="pap-btn" disabled={busy} onClick={saveUrl}>Simpan link</button>}
        </div>
      </Field>
      <p className="pap-muted">Spreadsheet harus bisa dibuka akun Google tersebut (bagikan sebagai Viewer). Tiap tab mesin dibaca dengan kolom NO, NAMA PART, KELOMPOK, MAINTENANCE (langkah), CHECK LIST, KETERANGAN; baris tanpa NO adalah langkah lanjutan part di atasnya. Sinkron otomatis berjalan bersama sinkron Google Drive (±30 menit).</p>
      {loading ? <p className="pap-muted">Membaca spreadsheet...</p> : data && (
        <ul className="pap-dash-agenda">
          {data.tabs.map((t) => (
            <li key={t.title}><div className="pap-sync-tab"><FileSpreadsheet /><span><b>{t.title}</b> · {t.langkah ? `${t.parts} part, ${t.langkah} langkah` : 'bukan lembar perawatan (dilewati)'}</span></div></li>
          ))}
        </ul>
      )}
      {!canSync && data && <p className="pap-muted">Sinkron dijalankan divisi Teknik dan GM.</p>}
    </Modal>
  )
}

// Form langkah lembar perawatan: ditulis ke spreadsheet, lalu lembar disinkron ulang
function StepForm({ tab, target, onClose, onSaved }: { tab: string; target: { step: Step } | { part: string; kelompok: string | null; baru?: boolean }; onClose: () => void; onSaved: (message: string) => void }) {
  const step = 'step' in target ? target.step : null
  const baru = !step && 'baru' in target && !!target.baru
  const [v, setV] = useState({ part: step?.part ?? ('part' in target ? target.part : ''), kelompok: step?.kelompok ?? ('kelompok' in target ? target.kelompok ?? '' : ''), langkah: step?.langkah ?? '', keterangan: step?.keterangan ?? '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function save(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      if (step) await api(`/api/maintenance/checklist/${step.id}`, { method: 'PATCH', json: v })
      else await api('/api/maintenance/checklist', { method: 'POST', json: { ...v, tab } })
      onSaved(step ? 'Langkah diperbarui di spreadsheet.' : baru ? `Part ${v.part} ditambahkan ke spreadsheet.` : 'Langkah ditambahkan ke spreadsheet.')
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal title={step ? 'Ubah langkah' : baru ? 'Part baru' : `Tambah langkah · ${v.part}`} subtitle={`Ditulis langsung ke tab "${tab}" di spreadsheet Lembar Perawatan`} onClose={onClose}
      footer={<><span className="pap-spacer" /><button className="pap-btn" onClick={onClose}>Batal</button><button className="pap-primary-button" form="step-form" disabled={busy}>{busy ? 'Menyimpan ke spreadsheet...' : 'Simpan'}</button></>}>
      <form id="step-form" className="pap-form-grid" onSubmit={save}>
        {error && <div className="full"><Notice onClose={() => setError('')}>{error}</Notice></div>}
        {baru && <Field label="Nama part *"><input className="pap-input" required maxLength={200} value={v.part} onChange={(e) => setV({ ...v, part: e.target.value })} /></Field>}
        {baru && <Field label="Kelompok"><input className="pap-input" maxLength={150} value={v.kelompok} onChange={(e) => setV({ ...v, kelompok: e.target.value })} /></Field>}
        <Field label="Langkah maintenance *" full><textarea className="pap-input" rows={3} required maxLength={2000} value={v.langkah} onChange={(e) => setV({ ...v, langkah: e.target.value })} /></Field>
        <Field label="Keterangan" full><input className="pap-input" maxLength={2000} value={v.keterangan} onChange={(e) => setV({ ...v, keterangan: e.target.value })} /></Field>
      </form>
    </Modal>
  )
}
