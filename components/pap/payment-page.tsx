'use client'

import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle2, Clock3, FileText, Plus, Search, Wallet, XCircle } from 'lucide-react'
import type { UserProfile } from '@/lib/users'
import { formatRupiah } from './accurate'
import { api, Field, formatDate, Modal, Notice } from './ui'

type Status = 'menunggu' | 'diterima' | 'ditolak'
const STATUS: Record<Status, string> = { menunggu: 'Menunggu verifikasi', diterima: 'Diterima', ditolak: 'Ditolak' }
const TONE: Record<Status, string> = { menunggu: 'warning', diterima: 'success', ditolak: 'danger' }
const JENIS: Record<string, string> = { dp: 'DP', pelunasan: 'Pelunasan', lainnya: 'Lainnya' }

type Payment = {
  id: number; quotation_id: number | null; customer_id: number | null; pembayar: string; jenis: string; nominal: number; tanggal_bayar: string
  metode: string | null; has_bukti: boolean; bukti_mime: string | null; bukti_name: string | null; catatan: string | null; status: Status; alasan: string | null
  verified_at: string | null; verified_name: string | null; created_by: number; created_name: string; created_at: string
  quotation_nomor: string | null; order_nomor: string | null; quotation_total: number | null; customer_no: string | null
}
type Unpaid = { number: string | null; trans_date: string; total_amount: number; umur: number; customer_id: number | null; customer_name: string | null; customer_no: string | null; maintenance_name: string | null }
export type PaymentPreset = { quotation_id: number; pembayar: string; nomor: string; sisa: number; dp: number | null }

const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }

