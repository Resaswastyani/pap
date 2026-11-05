'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, Archive, CalendarClock, Camera, ClipboardList, FileSpreadsheet, Package, Pencil, Plus, Search, Trash2, UserX, Wallet, Wrench } from 'lucide-react'
import type { UserProfile } from '@/lib/users'
import { formatRupiah } from './accurate'
import { compressImage } from './compress'
import { api, askReason, confirmDialog, Field, formatDate, Modal, Notice, Pager, RowActions, usePaged } from './ui'

type Kondisi = 'baik' | 'perlu_perbaikan' | 'rusak' | 'hilang'
type LogJenis = 'tambah' | 'mutasi' | 'kondisi' | 'perbaikan' | 'catatan' | 'penghapusan'
type Item = {
  id: number; kode: string; nama: string; kategori: string | null; merek: string | null; nomor_seri: string | null; jumlah: number; lokasi: string | null
  tahun: number | null; pajak_tahunan: string | null; pajak_lima_tahunan: string | null; uji_kir: string | null
  pemegang_id: number | null; pemegang_nama: string | null; pemegang_lain: string | null; tanggal_beli: string | null; harga_beli: number | null
  kondisi: Kondisi; status: 'aktif' | 'dihapuskan'; catatan: string | null; foto_versi: string | null; perbaikan_terakhir: string | null
}
type Log = { id: number; tanggal: string; jenis: LogJenis; keterangan: string | null; biaya: number | null; created_at: string; created_name: string }
type Summary = { total: number; unit: number; nilai: number; bermasalah: number; tanpa_pemegang: number; jatuh_tempo: number }
type Person = { id: number; name: string; division_name: string }

const KONDISI_LABEL: Record<Kondisi, string> = { baik: 'Baik', perlu_perbaikan: 'Perlu perbaikan', rusak: 'Rusak', hilang: 'Hilang' }
const KONDISI_TONE: Record<Kondisi, string> = { baik: 'success', perlu_perbaikan: 'warning', rusak: 'danger', hilang: 'danger' }
const LOG_LABEL: Record<LogJenis, string> = { tambah: 'Didata', mutasi: 'Mutasi', kondisi: 'Kondisi', perbaikan: 'Perbaikan', catatan: 'Catatan', penghapusan: 'Penghapusan' }
const LOG_TONE: Record<LogJenis, string> = { tambah: 'neutral', mutasi: 'info', kondisi: 'warning', perbaikan: 'warning', catatan: 'neutral', penghapusan: 'danger' }
const holder = (i: Item) => i.pemegang_nama ?? i.pemegang_lain
const fotoUrl = (i: Item) => `/api/ga/inventaris/${i.id}/foto?v=${i.foto_versi}`
const today = () => new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10)
const isVehicle = (kategori: string | null | undefined) => (kategori ?? '').trim().toLowerCase() === 'kendaraan'
// Sisa hari ke tanggal jatuh tempo (negatif = lewat)
const daysTo = (d: string) => Math.round((Date.parse(d.slice(0, 10)) - Date.parse(today())) / 86400e3)
const VEHICLE_DATES = [['pajak_tahunan', 'Pajak tahunan'], ['pajak_lima_tahunan', 'Pajak 5 tahunan'], ['uji_kir', 'Uji KIR']] as const
function DueBadge({ date }: { date: string }) {
  const n = daysTo(date)
  if (n > 30) return null
  return <span className={`pap-status ${n < 0 ? 'danger' : 'warning'}`}>{n < 0 ? `lewat ${-n} hari` : n === 0 ? 'hari ini' : `${n} hari lagi`}</span>
}
const nearestDue = (i: Item) => VEHICLE_DATES.flatMap(([k, l]) => (i[k] ? [{ label: l as string, date: i[k] as string }] : [])).sort((a, b) => a.date.localeCompare(b.date))[0]

