'use client'

import { useCallback, useEffect, useState } from 'react'
import { Cog, ExternalLink, FileSpreadsheet, FileText, ListChecks, Pencil, Plus, RefreshCw, Trash2, Wrench } from 'lucide-react'
import type { UserProfile } from '@/lib/users'
import { api, Field, Modal, Notice, Pager, usePaged } from './ui'

type Machine = { id: number; kode: string; nama: string; tahap: string; kapasitas: string | null; status: 'aktif' | 'maintenance' | 'nonaktif'; keterangan: string | null; lini: string | null; antrian: number; sedang_dikerjakan: string | null; critical_point: number; perbaikan_terbuka: number }

const STATUS_LABEL = { aktif: 'Aktif', maintenance: 'Maintenance', nonaktif: 'Nonaktif' } as const
const STATUS_TONE = { aktif: 'success', maintenance: 'warning', nonaktif: 'neutral' } as const

export function MachinePage({ user }: { user: UserProfile }) {
  const [items, setItems] = useState<Machine[]>([])
  const [tahapList, setTahapList] = useState<string[]>(['Blow', 'Cetak', 'Bag making', 'Lainnya'])
  const [canManage, setCanManage] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [form, setForm] = useState<Machine | 'new' | null>(null)
  const [detailId, setDetailId] = useState<number | null>(null)
  const [sheetOpen, setSheetOpen] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api<{ items: Machine[]; tahap: string[]; canManage: boolean }>('/api/machines')
      setItems(res.items)
      setTahapList(res.tahap)
      setCanManage(res.canManage)
      setError('')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => { load() }, [load])

  const flash = (text: string) => {
    setMessage(text)
    setTimeout(() => setMessage(''), 5000)
  }
  const count = (status: Machine['status']) => items.filter((m) => m.status === status).length
  const busyCount = items.filter((m) => m.sedang_dikerjakan).length
  // Dikelompokkan per lini produksi (dari sheet mapping teknis); mesin tanpa lini di akhir
  const paged = usePaged(items, items.length)
  const groups = [...new Set(paged.items.map((m) => m.lini ?? ''))].map((lini) => ({ lini, list: paged.items.filter((m) => (m.lini ?? '') === lini) }))

  return (
    <>
      <div className="pap-page-heading">
        <div>
          <p className="pap-eyebrow">PRODUKSI · TEKNIK</p>
          <h1>Data Mesin</h1>
          <span>Mesin produksi per lini & tahap, beserta critical point perawatan (langkah, foto/video Drive, SOP) dari spreadsheet Mapping Teknis Mesin.</span>
        </div>
        <div className="pap-inline-actions">
          <button className="pap-btn" onClick={() => setSheetOpen(true)}><FileSpreadsheet /> Google Sheet</button>
          {canManage && <button className="pap-primary-button" onClick={() => setForm('new')}><Plus /> Tambah mesin</button>}
        </div>
      </div>
      {message && <Notice kind="success" onClose={() => setMessage('')}>{message}</Notice>}
      <div className="pap-stat-grid four">
        <div className="pap-stat-card"><div><span>Mesin aktif</span><strong>{count('aktif')}/{items.length}</strong><small className="neutral">{busyCount} sedang memproduksi</small></div><div className="pap-stat-icon stat-0"><Cog /></div></div>
        <div className="pap-stat-card"><div><span>Maintenance</span><strong>{count('maintenance')}</strong><small className="neutral">{items.reduce((n, m) => n + m.perbaikan_terbuka, 0)} laporan kerusakan terbuka</small></div><div className="pap-stat-icon stat-2"><Wrench /></div></div>
        <div className="pap-stat-card"><div><span>Critical point</span><strong>{items.reduce((n, m) => n + m.critical_point, 0)}</strong><small className="neutral">langkah perawatan dari sheet teknis</small></div><div className="pap-stat-icon stat-1"><ListChecks /></div></div>
        <div className="pap-stat-card"><div><span>Antrian tahap</span><strong>{items.reduce((n, m) => n + m.antrian, 0)}</strong><small className="neutral">Tahap belum selesai di semua mesin</small></div><div className="pap-stat-icon stat-1"><Cog /></div></div>
      </div>
      <div className="pap-table-card">
        <div className="pap-card-head"><div><h2>Daftar mesin</h2><p>{canManage ? 'PPIC & Teknik dapat menambah, mengubah, dan menyinkron data mesin. Klik mesin untuk melihat critical point.' : `${user.division.name} · klik mesin untuk melihat critical point perawatan`}</p></div></div>
        {error && <div className="pap-card-notice"><Notice onClose={() => setError('')}>{error}</Notice></div>}
        <div className="pap-table-wrap">
          <table>
            <thead><tr><th>Mesin</th><th>Tahap</th><th className="pap-num">Critical point</th><th>Sedang dikerjakan</th><th className="pap-num">Antrian</th><th>Status</th>{canManage && <th aria-label="Aksi" />}</tr></thead>
            {groups.map((g) => (
              <tbody key={g.lini}>
                {groups.length > 1 && <tr className="pap-group-row"><td colSpan={canManage ? 7 : 6}>{g.lini || 'Mesin lain'}</td></tr>}
                {g.list.map((m) => (
                  <tr key={m.id} className="pap-row-link" onClick={() => setDetailId(m.id)}>
                    <td><div className="pap-cell-title">{m.nama}</div><div className="pap-cell-sub">{m.kode}{m.kapasitas ? ` · ${m.kapasitas}` : ''}</div></td>
                    <td>{m.tahap}</td>
                    <td className="pap-num">{m.critical_point || <span className="pap-muted">—</span>}</td>
                    <td>{m.sedang_dikerjakan ?? <span className="pap-muted">—</span>}</td>
                    <td className="pap-num">{m.antrian}</td>
                    <td><span className={`pap-status ${STATUS_TONE[m.status]}`}>{STATUS_LABEL[m.status]}</span>{m.perbaikan_terbuka > 0 && <div className="pap-cell-sub pap-text-danger">{m.perbaikan_terbuka} kerusakan terbuka</div>}</td>
                    {canManage && <td><button className="pap-icon-button" aria-label={`Edit ${m.nama}`} onClick={(e) => { e.stopPropagation(); setForm(m) }}><Pencil /></button></td>}
                  </tr>
                ))}
              </tbody>
            ))}
          </table>
          {!loading && !items.length && <div className="pap-empty">Belum ada mesin. {canManage ? 'Klik "Google Sheet" untuk mengambil data mesin dari spreadsheet Mapping Teknis Mesin, atau "Tambah mesin".' : 'PPIC / Teknik dapat menambahkan mesin.'}</div>}
          {loading && !items.length && <div className="pap-empty">Memuat mesin...</div>}
          <Pager {...paged.pager} noun="mesin" />
        </div>
      </div>
      {form && <MachineForm initial={form === 'new' ? null : form} tahapList={tahapList} onClose={() => setForm(null)} onSaved={(text) => { setForm(null); flash(text); load() }} />}
      {detailId && <MachineDetail id={detailId} onClose={() => setDetailId(null)} onEdit={(m) => { setDetailId(null); setForm(m) }} />}
      {sheetOpen && <MachineSheetSync onClose={() => setSheetOpen(false)} onImported={(t) => { setSheetOpen(false); flash(t); load() }} />}
    </>
  )
}

