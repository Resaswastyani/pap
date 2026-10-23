'use client'

import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, CalendarClock, CalendarPlus, Clock3, PhoneCall, Repeat, Search, UserMinus } from 'lucide-react'
import type { UserProfile } from '@/lib/users'
import { formatRupiah } from './accurate'
import { nowInput, toInputDateTime, VisitForm, WaButton, type MarketingUser } from './marketing'
import { AttachmentInput, emptyAttachments, NoteFiles, pendingCount, uploadNoteAttachments, type NoteAttachment, type PendingAttachments } from './attachments'
import { api, formatDate, Modal, Notice, Pager } from './ui'

type Status = 'waktunya' | 'berisiko' | 'nonaktif' | 'aman'
const STATUS_LABEL: Record<Status, string> = { waktunya: 'Waktunya order', berisiko: 'Berisiko berhenti', nonaktif: 'Pelanggan pasif', aman: 'Aman' }
const STATUS_TONE: Record<Status, string> = { waktunya: 'warning', berisiko: 'danger', nonaktif: 'neutral', aman: 'success' }

type Row = {
  id: number; accurate_id: number; customer_no: string | null; name: string; mobile_phone: string | null; work_phone: string | null; bill_city: string | null
  maintenance_to: number | null; maintenance_name: string | null; next_followup_at: string | null; last_contact_at: string | null; last_followup_at: string | null; last_followup_via: string | null; last_activity_at: string | null
  order_count: number; first_order: string; last_order: string; total_amount: number; interval_hari: number; hari_sejak: number; perkiraan_order: string
  hari_terlambat: number; status: Status
}
type Activity = { id: number; jenis: string; hasil: string | null; created_at: string; user_name: string; attachments?: NoteAttachment[] }
type Invoice = { number: string | null; trans_date: string; total_amount: number; status: string | null }
const JENIS: Record<string, string> = { whatsapp: 'WhatsApp', telepon: 'Telepon', email: 'Email', visit: 'Visit', meeting: 'Meeting', catatan: 'Catatan', handover: 'PIC', status: 'Status' }

// Nomor HP Accurate (08xx / +62) -> 62xx untuk tautan WhatsApp
const toWa = (phone: string | null) => {
  const d = (phone ?? '').replace(/[^\d]/g, '')
  return d ? (d.startsWith('0') ? `62${d.slice(1)}` : d.startsWith('8') ? `62${d}` : d) : null
}
const lateText = (r: Row) => (r.hari_terlambat > 0 ? `lewat ${r.hari_terlambat} hari` : r.hari_terlambat === 0 ? 'hari ini' : `${-r.hari_terlambat} hari lagi`)

