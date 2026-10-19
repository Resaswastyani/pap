'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, ClipboardCheck, Moon, Pencil, Plus, Sun, Sunrise, Trash2 } from 'lucide-react'
import type { UserProfile } from '@/lib/users'
import { formatNumber } from './accurate'
import { api, Field, formatDate, Modal, Notice } from './ui'

export type QcStatus = 'menunggu' | 'lolos' | 'perbaikan' | 'reject'
export type Result = {
  id: number; job_id: number; stage_id: number; tanggal: string; shift: number; machine_id: number | null; machine_name: string | null
  jumlah_hasil: number; jumlah_reject: number; satuan: string | null; operator: string | null; kendala: string | null; catatan: string | null
  status_qc: QcStatus; catatan_qc: string | null; qc_at: string | null; qc_name: string | null; reported_by: number; reported_name: string; created_at: string
  nomor: string; spk_nomor: string | null; item_name: string; customer_name: string | null; tahap: string; urutan: number
}
type Rekap = { shift: number; satuan: string | null; laporan: number; hasil: number; reject: number; baik: number; menunggu_qc: number; kendala: number }
type Can = { report: boolean; qc: boolean; manage: boolean }
type StageOption = {
  id: number; job_id: number; urutan: number; tahap: string; machine_id: number | null; status: string; progress: number; target: number | null; unit: string | null
  nomor: string; spk_nomor: string | null; item_name: string; customer_name: string | null; due_date: string | null; hasil_baik: number | null
}
type MachineOption = { id: number; kode: string; nama: string; tahap: string }

export const QC_LABEL: Record<QcStatus, string> = { menunggu: 'Menunggu QC', lolos: 'Lolos QC', perbaikan: 'Perlu perbaikan', reject: 'Reject' }
const QC_TONE: Record<QcStatus, string> = { menunggu: 'warning', lolos: 'success', perbaikan: 'info', reject: 'danger' }
// Sama dengan keterangan jadwal shift
export const SHIFT_INFO = [
  { shift: 1, label: 'Shift 1', jam: '07.00–15.00', icon: Sunrise },
  { shift: 2, label: 'Shift 2', jam: '15.00–23.00', icon: Sun },
  { shift: 3, label: 'Shift 3', jam: '23.00–07.00', icon: Moon },
]
export const QcBadge = ({ value }: { value: QcStatus }) => <span className={`pap-status ${QC_TONE[value]}`}>{QC_LABEL[value]}</span>
const num = (n: number) => formatNumber(n, 2)
const addDays = (ymd: string, d: number) => {
  const x = new Date(`${ymd}T00:00:00Z`)
  x.setUTCDate(x.getUTCDate() + d)
  return x.toISOString().slice(0, 10)
}
const DAY_NAME = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu']

