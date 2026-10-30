'use client'

import { useCallback, useEffect, useState } from 'react'
import { ClipboardList, Pencil, Plus, Search, Trash2, UserMinus } from 'lucide-react'
import { api, confirmDialog, Field, Modal, Notice, Pager, usePaged } from './ui'

// Jobdesk per jabatan: tab Jobdesk di menu Karyawan dan bagian Jobdesk di detail karyawan
export type Jobdesk = { id: number; jabatan: string; atasan_langsung: string | null; atasan_tak_langsung: string | null; bawahan: string | null; fungsi: string[]; tugas: string[]; koordinasi: string[]; sumber: string | null }
type Emp = { id: number; nip: string; nama: string; jabatan: string | null; divisi: string | null; job_description_id: number | null }
type Res = { items: Jobdesk[]; employees: Emp[]; can: { manage: boolean } }

function JobdeskBody({ j }: { j: Jobdesk }) {
  return (
    <>
      <dl className="pap-detail-grid">
        <div><dt>Atasan langsung</dt><dd>{j.atasan_langsung ?? '—'}</dd></div>
        <div><dt>Atasan tak langsung</dt><dd>{j.atasan_tak_langsung ?? '—'}</dd></div>
        {j.bawahan && <div><dt>Bawahan</dt><dd>{j.bawahan}</dd></div>}
      </dl>
      {j.fungsi.length > 0 && <><h4 className="pap-jobdesk-head">Fungsi jabatan</h4>{j.fungsi.map((f) => <p key={f} className="pap-jobdesk-text">{f}</p>)}</>}
      {j.tugas.length > 0 && <><h4 className="pap-jobdesk-head">Tugas &amp; tanggung jawab</h4><ol className="pap-jobdesk-list">{j.tugas.map((t, i) => <li key={i}>{t}</li>)}</ol></>}
      {j.koordinasi.length > 0 && <><h4 className="pap-jobdesk-head">Koordinasi</h4><ul className="pap-jobdesk-list">{j.koordinasi.map((t, i) => <li key={i}>{t}</li>)}</ul></>}
    </>
  )
}

// Bagian di detail karyawan
export function EmployeeJobdesk({ nip, jobdesk, manage }: { nip: string; jobdesk: Jobdesk | null; manage: boolean }) {
  const [current, setCurrent] = useState(jobdesk)
  const [options, setOptions] = useState<Jobdesk[]>([])
  const [error, setError] = useState('')
  useEffect(() => {
    if (manage) api<Res>('/api/hrd/jobdesks').then((r) => setOptions(r.items)).catch((e) => setError(e.message))
  }, [manage])
  async function pick(value: string) {
    try {
      await api('/api/hrd/jobdesks/assign', { method: 'POST', json: { nip, job_description_id: value || null } })
      setCurrent(options.find((o) => String(o.id) === value) ?? null)
    } catch (e) {
      setError((e as Error).message)
    }
  }
  return (
    <section className="pap-detail-section">
      <h3>Jobdesk{current ? ` · ${current.jabatan}` : ''}</h3>
      {error && <Notice onClose={() => setError('')}>{error}</Notice>}
      {manage && (
        <Field label="Jobdesk karyawan ini">
          <select className="pap-select" value={current?.id ?? ''} onChange={(e) => pick(e.target.value)}>
            <option value="">Belum ada jobdesk</option>
            {options.map((o) => <option key={o.id} value={o.id}>{o.jabatan}</option>)}
          </select>
        </Field>
      )}
      {current ? <JobdeskBody j={current} /> : <p className="pap-muted">Belum ada jobdesk untuk karyawan ini.{manage ? ' Pilih di atas, atau buat baru di tab Jobdesk.' : ''}</p>}
    </section>
  )
}