export function RepeatOrderPage({ user, focusId }: { user: UserProfile; focusId?: number | null }) {
  const [items, setItems] = useState<Row[]>([])
  const [summary, setSummary] = useState<Partial<Record<Status, number>>>({})
  const [due, setDue] = useState({ today: 0, overdue: 0 })
  const [inactiveDays, setInactiveDays] = useState(90)
  const [users, setUsers] = useState<MarketingUser[]>([])
  const [seesAll, setSeesAll] = useState(false)
  const [status, setStatus] = useState('perlu')
  const [pic, setPic] = useState('')
  const [q, setQ] = useState('')
  const [page, setPage] = useState(1)
  const [size, setSize] = useState(50)
  const [total, setTotal] = useState(0)
  const [pageSize, setPageSize] = useState(50)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [detailId, setDetailId] = useState<number | null>(focusId ?? null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ status, page: String(page), pageSize: String(size) })
      if (pic) params.set('pic', pic)
      if (q.trim()) params.set('q', q.trim())
      const res = await api<{ items: Row[]; summary: typeof summary; due: typeof due; users: MarketingUser[]; seesAll: boolean; total: number; pageSize: number; inactiveDays: number }>(`/api/repeat-order?${params}`)
      setItems(res.items)
      setSummary(res.summary)
      setDue(res.due)
      setInactiveDays(res.inactiveDays)
      setUsers(res.users)
      setSeesAll(res.seesAll)
      setTotal(res.total)
      setPageSize(res.pageSize)
      setError('')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [status, pic, q, page, size])
  useEffect(() => {
    const t = setTimeout(load, q ? 300 : 0)
    return () => clearTimeout(t)
  }, [load, q])
  useEffect(() => setPage(1), [status, pic, q])
  const flash = (text: string) => { setMessage(text); setTimeout(() => setMessage(''), 5000); load() }
  const count = (s: Status) => summary[s] ?? 0
  const cards: [string, string, number, string, typeof Repeat, string][] = [
    ['perlu', 'Perlu dihubungi', count('waktunya') + count('berisiko'), `${count('berisiko')} berisiko berhenti order`, AlertTriangle, 'stat-2'],
    ['followup', 'Follow-up hari ini', due.today + due.overdue, due.overdue ? `${due.overdue} terlambat` : 'Jadwal follow-up', CalendarClock, 'stat-1'],
    ['aman', 'Aman', count('aman'), 'Belum waktunya order', Repeat, 'stat-0'],
    ['nonaktif', 'Pelanggan pasif', count('nonaktif'), `Tidak order > ${inactiveDays} hari`, UserMinus, 'stat-1'],
  ]

  return (
    <>
      <div className="pap-page-heading">
        <div>
          <p className="pap-eyebrow">MARKETING MAINTENANCE</p>
          <h1>Repeat Order</h1>
          <span>Pantau customer agar rutin order: perkiraan order berikutnya dihitung dari rata-rata jarak faktur di Accurate.</span>
        </div>
      </div>
      {message && <Notice kind="success" onClose={() => setMessage('')}>{message}</Notice>}
      <div className="pap-stat-grid four">
        {cards.map(([key, label, value, note, Icon, tone]) => (
          <button key={key} className={`pap-stat-card pap-stat-button ${status === key ? 'active' : ''}`} onClick={() => setStatus(key)}>
            <div><span>{label}</span><strong>{value}</strong><small className="neutral">{note}</small></div>
            <div className={`pap-stat-icon ${tone}`}><Icon /></div>
          </button>
        ))}
      </div>
      <div className="pap-table-card">
        <div className="pap-card-head"><div><h2>Customer</h2><p>{seesAll ? 'Semua customer. Tentukan PIC Marketing Maintenance untuk tiap customer.' : 'Customer yang Anda pegang.'}</p></div></div>
        <div className="pap-filters">
          <label className="pap-filter-search"><Search /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari nama, nomor, kota..." /></label>
          <select className="pap-select" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter status">
            <option value="perlu">Perlu dihubungi</option>
            <option value="followup">Follow-up jatuh tempo</option>
            {Object.entries(STATUS_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            <option value="semua">Semua</option>
          </select>
          {seesAll && (
            <select className="pap-select" value={pic} onChange={(e) => setPic(e.target.value)} aria-label="Filter PIC">
              <option value="">Semua PIC</option>
              <option value="me">Saya</option>
              <option value="none">Belum ada PIC</option>
              {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          )}
        </div>
        {error && <div className="pap-card-notice"><Notice onClose={() => setError('')}>{error}</Notice></div>}
        <div className="pap-table-wrap">
          <table>
            <thead><tr><th>Customer</th><th>Riwayat order</th><th>Perkiraan order</th><th>PIC</th><th>Follow-up</th><th>Status</th></tr></thead>
            <tbody>
              {items.map((r) => (
                <tr key={r.id} className="pap-row-link" onClick={() => setDetailId(r.id)}>
                  <td><div className="pap-cell-title">{r.name}</div><div className="pap-cell-sub">{[r.customer_no, r.bill_city].filter(Boolean).join(' · ')}</div></td>
                  <td>{r.order_count}x · tiap ±{r.interval_hari} hari<div className="pap-cell-sub">Terakhir {formatDate(r.last_order)} · {formatRupiah(r.total_amount)}</div></td>
                  <td className={r.hari_terlambat > 0 ? 'pap-followup overdue' : r.hari_terlambat >= -3 ? 'pap-followup today' : ''}>{formatDate(r.perkiraan_order)}<div className="pap-cell-sub">{lateText(r)}</div></td>
                  <td>{r.maintenance_name ?? <span className="pap-muted">Belum ada</span>}</td>
                  <td className={r.next_followup_at && r.next_followup_at.slice(0, 10) <= nowInput().slice(0, 10) ? 'pap-followup overdue' : ''}>{r.last_followup_at ? <><div className="pap-nowrap">Terakhir {formatDate(r.last_followup_at)}</div><div className="pap-cell-sub">{r.last_followup_via}{r.next_followup_at ? ` · berikutnya ${formatDate(r.next_followup_at, true)}` : ''}</div></> : <>{r.next_followup_at ? <div className="pap-nowrap">Jadwal {formatDate(r.next_followup_at, true)}</div> : '—'}<div className="pap-cell-sub">Belum pernah difollow-up</div></>}</td>
                  <td><span className={`pap-status ${STATUS_TONE[r.status]}`}>{STATUS_LABEL[r.status]}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
          {!loading && !items.length && <div className="pap-empty">{status === 'perlu' ? 'Tidak ada customer yang perlu dihubungi saat ini.' : 'Tidak ada customer yang cocok.'}{!seesAll && ' Customer muncul di sini setelah Lead menetapkan Anda sebagai PIC (atau lewat handover prospek).'}</div>}
          {loading && !items.length && <div className="pap-empty">Memuat...</div>}
        </div>
        <Pager page={page} pageSize={pageSize} total={total} onPage={setPage} onPageSize={(v) => { setSize(v); setPage(1) }} />
      </div>
      {detailId && <RepeatDetail id={detailId} user={user} users={users} onClose={() => setDetailId(null)} onChanged={flash} />}
    </>
  )
}

function RepeatDetail({ id, user, users, onClose, onChanged }: { id: number; user: UserProfile; users: MarketingUser[]; onClose: () => void; onChanged: (m: string) => void }) {
  const [item, setItem] = useState<Row | null>(null)
  const [activities, setActivities] = useState<Activity[]>([])
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [canAssign, setCanAssign] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [visit, setVisit] = useState(false)
  const [values, setValues] = useState({ jenis: 'whatsapp', hasil: '', next_followup_at: '' })
  const [attachments, setAttachments] = useState<PendingAttachments>(emptyAttachments)
  const load = useCallback(async () => {
    try {
      const res = await api<{ item: Row; activities: Activity[]; invoices: Invoice[]; canAssign: boolean }>(`/api/repeat-order/${id}`)
      setItem(res.item)
      setActivities(res.activities)
      setInvoices(res.invoices)
      setCanAssign(res.canAssign)
      setValues((v) => ({ ...v, next_followup_at: toInputDateTime(res.item.next_followup_at) || nowInput(Math.max(7, Math.min(30, Math.round(res.item.interval_hari / 2))), 10) }))
    } catch (e) {
      setError((e as Error).message)
    }
  }, [id])
  useEffect(() => { load() }, [load])

  async function post(json: Record<string, unknown>, text: string) {
    setBusy(true)
    setError('')
    try {
      const res = await api<{ id?: number }>(`/api/repeat-order/${id}`, { method: 'POST', json })
      // Lampiran hanya untuk catatan follow-up (bukan ganti PIC)
      const failed = res.id && 'hasil' in json ? await uploadNoteAttachments('activity', res.id, attachments) : []
      if ('hasil' in json) {
        setValues((v) => ({ ...v, hasil: '' }))
        setAttachments(emptyAttachments())
      }
      await load()
      onChanged(failed.length ? `${text} Sebagian lampiran gagal: ${failed.join(' ')}` : text)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  if (!item) return <Modal title="Customer" onClose={onClose}>{error ? <Notice>{error}</Notice> : <p className="pap-muted">Memuat...</p>}</Modal>
  const wa = toWa(item.mobile_phone ?? item.work_phone)
  return (
    <>
      <Modal title={item.name} subtitle={[item.customer_no, item.bill_city].filter(Boolean).join(' · ')} wide onClose={onClose}>
        {error && <Notice onClose={() => setError('')}>{error}</Notice>}
        <div className="pap-detail-badges"><span className={`pap-status ${STATUS_TONE[item.status]}`}>{STATUS_LABEL[item.status]}</span><span className="pap-status neutral">{item.order_count}x order</span></div>
        <dl className="pap-detail-grid">
          <div><dt>Order terakhir</dt><dd>{formatDate(item.last_order)} ({item.hari_sejak} hari lalu)</dd></div>
          <div><dt>Perkiraan order berikutnya</dt><dd>{formatDate(item.perkiraan_order)} · {lateText(item)}</dd></div>
          <div><dt>Rata-rata jarak order</dt><dd>±{item.interval_hari} hari{item.order_count < 2 ? ' (default, baru 1x order)' : ''}</dd></div>
          <div><dt>Total transaksi</dt><dd>{formatRupiah(item.total_amount)} sejak {formatDate(item.first_order)}</dd></div>
          <div>
            <dt>PIC Marketing Maintenance</dt>
            <dd>{canAssign ? (
              <select className="pap-select" value={item.maintenance_to ?? ''} disabled={busy} onChange={(e) => post({ maintenance_to: e.target.value || null }, 'PIC customer diperbarui.')}>
                <option value="">Belum ada PIC</option>
                {users.map((u) => <option key={u.id} value={u.id}>{u.name} · {u.division_name}</option>)}
              </select>
            ) : item.maintenance_name ?? '—'}</dd>
          </div>
          <div><dt>Kontak</dt><dd>{[item.mobile_phone, item.work_phone].filter(Boolean).join(' · ') || '—'}</dd></div>
        </dl>
        <div className="pap-inline-actions pap-wrap">
          {wa && <WaButton phone={wa} text={`Halo kak, kami dari PT Pandawa Amerta Packindo. Stok kantong plastiknya bagaimana, apakah sudah waktunya order lagi? Kami siap bantu prosesnya 🙏`} label="WhatsApp repeat order" />}
          <button className="pap-btn" onClick={() => setVisit(true)}><CalendarPlus /> Jadwalkan visit</button>
        </div>

        <section className="pap-detail-section">
          <h3>Catat follow-up</h3>
          <form className="pap-activity-form" onSubmit={(e) => { e.preventDefault(); post({ ...values, lampiran: pendingCount(attachments) }, 'Follow-up customer dicatat.') }}>
            <div className="pap-activity-row two">
              <select className="pap-select" value={values.jenis} onChange={(e) => setValues((v) => ({ ...v, jenis: e.target.value }))} aria-label="Jenis follow-up">
                <option value="whatsapp">WhatsApp</option><option value="telepon">Telepon</option><option value="visit">Visit</option><option value="email">Email</option><option value="catatan">Catatan</option>
              </select>
              <label className="pap-activity-date"><span>Follow-up berikutnya</span><input className="pap-input" type="datetime-local" value={values.next_followup_at} onChange={(e) => setValues((v) => ({ ...v, next_followup_at: e.target.value }))} /></label>
            </div>
            <textarea className="pap-input" rows={2} maxLength={5000} value={values.hasil} onChange={(e) => setValues((v) => ({ ...v, hasil: e.target.value }))} placeholder="Hasil (opsional bila ada lampiran): stok customer, rencana order, keluhan, minta penawaran baru, dll." />
            <div className="pap-note-attach"><AttachmentInput value={attachments} onChange={setAttachments} /></div>
            <div className="pap-inline-actions"><span className="pap-spacer" /><button className="pap-primary-button" disabled={busy}><PhoneCall /> Simpan follow-up</button></div>
          </form>
        </section>

        <section className="pap-detail-section">
          <h3>Riwayat follow-up ({activities.length})</h3>
          <ol className="pap-note-list">
            {activities.map((a) => (
              <li key={a.id} className={`pap-note-item act-${a.jenis}`}>
                <div className="pap-note-head"><span className="pap-note-progress">{JENIS[a.jenis] ?? a.jenis}</span><span className="pap-note-meta"><strong>{a.user_name}</strong> · {formatDate(a.created_at, true)}</span></div>
                {a.hasil && <p className="pap-prewrap">{a.hasil}</p>}
                <NoteFiles items={a.attachments} currentUserId={user.id} isAdmin={user.role.isAdmin} onChanged={load} />
              </li>
            ))}
          </ol>
          {!activities.length && <p className="pap-muted">Belum ada follow-up.</p>}
        </section>

        <section className="pap-detail-section">
          <h3><Clock3 className="pap-inline-icon" /> Faktur terakhir</h3>
          <table className="pap-compact-table">
            <thead><tr><th>Tanggal</th><th>No. faktur</th><th className="pap-num">Nilai</th><th>Status</th></tr></thead>
            <tbody>{invoices.map((f, i) => <tr key={i}><td>{formatDate(f.trans_date)}</td><td>{f.number ?? '—'}</td><td className="pap-num">{formatRupiah(f.total_amount)}</td><td>{f.status ?? '—'}</td></tr>)}</tbody>
          </table>
        </section>
      </Modal>
      {visit && (
        <VisitForm
          customer={{ id: item.id, name: item.name, customer_no: item.customer_no, bill_city: item.bill_city }}
          users={users}
          canSupervise={canAssign}
          currentUserId={user.id}
          onClose={() => setVisit(false)}
          onSaved={(text) => { setVisit(false); onChanged(text) }}
        />
      )}
    </>
  )
}