// ---------- Menu Hasil Produksi & QC ----------
export function ResultsPage(_props: { user: UserProfile }) {
  const [tanggal, setTanggal] = useState('')
  const [current, setCurrent] = useState<{ tanggal: string; shift: number } | null>(null)
  const [shift, setShift] = useState(0)
  const [pendingOnly, setPendingOnly] = useState(false)
  const [items, setItems] = useState<Result[]>([])
  const [rekap, setRekap] = useState<Rekap[]>([])
  const [pendingQc, setPendingQc] = useState(0)
  const [can, setCan] = useState<Can>({ report: false, qc: false, manage: false })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [form, setForm] = useState<Result | 'new' | null>(null)
  const [qcFor, setQcFor] = useState<Result | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (tanggal) params.set('tanggal', tanggal)
      if (shift) params.set('shift', String(shift))
      if (pendingOnly) params.set('qc', 'menunggu')
      const res = await api<{ tanggal: string; current: { tanggal: string; shift: number }; items: Result[]; rekap: Rekap[]; pendingQc: number; can: Can }>(`/api/production/results?${params}`)
      setTanggal(res.tanggal)
      setCurrent(res.current)
      setItems(res.items)
      setRekap(res.rekap)
      setPendingQc(res.pendingQc)
      setCan(res.can)
      setError('')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [tanggal, shift, pendingOnly])
  useEffect(() => { load() }, [load])
  const flash = (text: string) => {
    setMessage(text)
    setTimeout(() => setMessage(''), 4000)
    load()
  }
  const day = tanggal ? new Date(`${tanggal}T00:00:00Z`).getUTCDay() : 0

  return (
    <>
      <div className="pap-page-heading">
        <div>
          <p className="pap-eyebrow">PRODUKSI</p>
          <h1>Hasil Produksi & QC</h1>
          <span>Laporan hasil produksi per shift dari KA Shift terhadap target SPK, lalu diperiksa QC. Progress tahap di Jadwal Produksi dihitung otomatis dari hasil baik.</span>
        </div>
        {can.report && <button className="pap-primary-button" onClick={() => setForm('new')}><Plus /> Lapor hasil</button>}
      </div>
      {message && <Notice kind="success" onClose={() => setMessage('')}>{message}</Notice>}
      {error && <Notice onClose={() => setError('')}>{error}</Notice>}

      <div className="pap-stat-grid four">
        {SHIFT_INFO.map(({ shift: s, label, jam, icon: Icon }) => {
          const rows = rekap.filter((r) => r.shift === s)
          const active = current && current.tanggal === tanggal && current.shift === s
          return (
            <button key={s} className={`pap-stat-card pap-stat-button ${shift === s ? 'active' : ''}`} onClick={() => { setPendingOnly(false); setShift((v) => (v === s ? 0 : s)) }}>
              <div>
                <span>{label} · {jam}{active ? ' · berjalan' : ''}</span>
                {rows.length ? rows.map((r) => <strong key={r.satuan ?? ''} className="pap-result-stat">{num(r.baik)} <small>{r.satuan ?? ''}</small></strong>) : <strong>—</strong>}
                <small className="neutral">{rows.length ? `${rows.reduce((n, r) => n + r.laporan, 0)} laporan · reject ${rows.map((r) => `${r.hasil ? Math.round((r.reject / r.hasil) * 1000) / 10 : 0}%`).join(' / ')}` : 'Belum ada laporan'}</small>
              </div>
              <div className={`pap-stat-icon stat-${s === 3 ? 2 : s === 2 ? 0 : 1}`}><Icon /></div>
            </button>
          )
        })}
        <button className={`pap-stat-card pap-stat-button ${pendingOnly ? 'active' : ''}`} onClick={() => setPendingOnly((v) => !v)}>
          <div><span>Menunggu QC (semua tanggal)</span><strong>{pendingQc}</strong><small className="neutral">{rekap.reduce((n, r) => n + r.kendala, 0)} laporan dengan kendala hari ini</small></div>
          <div className="pap-stat-icon stat-2"><ClipboardCheck /></div>
        </button>
      </div>

      <div className="pap-table-card">
        <div className="pap-calendar-bar pap-visit-bar">
          <div className="pap-calendar-nav">
            <button className="pap-icon-button" aria-label="Hari sebelumnya" disabled={!tanggal || pendingOnly} onClick={() => setTanggal(addDays(tanggal, -1))}><ChevronLeft /></button>
            <button className="pap-icon-button" aria-label="Hari berikutnya" disabled={!tanggal || pendingOnly} onClick={() => setTanggal(addDays(tanggal, 1))}><ChevronRight /></button>
            <h3>{pendingOnly ? 'Semua laporan menunggu QC' : tanggal ? `${DAY_NAME[day]}, ${formatDate(tanggal)}` : '...'}</h3>
          </div>
          <div className="pap-inline-actions">
            <input className="pap-input pap-date-input" type="date" value={tanggal} disabled={pendingOnly} onChange={(e) => e.target.value && setTanggal(e.target.value)} aria-label="Tanggal produksi" />
            {current && tanggal !== current.tanggal && <button className="pap-btn" onClick={() => { setPendingOnly(false); setTanggal(current.tanggal) }}>Hari ini</button>}
            <div className="pap-segmented" role="tablist" aria-label="Shift">
              {[0, 1, 2, 3].map((s) => <button key={s} className={shift === s ? 'active' : ''} onClick={() => setShift(s)}>{s ? `Shift ${s}` : 'Semua'}</button>)}
            </div>
          </div>
        </div>
        <ResultsTable items={items} can={can} showDate={pendingOnly} onEdit={(r) => setForm(r)} onQc={setQcFor} onDeleted={() => flash('Laporan dihapus.')} onError={setError} />
        {!loading && !items.length && <div className="pap-empty">{pendingOnly ? 'Tidak ada laporan yang menunggu QC.' : `Belum ada laporan hasil produksi${shift ? ` shift ${shift}` : ''} pada tanggal ini.`}</div>}
        {loading && !items.length && <div className="pap-empty">Memuat laporan...</div>}
      </div>
      {form && <ResultForm initial={form === 'new' ? null : form} defaults={current} onClose={() => setForm(null)} onSaved={(t) => { setForm(null); flash(t) }} />}
      {qcFor && <QcForm item={qcFor} onClose={() => setQcFor(null)} onSaved={(t) => { setQcFor(null); flash(t) }} />}
    </>
  )
}

