'use client'

import { useCallback, useEffect, useState } from 'react'
import { CalendarPlus, Download, Plus, Search, Trash2, Users } from 'lucide-react'
import { api, Field, formatDate, Modal, Notice, RowActions, confirmDialog } from './ui'

// Sesi training dikelola di SIMPAP: tambah / ubah / hapus, peserta & kehadiran (bagian atas tab Jadwal Training)

const STATUS = { terjadwal: 'Terjadwal', selesai: 'Selesai', batal: 'Batal' } as const
const STATUS_TONE = { terjadwal: 'info', selesai: 'success', batal: 'neutral' } as const
const KEHADIRAN = { terdaftar: 'Terdaftar', hadir: 'Hadir', tidak_hadir: 'Tidak hadir' } as const
type Peserta = { nama: string; employee_id: number | null; kehadiran: keyof typeof KEHADIRAN }
type Sesi = {
  id: number; judul: string; batch: string | null; tanggal: string; jam_mulai: string | null; jam_selesai: string | null; tempat: string | null; pemateri: string | null
  catatan: string | null; status: keyof typeof STATUS; dibuat_oleh: string | null; peserta: Peserta[]
}
type Emp = { id: number; nama: string; nip: string; jabatan: string | null; divisi: string | null }
type Res = { items: Sesi[]; employees: Emp[]; can: { manage: boolean } }

const wibToday = () => new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10)
const jamText = (s: Sesi) => (s.jam_mulai ? `${s.jam_mulai}${s.jam_selesai ? `–${s.jam_selesai}` : ''} WIB` : '')