export function JobdeskPage() {
  const [data, setData] = useState<Res | null>(null)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [q, setQ] = useState('')
  const [tab, setTab] = useState<'jabatan' | 'belum'>('jabatan')
  const [detail, setDetail] = useState<number | null>(null)
  const [form, setForm] = useState<Jobdesk | 'baru' | null>(null)
  const load = useCallback(() => api<Res>('/api/hrd/jobdesks').then((r) => { setData(r); setError('') }).catch((e) => setError(e.message)), [])
  useEffect(() => { load() }, [load])
  const term = q.trim().toLowerCase()
  const holders = (id: number) => (data?.employees ?? []).filter((e) => e.job_description_id === id)
  const rows = (data?.items ?? []).filter((j) => !term || [j.jabatan, j.atasan_langsung, ...holders(j.id).map((e) => e.nama)].some((x) => x?.toLowerCase().includes(term)))
  const belum = (data?.employees ?? []).filter((e) => e.job_description_id === null && (!term || [e.nama, e.jabatan, e.divisi].some((x) => x?.toLowerCase().includes(term))))
  const pagedJ = usePaged(rows, `j-${q}`, 25)
  const pagedB = usePaged(belum, `b-${q}`, 25)
  const manage = !!data?.can.manage
  const current = data?.items.find((j) => j.id === detail) ?? null
  async function assign(nip: string, value: string | number | null) {
    try {
      await api('/api/hrd/jobdesks/assign', { method: 'POST', json: { nip, job_description_id: value || null } })
      await load()
    } catch (e) {
      setError((e as Error).message)
    }
  }
  async function remove(j: Jobdesk) {
    if (!(await confirmDialog(`Hapus jobdesk ${j.jabatan}? ${holders(j.id).length} karyawan akan kehilangan jobdesk ini. Bisa dipulihkan dari Data Terhapus.`))) return
    try {
      await api(`/api/hrd/jobdesks/${j.id}`, { method: 'DELETE' })
      setDetail(null)
      setMessage(`Jobdesk ${j.jabatan} dihapus.`)
      await load()
    } catch (e) {
      setError((e as Error).message)
    }
  }
  return (
    <>
      <div className="pap-page-heading">
        <div>
          <p className="pap-eyebrow">SDM</p>
          <h1>Jobdesk</h1>
          <span>Uraian tugas tiap jabatan dan karyawan pemegangnya. Jobdesk juga tampil di detail masing-masing karyawan.</span>
        </div>
        {manage && <button className="pap-primary-button" onClick={() => setForm('baru')}><Plus /> Tambah jobdesk</button>}
      </div>
      {message && <Notice kind="success" onClose={() => setMessage('')}>{message}</Notice>}
      {error && <Notice onClose={() => setError('')}>{error}</Notice>}
      <div className="pap-table-card">
        <div className="pap-card-head">
          <div className="pap-segmented" role="tablist">
            <button role="tab" aria-selected={tab === 'jabatan'} className={tab === 'jabatan' ? 'active' : ''} onClick={() => setTab('jabatan')}><ClipboardList /> Per jabatan ({data?.items.length ?? 0})</button>
            <button role="tab" aria-selected={tab === 'belum'} className={tab === 'belum' ? 'active' : ''} onClick={() => setTab('belum')}><UserMinus /> Belum punya jobdesk ({data?.employees.filter((e) => e.job_description_id === null).length ?? 0})</button>
          </div>
          <label className="pap-filter-search"><Search /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari jabatan atau karyawan..." /></label>
        </div>
        <div className="pap-table-wrap">
          {tab === 'jabatan' ? (
            <table>
              <thead><tr><th>Jabatan</th><th>Atasan langsung</th><th>Pemegang saat ini</th><th className="pap-num">Tugas</th></tr></thead>
              <tbody>
                {pagedJ.items.map((j) => {
                  const h = holders(j.id)
                  return (
                    <tr key={j.id} className="pap-row-link" onClick={() => setDetail(j.id)}>
                      <td><div className="pap-cell-title">{j.jabatan}</div></td>
                      <td>{j.atasan_langsung ?? '—'}</td>
                      <td>{h.length ? h.map((e) => e.nama).join(', ') : <span className="pap-muted">Belum ada</span>}</td>
                      <td className="pap-num">{j.tugas.length}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          ) : (
            <table>
              <thead><tr><th>Karyawan</th><th>Divisi</th><th>{manage ? 'Pasang jobdesk' : 'Jobdesk'}</th></tr></thead>
              <tbody>
                {pagedB.items.map((e) => (
                  <tr key={e.nip}>
                    <td><div className="pap-cell-title">{e.nama}</div><div className="pap-cell-sub">{e.jabatan ?? '—'}</div></td>
                    <td>{e.divisi ?? '—'}</td>
                    <td>{manage ? (
                      <select className="pap-select" value="" aria-label={`Pasang jobdesk untuk ${e.nama}`} onChange={(x) => assign(e.nip, x.target.value)}>
                        <option value="">Pilih jobdesk...</option>
                        {data?.items.map((o) => <option key={o.id} value={o.id}>{o.jabatan}</option>)}
                      </select>
                    ) : <span className="pap-muted">Belum ada</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {data && tab === 'jabatan' && !rows.length && <div className="pap-empty">{q ? 'Tidak ada yang cocok.' : 'Belum ada jobdesk.'}</div>}
          {data && tab === 'belum' && !belum.length && <div className="pap-empty">{q ? 'Tidak ada yang cocok.' : 'Semua karyawan aktif sudah punya jobdesk.'}</div>}
          {!data && !error && <div className="pap-empty">Memuat...</div>}
          {tab === 'jabatan' ? <Pager {...pagedJ.pager} noun="jabatan" /> : <Pager {...pagedB.pager} noun="karyawan" />}
        </div>
      </div>
      {current && (
        <Modal title={current.jabatan} subtitle={current.sumber ?? undefined} wide onClose={() => setDetail(null)}
          footer={<>
            {manage && <button className="pap-btn danger" onClick={() => remove(current)}><Trash2 /> Hapus</button>}
            <span className="pap-spacer" />
            <button className="pap-btn" onClick={() => setDetail(null)}>Tutup</button>
            {manage && <button className="pap-primary-button" onClick={() => setForm(current)}><Pencil /> Ubah</button>}
          </>}>
          <JobdeskBody j={current} />
          <h4 className="pap-jobdesk-head">Pemegang saat ini ({holders(current.id).length})</h4>
          {holders(current.id).length ? (
            <ul className="pap-file-list">
              {holders(current.id).map((e) => (
                <li key={e.nip}><div><strong>{e.nama}</strong><span className="pap-cell-sub"> {e.jabatan ?? ''}{e.divisi ? ` · ${e.divisi}` : ''}</span></div>
                  {manage && <button type="button" className="pap-icon-button" aria-label={`Lepas jobdesk dari ${e.nama}`} title="Lepas" onClick={() => assign(e.nip, null)}><UserMinus /></button>}
                </li>
              ))}
            </ul>
          ) : <p className="pap-muted">Belum ada karyawan.</p>}
          {manage && (
            <Field label="Tambah pemegang">
              <select className="pap-select" value="" onChange={(e) => e.target.value && assign(e.target.value, current.id)}>
                <option value="">Pilih karyawan...</option>
                {data?.employees.filter((e) => e.job_description_id !== current.id).map((e) => <option key={e.nip} value={e.nip}>{e.nama}{e.jabatan ? ` · ${e.jabatan}` : ''}{e.job_description_id ? ' (pindah dari jobdesk lain)' : ''}</option>)}
              </select>
            </Field>
          )}
        </Modal>
      )}
      {form && <JobdeskForm item={form === 'baru' ? null : form} onClose={() => setForm(null)} onSaved={(t) => { setForm(null); setMessage(t); load() }} />}
    </>
  )
}

function JobdeskForm({ item, onClose, onSaved }: { item: Jobdesk | null; onClose: () => void; onSaved: (text: string) => void }) {
  const [v, setV] = useState({
    jabatan: item?.jabatan ?? '', atasan_langsung: item?.atasan_langsung ?? '', atasan_tak_langsung: item?.atasan_tak_langsung ?? '', bawahan: item?.bawahan ?? '',
    fungsi: item?.fungsi.join('\n') ?? '', tugas: item?.tugas.join('\n') ?? '', koordinasi: item?.koordinasi.join('\n') ?? '',
  })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV({ ...v, [k]: e.target.value })
  async function save(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    try {
      await api(item ? `/api/hrd/jobdesks/${item.id}` : '/api/hrd/jobdesks', { method: item ? 'PUT' : 'POST', json: v })
      onSaved(`Jobdesk ${v.jabatan} disimpan.`)
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
    }
  }
  return (
    <Modal title={item ? `Ubah ${item.jabatan}` : 'Tambah jobdesk'} wide onClose={onClose}
      footer={<><span className="pap-spacer" /><button className="pap-btn" onClick={onClose}>Batal</button><button className="pap-primary-button" form="jobdesk-form" disabled={busy}>{busy ? 'Menyimpan...' : 'Simpan'}</button></>}>
      <form id="jobdesk-form" className="pap-form-grid" onSubmit={save}>
        {error && <div className="full"><Notice onClose={() => setError('')}>{error}</Notice></div>}
        <Field label="Nama jabatan *" full><input className="pap-input" required maxLength={150} value={v.jabatan} onChange={set('jabatan')} /></Field>
        <Field label="Atasan langsung"><input className="pap-input" maxLength={150} value={v.atasan_langsung} onChange={set('atasan_langsung')} /></Field>
        <Field label="Atasan tak langsung"><input className="pap-input" maxLength={150} value={v.atasan_tak_langsung} onChange={set('atasan_tak_langsung')} /></Field>
        <Field label="Bawahan" full><input className="pap-input" maxLength={255} value={v.bawahan} onChange={set('bawahan')} /></Field>
        <Field label="Fungsi jabatan" full><textarea className="pap-input" rows={3} value={v.fungsi} onChange={set('fungsi')} /></Field>
        <Field label="Tugas & tanggung jawab" hint="Satu tugas per baris" full><textarea className="pap-input" rows={10} value={v.tugas} onChange={set('tugas')} /></Field>
        <Field label="Koordinasi" hint="Satu bagian per baris" full><textarea className="pap-input" rows={3} value={v.koordinasi} onChange={set('koordinasi')} /></Field>
      </form>
    </Modal>
  )
}
