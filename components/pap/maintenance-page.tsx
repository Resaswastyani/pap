'use client'

import { useCallback, useEffect, useState } from 'react'
import { AlarmClock, CalendarCheck, CalendarClock, ClipboardCheck, History, List, Pencil, Plus, Printer, Search, Wrench } from 'lucide-react'
import type { UserProfile } from '@/lib/users'
import { AttachmentInput, AttachmentPanel, emptyAttachments, pendingCount, uploadNoteAttachments, type PendingAttachments } from './attachments'
import { api, Field, formatDate, Modal, Notice, Pager, usePaged } from './ui'

type Hasil = 'baik' | 'perlu_tindakan' | 'rusak'
type Plan = {
  id: number; machine_id: number; machine_kode: string; machine_nama: string; machine_tahap: string | null; machine_status: string
  judul: string; komponen: string | null; interval_hari: number; berikutnya: string; terakhir: string | null; pic_id: number | null; pic_name: string | null
  aktif: boolean; catatan: string | null; sisa_hari: number; hasil_terakhir: Hasil | null
}
type Log = {
  id: number; plan_id: number | null; plan_judul: string | null; machine_id: number; machine_kode: string; machine_nama: string; tanggal: string; hasil: Hasil
  temuan: string | null; tindakan: string | null; durasi_menit: number | null; repair_id: number | null; repair_nomor: string | null
  dikerjakan_oleh: number; dikerjakan_name: string; created_at: string; lampiran: number
}
type Machine = { id: number; kode: string; nama: string; tahap: string | null; status: string }
type Summary = { aktif: number; terlambat: number; minggu: number; checkup_30: number; temuan_30: number }

export const HASIL_LABEL: Record<Hasil, string> = { baik: 'Baik', perlu_tindakan: 'Perlu tindakan', rusak: 'Rusak' }
const HASIL_TONE: Record<Hasil, string> = { baik: 'success', perlu_tindakan: 'warning', rusak: 'danger' }
const HasilBadge = ({ value }: { value: Hasil }) => <span className={`pap-status ${HASIL_TONE[value]}`}>{HASIL_LABEL[value]}</span>

function DueBadge({ plan }: { plan: Plan }) {
  if (!plan.aktif) return <span className="pap-status neutral">Nonaktif</span>
  const d = plan.sisa_hari
  if (d < 0) return <span className="pap-status danger">Terlambat {-d} hari</span>
  if (d === 0) return <span className="pap-status warning">Hari ini</span>
  if (d <= 7) return <span className="pap-status warning">{d} hari lagi</span>
  return <span className="pap-status neutral">{d} hari lagi</span>
}

