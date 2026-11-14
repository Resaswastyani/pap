'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { CheckCircle2, Clock, Inbox, LifeBuoy, MessageSquare, Pencil, Plus, RotateCcw, Search, Send, Trash2, UserCheck } from 'lucide-react'
import type { UserProfile } from '@/lib/users'
import { AttachmentPanel } from './attachments'
import { api, askReason, Field, formatDate, Modal, Notice, Pager, RowActions, usePaged, confirmDialog, FreshBadge } from './ui'

// Tiket Kendala Sistem: semua pengguna melaporkan kendala SIMPAP; Super Admin / Staff IT menangani semua tiket,
// pengguna lain hanya melihat & menindaklanjuti tiket yang ia ajukan.

const JENIS = { sistem: 'Sistem SIMPAP', umum: 'IT umum' } as const
const KATEGORI = {
  error: 'Error / bug', akses: 'Akses & akun', data: 'Data salah / hilang', permintaan: 'Permintaan fitur',
  perangkat: 'Laptop / komputer rusak', jaringan: 'Jaringan / internet / WiFi', printer: 'Printer / scanner', email: 'Email & akun Google', software: 'Software / aplikasi lain', lainnya: 'Lainnya',
} as const
const KATEGORI_JENIS: Record<keyof typeof JENIS, (keyof typeof KATEGORI)[]> = {
  sistem: ['error', 'akses', 'data', 'permintaan', 'lainnya'],
  umum: ['perangkat', 'jaringan', 'printer', 'email', 'software', 'lainnya'],
}
const PRIORITAS = { rendah: 'Rendah', normal: 'Normal', tinggi: 'Tinggi', darurat: 'Darurat' } as const
const STATUS = { baru: 'Baru', diproses: 'Diproses', menunggu_user: 'Menunggu pelapor', selesai: 'Selesai', ditolak: 'Ditolak' } as const
const STATUS_TONE = { baru: 'info', diproses: 'warning', menunggu_user: 'warning', selesai: 'success', ditolak: 'neutral' } as const
const PRIORITAS_TONE = { rendah: 'neutral', normal: 'info', tinggi: 'warning', darurat: 'danger' } as const
type Status = keyof typeof STATUS

type Ticket = {
  id: number; nomor: string; judul: string; jenis: keyof typeof JENIS; kategori: keyof typeof KATEGORI; modul: string | null; lokasi: string | null; prioritas: keyof typeof PRIORITAS; deskripsi: string; status: Status
  dilaporkan_oleh: number | null; ditangani_oleh: number | null; selesai_at: string | null; created_at: string; updated_at: string
  pelapor: string | null; pelapor_divisi: string | null; penangan: string | null; pesan?: number
}
type Handler = { id: number; name: string }
type ListRes = { items: Ticket[]; stats: { baru: number; diproses: number; menunggu_user: number; selesai_bulan_ini: number; total: number }; handlers: Handler[]; can: { handle: boolean } }
type Message = { id: number; jenis: 'komentar' | 'status'; pesan: string; created_at: string; user_id: number | null; nama: string | null; penangan: boolean }
type DetailRes = { item: Ticket; messages: Message[]; handlers: Handler[]; can: { handle: boolean; edit: boolean; delete: boolean; reply: boolean; close: boolean; reopen: boolean } }

