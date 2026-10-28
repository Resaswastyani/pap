'use client'

import { useCallback, useEffect, useState } from 'react'
import { AlertOctagon, CheckCircle2, Clock3, PauseCircle, Plus, Search, Siren, Wrench } from 'lucide-react'
import type { UserProfile } from '@/lib/users'
import { AttachmentPanel } from './attachments'
import { api, Field, formatDate, Modal, Notice, Pager, usePaged, useQuickAction, confirmDialog } from './ui'

type Status = 'baru' | 'dikerjakan' | 'menunggu_part' | 'selesai' | 'batal'
type Priority = 'darurat' | 'tinggi' | 'normal'
type Repair = {
  id: number; nomor: string | null; machine_id: number; machine_kode: string; machine_nama: string; machine_tahap: string; machine_status: string
  result_id: number | null; keluhan: string; prioritas: Priority; mesin_berhenti: boolean; status: Status; teknisi_id: number | null; teknisi_name: string | null
  penyebab: string | null; tindakan: string | null; sparepart: string | null; target_selesai: string | null; mulai_at: string | null; selesai_at: string | null
  reported_by: number; reported_name: string; reporter_division: string; created_at: string; durasi_menit: number
  result_tanggal: string | null; result_shift: number | null; result_spk: string | null; result_item: string | null
}
type Machine = { id: number; kode: string; nama: string; tahap: string; status: string }
type Summary = { terbuka: number; darurat: number; baru: number; selesai_30: number; rata_menit: number; mesin_berhenti: number }

export const REPAIR_STATUS_LABEL: Record<Status, string> = { baru: 'Baru', dikerjakan: 'Dikerjakan', menunggu_part: 'Menunggu sparepart', selesai: 'Selesai', batal: 'Batal' }
const STATUS_TONE: Record<Status, string> = { baru: 'danger', dikerjakan: 'info', menunggu_part: 'warning', selesai: 'success', batal: 'neutral' }
export const PRIORITY_LABEL: Record<Priority, string> = { darurat: 'Darurat', tinggi: 'Tinggi', normal: 'Normal' }
const PRIORITY_TONE: Record<Priority, string> = { darurat: 'danger', tinggi: 'warning', normal: 'neutral' }
const isOpen = (s: Status) => s === 'baru' || s === 'dikerjakan' || s === 'menunggu_part'
// 135 -> "2 j 15 m", 1600 -> "1 h 2 j"
export function formatDuration(minutes: number) {
  if (minutes < 60) return `${Math.max(0, minutes)} m`
  const h = Math.floor(minutes / 60)
  if (h < 24) return `${h} j${minutes % 60 ? ` ${minutes % 60} m` : ''}`
  return `${Math.floor(h / 24)} h${h % 24 ? ` ${h % 24} j` : ''}`
}
const toInput = (v: string | null) => (v ? v.slice(0, 16).replace(' ', 'T') : '')