export function MaintenancePage({ user, focusId }: { user: UserProfile; focusId?: number | null }) {
  const [tab, setTab] = useState<'jadwal' | 'riwayat'>('jadwal')
  const [items, setItems] = useState<Plan[]>([])
  const [logs, setLogs] = useState<Log[]>([])
  const [summary, setSummary] = useState<Summary | null>(null)
  const [machines, setMachines] = useState<Machine[]>([])
  const [komponen, setKomponen] = useState<{ machine_id: number; komponen: string }[]>([])
  const [technicians, setTechnicians] = useState<{ id: number; name: string }[]>([])
  const [can, setCan] = useState({ manage: false })
  const [status, setStatus] = useState('aktif')
  const [machine, setMachine] = useState('')
  const [hasil, setHasil] = useState('')
  const [q, setQ] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [planForm, setPlanForm] = useState<Plan | 'new' | null>(null)
  const [checkup, setCheckup] = useState<{ plan: Plan | null } | null>(null)
  const [detailId, setDetailId] = useState<number | null>(focusId ?? null)
  const [logDetail, setLogDetail] = useState<Log | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ status })
      if (machine) params.set('machine', machine)
      if (q.trim()) params.set('q', q.trim())
      const res = await api<{ items: Plan[]; summary: Summary; machines: Machine[]; komponen: typeof komponen; technicians: typeof technicians; can: typeof can }>(`/api/maintenance?${params}`)
      setItems(res.items)
      setSummary(res.summary)
      setMachines(res.machines)
      setKomponen(res.komponen)
      setTechnicians(res.technicians)
      setCan(res.can)
      if (tab === 'riwayat') {
        const lp = new URLSearchParams()
        if (machine) lp.set('machine', machine)
        if (hasil) lp.set('hasil', hasil)
        if (q.trim()) lp.set('q', q.trim())
        setLogs((await api<{ items: Log[] }>(`/api/maintenance/checkup?${lp}`)).items)
      }
      setError('')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [status, machine, hasil, q, tab])
  useEffect(() => {
    const timer = setTimeout(load, q ? 300 : 0)
    return () => clearTimeout(timer)
  }, [load, q])
  const flash = (text: string) => {
    setMessage(text)
    setTimeout(() => setMessage(''), 5000)
    load()
  }

  const pagedPlans = usePaged(items, `${status}-${machine}-${q}`)
  const pagedLogs = usePaged(logs, `${machine}-${hasil}-${q}`)
  const stats: [string, number, string, string, typeof Wrench, string][] = summary ? [
    ['terlambat', summary.terlambat, 'Terlambat', 'Lewat jatuh tempo, belum dicek', AlarmClock, 'stat-2'],
    ['minggu', summary.minggu, 'Jatuh tempo 7 hari', 'Termasuk yang terlambat', CalendarClock, 'stat-1'],
    ['aktif', summary.aktif, 'Jadwal aktif', 'Perawatan rutin semua mesin', CalendarCheck, 'stat-0'],
    ['checkup', summary.checkup_30, 'Checkup 30 hari', summary.temuan_30 ? `${summary.temuan_30} dengan temuan` : 'Tidak ada temuan', ClipboardCheck, 'stat-0'],
  ] : []
  const printHref = `/cetak/perawatan${machine ? `?mesin=${machine}` : ''}`

  return (
    <>
      <div className="pap-page-heading">
        <div>
          <p className="pap-eyebrow">TEKNIK</p>
          <h1>Perawatan Mesin</h1>
          <span>Jadwal maintenance rutin tiap mesin dan catatan checkup Teknik. Jatuh tempo maju otomatis setelah checkup dicatat; temuan rusak bisa langsung diteruskan ke Kerusakan Mesin.</span>
        </div>
        <div className="pap-inline-actions pap-wrap">
          <a className="pap-btn" href={printHref} target="_blank" rel="noreferrer"><Printer /> Cetak laporan</a>
          {can.manage && <button className="pap-btn" onClick={() => setCheckup({ plan: null })}><ClipboardCheck /> Catat checkup</button>}
          {can.manage && <button className="pap-primary-button" onClick={() => setPlanForm('new')}><Plus /> Tambah jadwal</button>}
        </div>
      </div>
      {message && <Notice kind="success" onClose={() => setMessage('')}>{message}</Notice>}
      {summary && (
        <div className="pap-stat-grid four">
          {stats.map(([key, value, label, note, Icon, tone]) => (
            <button key={key} className={`pap-stat-card pap-stat-button ${tab === 'jadwal' && status === key ? 'active' : ''}`} onClick={() => {
              if (key === 'checkup') return setTab('riwayat')
              setTab('jadwal')
              setStatus(key === 'aktif' ? 'aktif' : key)
            }}>
              <div><span>{label}</span><strong>{value}</strong><small className="neutral">{note}</small></div>
              <div className={`pap-stat-icon ${tone}`}><Icon /></div>
            </button>
          ))}
        </div>
      )}
      <div className="pap-table-card">
        <div className="pap-filters pap-filters-top">
          <div className="pap-segmented" role="tablist" aria-label="Tampilan perawatan">
            <button role="tab" aria-selected={tab === 'jadwal'} className={tab === 'jadwal' ? 'active' : ''} onClick={() => setTab('jadwal')}><List /> Jadwal</button>
            <button role="tab" aria-selected={tab === 'riwayat'} className={tab === 'riwayat' ? 'active' : ''} onClick={() => setTab('riwayat')}><History /> Riwayat checkup</button>
          </div>
          <label className="pap-filter-search"><Search /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder={tab === 'jadwal' ? 'Cari pekerjaan, komponen, mesin...' : 'Cari temuan, tindakan, mesin...'} /></label>
          {tab === 'jadwal' ? (
            <select className="pap-select" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter status jadwal">
              <option value="aktif">Semua jadwal aktif</option>
              <option value="terlambat">Terlambat</option>
              <option value="minggu">Jatuh tempo 7 hari</option>
              <option value="nonaktif">Nonaktif</option>
              <option value="semua">Semua</option>
            </select>
          ) : (
            <select className="pap-select" value={hasil} onChange={(e) => setHasil(e.target.value)} aria-label="Filter hasil checkup">
              <option value="">Semua hasil</option>
              {Object.entries(HASIL_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          )}
          <select className="pap-select" value={machine} onChange={(e) => setMachine(e.target.value)} aria-label="Filter mesin">
            <option value="">Semua mesin</option>
            {machines.map((m) => <option key={m.id} value={m.id}>{m.nama}</option>)}
          </select>
        </div>
        {error && <div className="pap-card-notice"><Notice onClose={() => setError('')}>{error}</Notice></div>}
        {tab === 'jadwal' ? (
          <>
            <div className="pap-table-wrap">
              <table>
                <thead><tr><th>Mesin</th><th>Pekerjaan</th><th>Interval</th><th>Jatuh tempo</th><th>Checkup terakhir</th><th>PIC</th><th aria-label="Aksi" /></tr></thead>
                <tbody>
                  {pagedPlans.items.map((p) => (
                    <tr key={p.id} className="pap-row-link" onClick={() => setDetailId(p.id)}>
                      <td className="pap-nowrap"><div className="pap-cell-title">{p.machine_nama}</div><div className="pap-cell-sub">{p.machine_kode}{p.machine_status !== 'aktif' ? ` · ${p.machine_status}` : ''}</div></td>
                      <td><div className="pap-cell-title">{p.judul}</div>{p.komponen && <div className="pap-cell-sub">{p.komponen}</div>}</td>
                      <td className="pap-nowrap">Tiap {p.interval_hari} hari</td>
                      <td className="pap-nowrap"><div>{formatDate(p.berikutnya)}</div><DueBadge plan={p} /></td>
                      <td className="pap-nowrap">{p.terakhir ? <><div>{formatDate(p.terakhir)}</div>{p.hasil_terakhir && <HasilBadge value={p.hasil_terakhir} />}</> : <span className="pap-muted">Belum pernah</span>}</td>
                      <td>{p.pic_name ?? <span className="pap-muted">Semua Teknik</span>}</td>
                      <td onClick={(e) => e.stopPropagation()}>
                        {can.manage && p.aktif && <button className="pap-btn" onClick={() => setCheckup({ plan: p })}><ClipboardCheck /> Checkup</button>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!loading && !items.length && <div className="pap-empty">{status === 'aktif' ? 'Belum ada jadwal perawatan. Tambahkan jadwal rutin tiap mesin, mis. ganti oli tiap 30 hari.' : 'Tidak ada jadwal yang cocok dengan filter.'}</div>}
              {loading && !items.length && <div className="pap-empty">Memuat jadwal...</div>}
            </div>
            <Pager {...pagedPlans.pager} noun="jadwal" />
          </>
        ) : (
          <>
            <div className="pap-table-wrap">
              <table>
                <thead><tr><th>Tanggal</th><th>Mesin / pekerjaan</th><th>Hasil</th><th>Temuan & tindakan</th><th>Teknisi</th></tr></thead>
                <tbody>
                  {pagedLogs.items.map((l) => (
                    <tr key={l.id} className="pap-row-link" onClick={() => setLogDetail(l)}>
                      <td className="pap-nowrap">{formatDate(l.tanggal)}</td>
                      <td><div className="pap-cell-title">{l.machine_nama}</div><div className="pap-cell-sub">{l.plan_judul ?? 'Checkup di luar jadwal'}</div></td>
                      <td className="pap-nowrap"><HasilBadge value={l.hasil} />{l.repair_nomor && <div className="pap-cell-sub">{l.repair_nomor}</div>}</td>
                      <td><div className="pap-repair-keluhan">{[l.temuan, l.tindakan].filter(Boolean).join(' → ') || '—'}</div>{l.lampiran > 0 && <div className="pap-cell-sub">{l.lampiran} lampiran</div>}</td>
                      <td className="pap-nowrap">{l.dikerjakan_name}{l.durasi_menit ? <div className="pap-cell-sub">{l.durasi_menit} menit</div> : null}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!loading && !logs.length && <div className="pap-empty">Belum ada checkup tercatat.</div>}
            </div>
            <Pager {...pagedLogs.pager} noun="checkup" />
          </>
        )}
      </div>
      {planForm && <PlanForm initial={planForm === 'new' ? null : planForm} machines={machines} komponen={komponen} technicians={technicians} onClose={() => setPlanForm(null)} onSaved={(text) => { setPlanForm(null); flash(text) }} />}
      {checkup && <CheckupForm plan={checkup.plan} machines={machines} onClose={() => setCheckup(null)} onSaved={(text) => { setCheckup(null); flash(text) }} />}
      {detailId && (
        <PlanDetail
          id={detailId}
          onClose={() => setDetailId(null)}
          onEdit={(p) => { setDetailId(null); setPlanForm(p) }}
          onCheckup={(p) => { setDetailId(null); setCheckup({ plan: p }) }}
          onOpenLog={setLogDetail}
        />
      )}
      {logDetail && <LogDetail log={logDetail} user={user} canManage={can.manage} onClose={() => setLogDetail(null)} />}
    </>
  )
}

// ---------- Form jadwal ----------
function PlanForm({ initial, machines, komponen, technicians, onClose, onSaved }: {
  initial: Plan | null; machines: Machine[]; komponen: { machine_id: number; komponen: string }[]; technicians: { id: number; name: string }[]
  onClose: () => void; onSaved: (text: string) => void
}) {
  const today = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10)
  const [values, setValues] = useState({
    machine_id: initial ? String(initial.machine_id) : '', judul: initial?.judul ?? '', komponen: initial?.komponen ?? '',
    interval_hari: String(initial?.interval_hari ?? 30), berikutnya: initial?.berikutnya ?? today, pic_id: initial?.pic_id ? String(initial.pic_id) : '', catatan: initial?.catatan ?? '',
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const set = (k: keyof typeof values) => (e: { target: { value: string } }) => setValues((v) => ({ ...v, [k]: e.target.value }))
  const options = komponen.filter((k) => String(k.machine_id) === values.machine_id)

  async function run(task: () => Promise<unknown>, text: string) {
    setBusy(true)
    setError('')
    try {
      await task()
      onSaved(text)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    run(() => api(initial ? `/api/maintenance/${initial.id}` : '/api/maintenance', { method: initial ? 'PATCH' : 'POST', json: values }), initial ? 'Jadwal perawatan diperbarui.' : 'Jadwal perawatan ditambahkan.')
  }
  return (
    <Modal
      title={initial ? 'Ubah jadwal perawatan' : 'Tambah jadwal perawatan'}
      subtitle="Pengingat dikirim ke PIC (atau semua Teknik) saat jatuh tempo"
      onClose={onClose}
      footer={<>
        {initial && <button className="pap-btn" disabled={busy} onClick={() => run(() => api(`/api/maintenance/${initial.id}`, { method: 'PATCH', json: { aktif: !initial.aktif } }), initial.aktif ? 'Jadwal dinonaktifkan.' : 'Jadwal diaktifkan kembali.')}>{initial.aktif ? 'Nonaktifkan' : 'Aktifkan'}</button>}
        {initial && <button className="pap-btn danger" disabled={busy} onClick={() => window.confirm(`Hapus jadwal "${initial.judul}"? Riwayat checkup tetap tersimpan.`) && run(() => api(`/api/maintenance/${initial.id}`, { method: 'DELETE' }), 'Jadwal perawatan dihapus.')}>Hapus</button>}
        <span className="pap-spacer" />
        <button className="pap-btn" onClick={onClose}>Batal</button>
        <button className="pap-primary-button" form="plan-form" disabled={busy}>{busy ? 'Menyimpan...' : 'Simpan'}</button>
      </>}
    >
      <form id="plan-form" className="pap-form-grid" onSubmit={submit}>
        {error && <div className="full"><Notice onClose={() => setError('')}>{error}</Notice></div>}
        <Field label="Mesin" full>
          <select className="pap-select" required value={values.machine_id} onChange={set('machine_id')}>
            <option value="">— Pilih mesin —</option>
            {machines.map((m) => <option key={m.id} value={m.id}>{m.nama} ({m.kode})</option>)}
          </select>
        </Field>
        <Field label="Pekerjaan perawatan" full><input className="pap-input" required maxLength={200} value={values.judul} onChange={set('judul')} placeholder="Mis. Ganti oli gearbox, bersihkan dies, cek pisau las" /></Field>
        <Field label="Komponen (opsional)" hint={options.length ? 'Pilihan dari critical point Data Mesin, atau ketik sendiri.' : undefined}>
          <input className="pap-input" list="pap-komponen-mesin" maxLength={150} value={values.komponen} onChange={set('komponen')} />
          <datalist id="pap-komponen-mesin">{options.map((k) => <option key={k.komponen} value={k.komponen} />)}</datalist>
        </Field>
        <Field label="Interval (hari)"><input className="pap-input" type="number" min={1} max={3650} required value={values.interval_hari} onChange={set('interval_hari')} /></Field>
        <Field label="Jatuh tempo berikutnya"><input className="pap-input" type="date" required value={values.berikutnya} onChange={set('berikutnya')} /></Field>
        <Field label="PIC teknisi">
          <select className="pap-select" value={values.pic_id} onChange={set('pic_id')}>
            <option value="">Semua Teknik</option>
            {technicians.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </Field>
        <Field label="Catatan / langkah kerja (opsional)" full><textarea className="pap-input" rows={3} maxLength={5000} value={values.catatan} onChange={set('catatan')} /></Field>
      </form>
    </Modal>
  )
}

// ---------- Form checkup ----------
function CheckupForm({ plan, machines, onClose, onSaved }: { plan: Plan | null; machines: Machine[]; onClose: () => void; onSaved: (text: string) => void }) {
  const today = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10)
  const [values, setValues] = useState({ machine_id: plan ? String(plan.machine_id) : '', tanggal: today, hasil: 'baik' as Hasil, temuan: '', tindakan: '', durasi_menit: '' })
  const [lapor, setLapor] = useState({ lapor_kerusakan: false, prioritas: 'normal', mesin_berhenti: false })
  const [files, setFiles] = useState<PendingAttachments>(emptyAttachments)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const set = (k: keyof typeof values) => (e: { target: { value: string } }) => setValues((v) => ({ ...v, [k]: e.target.value }))

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const res = await api<{ id: number; repairId: number | null }>('/api/maintenance/checkup', {
        method: 'POST',
        json: { ...values, plan_id: plan?.id ?? null, ...(values.hasil !== 'baik' ? lapor : {}) },
      })
      const failed = pendingCount(files) ? await uploadNoteAttachments('maintenance_log', res.id, files) : []
      onSaved([
        'Checkup dicatat.',
        plan ? 'Jatuh tempo berikutnya sudah diperbarui.' : '',
        res.repairId ? 'Temuan diteruskan ke Kerusakan Mesin.' : '',
        failed.length ? `Sebagian lampiran gagal: ${failed.join(' ')}` : '',
      ].filter(Boolean).join(' '))
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal
      title={plan ? `Checkup: ${plan.judul}` : 'Catat checkup mesin'}
      subtitle={plan ? `${plan.machine_nama} · tiap ${plan.interval_hari} hari` : 'Checkup di luar jadwal rutin'}
      wide
      onClose={onClose}
      footer={<><span className="pap-spacer" /><button className="pap-btn" onClick={onClose}>Batal</button><button className="pap-primary-button" form="checkup-form" disabled={busy}>{busy ? 'Menyimpan...' : 'Simpan checkup'}</button></>}
    >
      <form id="checkup-form" className="pap-form-grid" onSubmit={submit}>
        {error && <div className="full"><Notice onClose={() => setError('')}>{error}</Notice></div>}
        {!plan && (
          <Field label="Mesin" full>
            <select className="pap-select" required value={values.machine_id} onChange={set('machine_id')}>
              <option value="">— Pilih mesin —</option>
              {machines.map((m) => <option key={m.id} value={m.id}>{m.nama} ({m.kode})</option>)}
            </select>
          </Field>
        )}
        <Field label="Tanggal checkup"><input className="pap-input" type="date" max={today} required value={values.tanggal} onChange={set('tanggal')} /></Field>
        <Field label="Durasi (menit, opsional)"><input className="pap-input" type="number" min={0} value={values.durasi_menit} onChange={set('durasi_menit')} /></Field>
        <Field label="Hasil" full>
          <div className="pap-qc-options three" role="radiogroup">
            {(Object.keys(HASIL_LABEL) as Hasil[]).map((h) => (
              <button type="button" key={h} role="radio" aria-checked={values.hasil === h} className={`pap-qc-option ${HASIL_TONE[h] === 'success' ? 'info' : HASIL_TONE[h]} ${values.hasil === h ? 'active' : ''}`} onClick={() => setValues((v) => ({ ...v, hasil: h }))}>{HASIL_LABEL[h]}</button>
            ))}
          </div>
        </Field>
        <Field label={values.hasil === 'baik' ? 'Temuan (opsional)' : 'Temuan / kondisi mesin'} full><textarea className="pap-input" rows={2} required={values.hasil !== 'baik'} maxLength={5000} value={values.temuan} onChange={set('temuan')} placeholder="Kondisi yang ditemukan saat pengecekan" /></Field>
        <Field label="Tindakan yang dilakukan (opsional)" full><textarea className="pap-input" rows={2} maxLength={5000} value={values.tindakan} onChange={set('tindakan')} placeholder="Mis. oli diganti 2 L, baut dikencangkan" /></Field>
        {values.hasil !== 'baik' && (
          <div className="pap-inline-panel full">
            <label className="pap-check"><input type="checkbox" checked={lapor.lapor_kerusakan} onChange={(e) => setLapor((l) => ({ ...l, lapor_kerusakan: e.target.checked }))} /> Teruskan ke <strong>Kerusakan Mesin</strong> untuk diperbaiki</label>
            {lapor.lapor_kerusakan && (
              <div className="pap-inline-actions pap-wrap">
                <select className="pap-select" value={lapor.prioritas} onChange={(e) => setLapor((l) => ({ ...l, prioritas: e.target.value }))} aria-label="Prioritas perbaikan">
                  <option value="normal">Prioritas normal</option><option value="tinggi">Prioritas tinggi</option><option value="darurat">Darurat</option>
                </select>
                <label className="pap-check"><input type="checkbox" checked={lapor.mesin_berhenti} onChange={(e) => setLapor((l) => ({ ...l, mesin_berhenti: e.target.checked }))} /> Mesin berhenti (status jadi maintenance)</label>
              </div>
            )}
          </div>
        )}
        <Field label="Foto / dokumen checkup (opsional)" full><AttachmentInput value={files} onChange={setFiles} /></Field>
      </form>
    </Modal>
  )
}

// ---------- Detail jadwal + riwayat ----------
function PlanDetail({ id, onClose, onEdit, onCheckup, onOpenLog }: {
  id: number; onClose: () => void; onEdit: (p: Plan) => void; onCheckup: (p: Plan) => void; onOpenLog: (l: Log) => void
}) {
  const [item, setItem] = useState<Plan | null>(null)
  const [logs, setLogs] = useState<Log[]>([])
  const [can, setCan] = useState({ manage: false })
  const [error, setError] = useState('')
  useEffect(() => {
    api<{ item: Plan; logs: Log[]; can: typeof can }>(`/api/maintenance/${id}`)
      .then((res) => { setItem(res.item); setLogs(res.logs); setCan(res.can) })
      .catch((e) => setError(e.message))
  }, [id])
  if (!item) return <Modal title="Jadwal perawatan" onClose={onClose}>{error ? <Notice>{error}</Notice> : <p className="pap-muted">Memuat...</p>}</Modal>
  return (
    <Modal
      title={item.judul}
      subtitle={`${item.machine_nama} (${item.machine_kode})${item.komponen ? ` · ${item.komponen}` : ''}`}
      wide
      onClose={onClose}
      footer={<>
        {can.manage && <button className="pap-btn" onClick={() => onEdit(item)}><Pencil /> Ubah jadwal</button>}
        <span className="pap-spacer" />
        <button className="pap-btn" onClick={onClose}>Tutup</button>
        {can.manage && item.aktif && <button className="pap-primary-button" onClick={() => onCheckup(item)}><ClipboardCheck /> Catat checkup</button>}
      </>}
    >
      <div className="pap-detail-badges"><DueBadge plan={item} /></div>
      <dl className="pap-detail-grid">
        <div><dt>Interval</dt><dd>Tiap {item.interval_hari} hari</dd></div>
        <div><dt>Jatuh tempo berikutnya</dt><dd>{formatDate(item.berikutnya)}</dd></div>
        <div><dt>Checkup terakhir</dt><dd>{item.terakhir ? formatDate(item.terakhir) : 'Belum pernah'}</dd></div>
        <div><dt>PIC</dt><dd>{item.pic_name ?? 'Semua Teknik'}</dd></div>
      </dl>
      {item.catatan && <section className="pap-detail-section"><h3>Catatan / langkah kerja</h3><p className="pap-prewrap">{item.catatan}</p></section>}
      <section className="pap-detail-section">
        <h3>Riwayat checkup ({logs.length})</h3>
        <ol className="pap-note-list">
          {logs.map((l) => (
            <li key={l.id} className="pap-note-item">
              <button type="button" className="pap-link-button" onClick={() => onOpenLog(l)}>
                <div className="pap-note-head"><HasilBadge value={l.hasil} /><span className="pap-note-meta"><strong>{l.dikerjakan_name}</strong> · {formatDate(l.tanggal)}{l.lampiran ? ` · ${l.lampiran} lampiran` : ''}</span></div>
              </button>
              {(l.temuan || l.tindakan) && <p className="pap-prewrap">{[l.temuan, l.tindakan && `Tindakan: ${l.tindakan}`].filter(Boolean).join('\n')}</p>}
            </li>
          ))}
        </ol>
        {!logs.length && <p className="pap-muted">Belum ada checkup untuk jadwal ini.</p>}
      </section>
    </Modal>
  )
}

// ---------- Detail satu checkup + lampiran ----------
function LogDetail({ log, user, canManage, onClose }: { log: Log; user: UserProfile; canManage: boolean; onClose: () => void }) {
  return (
    <Modal title={`Checkup ${formatDate(log.tanggal)}`} subtitle={`${log.machine_nama} · ${log.plan_judul ?? 'di luar jadwal'}`} onClose={onClose} footer={<><span className="pap-spacer" /><button className="pap-btn" onClick={onClose}>Tutup</button></>}>
      <div className="pap-detail-badges"><HasilBadge value={log.hasil} />{log.repair_nomor && <span className="pap-status info">Diteruskan: {log.repair_nomor}</span>}</div>
      <dl className="pap-detail-grid">
        <div><dt>Teknisi</dt><dd>{log.dikerjakan_name}</dd></div>
        <div><dt>Durasi</dt><dd>{log.durasi_menit ? `${log.durasi_menit} menit` : '—'}</dd></div>
      </dl>
      {log.temuan && <section className="pap-detail-section"><h3>Temuan</h3><p className="pap-prewrap">{log.temuan}</p></section>}
      {log.tindakan && <section className="pap-detail-section"><h3>Tindakan</h3><p className="pap-prewrap">{log.tindakan}</p></section>}
      <AttachmentPanel title="Foto / dokumen checkup" basePath={`/api/notes/maintenance_log/${log.id}/attachments`} fileBase="/api/notes/attachments" canAdd={canManage || log.dikerjakan_oleh === user.id} currentUserId={user.id} isAdmin={user.role.isAdmin} />
    </Modal>
  )
}