export function TrainingSessions({ canImport }: { canImport: boolean }) {
  const [data, setData] = useState<Res | null>(null)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [view, setView] = useState<'mendatang' | 'lewat' | 'semua'>('mendatang')
  const [q, setQ] = useState('')
  const [form, setForm] = useState<Sesi | 'baru' | null>(null)
  const [detail, setDetail] = useState<Sesi | null>(null)
  const [busy, setBusy] = useState(false)
  const load = useCallback(() => api<Res>('/api/hrd/training/sessions').then((r) => { setData(r); setError('') }).catch((e) => setError(e.message)), [])
  useEffect(() => { load() }, [load])
  const manage = !!data?.can.manage
  const today = wibToday()
  const term = q.trim().toLowerCase()
  const items = (data?.items ?? [])
    .filter((s) => view === 'semua' || (view === 'mendatang' ? s.tanggal >= today && s.status !== 'batal' : s.tanggal < today || s.status === 'batal'))
    .filter((s) => !term || [s.judul, s.batch, s.tempat, s.pemateri, ...s.peserta.map((p) => p.nama)].some((x) => x?.toLowerCase().includes(term)))
  if (view === 'mendatang') items.sort((a, b) => a.tanggal.localeCompare(b.tanggal) || String(a.jam_mulai).localeCompare(String(b.jam_mulai)))

  async function remove(s: Sesi) {
    if (!(await confirmDialog(`Hapus sesi "${s.judul}" ${formatDate(s.tanggal)}? Peserta ikut terhapus; bisa dipulihkan dari Data Terhapus.`))) return
    try {
      await api(`/api/hrd/training/sessions/${s.id}`, { method: 'DELETE' })
      setDetail(null)
      setMessage('Sesi training dihapus.')
      load()
    } catch (e) {
      setError((e as Error).message)
    }
  }
  async function importSheet() {
    if (!(await confirmDialog({ title: 'Impor dari spreadsheet', message: 'Sesi di tab BATCH spreadsheet jadwal yang belum ada di SIMPAP akan ditambahkan beserta pesertanya. Sesi yang sudah ada tidak diubah.', confirmLabel: 'Ya, impor' }))) return
    setBusy(true)
    try {
      const r = await api<{ added: number }>('/api/hrd/training/sessions', { method: 'POST', json: { impor: true } })
      setMessage(r.added ? `${r.added} sesi diimpor dari spreadsheet.` : 'Semua sesi spreadsheet sudah ada di SIMPAP.')
      load()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="pap-table-card pap-ts-card">
      <div className="pap-card-head">
        <div><h2>Sesi training</h2><p>Jadwal training yang dikelola di SIMPAP: tanggal, jam, tempat, pemateri, peserta, dan kehadiran.</p></div>
        {manage && (
          <div className="pap-inline-actions pap-wrap">
            {canImport && <button className="pap-btn" disabled={busy} onClick={importSheet}><Download /> Impor dari spreadsheet</button>}
            <button className="pap-primary-button" onClick={() => setForm('baru')}><CalendarPlus /> Tambah sesi</button>
          </div>
        )}
      </div>
      {message && <div className="pap-card-notice"><Notice kind="success" onClose={() => setMessage('')}>{message}</Notice></div>}
      {error && <div className="pap-card-notice"><Notice onClose={() => setError('')}>{error}</Notice></div>}
      <div className="pap-filters">
        <div className="pap-segmented" role="tablist">
          {([['mendatang', 'Mendatang'], ['lewat', 'Sudah lewat'], ['semua', 'Semua']] as const).map(([k, l]) => <button key={k} role="tab" aria-selected={view === k} className={view === k ? 'active' : ''} onClick={() => setView(k)}>{l}</button>)}
        </div>
        <label className="pap-filter-search"><Search /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari materi, batch, peserta..." /></label>
      </div>
      <div className="pap-ts-list">
        {items.map((s) => {
          const hadir = s.peserta.filter((p) => p.kehadiran === 'hadir').length
          return (
            <article key={s.id} className="pap-ts-item" onClick={() => setDetail(s)}>
              <div className="pap-jadwal-date"><strong>{Number(s.tanggal.slice(8, 10))}</strong><span>{formatDate(s.tanggal).replace(/^\d+\s*/, '')}</span></div>
              <div className="pap-ts-body">
                <div className="pap-jadwal-head"><b>{s.judul}</b><span className={`pap-status ${STATUS_TONE[s.status]}`}>{s.tanggal === today && s.status === 'terjadwal' ? 'Hari ini' : STATUS[s.status]}</span></div>
                <small className="pap-muted">{[s.batch, jamText(s), s.tempat, s.pemateri && `Pemateri: ${s.pemateri}`].filter(Boolean).join(' · ') || '—'}</small>
                <small><Users className="pap-inline-icon" /> {s.peserta.length} peserta{s.status === 'selesai' && s.peserta.length ? ` · ${hadir} hadir` : ''}</small>
              </div>
              <div className="pap-ts-actions" onClick={(e) => e.stopPropagation()}>
                <RowActions label={s.judul} onView={() => setDetail(s)} onEdit={manage ? () => setForm(s) : undefined} onDelete={manage ? () => remove(s) : undefined} />
              </div>
            </article>
          )
        })}
        {data && !items.length && <div className="pap-empty">{term ? 'Tidak ada sesi yang cocok.' : view === 'mendatang' ? `Belum ada sesi training mendatang.${manage ? ' Klik "Tambah sesi".' : ''}` : 'Belum ada sesi.'}</div>}
        {!data && !error && <div className="pap-empty">Memuat sesi training...</div>}
      </div>
      {detail && (
        <Modal title={detail.judul} subtitle={[formatDate(detail.tanggal), jamText(detail), detail.batch].filter(Boolean).join(' · ')} onClose={() => setDetail(null)}
          footer={<>
            {manage && <button className="pap-btn danger" onClick={() => remove(detail)}><Trash2 /> Hapus</button>}
            <span className="pap-spacer" />
            <button className="pap-btn" onClick={() => setDetail(null)}>Tutup</button>
            {manage && <button className="pap-primary-button" onClick={() => { setForm(detail); setDetail(null) }}>Ubah</button>}
          </>}>
          <dl className="pap-acc-detail">
            <div><dt>Status</dt><dd><span className={`pap-status ${STATUS_TONE[detail.status]}`}>{STATUS[detail.status]}</span></dd></div>
            <div><dt>Tempat</dt><dd>{detail.tempat ?? '—'}</dd></div>
            <div><dt>Pemateri</dt><dd>{detail.pemateri ?? '—'}</dd></div>
            <div><dt>Dibuat oleh</dt><dd>{detail.dibuat_oleh ?? '—'}</dd></div>
          </dl>
          {detail.catatan && <p className="pap-prewrap">{detail.catatan}</p>}
          <section className="pap-detail-section">
            <h3>Peserta ({detail.peserta.length})</h3>
            {detail.peserta.length ? (
              <ul className="pap-ts-peserta">
                {detail.peserta.map((p, i) => <li key={`${p.nama}-${i}`}><span>{p.nama}</span><span className={`pap-status ${p.kehadiran === 'hadir' ? 'success' : p.kehadiran === 'tidak_hadir' ? 'danger' : 'neutral'}`}>{KEHADIRAN[p.kehadiran]}</span></li>)}
              </ul>
            ) : <p className="pap-muted">Belum ada peserta.</p>}
          </section>
        </Modal>
      )}
      {form && data && <SessionForm item={form === 'baru' ? null : form} employees={data.employees} onClose={() => setForm(null)} onSaved={(t) => { setForm(null); setMessage(t); load() }} />}
    </div>
  )
}

function SessionForm({ item, employees, onClose, onSaved }: { item: Sesi | null; employees: Emp[]; onClose: () => void; onSaved: (message: string) => void }) {
  const [v, setV] = useState({
    judul: item?.judul ?? '', batch: item?.batch ?? '', tanggal: item?.tanggal ?? wibToday(), jam_mulai: item?.jam_mulai ?? '13:00', jam_selesai: item?.jam_selesai ?? '15:00',
    tempat: item?.tempat ?? '', pemateri: item?.pemateri ?? '', catatan: item?.catatan ?? '', status: item?.status ?? 'terjadwal',
  })
  const [peserta, setPeserta] = useState<Peserta[]>(item?.peserta ?? [])
  const [cari, setCari] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV({ ...v, [k]: e.target.value })
  function addPeserta(text: string) {
    const name = text.trim()
    if (!name) return
    const emp = employees.find((e) => `${e.nama} (${e.nip})` === name || e.nama.toLowerCase() === name.toLowerCase())
    const nama = emp?.nama ?? name
    if (peserta.some((p) => p.nama.toLowerCase() === nama.toLowerCase())) return setCari('')
    setPeserta([...peserta, { nama, employee_id: emp?.id ?? null, kehadiran: 'terdaftar' }])
    setCari('')
  }
  async function save(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await api(item ? `/api/hrd/training/sessions/${item.id}` : '/api/hrd/training/sessions', { method: item ? 'PUT' : 'POST', json: { ...v, peserta } })
      onSaved(item ? 'Sesi training diperbarui.' : 'Sesi training ditambahkan.')
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
    }
  }
  return (
    <Modal title={item ? 'Ubah sesi training' : 'Tambah sesi training'} wide onClose={onClose}
      footer={<><span className="pap-spacer" /><button className="pap-btn" onClick={onClose}>Batal</button><button className="pap-primary-button" form="ts-form" disabled={busy}>{busy ? 'Menyimpan...' : 'Simpan'}</button></>}>
      <form id="ts-form" className="pap-form-grid" onSubmit={save}>
        {error && <div className="full"><Notice onClose={() => setError('')}>{error}</Notice></div>}
        <Field label="Materi / judul training *" full><input className="pap-input" required maxLength={200} value={v.judul} onChange={set('judul')} placeholder="Mis. Training QC Kualitas Hasil Produksi" /></Field>
        <Field label="Batch"><input className="pap-input" maxLength={60} value={v.batch} onChange={set('batch')} placeholder="BATCH 1" /></Field>
        <Field label="Status"><select className="pap-select" value={v.status} onChange={set('status')}>{Object.entries(STATUS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        <Field label="Tanggal *"><input className="pap-input" type="date" required value={v.tanggal} onChange={set('tanggal')} /></Field>
        <div className="pap-form-grid pap-ts-jam">
          <Field label="Jam mulai"><input className="pap-input" type="time" value={v.jam_mulai} onChange={set('jam_mulai')} /></Field>
          <Field label="Jam selesai"><input className="pap-input" type="time" value={v.jam_selesai} onChange={set('jam_selesai')} /></Field>
        </div>
        <Field label="Tempat"><input className="pap-input" maxLength={150} value={v.tempat} onChange={set('tempat')} placeholder="Ruang Produksi (Layar TV)" /></Field>
        <Field label="Pemateri"><input className="pap-input" maxLength={200} value={v.pemateri} onChange={set('pemateri')} placeholder="Kurniawan, Ino, ..." /></Field>
        <Field label="Catatan" full><textarea className="pap-input" rows={2} maxLength={1000} value={v.catatan} onChange={set('catatan')} /></Field>
        <div className="pap-field full">
          <span>Peserta ({peserta.length})</span>
          <div className="pap-inline-actions">
            <input className="pap-input" list="pap-ts-emps" value={cari} onChange={(e) => setCari(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addPeserta(cari) } }} placeholder="Ketik nama karyawan lalu Enter" />
            <datalist id="pap-ts-emps">{employees.map((e) => <option key={e.id} value={`${e.nama} (${e.nip})`}>{e.jabatan ?? e.divisi ?? ''}</option>)}</datalist>
            <button type="button" className="pap-btn" onClick={() => addPeserta(cari)}><Plus /> Tambah</button>
          </div>
          {peserta.length > 0 && (
            <ul className="pap-ts-peserta editable">
              {peserta.map((p, i) => (
                <li key={`${p.nama}-${i}`}>
                  <span>{p.nama}</span>
                  <select className="pap-select" value={p.kehadiran} onChange={(e) => setPeserta(peserta.map((x, j) => (j === i ? { ...x, kehadiran: e.target.value as Peserta['kehadiran'] } : x)))} aria-label={`Kehadiran ${p.nama}`}>
                    {Object.entries(KEHADIRAN).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                  </select>
                  <button type="button" className="pap-icon-button" aria-label={`Hapus ${p.nama}`} onClick={() => setPeserta(peserta.filter((_, j) => j !== i))}><Trash2 /></button>
                </li>
              ))}
            </ul>
          )}
          {peserta.length > 0 && <div className="pap-inline-actions pap-wrap"><button type="button" className="pap-btn" onClick={() => setPeserta(peserta.map((p) => ({ ...p, kehadiran: 'hadir' })))}>Tandai semua hadir</button></div>}
        </div>
      </form>
    </Modal>
  )
}