export function RepairPage({ user, focusId }: { user: UserProfile; focusId?: number | null }) {
  const [items, setItems] = useState<Repair[]>([])
  const [summary, setSummary] = useState<Summary | null>(null)
  const [machines, setMachines] = useState<Machine[]>([])
  const [technicians, setTechnicians] = useState<{ id: number; name: string }[]>([])
  const [can, setCan] = useState({ report: false, handle: false })
  const [status, setStatus] = useState('terbuka')
  const [machine, setMachine] = useState('')
  const [mine, setMine] = useState(false)
  const [q, setQ] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [formOpen, setFormOpen] = useState(false)
  useQuickAction('lapor-kerusakan', () => setFormOpen(true))
  const [detailId, setDetailId] = useState<number | null>(focusId ?? null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ status })
      if (machine) params.set('machine', machine)
      if (mine) params.set('saya', '1')
      if (q.trim()) params.set('q', q.trim())
      const res = await api<{ items: Repair[]; summary: Summary; machines: Machine[]; technicians: typeof technicians; can: typeof can }>(`/api/repairs?${params}`)
      setItems(res.items)
      setSummary(res.summary)
      setMachines(res.machines)
      setTechnicians(res.technicians)
      setCan(res.can)
      setError('')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [status, machine, mine, q])
  useEffect(() => {
    const timer = setTimeout(load, q ? 300 : 0)
    return () => clearTimeout(timer)
  }, [load, q])
  const flash = (text: string) => {
    setMessage(text)
    setTimeout(() => setMessage(''), 5000)
    load()
  }

  const stats: [string, number | string, string, string, typeof Wrench, string][] = summary ? [
    ['terbuka', summary.terbuka, 'Laporan terbuka', `${summary.baru} belum ditangani Teknik`, Wrench, 'stat-1'],
    ['darurat', summary.darurat, 'Darurat', 'Prioritas darurat belum selesai', Siren, 'stat-2'],
    ['berhenti', summary.mesin_berhenti, 'Mesin berhenti', 'Status maintenance karena rusak', PauseCircle, 'stat-2'],
    ['selesai', summary.selesai_30, 'Selesai 30 hari', summary.rata_menit ? `Rata-rata ${formatDuration(summary.rata_menit)} sampai selesai` : 'Belum ada perbaikan selesai', CheckCircle2, 'stat-0'],
  ] : []

  const paged = usePaged(items, items.length)
  return (
    <>
      <div className="pap-page-heading">
        <div>
          <p className="pap-eyebrow">PRODUKSI · TEKNIK</p>
          <h1>Kerusakan Mesin</h1>
          <span>Produksi melaporkan mesin rusak, kendala, atau perlu troubleshoot; Teknik langsung mendapat notifikasi, menangani, dan mencatat penyebab serta tindakannya. Mesin yang berhenti otomatis berstatus maintenance.</span>
        </div>
        {can.report && <button className="pap-primary-button" onClick={() => setFormOpen(true)}><Plus /> Lapor kerusakan</button>}
      </div>
      {message && <Notice kind="success" onClose={() => setMessage('')}>{message}</Notice>}
      {summary && (
        <div className="pap-stat-grid four">
          {stats.map(([key, value, label, note, Icon, tone]) => (
            <button key={key} className={`pap-stat-card pap-stat-button ${status === key ? 'active' : ''}`} onClick={() => key === 'selesai' ? setStatus((s) => (s === 'selesai' ? 'terbuka' : 'selesai')) : setStatus('terbuka')}>
              <div><span>{label}</span><strong>{value}</strong><small className="neutral">{note}</small></div>
              <div className={`pap-stat-icon ${tone}`}><Icon /></div>
            </button>
          ))}
        </div>
      )}
      <div className="pap-table-card">
        <div className="pap-filters pap-filters-top">
          <label className="pap-filter-search"><Search /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari nomor, mesin, keluhan..." /></label>
          <select className="pap-select" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter status">
            <option value="terbuka">Belum selesai</option>
            {Object.entries(REPAIR_STATUS_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            <option value="semua">Semua</option>
          </select>
          <select className="pap-select" value={machine} onChange={(e) => setMachine(e.target.value)} aria-label="Filter mesin">
            <option value="">Semua mesin</option>
            {machines.map((m) => <option key={m.id} value={m.id}>{m.nama} ({m.kode})</option>)}
          </select>
          <label className="pap-check"><input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} /> {can.handle ? 'Tugas saya' : 'Laporan saya'}</label>
        </div>
        {error && <div className="pap-card-notice"><Notice onClose={() => setError('')}>{error}</Notice></div>}
        <div className="pap-table-wrap">
          <table>
            <thead><tr><th>Mesin</th><th>Keluhan</th><th>Prioritas</th><th>Teknisi</th><th>Status</th><th>Waktu</th></tr></thead>
            <tbody>
              {paged.items.map((r) => (
                <tr key={r.id} className="pap-row-link" onClick={() => setDetailId(r.id)}>
                  <td className="pap-nowrap"><div className="pap-cell-title">{r.machine_nama}</div><div className="pap-cell-sub">{r.machine_kode} · {r.machine_tahap}</div></td>
                  <td><div className="pap-repair-keluhan">{r.keluhan}</div><div className="pap-cell-sub">{r.nomor} · {r.reported_name} ({r.reporter_division})</div></td>
                  <td><span className={`pap-status ${PRIORITY_TONE[r.prioritas]}`}>{PRIORITY_LABEL[r.prioritas]}</span>{r.mesin_berhenti && <div className="pap-cell-sub pap-text-danger">Mesin berhenti</div>}</td>
                  <td>{r.teknisi_name ?? <span className="pap-muted">Belum ada</span>}</td>
                  <td><span className={`pap-status ${STATUS_TONE[r.status]}`}>{REPAIR_STATUS_LABEL[r.status]}</span></td>
                  <td className="pap-nowrap"><div>{formatDate(r.created_at, true)}</div><div className="pap-cell-sub"><Clock3 className="pap-inline-icon" /> {isOpen(r.status) ? `${formatDuration(r.durasi_menit)} berjalan` : `selesai dalam ${formatDuration(r.durasi_menit)}`}</div></td>
                </tr>
              ))}
            </tbody>
          </table>
          {!loading && !items.length && <div className="pap-empty">{status === 'terbuka' ? 'Tidak ada kerusakan mesin yang terbuka.' : 'Tidak ada laporan yang cocok dengan filter.'}</div>}
          {loading && !items.length && <div className="pap-empty">Memuat laporan...</div>}
        </div>
        <Pager {...paged.pager} noun="laporan" />
      </div>
      {formOpen && <RepairForm machines={machines} onClose={() => setFormOpen(false)} onSaved={(id) => { setFormOpen(false); flash('Laporan kerusakan terkirim. Teknik sudah mendapat notifikasi.'); setDetailId(id) }} />}
      {detailId && <RepairDetail id={detailId} user={user} onClose={() => setDetailId(null)} onChanged={load} />}
    </>
  )
}