// ---------- Detail mesin: critical point perawatan ----------
type Checkpoint = { id: number; komponen: string; komponen_urut: number; jenis: 'langkah' | 'catatan'; urut: number; teks: string; keterangan: string | null; link: string | null; drive_file_id: string | null }
type MachineDoc = { id: number; judul: string; url: string | null; drive_file_id: string | null }
type RepairRow = { id: number; nomor: string | null; keluhan: string; status: string; prioritas: string; created_at: string }

// Preview gambar Drive (seperti Master Data desain); disembunyikan bila file bukan gambar/video
function DriveThumb({ fileId, title }: { fileId: string; title: string }) {
  const [state, setState] = useState<'loading' | 'ok' | 'failed'>('loading')
  if (state === 'failed') return null
  return <img className="pap-machine-thumb" style={state === 'ok' ? undefined : { display: 'none' }} src={`/api/machines/drive/${fileId}/thumb?s=360`} alt={title} onLoad={() => setState('ok')} onError={() => setState('failed')} />
}

function MachineDetail({ id, onClose, onEdit }: { id: number; onClose: () => void; onEdit: (m: Machine) => void }) {
  const [data, setData] = useState<{ machine: Machine; checkpoints: Checkpoint[]; documents: MachineDoc[]; repairs: RepairRow[]; canManage: boolean } | null>(null)
  const [error, setError] = useState('')
  useEffect(() => { api<NonNullable<typeof data>>(`/api/machines/${id}`).then(setData).catch((e) => setError(e.message)) }, [id])
  if (!data) return <Modal title="Detail mesin" onClose={onClose}>{error ? <Notice>{error}</Notice> : <p className="pap-muted">Memuat...</p>}</Modal>
  const { machine, checkpoints, documents, repairs } = data
  const components = [...new Map(checkpoints.map((c) => [c.komponen_urut, c.komponen])).entries()]
  return (
    <Modal
      wide
      title={machine.nama}
      subtitle={`${machine.kode} · ${machine.tahap}${machine.lini ? ` · ${machine.lini}` : ''}`}
      onClose={onClose}
      footer={<><span className="pap-spacer" /><button className="pap-btn" onClick={onClose}>Tutup</button>{data.canManage && <button className="pap-primary-button" onClick={() => onEdit(machine)}><Pencil /> Edit mesin</button>}</>}
    >
      <div className="pap-detail-badges">
        <span className={`pap-status ${STATUS_TONE[machine.status]}`}>{STATUS_LABEL[machine.status]}</span>
        {machine.kapasitas && <span className="pap-status neutral">{machine.kapasitas}</span>}
      </div>
      {documents.length > 0 && (
        <section className="pap-detail-section">
          <h3>Data pembantu</h3>
          <ul className="pap-file-list">
            {documents.map((d) => (
              <li key={d.id}>
                <FileText />
                <div>{d.url ? <a href={d.url} target="_blank" rel="noopener noreferrer">{d.judul} <ExternalLink className="pap-inline-icon" /></a> : <span>{d.judul}</span>}<span>{d.url ? (d.url.includes('presentation') ? 'Google Slides' : d.url.includes('drive.google') ? 'Google Drive' : 'Dokumen') : 'Chip file Google (tanpa link)'}</span></div>
              </li>
            ))}
          </ul>
        </section>
      )}
      <section className="pap-detail-section">
        <h3>Critical point perawatan</h3>
        {!checkpoints.length && <p className="pap-muted">Belum ada critical point. Sinkron dari Google Sheet di halaman Data Mesin.</p>}
        <div className="pap-checkpoint-groups">
          {components.map(([urut, nama]) => (
            <div key={urut} className="pap-checkpoint-group">
              <h4>{nama}</h4>
              <ol className="pap-checkpoints">
                {checkpoints.filter((c) => c.komponen_urut === urut).map((c) => (
                  <li key={c.id} className={c.jenis}>
                    {c.jenis === 'langkah' && <span className="pap-checkpoint-no">{c.urut}</span>}
                    <div>
                      <p>{c.teks}</p>
                      {c.keterangan && <small>→ {c.keterangan}</small>}
                      {c.link && (
                        <a className="pap-checkpoint-link" href={c.link} target="_blank" rel="noopener noreferrer">
                          {c.drive_file_id && <DriveThumb fileId={c.drive_file_id} title={c.teks} />}
                          <span><ExternalLink className="pap-inline-icon" /> Buka foto / video</span>
                        </a>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          ))}
        </div>
      </section>
      {repairs.length > 0 && (
        <section className="pap-detail-section">
          <h3>Laporan kerusakan terakhir</h3>
          <ul className="pap-formula-jobs">{repairs.map((r) => <li key={r.id}><b>{r.nomor}</b> · {r.keluhan.slice(0, 90)} <span className="pap-status neutral">{r.status}</span></li>)}</ul>
        </section>
      )}
    </Modal>
  )
}

// ---------- Sinkron dari spreadsheet Mapping Teknis Mesin ----------
type SheetPreview = {
  url: string; account: string | null; canSync: boolean; tabs: string[]; error?: string
  machines: { kode: string; nama: string; lini: string | null; tahap: string; dokumen: number; komponen: number; langkah: number }[]
}

function MachineSheetSync({ onClose, onImported }: { onClose: () => void; onImported: (message: string) => void }) {
  const [data, setData] = useState<SheetPreview | null>(null)
  const [url, setUrl] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const preview = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await api<SheetPreview>('/api/machines/sheet')
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
    try {
      await api('/api/machines/sheet', { method: 'PUT', json: { url } })
      await preview()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  async function importAll() {
    setBusy(true)
    setError('')
    try {
      const res = await api<{ mesin: number; baru: number; langkah: number; dokumen: number }>('/api/machines/sheet', { method: 'POST' })
      onImported(`Sinkron selesai: ${res.mesin} mesin (${res.baru} baru), ${res.langkah} langkah critical point, ${res.dokumen} data pembantu.`)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const canSync = data?.canSync ?? false
  return (
    <Modal
      wide
      title="Sinkron Data Mesin dari Google Sheet"
      subtitle={data?.account ? `Dibaca dengan akun Google ${data.account} (sama dengan Master Data > Logo & Desain)` : 'Memakai akun Google yang terhubung di Master Data > Logo & Desain'}
      onClose={onClose}
      footer={<><button className="pap-btn" disabled={loading || busy} onClick={preview}><RefreshCw /> Muat ulang</button><span className="pap-spacer" /><button className="pap-btn" onClick={onClose}>Tutup</button>{canSync && <button className="pap-primary-button" disabled={busy || loading || !data?.machines.length} onClick={importAll}>{busy ? 'Menyinkron...' : `Sinkron ${data?.machines.length ?? 0} mesin`}</button>}</>}
    >
      {error && <Notice onClose={() => setError('')}>{error}</Notice>}
      <Field label="Link spreadsheet Mapping Teknis Mesin">
        <div className="pap-inline-actions">
          <input className="pap-input" value={url} disabled={!!data && !canSync} onChange={(e) => setUrl(e.target.value)} />
          {url && <a className="pap-icon-button" href={url} target="_blank" rel="noreferrer" aria-label="Buka spreadsheet"><ExternalLink /></a>}
          {canSync && data && url !== data.url && <button className="pap-btn" disabled={busy} onClick={saveUrl}>Simpan link</button>}
        </div>
      </Field>
      <p className="pap-muted">Spreadsheet harus bisa dibuka akun Google tersebut (bagikan sebagai Viewer). Dibaca: judul lini (INLINE PP / INLINE HD), mesin (A. MC BLOW), komponen (- EPC), langkah bernomor beserta link foto/video, dan Data Pembantu. Mesin baru dibuat otomatis; status, kapasitas, dan keterangan yang diatur di PAP-MS tidak ditimpa. Sinkron ulang mengganti critical point dengan isi sheet terbaru.</p>
      {loading ? <p className="pap-muted">Membaca spreadsheet...</p> : data && data.machines.length > 0 && (
        <div className="pap-table-wrap bordered">
          <table>
            <thead><tr><th>Mesin</th><th>Lini · tahap</th><th className="pap-num">Komponen</th><th className="pap-num">Langkah</th><th className="pap-num">Data pembantu</th></tr></thead>
            <tbody>{data.machines.map((m) => <tr key={m.kode}><td><div className="pap-cell-title">{m.nama}</div><div className="pap-cell-sub">{m.kode}</div></td><td>{m.lini ?? '—'} · {m.tahap}</td><td className="pap-num">{m.komponen}</td><td className="pap-num">{m.langkah}</td><td className="pap-num">{m.dokumen}</td></tr>)}</tbody>
          </table>
        </div>
      )}
      {!loading && data && !data.machines.length && !error && <div className="pap-empty">Belum ada mesin yang dikenali di spreadsheet.</div>}
    </Modal>
  )
}

function MachineForm({ initial, tahapList, onClose, onSaved }: { initial: Machine | null; tahapList: string[]; onClose: () => void; onSaved: (message: string) => void }) {
  const [values, setValues] = useState({
    kode: initial?.kode ?? '',
    nama: initial?.nama ?? '',
    tahap: initial?.tahap ?? 'Blow',
    kapasitas: initial?.kapasitas ?? '',
    status: initial?.status ?? 'aktif',
    keterangan: initial?.keterangan ?? '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const set = (key: keyof typeof values) => (e: { target: { value: string } }) => setValues((v) => ({ ...v, [key]: e.target.value }))

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError('')
    try {
      if (initial) await api(`/api/machines/${initial.id}`, { method: 'PATCH', json: values })
      else await api('/api/machines', { method: 'POST', json: values })
      onSaved(initial ? 'Mesin diperbarui.' : 'Mesin ditambahkan.')
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }
  async function remove() {
    if (!initial || !window.confirm(`Hapus mesin ${initial.nama}? Tahap yang memakai mesin ini perlu dijadwalkan ulang.`)) return
    setSaving(true)
    try {
      await api(`/api/machines/${initial.id}`, { method: 'DELETE' })
      onSaved('Mesin dihapus.')
    } catch (err) {
      setError((err as Error).message)
      setSaving(false)
    }
  }

  return (
    <Modal
      title={initial ? 'Edit mesin' : 'Tambah mesin'}
      subtitle={initial?.kode}
      onClose={onClose}
      footer={<>{initial && <button type="button" className="pap-btn danger" disabled={saving} onClick={remove}><Trash2 /> Hapus</button>}<span className="pap-spacer" /><button type="button" className="pap-btn" onClick={onClose}>Batal</button><button type="submit" form="machine-form" className="pap-primary-button" disabled={saving}>{saving ? 'Menyimpan...' : 'Simpan'}</button></>}
    >
      <form id="machine-form" className="pap-form-grid" onSubmit={submit}>
        {error && <div className="full"><Notice onClose={() => setError('')}>{error}</Notice></div>}
        <Field label="Kode mesin"><input className="pap-input" required maxLength={30} value={values.kode} onChange={set('kode')} placeholder="Contoh: BLW-01" /></Field>
        <Field label="Nama mesin"><input className="pap-input" required maxLength={150} value={values.nama} onChange={set('nama')} placeholder="Contoh: Mesin Blow 1" /></Field>
        <Field label="Tahap">
          <select className="pap-select" value={values.tahap} onChange={set('tahap')}>{tahapList.map((t) => <option key={t} value={t}>{t}</option>)}</select>
        </Field>
        <Field label="Status">
          <select className="pap-select" value={values.status} onChange={set('status')}>{Object.entries(STATUS_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        </Field>
        <Field label="Kapasitas (opsional)" full><input className="pap-input" maxLength={150} value={values.kapasitas} onChange={set('kapasitas')} placeholder="Contoh: 500 kg/hari" /></Field>
        <Field label="Keterangan (opsional)" full><textarea className="pap-input" rows={2} maxLength={5000} value={values.keterangan} onChange={set('keterangan')} /></Field>
      </form>
    </Modal>
  )
}