// ---------- Tabel laporan (dipakai juga di detail job) ----------
export function ResultsTable({ items, can, showDate, showJob = true, currentUserId, onEdit, onQc, onDeleted, onError }: {
  items: Result[]; can: Can; showDate?: boolean; showJob?: boolean; currentUserId?: number
  onEdit: (r: Result) => void; onQc: (r: Result) => void; onDeleted: () => void; onError: (message: string) => void
}) {
  if (!items.length) return null
  const editable = (r: Result) => can.manage || (can.report && r.status_qc === 'menunggu' && (currentUserId === undefined || r.reported_by === currentUserId))
  async function remove(r: Result) {
    if (!window.confirm('Hapus laporan hasil produksi ini?')) return
    try {
      await api(`/api/production/results/${r.id}`, { method: 'DELETE' })
      onDeleted()
    } catch (e) {
      onError((e as Error).message)
    }
  }
  return (
    <div className="pap-table-wrap">
      <table className="pap-results-table">
        <thead><tr><th>Shift</th>{showJob && <th>SPK / Produk</th>}<th>Tahap · Mesin</th><th className="pap-num">Hasil</th><th className="pap-num">Reject</th><th className="pap-num">Baik</th><th>Operator / Pelapor</th><th>QC</th><th></th></tr></thead>
        <tbody>
          {items.map((r) => (
            <tr key={r.id}>
              <td className="pap-nowrap"><b>Shift {r.shift}</b>{(showDate || !showJob) && <div className="pap-cell-sub">{formatDate(r.tanggal)}</div>}</td>
              {showJob && <td><div className="pap-cell-title">{r.item_name}</div><div className="pap-cell-sub">{r.spk_nomor ?? r.nomor}{r.customer_name ? ` · ${r.customer_name}` : ''}</div></td>}
              <td><div>{r.tahap}</div><div className="pap-cell-sub">{r.machine_name ?? 'Mesin tidak dicatat'}</div></td>
              <td className="pap-num pap-nowrap">{num(r.jumlah_hasil)} {r.satuan}</td>
              <td className="pap-num pap-nowrap">{r.jumlah_reject ? <span className="pap-text-danger">{num(r.jumlah_reject)}</span> : '0'}{r.jumlah_hasil > 0 && r.jumlah_reject > 0 && <div className="pap-cell-sub">{Math.round((r.jumlah_reject / r.jumlah_hasil) * 1000) / 10}%</div>}</td>
              <td className="pap-num pap-nowrap"><b>{r.status_qc === 'reject' ? '0' : num(r.jumlah_hasil - r.jumlah_reject)}</b></td>
              <td>
                <div>{r.operator ?? '—'}</div><div className="pap-cell-sub">Lapor: {r.reported_name}</div>
                {r.kendala && <div className="pap-result-issue"><AlertTriangle /> {r.kendala}</div>}
                {r.catatan && <div className="pap-cell-sub">{r.catatan}</div>}
              </td>
              <td>
                <QcBadge value={r.status_qc} />
                {r.qc_name && <div className="pap-cell-sub">{r.qc_name} · {formatDate(r.qc_at, true)}</div>}
                {r.catatan_qc && <div className="pap-cell-sub">{r.catatan_qc}</div>}
              </td>
              <td className="pap-nowrap">
                <div className="pap-row-actions">
                  {can.qc && <button className="pap-btn small" onClick={() => onQc(r)}><CheckCircle2 /> QC</button>}
                  {editable(r) && <button className="pap-icon-button" aria-label="Ubah laporan" onClick={() => onEdit(r)}><Pencil /></button>}
                  {editable(r) && <button className="pap-icon-button" aria-label="Hapus laporan" onClick={() => remove(r)}><Trash2 /></button>}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ---------- Form lapor / ubah hasil produksi ----------
export function ResultForm({ initial, stageId, defaults, onClose, onSaved }: {
  initial: Result | null; stageId?: number; defaults?: { tanggal: string; shift: number } | null; onClose: () => void; onSaved: (message: string) => void
}) {
  const [stages, setStages] = useState<StageOption[]>([])
  const [machines, setMachines] = useState<MachineOption[]>([])
  const [filter, setFilter] = useState('')
  const [now, setNow] = useState(defaults ?? null)
  const [values, setValues] = useState({
    stage_id: String(initial?.stage_id ?? stageId ?? ''),
    tanggal: initial?.tanggal ?? defaults?.tanggal ?? '',
    shift: String(initial?.shift ?? defaults?.shift ?? ''),
    machine_id: initial?.machine_id ? String(initial.machine_id) : '',
    jumlah_hasil: initial ? String(initial.jumlah_hasil) : '',
    jumlah_reject: initial ? String(initial.jumlah_reject) : '',
    satuan: initial?.satuan ?? '',
    operator: initial?.operator ?? '',
    kendala: initial?.kendala ?? '',
    catatan: initial?.catatan ?? '',
  })
  const [repair, setRepair] = useState({ lapor: false, prioritas: 'tinggi', mesin_berhenti: false })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    api<{ stages: StageOption[]; machines: MachineOption[]; current: { tanggal: string; shift: number } }>('/api/production/results/options').then((res) => {
      setStages(res.stages)
      setMachines(res.machines)
      // Tanggal & shift berjalan (mis. dibuka dari detail job)
      setNow((v) => v ?? res.current)
    }).catch((e) => setError(e.message))
  }, [])
  useEffect(() => {
    if (now && !initial) setValues((v) => ({ ...v, tanggal: v.tanggal || now.tanggal, shift: v.shift || String(now.shift) }))
  }, [now, initial])

  const stage = stages.find((s) => String(s.id) === values.stage_id)
  // Pilih tahap: mesin & satuan mengikuti tahap bila belum diisi
  useEffect(() => {
    if (!stage || initial) return
    setValues((v) => ({ ...v, machine_id: v.machine_id || (stage.machine_id ? String(stage.machine_id) : ''), satuan: stage.unit ?? v.satuan }))
  }, [stage, initial])
  const set = (key: keyof typeof values) => (e: { target: { value: string } }) => setValues((v) => ({ ...v, [key]: e.target.value }))
  const groups = useMemo(() => {
    const q = filter.trim().toLowerCase()
    const list = stages.filter((s) => !q || String(s.id) === values.stage_id || `${s.spk_nomor ?? ''} ${s.nomor} ${s.item_name} ${s.customer_name ?? ''} ${s.tahap}`.toLowerCase().includes(q))
    const map = new Map<number, StageOption[]>()
    for (const s of list) map.set(s.job_id, [...(map.get(s.job_id) ?? []), s])
    return [...map.values()]
  }, [stages, filter, values.stage_id])
  const hasil = Number(values.jumlah_hasil.replace(',', '.')) || 0
  const reject = Number(values.jumlah_reject.replace(',', '.')) || 0

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const lapor = !initial && repair.lapor && !!values.kendala.trim()
      await api(initial ? `/api/production/results/${initial.id}` : '/api/production/results', {
        method: initial ? 'PATCH' : 'POST',
        json: lapor ? { ...values, lapor_kerusakan: true, prioritas: repair.prioritas, mesin_berhenti: repair.mesin_berhenti } : values,
      })
      onSaved(initial ? 'Laporan hasil produksi diperbarui.' : `Hasil produksi dilaporkan. Menunggu pemeriksaan QC.${lapor ? ' Kerusakan mesin sudah diteruskan ke Teknik.' : ''}`)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      wide
      title={initial ? 'Ubah laporan hasil produksi' : 'Lapor hasil produksi'}
      subtitle="Satu laporan untuk satu tahap pada satu shift. Hasil baik = hasil − reject."
      onClose={onClose}
      footer={<><span className="pap-spacer" /><button className="pap-btn" onClick={onClose}>Batal</button><button className="pap-primary-button" form="result-form" disabled={busy}>{busy ? 'Menyimpan...' : initial ? 'Simpan' : 'Kirim laporan'}</button></>}
    >
      <form id="result-form" className="pap-form-grid" onSubmit={submit}>
        {error && <div className="full"><Notice onClose={() => setError('')}>{error}</Notice></div>}
        <Field label="SPK / job & tahap produksi" full hint={stage ? `Target ${stage.target === null ? '—' : `${num(stage.target)} ${stage.unit ?? ''}`} · hasil baik ${num(stage.hasil_baik ?? 0)} ${stage.unit ?? ''}${stage.target ? ` (${Math.min(100, Math.floor(((stage.hasil_baik ?? 0) / stage.target) * 100))}%)` : ''}${stage.due_date ? ` · kirim ${formatDate(stage.due_date)}` : ''}` : 'Job yang sudah terbit SPK-nya tampil paling atas.'}>
          {!initial && !stageId && <input className="pap-input" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Cari SPK, produk, customer, tahap..." />}
          <select className="pap-select" required value={values.stage_id} onChange={set('stage_id')} disabled={!!stageId && !initial}>
            <option value="">— Pilih tahap —</option>
            {initial && !stage && <option value={initial.stage_id}>{initial.spk_nomor ?? initial.nomor} · {initial.item_name} — {initial.tahap}</option>}
            {groups.map((list) => (
              <optgroup key={list[0].job_id} label={`${list[0].spk_nomor ?? `${list[0].nomor} (SPK belum terbit)`} · ${list[0].item_name}${list[0].customer_name ? ` · ${list[0].customer_name}` : ''}`}>
                {list.map((s) => <option key={s.id} value={s.id}>{s.urutan}. {s.tahap}{s.target ? ` — ${s.progress}%` : ''}</option>)}
              </optgroup>
            ))}
          </select>
        </Field>
        <div className="pap-field-pair">
          <Field label="Tanggal produksi" hint="Shift 3 lewat tengah malam: pakai tanggal mulai shift"><input className="pap-input" type="date" required value={values.tanggal} onChange={set('tanggal')} /></Field>
          <Field label="Shift" hint={SHIFT_INFO.find((s) => String(s.shift) === values.shift)?.jam}>
            <div className="pap-segmented pap-shift-pick" role="radiogroup">
              {SHIFT_INFO.map((s) => <button type="button" key={s.shift} role="radio" aria-checked={values.shift === String(s.shift)} className={values.shift === String(s.shift) ? 'active' : ''} onClick={() => setValues((v) => ({ ...v, shift: String(s.shift) }))} title={`${s.label} · ${s.jam}`}>{s.shift}</button>)}
            </div>
          </Field>
        </div>
        <Field label="Mesin">
          <select className="pap-select" value={values.machine_id} onChange={set('machine_id')}>
            <option value="">— Tidak dicatat —</option>
            {machines.map((m) => <option key={m.id} value={m.id}>{m.nama} ({m.kode}) · {m.tahap}</option>)}
          </select>
        </Field>
        <Field label="Operator yang bertugas"><input className="pap-input" maxLength={255} value={values.operator} onChange={set('operator')} placeholder="mis. Andi, Satria" /></Field>
        <div className="pap-field-pair">
          <Field label="Jumlah hasil"><input className="pap-input" inputMode="decimal" required value={values.jumlah_hasil} onChange={set('jumlah_hasil')} placeholder="0" /></Field>
          <Field label="Reject / afalan"><input className="pap-input" inputMode="decimal" value={values.jumlah_reject} onChange={set('jumlah_reject')} placeholder="0" /></Field>
        </div>
        <Field label="Satuan" hint={hasil ? `Hasil baik ${num(Math.max(0, hasil - reject))} ${values.satuan}${reject ? ` · reject ${Math.round((reject / hasil) * 1000) / 10}%` : ''}` : undefined}>
          <input className="pap-input" maxLength={40} value={values.satuan} onChange={set('satuan')} placeholder="kg, pcs, roll, bal" list="pap-result-units" />
          <datalist id="pap-result-units">{['kg', 'pcs', 'roll', 'bal', 'lembar', 'pack'].map((u) => <option key={u} value={u} />)}</datalist>
        </Field>
        <Field label="Kendala bahan baku / mesin" full hint="Diisi bila ada kendala, mis. bahan telat, mesin trouble, listrik padam."><textarea className="pap-input" rows={2} maxLength={5000} value={values.kendala} onChange={set('kendala')} /></Field>
        {!initial && values.kendala.trim() && (
          <div className="full pap-result-repair">
            <label className="pap-check"><input type="checkbox" checked={repair.lapor} onChange={(e) => setRepair((r) => ({ ...r, lapor: e.target.checked }))} /> Laporkan sebagai kerusakan mesin ke Teknik</label>
            {repair.lapor && (
              <>
                <select className="pap-select" value={repair.prioritas} onChange={(e) => setRepair((r) => ({ ...r, prioritas: e.target.value }))} aria-label="Prioritas perbaikan">
                  <option value="darurat">Darurat</option><option value="tinggi">Tinggi</option><option value="normal">Normal</option>
                </select>
                <label className="pap-check"><input type="checkbox" checked={repair.mesin_berhenti} onChange={(e) => setRepair((r) => ({ ...r, mesin_berhenti: e.target.checked }))} /> Mesin berhenti</label>
                {!values.machine_id && <small className="pap-text-danger">Pilih mesin di atas.</small>}
              </>
            )}
          </div>
        )}
        <Field label="Catatan" full><textarea className="pap-input" rows={2} maxLength={5000} value={values.catatan} onChange={set('catatan')} /></Field>
      </form>
    </Modal>
  )
}

// ---------- Verifikasi QC ----------
export function QcForm({ item, onClose, onSaved }: { item: Result; onClose: () => void; onSaved: (message: string) => void }) {
  const [status, setStatus] = useState<QcStatus>(item.status_qc === 'menunggu' ? 'lolos' : item.status_qc)
  const [catatan, setCatatan] = useState(item.catatan_qc ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function save() {
    setBusy(true)
    setError('')
    try {
      await api(`/api/production/results/${item.id}`, { method: 'PATCH', json: { qc: { status_qc: status, catatan_qc: catatan } } })
      onSaved(`QC ${item.tahap} shift ${item.shift}: ${QC_LABEL[status]}.`)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal
      title="Pemeriksaan QC"
      subtitle={`${item.spk_nomor ?? item.nomor} · ${item.item_name} · ${item.tahap} · Shift ${item.shift}, ${formatDate(item.tanggal)}`}
      onClose={onClose}
      footer={<><span className="pap-spacer" /><button className="pap-btn" onClick={onClose}>Batal</button><button className="pap-primary-button" disabled={busy} onClick={save}>{busy ? 'Menyimpan...' : 'Simpan hasil QC'}</button></>}
    >
      {error && <Notice onClose={() => setError('')}>{error}</Notice>}
      <dl className="pap-detail-grid">
        <div><dt>Hasil</dt><dd>{num(item.jumlah_hasil)} {item.satuan}</dd></div>
        <div><dt>Reject</dt><dd>{num(item.jumlah_reject)} {item.satuan}</dd></div>
        <div><dt>Operator</dt><dd>{item.operator ?? '—'}</dd></div>
        <div><dt>Dilaporkan</dt><dd>{item.reported_name} · {formatDate(item.created_at, true)}</dd></div>
      </dl>
      {item.kendala && <p className="pap-result-issue"><AlertTriangle /> {item.kendala}</p>}
      <div className="pap-qc-options" role="radiogroup" aria-label="Status QC">
        {(['lolos', 'perbaikan', 'reject', 'menunggu'] as QcStatus[]).map((s) => (
          <button key={s} type="button" role="radio" aria-checked={status === s} className={`pap-qc-option ${QC_TONE[s]} ${status === s ? 'active' : ''}`} onClick={() => setStatus(s)}>{QC_LABEL[s]}</button>
        ))}
      </div>
      <Field label={status === 'perbaikan' || status === 'reject' ? 'Catatan QC (wajib)' : 'Catatan QC'} full hint={status === 'reject' ? 'Hasil laporan ini tidak dihitung sebagai hasil baik.' : undefined}>
        <textarea className="pap-input" rows={3} maxLength={5000} value={catatan} onChange={(e) => setCatatan(e.target.value)} placeholder="Ketebalan, ukuran, warna cetak, kekuatan seal, dll." />
      </Field>
    </Modal>
  )
}