// ---------- Form lapor kerusakan ----------
export function RepairForm({ machines, presetMachineId, onClose, onSaved }: { machines: Machine[]; presetMachineId?: number | null; onClose: () => void; onSaved: (id: number) => void }) {
  const [values, setValues] = useState({ machine_id: presetMachineId ? String(presetMachineId) : '', prioritas: 'normal' as Priority, mesin_berhenti: false, keluhan: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const res = await api<{ item: Repair }>('/api/repairs', { method: 'POST', json: values })
      onSaved(res.item.id)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal
      title="Lapor kerusakan mesin"
      subtitle="Teknik langsung mendapat notifikasi. Foto kerusakan bisa ditambahkan setelah laporan terkirim."
      onClose={onClose}
      footer={<><span className="pap-spacer" /><button className="pap-btn" onClick={onClose}>Batal</button><button className="pap-primary-button" form="repair-form" disabled={busy}>{busy ? 'Mengirim...' : 'Kirim ke Teknik'}</button></>}
    >
      <form id="repair-form" className="pap-form-grid" onSubmit={submit}>
        {error && <div className="full"><Notice onClose={() => setError('')}>{error}</Notice></div>}
        <Field label="Mesin" full>
          <select className="pap-select" required value={values.machine_id} onChange={(e) => setValues((v) => ({ ...v, machine_id: e.target.value }))}>
            <option value="">— Pilih mesin —</option>
            {machines.map((m) => <option key={m.id} value={m.id}>{m.nama} ({m.kode}) · {m.tahap}{m.status === 'maintenance' ? ' · maintenance' : ''}</option>)}
          </select>
        </Field>
        <Field label="Prioritas" full>
          <div className="pap-qc-options three" role="radiogroup">
            {(['darurat', 'tinggi', 'normal'] as Priority[]).map((p) => (
              <button type="button" key={p} role="radio" aria-checked={values.prioritas === p} className={`pap-qc-option ${p === 'darurat' ? 'danger' : p === 'tinggi' ? 'warning' : 'info'} ${values.prioritas === p ? 'active' : ''}`} onClick={() => setValues((v) => ({ ...v, prioritas: p }))}>{PRIORITY_LABEL[p]}</button>
            ))}
          </div>
        </Field>
        <label className="pap-check full"><input type="checkbox" checked={values.mesin_berhenti} onChange={(e) => setValues((v) => ({ ...v, mesin_berhenti: e.target.checked }))} /> Mesin berhenti / tidak bisa dipakai (status mesin jadi maintenance)</label>
        <Field label="Kerusakan / kendala" full><textarea className="pap-input" rows={4} required maxLength={5000} value={values.keluhan} onChange={(e) => setValues((v) => ({ ...v, keluhan: e.target.value }))} placeholder="Gejala, sejak kapan, bunyi / bau, kode error, apa yang sudah dicoba" /></Field>
      </form>
    </Modal>
  )
}

// ---------- Detail & penanganan Teknik ----------
function RepairDetail({ id, user, onClose, onChanged }: { id: number; user: UserProfile; onClose: () => void; onChanged: () => void }) {
  const [item, setItem] = useState<Repair | null>(null)
  const [technicians, setTechnicians] = useState<{ id: number; name: string }[]>([])
  const [can, setCan] = useState({ handle: false, cancel: false })
  const [form, setForm] = useState({ teknisi_id: '', prioritas: 'normal' as Priority, mesin_berhenti: false, penyebab: '', tindakan: '', sparepart: '', target_selesai: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  const load = useCallback(async () => {
    try {
      const res = await api<{ item: Repair; technicians: typeof technicians; can: typeof can }>(`/api/repairs/${id}`)
      setItem(res.item)
      setTechnicians(res.technicians)
      setCan(res.can)
      setForm({
        teknisi_id: res.item.teknisi_id ? String(res.item.teknisi_id) : '', prioritas: res.item.prioritas, mesin_berhenti: res.item.mesin_berhenti,
        penyebab: res.item.penyebab ?? '', tindakan: res.item.tindakan ?? '', sparepart: res.item.sparepart ?? '', target_selesai: toInput(res.item.target_selesai),
      })
    } catch (e) {
      setError((e as Error).message)
    }
  }, [id])
  useEffect(() => { load() }, [load])

  async function save(extra: Record<string, unknown>, text: string) {
    setBusy(true)
    setError('')
    try {
      await api(`/api/repairs/${id}`, { method: 'PATCH', json: extra })
      await load()
      onChanged()
      setMessage(text)
      setTimeout(() => setMessage(''), 4000)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (!item) return <Modal title="Laporan kerusakan" onClose={onClose}>{error ? <Notice>{error}</Notice> : <p className="pap-muted">Memuat...</p>}</Modal>
  const handling = { ...form, target_selesai: form.target_selesai || null, teknisi_id: form.teknisi_id || null }
  const next: [Status, string][] = item.status === 'baru' ? [['dikerjakan', 'Mulai kerjakan']] : item.status === 'dikerjakan' ? [['menunggu_part', 'Menunggu sparepart'], ['selesai', 'Tandai selesai']] : item.status === 'menunggu_part' ? [['dikerjakan', 'Lanjut dikerjakan'], ['selesai', 'Tandai selesai']] : [['dikerjakan', 'Buka kembali']]

  return (
    <Modal
      wide
      title={`${item.machine_nama} (${item.machine_kode})`}
      subtitle={`${item.nomor ?? ''} · dilapor ${item.reported_name} (${item.reporter_division}) · ${formatDate(item.created_at, true)}`}
      onClose={onClose}
      footer={
        <>
          {can.cancel && <button className="pap-btn danger" disabled={busy} onClick={async () => (await confirmDialog('Batalkan laporan kerusakan ini?')) && save({ batal: true }, 'Laporan dibatalkan.')}>Batalkan laporan</button>}
          <span className="pap-spacer" />
          {can.handle && <button className="pap-btn" disabled={busy} onClick={() => save(handling, 'Penanganan disimpan.')}>Simpan</button>}
          {can.handle && next.map(([s, label]) => (
            <button key={s} className={s === 'selesai' ? 'pap-primary-button' : 'pap-btn'} disabled={busy} onClick={() => save({ ...handling, status: s }, `Status: ${REPAIR_STATUS_LABEL[s]}.`)}>{label}</button>
          ))}
        </>
      }
    >
      {error && <Notice onClose={() => setError('')}>{error}</Notice>}
      {message && <Notice kind="success" onClose={() => setMessage('')}>{message}</Notice>}
      <div className="pap-detail-badges">
        <span className={`pap-status ${STATUS_TONE[item.status]}`}>{REPAIR_STATUS_LABEL[item.status]}</span>
        <span className={`pap-status ${PRIORITY_TONE[item.prioritas]}`}>Prioritas {PRIORITY_LABEL[item.prioritas].toLowerCase()}</span>
        {item.mesin_berhenti && <span className="pap-status danger"><AlertOctagon className="pap-inline-icon" /> Mesin berhenti</span>}
        <span className="pap-status neutral">Mesin: {item.machine_status}</span>
      </div>
      <dl className="pap-detail-grid">
        <div><dt>{isOpen(item.status) ? 'Sudah berjalan' : 'Lama perbaikan'}</dt><dd><strong>{formatDuration(item.durasi_menit)}</strong>{item.mesin_berhenti ? ' (downtime mesin)' : ''}</dd></div>
        <div><dt>Teknisi</dt><dd>{item.teknisi_name ?? '—'}</dd></div>
        <div><dt>Mulai dikerjakan</dt><dd>{formatDate(item.mulai_at, true) || '—'}</dd></div>
        <div><dt>{item.status === 'batal' ? 'Dibatalkan' : 'Selesai'}</dt><dd>{formatDate(item.selesai_at, true) || (item.target_selesai ? `Target ${formatDate(item.target_selesai, true)}` : '—')}</dd></div>
        {item.result_id && <div className="full"><dt>Dari laporan hasil produksi</dt><dd>{item.result_spk ?? ''} {item.result_item} · Shift {item.result_shift}, {formatDate(item.result_tanggal)}</dd></div>}
      </dl>
      <section className="pap-detail-section">
        <h3>Kerusakan / kendala</h3>
        <p className="pap-prewrap">{item.keluhan}</p>
      </section>
      <section className="pap-detail-section">
        <h3>Penanganan Teknik</h3>
        {can.handle ? (
          <div className="pap-form-grid">
            <Field label="Teknisi">
              <select className="pap-select" value={form.teknisi_id} onChange={(e) => setForm((v) => ({ ...v, teknisi_id: e.target.value }))}>
                <option value="">— Belum ditugaskan —</option>
                {technicians.map((t) => <option key={t.id} value={t.id}>{t.name}{t.id === user.id ? ' (saya)' : ''}</option>)}
              </select>
            </Field>
            <Field label="Target selesai"><input className="pap-input" type="datetime-local" value={form.target_selesai} onChange={(e) => setForm((v) => ({ ...v, target_selesai: e.target.value }))} /></Field>
            <Field label="Prioritas">
              <select className="pap-select" value={form.prioritas} onChange={(e) => setForm((v) => ({ ...v, prioritas: e.target.value as Priority }))}>
                {Object.entries(PRIORITY_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </Field>
            <label className="pap-check"><input type="checkbox" checked={form.mesin_berhenti} onChange={(e) => setForm((v) => ({ ...v, mesin_berhenti: e.target.checked }))} /> Mesin berhenti (maintenance)</label>
            <Field label="Penyebab" full><textarea className="pap-input" rows={2} maxLength={5000} value={form.penyebab} onChange={(e) => setForm((v) => ({ ...v, penyebab: e.target.value }))} placeholder="Hasil pengecekan / diagnosa" /></Field>
            <Field label="Tindakan perbaikan" full hint="Wajib diisi sebelum menandai selesai."><textarea className="pap-input" rows={3} maxLength={5000} value={form.tindakan} onChange={(e) => setForm((v) => ({ ...v, tindakan: e.target.value }))} /></Field>
            <Field label="Sparepart dipakai / dibutuhkan" full hint="Sparepart yang perlu dibeli diteruskan ke Purchasing."><textarea className="pap-input" rows={2} maxLength={5000} value={form.sparepart} onChange={(e) => setForm((v) => ({ ...v, sparepart: e.target.value }))} placeholder="mis. Bearing 6205 x2, heater band 220V" /></Field>
          </div>
        ) : (
          <div className="pap-spec-grid">
            <div><span>Penyebab</span><p className="pap-prewrap">{item.penyebab || <span className="pap-muted">Belum diisi Teknik.</span>}</p></div>
            <div><span>Tindakan</span><p className="pap-prewrap">{item.tindakan || <span className="pap-muted">Belum diisi Teknik.</span>}</p></div>
            <div><span>Sparepart</span><p className="pap-prewrap">{item.sparepart || <span className="pap-muted">—</span>}</p></div>
          </div>
        )}
      </section>
      <AttachmentPanel title="Foto / lampiran kerusakan & hasil perbaikan" basePath={`/api/notes/repair/${item.id}/attachments`} fileBase="/api/notes/attachments" canAdd={item.reported_by === user.id || can.handle} currentUserId={user.id} isAdmin={user.role.isAdmin} />
    </Modal>
  )
}