export function TicketPage({ user, menus, focusId }: { user: UserProfile; menus: string[]; focusId?: number | null }) {
  const [status, setStatus] = useState<'aktif' | Status | ''>('aktif')
  const [lingkup, setLingkup] = useState<'semua' | 'saya' | 'belum'>('semua')
  const [jenis, setJenis] = useState<'' | keyof typeof JENIS>('')
  const [q, setQ] = useState('')
  const [data, setData] = useState<ListRes | null>(null)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [form, setForm] = useState<Ticket | 'baru' | null>(null)
  const [openId, setOpenId] = useState<number | null>(focusId ?? null)

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams({ lingkup })
      if (status) params.set('status', status)
      if (jenis) params.set('jenis', jenis)
      if (q.trim()) params.set('q', q.trim())
      setData(await api<ListRes>(`/api/tickets?${params}`))
      setError('')
    } catch (e) {
      setError((e as Error).message)
    }
  }, [status, lingkup, jenis, q])
  useEffect(() => { const t = setTimeout(load, q ? 300 : 0); return () => clearTimeout(t) }, [load, q])

  const handler = !!data?.can.handle
  const items = data?.items ?? []
  const paged = usePaged(items, [status, lingkup, jenis, q])
  const s = data?.stats
  async function remove(t: Ticket) {
    if (!(await confirmDialog(`Hapus tiket ${t.nomor} "${t.judul}"? Tiket bisa dipulihkan dari Data Terhapus.`))) return
    try {
      await api(`/api/tickets/${t.id}`, { method: 'DELETE' })
      setMessage(`Tiket ${t.nomor} dihapus.`)
      load()
    } catch (e) {
      setError((e as Error).message)
    }
  }
  const tile = (label: string, value: number, note: string, Icon: typeof Inbox, tone: string, key: typeof status) => (
    <button key={label} type="button" className={`pap-stat-card pap-stat-button ${status === key ? 'active' : ''}`} onClick={() => setStatus(status === key ? 'aktif' : key)}>
      <div><span>{label}</span><strong>{value}</strong><small className="neutral">{note}</small></div>
      <div className={`pap-stat-icon ${tone}`}><Icon /></div>
    </button>
  )

  return (
    <>
      <div className="pap-page-heading">
        <div>
          <p className="pap-eyebrow">SISTEM · BANTUAN</p>
          <h1>Tiket Kendala</h1>
          <span>{handler ? 'Semua laporan kendala dari pengguna: sistem SIMPAP dan IT umum (laptop, jaringan, printer, dll.). Tangani, balas, dan ubah status tiket.' : 'Laporkan kendala ke Staff IT, baik error di SIMPAP maupun kendala IT umum seperti laptop rusak, jaringan, atau printer, lalu pantau tindak lanjutnya di sini.'}</span>
        </div>
        <button className="pap-primary-button" onClick={() => setForm('baru')}><Plus /> Ajukan tiket</button>
      </div>
      {message && <Notice kind="success" onClose={() => setMessage('')}>{message}</Notice>}
      {error && <Notice onClose={() => setError('')}>{error}</Notice>}
      <div className="pap-stat-grid four">
        {tile('Baru', s?.baru ?? 0, handler ? 'belum ditangani' : 'menunggu Staff IT', Inbox, 'stat-1', 'baru')}
        {tile('Diproses', s?.diproses ?? 0, 'sedang ditangani', Clock, 'stat-2', 'diproses')}
        {tile('Menunggu pelapor', s?.menunggu_user ?? 0, handler ? 'butuh info dari pelapor' : 'perlu jawaban Anda', MessageSquare, 'stat-2', 'menunggu_user')}
        {tile('Selesai bulan ini', s?.selesai_bulan_ini ?? 0, `${s?.total ?? 0} tiket total`, CheckCircle2, 'stat-0', 'selesai')}
      </div>
      <div className="pap-table-card">
        <div className="pap-card-head"><div><h2>{handler ? 'Daftar tiket' : 'Tiket saya'}</h2><p>{data ? `${items.length} tiket${status === 'aktif' ? ' aktif' : ''}` : 'Memuat...'} · klik tiket untuk melihat detail & percakapan</p></div></div>
        <div className="pap-filters">
          <div className="pap-segmented" role="tablist" aria-label="Status tiket">
            {([['aktif', 'Aktif'], ['', 'Semua'], ['selesai', 'Selesai'], ['ditolak', 'Ditolak']] as const).map(([k, l]) => <button key={l} role="tab" aria-selected={status === k} className={status === k ? 'active' : ''} onClick={() => setStatus(k)}>{l}</button>)}
          </div>
          <select className="pap-select" value={jenis} onChange={(e) => setJenis(e.target.value as typeof jenis)} aria-label="Jenis kendala">
            <option value="">Semua jenis</option><option value="sistem">Sistem SIMPAP</option><option value="umum">IT umum</option>
          </select>
          {handler && (
            <select className="pap-select" value={lingkup} onChange={(e) => setLingkup(e.target.value as typeof lingkup)} aria-label="Penangan">
              <option value="semua">Semua penangan</option><option value="saya">Saya tangani</option><option value="belum">Belum ada penangan</option>
            </select>
          )}
          <label className="pap-filter-search"><Search /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder={handler ? 'Cari nomor, judul, menu, pelapor...' : 'Cari nomor, judul, menu...'} /></label>
        </div>
        <div className="pap-table-wrap">
          <table>
            <thead><tr><th>Tiket</th><th>Jenis / kategori</th>{handler && <th>Pelapor</th>}<th>Prioritas</th><th>Status</th><th>Penangan</th><th className="pap-actions-col">Aksi</th></tr></thead>
            <tbody>
              {paged.items.map((t) => {
                const own = t.dilaporkan_oleh === user.id
                const editable = handler || (own && t.status === 'baru')
                return (
                  <tr key={t.id} className="pap-row-link" onClick={() => setOpenId(t.id)}>
                    <td><div className="pap-cell-title">{t.judul}<FreshBadge item={t} /></div><div className="pap-cell-sub">{t.nomor} · {formatDate(t.created_at, true)}{t.pesan ? ` · ${t.pesan} pesan` : ''}</div></td>
                    <td>{t.jenis === 'umum' ? <span className="pap-status neutral">IT umum</span> : <span className="pap-status info">SIMPAP</span>} {t.modul ?? t.lokasi ?? ''}<div className="pap-cell-sub">{KATEGORI[t.kategori] ?? t.kategori}</div></td>
                    {handler && <td>{t.pelapor ?? '—'}<div className="pap-cell-sub">{t.pelapor_divisi ?? ''}</div></td>}
                    <td><span className={`pap-status ${PRIORITAS_TONE[t.prioritas]}`}>{PRIORITAS[t.prioritas]}</span></td>
                    <td><span className={`pap-status ${STATUS_TONE[t.status]}`}>{STATUS[t.status]}</span>{t.selesai_at && <div className="pap-cell-sub">{formatDate(t.selesai_at)}</div>}</td>
                    <td>{t.penangan ?? <span className="pap-muted">—</span>}</td>
                    <td className="pap-actions-cell" onClick={(e) => e.stopPropagation()}>
                      <RowActions label={t.nomor} onView={() => setOpenId(t.id)} onEdit={editable ? () => setForm(t) : undefined} onDelete={editable ? () => remove(t) : undefined} />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {data && !items.length && (
            <div className="pap-empty pap-empty-stack"><LifeBuoy /><div>{q || status !== 'aktif' ? 'Tidak ada tiket yang cocok.' : handler ? 'Tidak ada tiket aktif. Semua kendala sudah ditangani.' : 'Belum ada tiket aktif. Klik "Ajukan tiket" bila menemukan kendala di SIMPAP.'}</div></div>
          )}
          {!data && !error && <div className="pap-empty">Memuat tiket...</div>}
          <Pager {...paged.pager} noun="tiket" />
        </div>
      </div>
      {form && <TicketForm item={form === 'baru' ? null : form} menus={menus} onClose={() => setForm(null)} onSaved={(text, id) => { setForm(null); setMessage(text); load(); if (id) setOpenId(id) }} />}
      {openId && <TicketDetail id={openId} user={user} onClose={() => setOpenId(null)} onEdit={(t) => { setOpenId(null); setForm(t) }} onChanged={load} onDeleted={(text) => { setOpenId(null); setMessage(text); load() }} />}
    </>
  )
}

function TicketForm({ item, menus, onClose, onSaved }: { item: Ticket | null; menus: string[]; onClose: () => void; onSaved: (message: string, id?: number) => void }) {
  const [v, setV] = useState({ judul: item?.judul ?? '', jenis: item?.jenis ?? 'sistem', kategori: item?.kategori ?? 'error', modul: item?.modul ?? '', lokasi: item?.lokasi ?? '', prioritas: item?.prioritas ?? 'normal', deskripsi: item?.deskripsi ?? '' })
  const setJenisForm = (j: keyof typeof JENIS) => setV({ ...v, jenis: j, kategori: KATEGORI_JENIS[j].includes(v.kategori) ? v.kategori : KATEGORI_JENIS[j][0] })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function save(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      if (item) {
        await api(`/api/tickets/${item.id}`, { method: 'PATCH', json: v })
        onSaved(`Tiket ${item.nomor} diperbarui.`)
      } else {
        const res = await api<{ id: number; nomor: string }>('/api/tickets', { method: 'POST', json: v })
        onSaved(`Tiket ${res.nomor} terkirim ke Staff IT. Tambahkan screenshot di detail tiket bila perlu.`, res.id)
      }
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
    }
  }
  return (
    <Modal title={item ? `Ubah tiket ${item.nomor}` : 'Ajukan tiket kendala'} subtitle={item ? undefined : 'Jelaskan kendalanya selengkap mungkin agar Staff IT bisa cepat menindaklanjuti'} wide onClose={onClose}
      footer={<><span className="pap-spacer" /><button className="pap-btn" onClick={onClose}>Batal</button><button className="pap-primary-button" form="ticket-form" disabled={busy}>{busy ? 'Mengirim...' : item ? 'Simpan' : <><Send /> Kirim tiket</>}</button></>}>
      <form id="ticket-form" className="pap-form-grid" onSubmit={save}>
        {error && <div className="full"><Notice onClose={() => setError('')}>{error}</Notice></div>}
        <div className="pap-field full">
          <span>Jenis kendala</span>
          <div className="pap-ticket-jenis" role="radiogroup">
            <button type="button" role="radio" aria-checked={v.jenis === 'sistem'} className={v.jenis === 'sistem' ? 'active' : ''} onClick={() => setJenisForm('sistem')}><b>Sistem SIMPAP</b><small>Error, akses menu, data salah, permintaan fitur</small></button>
            <button type="button" role="radio" aria-checked={v.jenis === 'umum'} className={v.jenis === 'umum' ? 'active' : ''} onClick={() => setJenisForm('umum')}><b>IT umum</b><small>Laptop / komputer rusak, jaringan, printer, email, software lain</small></button>
          </div>
        </div>
        <Field label="Judul kendala *" full><input className="pap-input" required maxLength={200} value={v.judul} onChange={(e) => setV({ ...v, judul: e.target.value })} placeholder={v.jenis === 'umum' ? 'Mis. Laptop tidak bisa menyala / WiFi lantai 2 putus' : 'Mis. Tidak bisa simpan Quotation, muncul pesan error'} /></Field>
        {v.jenis === 'umum' ? <Field label="Perangkat / lokasi"><input className="pap-input" maxLength={150} value={v.lokasi} onChange={(e) => setV({ ...v, lokasi: e.target.value })} placeholder="Mis. Laptop Asus HRD / Ruang produksi / Printer Epson Accounting" /></Field> : <Field label="Menu yang bermasalah">
          <select className="pap-select" value={v.modul} onChange={(e) => setV({ ...v, modul: e.target.value })}>
            <option value="">— Pilih menu —</option>
            {menus.map((m) => <option key={m} value={m}>{m}</option>)}
            <option value="Login / akun">Login / akun</option>
            <option value="Lainnya">Lainnya</option>
          </select>
        </Field>}
        <Field label="Kategori">
          <select className="pap-select" value={v.kategori} onChange={(e) => setV({ ...v, kategori: e.target.value as Ticket['kategori'] })}>{KATEGORI_JENIS[v.jenis].map((k) => <option key={k} value={k}>{KATEGORI[k]}</option>)}</select>
        </Field>
        <div className="pap-field full">
          <span>Prioritas</span>
          <div className="pap-segmented pap-ticket-prio" role="radiogroup">
            {Object.entries(PRIORITAS).map(([k, l]) => <button key={k} type="button" role="radio" aria-checked={v.prioritas === k} className={v.prioritas === k ? 'active' : ''} onClick={() => setV({ ...v, prioritas: k as Ticket['prioritas'] })}>{l}</button>)}
          </div>
          <small className="pap-muted">Darurat: pekerjaan berhenti total (mis. tidak bisa login, data hilang, laptop mati total, internet kantor putus).</small>
        </div>
        <Field label="Deskripsi kendala *" full>
          <textarea className="pap-input" required rows={6} maxLength={10000} value={v.deskripsi} onChange={(e) => setV({ ...v, deskripsi: e.target.value })}
            placeholder={v.jenis === 'umum' ? 'Jelaskan kendalanya: sejak kapan, apa yang sudah dicoba, dan dampaknya ke pekerjaan.\nMis. Laptop mati saat dinyalakan, lampu indikator berkedip. Sudah dicas semalaman.' : 'Apa yang Anda lakukan, apa yang terjadi, dan apa yang seharusnya terjadi.\nMis. Buka Quotation > Tambah > klik Simpan, muncul "Gagal menyimpan". Sudah dicoba 3x.'} />
        </Field>
      </form>
    </Modal>
  )
}

function TicketDetail({ id, user, onClose, onEdit, onChanged, onDeleted }: { id: number; user: UserProfile; onClose: () => void; onEdit: (t: Ticket) => void; onChanged: () => void; onDeleted: (message: string) => void }) {
  const [d, setD] = useState<DetailRes | null>(null)
  const [error, setError] = useState('')
  const [reply, setReply] = useState('')
  const [busy, setBusy] = useState(false)
  const endRef = useRef<HTMLDivElement>(null)
  const load = useCallback(() => api<DetailRes>(`/api/tickets/${id}`).then((r) => { setD(r); setError('') }).catch((e) => setError(e.message)), [id])
  useEffect(() => { load() }, [load])
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'nearest' }) }, [d?.messages.length])
  async function run(fn: () => Promise<unknown>) {
    setBusy(true)
    setError('')
    try {
      await fn()
      await load()
      onChanged()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  async function setStatus(status: Status, ask?: string) {
    let catatan = ''
    if (ask) {
      const required = status === 'ditolak'
      const answer = await askReason({ title: `${status === 'baru' ? 'Buka kembali' : STATUS[status]} · ${d?.item.nomor ?? ''}`, label: ask, required, danger: required, confirmLabel: 'Simpan' })
      if (answer === null) return
      catatan = answer
    }
    await run(() => api(`/api/tickets/${id}`, { method: 'PATCH', json: { status, catatan } }))
  }
  async function remove() {
    if (!d || !(await confirmDialog(`Hapus tiket ${d.item.nomor}? Tiket bisa dipulihkan dari Data Terhapus.`))) return
    try {
      await api(`/api/tickets/${id}`, { method: 'DELETE' })
      onDeleted(`Tiket ${d.item.nomor} dihapus.`)
    } catch (e) {
      setError((e as Error).message)
    }
  }
  if (!d) return <Modal title="Tiket kendala" onClose={onClose}>{error ? <Notice>{error}</Notice> : <p className="pap-muted">Memuat...</p>}</Modal>
  const t = d.item
  const can = d.can
  return (
    <Modal title={t.judul} subtitle={`${t.nomor} · diajukan ${formatDate(t.created_at, true)}${t.pelapor ? ` oleh ${t.pelapor}` : ''}${t.pelapor_divisi ? ` (${t.pelapor_divisi})` : ''}`} wide onClose={onClose}
      footer={<>
        {can.delete && <button className="pap-btn danger" disabled={busy} onClick={remove}><Trash2 /> Hapus</button>}
        {can.edit && <button className="pap-btn" disabled={busy} onClick={() => onEdit(t)}><Pencil /> Ubah</button>}
        <span className="pap-spacer" />
        {can.reopen && <button className="pap-btn" disabled={busy} onClick={() => setStatus('baru', 'Alasan membuka kembali tiket (opsional):')}><RotateCcw /> Buka kembali</button>}
        {can.close && <button className="pap-primary-button" disabled={busy} onClick={() => setStatus('selesai')}><CheckCircle2 /> Kendala sudah beres</button>}
        <button className="pap-btn" onClick={onClose}>Tutup</button>
      </>}>
      {error && <Notice onClose={() => setError('')}>{error}</Notice>}
      <div className="pap-detail-badges">
        <span className={`pap-status ${STATUS_TONE[t.status]}`}>{STATUS[t.status]}</span>
        <span className={`pap-status ${PRIORITAS_TONE[t.prioritas]}`}>Prioritas {PRIORITAS[t.prioritas].toLowerCase()}</span>
        <span className="pap-chip">{JENIS[t.jenis] ?? 'Sistem SIMPAP'}</span>
        <span className="pap-chip">{KATEGORI[t.kategori] ?? t.kategori}</span>
        {t.modul && <span className="pap-chip">{t.modul}</span>}
        {t.lokasi && <span className="pap-chip">{t.lokasi}</span>}
      </div>
      {can.handle && (
        <div className="pap-ticket-handle">
          <Field label="Status">
            <select className="pap-select" value={t.status} disabled={busy} onChange={(e) => {
              const s = e.target.value as Status
              setStatus(s, s === 'ditolak' ? 'Alasan tiket ditolak (wajib):' : s === 'menunggu_user' ? 'Info apa yang dibutuhkan dari pelapor? (opsional)' : s === 'selesai' ? 'Catatan penyelesaian (opsional):' : undefined)
            }}>
              {Object.entries(STATUS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </Field>
          <Field label="Ditangani oleh">
            <select className="pap-select" value={t.ditangani_oleh ?? ''} disabled={busy} onChange={(e) => run(() => api(`/api/tickets/${id}`, { method: 'PATCH', json: { ditangani_oleh: e.target.value || null } }))}>
              <option value="">— Belum ada —</option>
              {d.handlers.map((h) => <option key={h.id} value={h.id}>{h.name}{h.id === user.id ? ' (saya)' : ''}</option>)}
            </select>
          </Field>
          {!t.ditangani_oleh && <button type="button" className="pap-btn" disabled={busy} onClick={() => run(() => api(`/api/tickets/${id}`, { method: 'PATCH', json: { ditangani_oleh: user.id } }))}><UserCheck /> Saya tangani</button>}
        </div>
      )}
      <section className="pap-detail-section">
        <h3>Deskripsi</h3>
        <p className="pap-prewrap">{t.deskripsi}</p>
      </section>
      <AttachmentPanel title="Screenshot / lampiran" basePath={`/api/notes/ticket/${t.id}/attachments`} fileBase="/api/notes/attachments" canAdd={can.reply} currentUserId={user.id} isAdmin={user.role.isAdmin} />
      <section className="pap-detail-section">
        <h3>Percakapan</h3>
        <div className="pap-ticket-thread">
          {!d.messages.length && <p className="pap-muted">Belum ada balasan. {can.handle ? 'Balas untuk memberi tahu pelapor; status otomatis menjadi Diproses.' : 'Staff IT akan membalas di sini.'}</p>}
          {d.messages.map((m) => m.jenis === 'status' ? (
            <div key={m.id} className="pap-ticket-event"><span>{m.pesan}</span><small>{m.nama ?? 'Sistem'} · {formatDate(m.created_at, true)}</small></div>
          ) : (
            <div key={m.id} className={`pap-ticket-msg ${m.user_id === user.id ? 'mine' : ''} ${m.penangan ? 'it' : ''}`}>
              <div className="pap-ticket-msg-head"><b>{m.nama ?? 'Pengguna'}</b>{m.penangan && <span className="pap-status info">Staff IT</span>}<small>{formatDate(m.created_at, true)}</small></div>
              <p className="pap-prewrap">{m.pesan}</p>
            </div>
          ))}
          <div ref={endRef} />
        </div>
        {can.reply && t.status !== 'ditolak' && (
          <form className="pap-ticket-reply" onSubmit={(e) => { e.preventDefault(); if (reply.trim()) run(async () => { await api(`/api/tickets/${id}/messages`, { method: 'POST', json: { pesan: reply } }); setReply('') }) }}>
            <textarea className="pap-input" rows={2} maxLength={10000} value={reply} onChange={(e) => setReply(e.target.value)} placeholder={can.handle ? 'Balas pelapor...' : 'Tambahkan info untuk Staff IT...'} />
            <button className="pap-primary-button" disabled={busy || !reply.trim()}><Send /> Kirim</button>
          </form>
        )}
      </section>
    </Modal>
  )
}