export function PaymentPage({ user, focusId }: { user: UserProfile; focusId?: number | null }) {
  const [tab, setTab] = useState<'konfirmasi' | 'piutang'>('konfirmasi')
  const [items, setItems] = useState<Payment[]>([])
  const [unpaid, setUnpaid] = useState<Unpaid[]>([])
  const [summary, setSummary] = useState({ menunggu: 0, nilai_menunggu: 0, diterima_bulan_ini: 0 })
  const [canVerify, setCanVerify] = useState(false)
  const [status, setStatus] = useState('')
  const [q, setQ] = useState('')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [form, setForm] = useState(false)
  const [detailId, setDetailId] = useState<number | null>(focusId ?? null)

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams()
      if (status) params.set('status', status)
      if (q.trim()) params.set('q', q.trim())
      const res = await api<{ items: Payment[]; unpaid: Unpaid[]; summary: typeof summary; canVerify: boolean }>(`/api/payments?${params}`)
      setItems(res.items)
      setUnpaid(res.unpaid)
      setSummary(res.summary)
      setCanVerify(res.canVerify)
      setError('')
    } catch (e) {
      setError((e as Error).message)
    }
  }, [status, q])
  useEffect(() => {
    const t = setTimeout(load, q ? 300 : 0)
    return () => clearTimeout(t)
  }, [load, q])
  const flash = (t: string) => { setMessage(t); setTimeout(() => setMessage(''), 5000); load() }
  const piutang = unpaid.reduce((n, u) => n + u.total_amount, 0)

  return (
    <>
      <div className="pap-page-heading">
        <div>
          <p className="pap-eyebrow">MARKETING · ACCOUNTING</p>
          <h1>Pembayaran</h1>
          <span>Marketing mengirim konfirmasi pembayaran customer (DP / pelunasan) beserta bukti transfer; Accounting memverifikasi. Piutang diambil dari faktur Accurate yang belum lunas.</span>
        </div>
        <button className="pap-primary-button" onClick={() => setForm(true)}><Plus /> Konfirmasi pembayaran</button>
      </div>
      {message && <Notice kind="success" onClose={() => setMessage('')}>{message}</Notice>}
      {error && <Notice onClose={() => setError('')}>{error}</Notice>}
      <div className="pap-stat-grid four">
        <button className={`pap-stat-card pap-stat-button ${status === 'menunggu' ? 'active' : ''}`} onClick={() => { setTab('konfirmasi'); setStatus((s) => (s === 'menunggu' ? '' : 'menunggu')) }}>
          <div><span>Menunggu verifikasi</span><strong>{summary.menunggu}</strong><small className="neutral">{formatRupiah(summary.nilai_menunggu)}</small></div><div className="pap-stat-icon stat-2"><Clock3 /></div>
        </button>
        <div className="pap-stat-card"><div><span>Diterima bulan ini</span><strong>{formatRupiah(summary.diterima_bulan_ini)}</strong><small className="neutral">Sudah diverifikasi Accounting</small></div><div className="pap-stat-icon stat-0"><CheckCircle2 /></div></div>
        <button className="pap-stat-card pap-stat-button" onClick={() => setTab('piutang')}>
          <div><span>Faktur belum lunas</span><strong>{unpaid.length}</strong><small className="neutral">{formatRupiah(piutang)}</small></div><div className="pap-stat-icon stat-2"><AlertTriangle /></div>
        </button>
        <div className="pap-stat-card"><div><span>Peran Anda</span><strong className="pap-stat-text">{canVerify ? 'Verifikator' : user.division.code === 'accounting' ? 'Pemantau' : 'Pengirim'}</strong><small className="neutral">{canVerify ? 'Kepala Accounting / GM' : 'Diverifikasi Kepala Accounting / GM'}</small></div><div className="pap-stat-icon stat-1"><Wallet /></div></div>
      </div>
      <div className="pap-table-card">
        <div className="pap-card-head">
          <div className="pap-segmented">
            <button className={tab === 'konfirmasi' ? 'active' : ''} onClick={() => setTab('konfirmasi')}>Konfirmasi pembayaran</button>
            <button className={tab === 'piutang' ? 'active' : ''} onClick={() => setTab('piutang')}>Faktur belum lunas (Accurate)</button>
          </div>
        </div>
        {tab === 'konfirmasi' ? (
          <>
            <div className="pap-filters">
              <label className="pap-filter-search"><Search /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari pembayar, nomor penawaran / SO..." /></label>
              <select className="pap-select" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter status"><option value="">Semua status</option>{Object.entries(STATUS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
            </div>
            <div className="pap-table-wrap">
              <table>
                <thead><tr><th>Pembayar</th><th>Jenis</th><th className="pap-num">Nominal</th><th>Tanggal bayar</th><th>Referensi</th><th>Dikirim</th><th>Status</th></tr></thead>
                <tbody>
                  {items.map((p) => (
                    <tr key={p.id} className="pap-row-link" onClick={() => setDetailId(p.id)}>
                      <td><div className="pap-cell-title">{p.pembayar}</div><div className="pap-cell-sub">{[p.customer_no, p.metode].filter(Boolean).join(' · ')}</div></td>
                      <td>{JENIS[p.jenis]}</td>
                      <td className="pap-num">{formatRupiah(p.nominal)}</td>
                      <td>{formatDate(p.tanggal_bayar)}</td>
                      <td>{p.order_nomor ?? p.quotation_nomor ?? '—'}</td>
                      <td>{p.created_name}<div className="pap-cell-sub">{formatDate(p.created_at, true)}</div></td>
                      <td><span className={`pap-status ${TONE[p.status]}`}>{STATUS[p.status]}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!items.length && <div className="pap-empty">Belum ada konfirmasi pembayaran.</div>}
            </div>
          </>
        ) : (
          <div className="pap-table-wrap">
            <table>
              <thead><tr><th>Faktur</th><th>Customer</th><th className="pap-num">Nilai</th><th className="pap-num">Umur</th><th>PIC</th></tr></thead>
              <tbody>
                {unpaid.map((u, i) => (
                  <tr key={`${u.number}-${i}`}>
                    <td>{u.number ?? '—'}<div className="pap-cell-sub">{formatDate(u.trans_date)}</div></td>
                    <td>{u.customer_name ?? '—'}<div className="pap-cell-sub">{u.customer_no ?? ''}</div></td>
                    <td className="pap-num">{formatRupiah(u.total_amount)}</td>
                    <td className={`pap-num ${u.umur > 30 ? 'pap-followup overdue' : ''}`}>{u.umur} hari</td>
                    <td>{u.maintenance_name ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!unpaid.length && <div className="pap-empty">Tidak ada faktur belum lunas{canVerify ? '' : ' untuk customer pegangan Anda'}.</div>}
          </div>
        )}
      </div>
      {form && <PaymentForm onClose={() => setForm(false)} onSaved={(t) => { setForm(false); flash(t) }} />}
      {detailId && <PaymentDetail id={detailId} onClose={() => setDetailId(null)} onChanged={(t) => { setDetailId(null); flash(t) }} />}
    </>
  )
}

export function PaymentForm({ preset, onClose, onSaved }: { preset?: PaymentPreset; onClose: () => void; onSaved: (m: string) => void }) {
  const [quotations, setQuotations] = useState<{ id: number; nomor: string; order_nomor: string | null; kepada: string; total: number; terbayar: number; ongkir: number | null }[]>([])
  const [v, setV] = useState({
    quotation_id: preset ? String(preset.quotation_id) : '', pembayar: preset?.pembayar ?? '', jenis: preset?.dp ? 'dp' : 'pelunasan',
    nominal: preset ? String(Math.round(preset.dp ?? preset.sisa)) : '', tanggal_bayar: today(), metode: '', catatan: '',
  })
  const [file, setFile] = useState<File | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV((x) => ({ ...x, [k]: e.target.value }))
  useEffect(() => {
    if (preset) return
    api<{ items: { id: number; nomor: string; order_nomor: string | null; kepada: string; total: number; terbayar: number; ongkir: number | null }[] }>('/api/quotations?status=diterima').then((r) => setQuotations(r.items)).catch(() => {})
  }, [preset])
  function pick(id: string) {
    const qt = quotations.find((x) => String(x.id) === id)
    setV((x) => ({ ...x, quotation_id: id, pembayar: qt?.kepada ?? x.pembayar, nominal: qt ? String(Math.max(0, Math.round(qt.total + (qt.ongkir ?? 0) - qt.terbayar))) : x.nominal }))
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError('')
    try {
      const fd = new FormData()
      for (const [k, val] of Object.entries(v)) fd.append(k, val)
      if (file) fd.append('bukti', file)
      await api('/api/payments', { method: 'POST', body: fd })
      onSaved('Konfirmasi pembayaran dikirim ke Accounting.')
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }
  return (
    <Modal title="Konfirmasi pembayaran" subtitle={preset ? `${preset.nomor} · sisa tagihan ${formatRupiah(preset.sisa)}` : 'Dikirim ke Accounting untuk diverifikasi'} onClose={onClose}
      footer={<><span className="pap-spacer" /><button type="button" className="pap-btn" onClick={onClose}>Batal</button><button type="submit" form="payment-form" className="pap-primary-button" disabled={saving}>{saving ? 'Mengirim...' : 'Kirim ke Accounting'}</button></>}
    >
      <form id="payment-form" className="pap-form-grid" onSubmit={submit}>
        {error && <div className="full"><Notice onClose={() => setError('')}>{error}</Notice></div>}
        {!preset && (
          <Field label="Order (penawaran diterima)" full hint="Opsional; kosongkan untuk pembayaran customer lain (mis. repeat order lewat Accurate).">
            <select className="pap-select" value={v.quotation_id} onChange={(e) => pick(e.target.value)}>
              <option value="">— Tanpa penawaran —</option>
              {quotations.map((x) => <option key={x.id} value={x.id}>{x.order_nomor ?? x.nomor} · {x.kepada} · {formatRupiah(x.total)}</option>)}
            </select>
          </Field>
        )}
        <Field label="Pembayar (customer)" full><input className="pap-input" required maxLength={200} value={v.pembayar} onChange={set('pembayar')} /></Field>
        <Field label="Jenis"><select className="pap-select" value={v.jenis} onChange={set('jenis')}>{Object.entries(JENIS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        <Field label="Nominal (Rp)"><input className="pap-input" inputMode="numeric" required value={v.nominal} onChange={set('nominal')} /></Field>
        <Field label="Tanggal bayar"><input className="pap-input" type="date" required value={v.tanggal_bayar} onChange={set('tanggal_bayar')} /></Field>
        <Field label="Metode"><input className="pap-input" maxLength={100} value={v.metode} onChange={set('metode')} placeholder="Transfer BCA, tunai, ..." /></Field>
        <Field label="Bukti transfer (gambar / PDF, maks 4 MB)" full><input className="pap-input" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></Field>
        <Field label="Catatan" full><textarea className="pap-input" rows={2} maxLength={1000} value={v.catatan} onChange={set('catatan')} /></Field>
      </form>
    </Modal>
  )
}

function PaymentDetail({ id, onClose, onChanged }: { id: number; onClose: () => void; onChanged: (m: string) => void }) {
  const [item, setItem] = useState<Payment | null>(null)
  const [canVerify, setCanVerify] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { api<{ item: Payment; canVerify: boolean }>(`/api/payments/${id}`).then((r) => { setItem(r.item); setCanVerify(r.canVerify) }).catch((e) => setError(e.message)) }, [id])
  async function verify(status: 'diterima' | 'ditolak') {
    let alasan = ''
    if (status === 'ditolak') {
      alasan = window.prompt('Alasan ditolak (mis. dana belum masuk, nominal berbeda):') ?? ''
      if (!alasan.trim()) return
    }
    setBusy(true)
    try {
      await api(`/api/payments/${id}`, { method: 'POST', json: { status, alasan } })
      onChanged(status === 'diterima' ? 'Pembayaran diverifikasi.' : 'Pembayaran ditolak.')
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }
  if (!item) return <Modal title="Pembayaran" onClose={onClose}>{error ? <Notice>{error}</Notice> : <p className="pap-muted">Memuat...</p>}</Modal>
  const buktiUrl = `/api/payments/${item.id}?bukti=1`
  return (
    <Modal title={`${JENIS[item.jenis]} ${formatRupiah(item.nominal)}`} subtitle={`${item.pembayar} · ${formatDate(item.tanggal_bayar)}`} onClose={onClose}
      footer={<><span className="pap-spacer" />{canVerify && item.status === 'menunggu' && <><button className="pap-btn danger" disabled={busy} onClick={() => verify('ditolak')}><XCircle /> Tolak</button><button className="pap-primary-button" disabled={busy} onClick={() => verify('diterima')}><CheckCircle2 /> Dana sudah masuk</button></>}</>}
    >
      {error && <Notice onClose={() => setError('')}>{error}</Notice>}
      <div className="pap-detail-badges"><span className={`pap-status ${TONE[item.status]}`}>{STATUS[item.status]}</span></div>
      <dl className="pap-detail-grid">
        <div><dt>Referensi</dt><dd>{item.order_nomor ?? item.quotation_nomor ?? '—'}{item.quotation_total ? ` · total ${formatRupiah(item.quotation_total)}` : ''}</dd></div>
        <div><dt>Metode</dt><dd>{item.metode ?? '—'}</dd></div>
        <div><dt>Dikirim</dt><dd>{item.created_name} · {formatDate(item.created_at, true)}</dd></div>
        <div><dt>Diverifikasi</dt><dd>{item.verified_name ? `${item.verified_name} · ${formatDate(item.verified_at, true)}` : '—'}</dd></div>
        {item.catatan && <div className="full"><dt>Catatan</dt><dd className="pap-prewrap">{item.catatan}</dd></div>}
        {item.alasan && <div className="full"><dt>Alasan ditolak</dt><dd>{item.alasan}</dd></div>}
      </dl>
      {item.has_bukti && (
        <section className="pap-detail-section">
          <h3>Bukti transfer</h3>
          {item.bukti_mime?.startsWith('image/') ? <a href={buktiUrl} target="_blank" rel="noreferrer"><img className="pap-checkin-photo" src={buktiUrl} alt="Bukti transfer" /></a> : <a className="pap-btn" href={buktiUrl} target="_blank" rel="noreferrer"><FileText /> {item.bukti_name ?? 'Lihat bukti'}</a>}
        </section>
      )}
    </Modal>
  )
}