export function InventarisPage({ focusId }: { user: UserProfile; focusId?: number | null }) {
  const [items, setItems] = useState<Item[]>([])
  const [summary, setSummary] = useState<Summary | null>(null)
  const [categories, setCategories] = useState<string[]>([])
  const [locations, setLocations] = useState<string[]>([])
  const [people, setPeople] = useState<Person[]>([])
  const [can, setCan] = useState({ manage: false })
  const [q, setQ] = useState('')
  const [kategori, setKategori] = useState('')
  const [lokasi, setLokasi] = useState('')
  const [kondisi, setKondisi] = useState('')
  const [status, setStatus] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [form, setForm] = useState<Item | 'new' | null>(null)
  const [importing, setImporting] = useState(false)
  const [detailId, setDetailId] = useState<number | null>(focusId ?? null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (q.trim()) params.set('q', q.trim())
      if (kategori) params.set('kategori', kategori)
      if (lokasi) params.set('lokasi', lokasi)
      if (kondisi === 'kosong') params.set('pemegang', 'kosong')
      else if (kondisi === 'jatuh_tempo') params.set('jatuh_tempo', '1')
      else if (kondisi) params.set('kondisi', kondisi)
      if (status) params.set('status', status)
      const res = await api<{ items: Item[]; summary: Summary; categories: string[]; locations: string[]; users: Person[]; can: typeof can }>(`/api/ga/inventaris?${params}`)
      setItems(res.items)
      setSummary(res.summary)
      setCategories(res.categories)
      setLocations(res.locations)
      setPeople(res.users)
      setCan(res.can)
      setError('')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [q, kategori, lokasi, kondisi, status])
  useEffect(() => {
    const timer = setTimeout(load, q ? 300 : 0)
    return () => clearTimeout(timer)
  }, [load, q])
  const flash = (text: string) => {
    setMessage(text)
    setTimeout(() => setMessage(''), 5000)
    load()
  }

  const paged = usePaged(items, `${q}-${kategori}-${lokasi}-${kondisi}-${status}`)
  const toggle = (k: string) => { setStatus(''); setKondisi((v) => (v === k ? '' : k)) }
  const stats: { label: string; value: string; note: string; icon: typeof Package; tone: string; active: boolean; onClick: () => void }[] = summary ? [
    { label: 'Barang inventaris', value: String(summary.total), note: `${summary.unit} unit aktif tercatat`, icon: Package, tone: 'stat-0', active: !kondisi && !status, onClick: () => { setKondisi(''); setStatus('') } },
    { label: 'Pajak / KIR kendaraan', value: String(summary.jatuh_tempo), note: `jatuh tempo ≤ 30 hari${summary.nilai ? ` · nilai aset ${formatRupiah(summary.nilai)}` : ''}`, icon: CalendarClock, tone: summary.jatuh_tempo ? 'stat-2' : 'stat-3', active: kondisi === 'jatuh_tempo', onClick: () => toggle('jatuh_tempo') },
    { label: 'Perlu perhatian', value: String(summary.bermasalah), note: 'perlu perbaikan, rusak, hilang', icon: AlertTriangle, tone: summary.bermasalah ? 'stat-2' : 'stat-3', active: kondisi === 'bermasalah', onClick: () => toggle('bermasalah') },
    { label: 'Tanpa pemegang', value: String(summary.tanpa_pemegang), note: 'belum ada penanggung jawab', icon: UserX, tone: 'stat-1', active: kondisi === 'kosong', onClick: () => toggle('kosong') },
  ] : []

  return (
    <>
      <div className="pap-page-heading">
        <div>
          <p className="pap-eyebrow">GENERAL AFFAIR</p>
          <h1>Inventaris</h1>
          <span>Daftar aset dan barang inventaris kantor: lokasi, pemegang, kondisi, serta riwayat mutasi dan perbaikan.</span>
        </div>
        {can.manage && <div className="pap-inline-actions"><button className="pap-btn" onClick={() => setImporting(true)}><FileSpreadsheet /> Impor dari Excel</button><button className="pap-primary-button" onClick={() => setForm('new')}><Plus /> Tambah barang</button></div>}
      </div>
      {message && <Notice kind="success" onClose={() => setMessage('')}>{message}</Notice>}
      {summary && (
        <div className="pap-stat-grid four">
          {stats.map((s) => (
            <button key={s.label} className={`pap-stat-card pap-stat-button ${s.active ? 'active' : ''}`} onClick={s.onClick}>
              <div><span>{s.label}</span><strong>{s.value}</strong><small className="neutral">{s.note}</small></div>
              <div className={`pap-stat-icon ${s.tone}`}><s.icon /></div>
            </button>
          ))}
        </div>
      )}
      <div className="pap-table-card">
        <div className="pap-filters pap-filters-top">
          <label className="pap-filter-search"><Search /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari kode, nama, merek, no. seri, lokasi, pemegang..." /></label>
          <select className="pap-select" value={kategori} onChange={(e) => setKategori(e.target.value)} aria-label="Filter kategori">
            <option value="">Semua kategori</option>
            {categories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <select className="pap-select" value={lokasi} onChange={(e) => setLokasi(e.target.value)} aria-label="Filter lokasi">
            <option value="">Semua lokasi</option>
            {locations.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
          <select className="pap-select" value={status ? `status:${status}` : kondisi} onChange={(e) => { const v = e.target.value; if (v.startsWith('status:')) { setStatus(v.slice(7)); setKondisi('') } else { setStatus(''); setKondisi(v) } }} aria-label="Filter kondisi">
            <option value="">Semua kondisi</option>
            {Object.entries(KONDISI_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            <option value="kosong">Tanpa pemegang</option>
            <option value="jatuh_tempo">Pajak / KIR jatuh tempo</option>
            <option value="status:dihapuskan">Sudah dihapuskan</option>
          </select>
        </div>
        {error && <div className="pap-card-notice"><Notice onClose={() => setError('')}>{error}</Notice></div>}
        <div className="pap-table-wrap">
          <table>
            <thead><tr><th>Barang</th><th>Kategori</th><th className="pap-num">Jumlah</th><th>Lokasi</th><th>Pemegang</th><th>Kondisi</th><th>Harga beli / pajak</th><th className="pap-actions-col">Aksi</th></tr></thead>
            <tbody>
              {paged.items.map((i) => (
                <tr key={i.id} className="pap-row-link" onClick={() => setDetailId(i.id)}>
                  <td>
                    <div className="pap-inv-name">
                      {i.foto_versi ? <img className="pap-inv-thumb" src={fotoUrl(i)} alt="" loading="lazy" /> : <span className="pap-inv-thumb empty"><Package /></span>}
                      <div><div className="pap-cell-title">{i.nama}</div><div className="pap-cell-sub">{[i.kode, i.merek, isVehicle(i.kategori) ? i.nomor_seri : null].filter(Boolean).join(' · ')}</div></div>
                    </div>
                  </td>
                  <td>{i.kategori ?? '—'}</td>
                  <td className="pap-num">{i.jumlah}</td>
                  <td>{i.lokasi ?? '—'}</td>
                  <td>{holder(i) ?? <span className="pap-muted">Belum ada</span>}</td>
                  <td><span className={`pap-status ${KONDISI_TONE[i.kondisi]}`}>{KONDISI_LABEL[i.kondisi]}</span>{i.status === 'dihapuskan' && <div><span className="pap-status neutral">Dihapuskan</span></div>}</td>
                  <td className="pap-nowrap">{(() => { const due = nearestDue(i); return due ? <><div>{due.label} {formatDate(due.date)}</div><DueBadge date={due.date} /></> : <>{i.harga_beli !== null ? formatRupiah(i.harga_beli) : '—'}{i.tanggal_beli && <div className="pap-cell-sub">{formatDate(i.tanggal_beli)}</div>}</> })()}</td>
                  <td className="pap-actions-cell"><RowActions label={i.nama} onView={() => setDetailId(i.id)} onEdit={can.manage ? () => setForm(i) : undefined} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          {!loading && !items.length && <div className="pap-empty">{q || kategori || lokasi || kondisi || status ? 'Tidak ada barang yang cocok dengan filter.' : 'Belum ada barang inventaris. Klik "Tambah barang" untuk mulai mendata.'}</div>}
          {loading && !items.length && <div className="pap-empty">Memuat data...</div>}
        </div>
        <Pager {...paged.pager} noun="barang" />
      </div>
      {form && <ItemForm initial={form === 'new' ? null : form} categories={categories} locations={locations} people={people} onClose={() => setForm(null)} onSaved={(text, id) => { setForm(null); flash(text); if (id) setDetailId(id) }} />}
      {importing && <ImportDialog onClose={() => setImporting(false)} onDone={(text) => { setImporting(false); flash(text) }} />}
      {detailId && <ItemDetail id={detailId} onClose={() => setDetailId(null)} onEdit={(i) => { setDetailId(null); setForm(i) }} onChanged={flash} />}
    </>
  )
}

type ImportPreview = { file: string; barang: number; unit: number; kategori: Record<string, number>; riwayat: number; riwayatTanpaTanggal: number; contoh: string[]; report: string[] }
type ImportResult = { added: number; skipped: string[]; logsAdded: number; report: string[] }

// Impor dari Excel format "Data Asset PAP": pratinjau dulu, lalu simpan. Kode yang sudah ada dilewati (tidak menimpa data).
function ImportDialog({ onClose, onDone }: { onClose: () => void; onDone: (text: string) => void }) {
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function send(mode: 'preview' | 'import') {
    if (!file) return
    setBusy(true)
    setError('')
    try {
      const body = new FormData()
      body.set('file', file)
      body.set('mode', mode)
      if (mode === 'preview') setPreview(await api<ImportPreview>('/api/ga/inventaris/import', { method: 'POST', body }))
      else {
        const res = await api<ImportResult>('/api/ga/inventaris/import', { method: 'POST', body })
        onDone(`Impor selesai: ${res.added} barang baru, ${res.logsAdded} riwayat servis${res.skipped.length ? `; ${res.skipped.length} barang dilewati karena kodenya sudah ada (${res.skipped.slice(0, 5).join(', ')}${res.skipped.length > 5 ? ', ...' : ''})` : ''}.`)
      }
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal
      title="Impor inventaris dari Excel"
      subtitle='Format "Data Asset PAP": sheet Asset, Kendaraan, Pajak Kendaraan, Record Service Kendaraan, Record Service AC'
      wide
      onClose={onClose}
      footer={<><span className="pap-spacer" /><button className="pap-btn" onClick={onClose}>Batal</button>
        {preview
          ? <button className="pap-primary-button" disabled={busy} onClick={() => send('import')}>{busy ? 'Mengimpor...' : `Impor ${preview.barang} barang`}</button>
          : <button className="pap-primary-button" disabled={busy || !file} onClick={() => send('preview')}>{busy ? 'Membaca...' : 'Lihat pratinjau'}</button>}
      </>}
    >
      {error && <Notice onClose={() => setError('')}>{error}</Notice>}
      <Field label="File Excel (.xlsx)" full hint="Barang dengan kode yang sudah ada di Inventaris dilewati, jadi aman bila file yang sama diunggah lagi.">
        <input className="pap-input" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setPreview(null); setError('') }} />
      </Field>
      {preview && (
        <div className="pap-inline-panel">
          <strong>{preview.file}</strong>
          <p>{preview.barang} barang ({preview.unit} unit): {Object.entries(preview.kategori).map(([k, n]) => `${k} ${n}`).join(', ')} · {preview.riwayat} riwayat servis{preview.riwayatTanpaTanggal ? ` (${preview.riwayatTanpaTanggal} tanpa tanggal, dicatat dengan tanggal impor)` : ''}</p>
          <ul className="pap-plain-list">{preview.contoh.map((c) => <li key={c}>{c}</li>)}{preview.barang > preview.contoh.length && <li className="pap-muted">... dan {preview.barang - preview.contoh.length} barang lainnya</li>}</ul>
          {preview.report.length > 0 && <>
            <strong>Perlu dicek di Excel</strong>
            <ul className="pap-plain-list">{preview.report.map((r) => <li key={r}>{r}</li>)}</ul>
          </>}
        </div>
      )}
    </Modal>
  )
}

function ItemForm({ initial, categories, locations, people, onClose, onSaved }: { initial: Item | null; categories: string[]; locations: string[]; people: Person[]; onClose: () => void; onSaved: (text: string, id?: number) => void }) {
  const [values, setValues] = useState({
    kode: initial?.kode ?? '', nama: initial?.nama ?? '', kategori: initial?.kategori ?? '', merek: initial?.merek ?? '', nomor_seri: initial?.nomor_seri ?? '', jumlah: String(initial?.jumlah ?? 1),
    tahun: initial?.tahun ? String(initial.tahun) : '', pajak_tahunan: initial?.pajak_tahunan?.slice(0, 10) ?? '', pajak_lima_tahunan: initial?.pajak_lima_tahunan?.slice(0, 10) ?? '', uji_kir: initial?.uji_kir?.slice(0, 10) ?? '',
    lokasi: initial?.lokasi ?? '', pemegang_id: initial?.pemegang_id ? String(initial.pemegang_id) : '', pemegang_lain: initial?.pemegang_lain ?? '',
    tanggal_beli: initial?.tanggal_beli?.slice(0, 10) ?? '', harga_beli: initial?.harga_beli !== null && initial?.harga_beli !== undefined ? String(initial.harga_beli) : '',
    kondisi: initial?.kondisi ?? 'baik', catatan: initial?.catatan ?? '',
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const set = (k: keyof typeof values) => (e: { target: { value: string } }) => setValues((v) => ({ ...v, [k]: e.target.value }))
  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const res = await api<{ item: Item }>(initial ? `/api/ga/inventaris/${initial.id}` : '/api/ga/inventaris', { method: initial ? 'PATCH' : 'POST', json: values })
      onSaved(initial ? 'Data inventaris diperbarui.' : `Barang ${res.item.kode} ditambahkan. Tambahkan fotonya di detail barang.`, initial ? undefined : res.item.id)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal
      title={initial ? `Ubah ${initial.nama}` : 'Tambah barang inventaris'}
      wide
      onClose={onClose}
      footer={<><span className="pap-spacer" /><button className="pap-btn" onClick={onClose}>Batal</button><button className="pap-primary-button" form="inventaris-form" disabled={busy}>{busy ? 'Menyimpan...' : 'Simpan'}</button></>}
    >
      <form id="inventaris-form" className="pap-form-grid" onSubmit={submit}>
        {error && <div className="full"><Notice onClose={() => setError('')}>{error}</Notice></div>}
        <Field label="Nama barang" full><input className="pap-input" required maxLength={200} value={values.nama} onChange={set('nama')} placeholder="Mis. Laptop Lenovo ThinkPad, Meja kerja, AC 1 PK, Motor Honda Beat" /></Field>
        <Field label="Kode" hint={initial ? undefined : 'Kosongkan untuk dibuat otomatis (INV-0001, ...)'}><input className="pap-input" maxLength={40} value={values.kode} onChange={set('kode')} placeholder="Otomatis" /></Field>
        <Field label="Kategori"><input className="pap-input" maxLength={100} list="pap-inv-kategori" value={values.kategori} onChange={set('kategori')} placeholder="Pilih atau ketik" /></Field>
        <datalist id="pap-inv-kategori">{categories.map((c) => <option key={c} value={c} />)}</datalist>
        <Field label="Merek / tipe (opsional)"><input className="pap-input" maxLength={150} value={values.merek} onChange={set('merek')} /></Field>
        <Field label={isVehicle(values.kategori) ? 'No. polisi' : 'Nomor seri (opsional)'}><input className="pap-input" maxLength={150} value={values.nomor_seri} onChange={set('nomor_seri')} placeholder={isVehicle(values.kategori) ? 'Mis. AD 1237 VU' : undefined} /></Field>
        <Field label="Jumlah (unit)"><input className="pap-input" type="number" min={1} step={1} required value={values.jumlah} onChange={set('jumlah')} /></Field>
        {isVehicle(values.kategori) && <>
          <Field label="Tahun kendaraan (opsional)"><input className="pap-input" type="number" min={1950} max={new Date().getFullYear() + 1} value={values.tahun} onChange={set('tahun')} placeholder="Mis. 2019" /></Field>
          <Field label="Jatuh tempo pajak tahunan"><input className="pap-input" type="date" value={values.pajak_tahunan} onChange={set('pajak_tahunan')} /></Field>
          <Field label="Jatuh tempo pajak 5 tahunan"><input className="pap-input" type="date" value={values.pajak_lima_tahunan} onChange={set('pajak_lima_tahunan')} /></Field>
          <Field label="Jatuh tempo uji KIR (opsional)" hint="Untuk kendaraan niaga / pick up"><input className="pap-input" type="date" value={values.uji_kir} onChange={set('uji_kir')} /></Field>
        </>}
        <Field label="Lokasi / ruangan"><input className="pap-input" maxLength={150} list="pap-inv-lokasi" value={values.lokasi} onChange={set('lokasi')} placeholder="Mis. Kantor lt. 2, Gudang, Ruang meeting" /></Field>
        <datalist id="pap-inv-lokasi">{locations.map((l) => <option key={l} value={l} />)}</datalist>
        <Field label="Pemegang / penanggung jawab">
          <select className="pap-select" value={values.pemegang_id} onChange={set('pemegang_id')}>
            <option value="">— Bukan user PAP-MS / belum ada —</option>
            {people.map((p) => <option key={p.id} value={p.id}>{p.name} · {p.division_name}</option>)}
          </select>
        </Field>
        {!values.pemegang_id && <Field label="Nama pemegang lain (opsional)"><input className="pap-input" maxLength={150} value={values.pemegang_lain} onChange={set('pemegang_lain')} placeholder="Mis. Satpam, Driver, Ruang bersama" /></Field>}
        <Field label="Tanggal beli (opsional)"><input className="pap-input" type="date" max={today()} value={values.tanggal_beli} onChange={set('tanggal_beli')} /></Field>
        <Field label="Harga beli (Rp, opsional)"><input className="pap-input" type="number" min={0} step={1} inputMode="numeric" value={values.harga_beli} onChange={set('harga_beli')} placeholder="0" /></Field>
        <Field label="Kondisi">
          <select className="pap-select" value={values.kondisi} onChange={set('kondisi')}>
            {Object.entries(KONDISI_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </Field>
        <Field label="Catatan / spesifikasi (opsional)" full><textarea className="pap-input" rows={2} maxLength={5000} value={values.catatan} onChange={set('catatan')} placeholder="Mis. RAM 8 GB, garansi s/d 2027, aksesoris charger" /></Field>
      </form>
    </Modal>
  )
}

function ItemDetail({ id, onClose, onEdit, onChanged }: { id: number; onClose: () => void; onEdit: (i: Item) => void; onChanged: (text: string) => void }) {
  const [item, setItem] = useState<Item | null>(null)
  const [logs, setLogs] = useState<Log[]>([])
  const [can, setCan] = useState({ manage: false })
  const [entry, setEntry] = useState<{ jenis: 'perbaikan' | 'catatan'; tanggal: string; keterangan: string; biaya: string; kondisi: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const photoInput = useRef<HTMLInputElement>(null)
  const load = useCallback(async () => {
    try {
      const res = await api<{ item: Item; logs: Log[]; can: { manage: boolean } }>(`/api/ga/inventaris/${id}`)
      setItem(res.item)
      setLogs(res.logs)
      setCan(res.can)
    } catch (e) {
      setError((e as Error).message)
    }
  }, [id])
  useEffect(() => { load() }, [load])
  async function run(task: () => Promise<unknown>, text?: string, close = false) {
    setBusy(true)
    setError('')
    try {
      await task()
      if (close) { onChanged(text ?? ''); onClose(); return }
      await load()
      if (text) onChanged(text)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  function uploadPhoto(file: File | undefined) {
    if (!file) return
    run(async () => {
      const body = new FormData()
      body.set('file', await compressImage(file))
      await api(`/api/ga/inventaris/${id}/foto`, { method: 'POST', body })
    }, 'Foto barang disimpan.')
  }

  if (!item) return <Modal title="Barang inventaris" onClose={onClose}>{error ? <Notice>{error}</Notice> : <p className="pap-muted">Memuat...</p>}</Modal>
  const active = item.status === 'aktif'
  return (
    <Modal
      title={item.nama}
      subtitle={[item.kode, item.kategori, item.merek].filter(Boolean).join(' · ')}
      wide
      onClose={onClose}
      footer={<>
        {can.manage && <button className="pap-btn danger" disabled={busy} onClick={async () => { if (await confirmDialog(`Hapus data ${item.nama}? Data masuk ke Data Terhapus dan masih bisa dipulihkan.`)) run(() => api(`/api/ga/inventaris/${id}`, { method: 'DELETE' }), 'Data inventaris dihapus.', true) }}><Trash2 /> Hapus data</button>}
        {can.manage && (active
          ? <button className="pap-btn" disabled={busy} onClick={async () => { const a = await askReason({ title: 'Hapuskan dari inventaris', label: 'Alasan (dijual, rusak berat, hilang, ...)', confirmLabel: 'Hapuskan' }); if (a) run(() => api(`/api/ga/inventaris/${id}`, { method: 'PATCH', json: { status: 'dihapuskan', alasan: a } }), 'Barang dihapuskan dari inventaris.') }}><Archive /> Hapuskan</button>
          : <button className="pap-btn" disabled={busy} onClick={() => run(() => api(`/api/ga/inventaris/${id}`, { method: 'PATCH', json: { status: 'aktif' } }), 'Barang diaktifkan kembali.')}>Aktifkan kembali</button>)}
        <span className="pap-spacer" />
        {can.manage && <button className="pap-btn" onClick={() => onEdit(item)}><Pencil /> Ubah data</button>}
        <button className="pap-btn" onClick={onClose}>Tutup</button>
      </>}
    >
      {error && <Notice onClose={() => setError('')}>{error}</Notice>}
      <div className="pap-detail-badges">
        <span className={`pap-status ${KONDISI_TONE[item.kondisi]}`}>{KONDISI_LABEL[item.kondisi]}</span>
        {!active && <span className="pap-status neutral">Dihapuskan</span>}
      </div>
      <div className="pap-inv-detail">
        <div className="pap-inv-photo">
          {item.foto_versi ? <a href={fotoUrl(item)} target="_blank" rel="noreferrer"><img src={fotoUrl(item)} alt={`Foto ${item.nama}`} /></a> : <div className="pap-inv-photo-empty"><Package /><span>Belum ada foto</span></div>}
          {can.manage && (
            <div className="pap-inline-actions pap-wrap">
              <input ref={photoInput} type="file" accept="image/jpeg,image/png,image/webp" capture="environment" hidden onChange={(e) => { uploadPhoto(e.target.files?.[0]); e.target.value = '' }} />
              <button className="pap-btn" disabled={busy} onClick={() => photoInput.current?.click()}><Camera /> {item.foto_versi ? 'Ganti foto' : 'Tambah foto'}</button>
              {item.foto_versi && <button className="pap-btn" disabled={busy} onClick={() => run(() => api(`/api/ga/inventaris/${id}/foto`, { method: 'DELETE' }), 'Foto dihapus.')}><Trash2 /> Hapus foto</button>}
            </div>
          )}
        </div>
        <dl className="pap-detail-grid">
          <div><dt>Lokasi</dt><dd>{item.lokasi ?? '—'}</dd></div>
          <div><dt>Pemegang</dt><dd>{holder(item) ?? '—'}</dd></div>
          <div><dt>{isVehicle(item.kategori) ? 'No. polisi' : 'Nomor seri'}</dt><dd>{item.nomor_seri ?? '—'}</dd></div>
          <div><dt>Jumlah</dt><dd>{item.jumlah} unit</dd></div>
          {isVehicle(item.kategori) && <div><dt>Tahun</dt><dd>{item.tahun ?? '—'}</dd></div>}
          {VEHICLE_DATES.filter(([k]) => item[k] || (isVehicle(item.kategori) && k !== 'uji_kir')).map(([k, l]) => (
            <div key={k}><dt>{l}</dt><dd>{item[k] ? <>{formatDate(item[k]!)} <DueBadge date={item[k]!} /></> : '—'}</dd></div>
          ))}
          <div><dt>Tanggal beli</dt><dd>{item.tanggal_beli ? formatDate(item.tanggal_beli) : '—'}</dd></div>
          <div><dt>Harga beli</dt><dd>{item.harga_beli !== null ? formatRupiah(item.harga_beli) : '—'}</dd></div>
          <div><dt>Perbaikan terakhir</dt><dd>{item.perbaikan_terakhir ? formatDate(item.perbaikan_terakhir) : '—'}</dd></div>
          {item.catatan && <div className="full"><dt>Catatan</dt><dd className="pap-prewrap">{item.catatan}</dd></div>}
        </dl>
      </div>

      {can.manage && active && !entry && (
        <div className="pap-inline-actions pap-wrap">
          <button className="pap-btn" onClick={() => setEntry({ jenis: 'perbaikan', tanggal: today(), keterangan: '', biaya: '', kondisi: '' })}><Wrench /> Catat perbaikan</button>
          <button className="pap-btn" onClick={() => setEntry({ jenis: 'catatan', tanggal: today(), keterangan: '', biaya: '', kondisi: '' })}><ClipboardList /> Tambah catatan</button>
        </div>
      )}
      {entry && (
        <form className="pap-inline-panel" onSubmit={(e) => { e.preventDefault(); run(async () => { await api(`/api/ga/inventaris/${id}/logs`, { method: 'POST', json: entry }); setEntry(null) }, entry.jenis === 'perbaikan' ? 'Perbaikan dicatat.' : 'Catatan ditambahkan.') }}>
          <strong>{entry.jenis === 'perbaikan' ? 'Catat perbaikan' : 'Tambah catatan'}</strong>
          <div className="pap-form-grid">
            <Field label="Tanggal"><input className="pap-input" type="date" max={today()} value={entry.tanggal} onChange={(e) => setEntry({ ...entry, tanggal: e.target.value })} /></Field>
            {entry.jenis === 'perbaikan' && <Field label="Biaya (Rp, opsional)"><input className="pap-input" type="number" min={0} step={1} value={entry.biaya} onChange={(e) => setEntry({ ...entry, biaya: e.target.value })} /></Field>}
            <Field label={entry.jenis === 'perbaikan' ? 'Yang diperbaiki' : 'Catatan'} full><textarea className="pap-input" rows={2} required autoFocus maxLength={5000} value={entry.keterangan} onChange={(e) => setEntry({ ...entry, keterangan: e.target.value })} placeholder={entry.jenis === 'perbaikan' ? 'Mis. ganti baterai, servis AC di toko X' : 'Mis. dipinjam untuk pameran s/d 10 Nov'} /></Field>
            <Field label="Kondisi setelahnya (opsional)">
              <select className="pap-select" value={entry.kondisi} onChange={(e) => setEntry({ ...entry, kondisi: e.target.value })}>
                <option value="">Tidak berubah ({KONDISI_LABEL[item.kondisi]})</option>
                {Object.entries(KONDISI_LABEL).filter(([k]) => k !== item.kondisi).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </Field>
          </div>
          <div className="pap-inline-actions"><span className="pap-spacer" /><button type="button" className="pap-btn" onClick={() => setEntry(null)}>Batal</button><button className="pap-primary-button" disabled={busy}>{busy ? 'Menyimpan...' : 'Simpan'}</button></div>
        </form>
      )}

      <section className="pap-detail-section">
        <h3>Riwayat ({logs.length})</h3>
        <div className="pap-table-wrap bordered">
          <table>
            <thead><tr><th>Tanggal</th><th>Jenis</th><th>Keterangan</th><th className="pap-num">Biaya</th></tr></thead>
            <tbody>
              {logs.map((l) => (
                <tr key={l.id}>
                  <td className="pap-nowrap">{formatDate(l.tanggal)}</td>
                  <td><span className={`pap-status ${LOG_TONE[l.jenis]}`}>{LOG_LABEL[l.jenis]}</span></td>
                  <td>{l.keterangan}<div className="pap-cell-sub">{l.created_name}</div></td>
                  <td className="pap-num pap-nowrap">{l.biaya !== null ? formatRupiah(l.biaya) : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!logs.length && <div className="pap-empty">Belum ada riwayat.</div>}
        </div>
      </section>
    </Modal>
  )
}
