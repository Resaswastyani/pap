'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle, CheckCircle2, ChevronRight, CircleDot, Clock3, MessageSquare, MessageSquareWarning, Pencil, Plus, Search, Send, ShieldCheck, Star, Timer, Trash2, Wrench, XCircle,
} from 'lucide-react'
import type { UserProfile } from '@/lib/users'
import { formatRupiah } from './accurate'
import { AttachmentInput, AttachmentPanel, emptyAttachments, pendingCount, uploadNoteAttachments, type PendingAttachments } from './attachments'
import { BarList, ColumnChart } from './charts'
import { api, confirmDialog, Field, formatDate, Modal, Notice, Pager, usePaged } from './ui'

// Kendala Customer: catat keluhan customer & lacak penanganannya sampai selesai

const STATUS = { baru: 'Baru', investigasi: 'Investigasi', perbaikan: 'Perbaikan', konfirmasi: 'Konfirmasi customer', selesai: 'Selesai', ditolak: 'Ditolak' } as const
type Status = keyof typeof STATUS
const FLOW: Status[] = ['baru', 'investigasi', 'perbaikan', 'konfirmasi', 'selesai']
const STATUS_HINT: Record<Status, string> = {
  baru: 'Keluhan diterima, menunggu ditangani', investigasi: 'Mencari akar masalah (cek sampel, produksi, pengiriman)', perbaikan: 'Tindakan perbaikan & solusi dijalankan',
  konfirmasi: 'Menunggu konfirmasi customer atas solusi', selesai: 'Customer puas / keluhan ditutup', ditolak: 'Keluhan tidak valid / di luar tanggung jawab',
}
const STATUS_TONE: Record<Status, string> = { baru: 'info', investigasi: 'warning', perbaikan: 'warning', konfirmasi: 'info', selesai: 'success', ditolak: 'neutral' }
const KATEGORI: Record<string, string> = {
  kualitas: 'Kualitas produk', ukuran: 'Ukuran / ketebalan', cetak: 'Cetakan / warna', kemasan: 'Kemasan / packing', pengiriman: 'Pengiriman terlambat',
  kurang_kirim: 'Kurang kirim', salah_kirim: 'Salah kirim', administrasi: 'Faktur / administrasi', pelayanan: 'Pelayanan', lainnya: 'Lainnya',
}
const KATEGORI_HINT: Record<string, string> = { kualitas: 'sobek, bocor, getas, lengket', ukuran: 'ukuran / ketebalan tidak sesuai', cetak: 'cetakan, warna, logo', kemasan: 'packing rusak / kurang rapi' }
const PRIORITAS = { kritis: 'Kritis', tinggi: 'Tinggi', normal: 'Normal', rendah: 'Rendah' } as const
const SLA: Record<string, number> = { kritis: 1, tinggi: 3, normal: 7, rendah: 14 }
const CHANNEL = { whatsapp: 'WhatsApp', telepon: 'Telepon', email: 'Email', kunjungan: 'Kunjungan', marketplace: 'Marketplace', lainnya: 'Lainnya' } as const
const SOLUSI = { ganti_barang: 'Ganti barang', retur: 'Retur / refund', kirim_ulang: 'Kirim ulang / kirim kekurangan', potongan_harga: 'Potongan harga / kredit', perbaikan: 'Perbaikan / rework', penjelasan: 'Penjelasan / edukasi', lainnya: 'Lainnya' } as const

type Complaint = {
  id: number; nomor: string; tanggal: string; customer_id: number | null; customer_nama: string; customer_no: string | null; kontak: string | null; channel: string; judul: string; kategori: string
  prioritas: string; deskripsi: string; produk: string | null; item_accurate_id: number | null; referensi: string | null; qty_terdampak: number | null; satuan: string | null
  status: Status; pic_id: number | null; pic_nama: string | null; pic_divisi: string | null; divisi_terkait: string | null; target_selesai: string | null; terlambat: boolean
  akar_masalah: string | null; tindakan_perbaikan: string | null; tindakan_pencegahan: string | null; solusi: string | null; solusi_detail: string | null; nilai_kompensasi: number | null
  kepuasan: number | null; catatan_penutupan: string | null; selesai_at: string | null; dilaporkan_oleh: number | null; pelapor_nama: string | null; created_at: string; updated_at: string
  lampiran: number; update_terakhir: string | null; umur_hari: number
}
type Update = { id: number; jenis: string; status_dari: string | null; status_ke: string | null; pesan: string; created_at: string; user_id: number | null; user_nama: string | null }
type ListRes = {
  items: Complaint[]
  stats: { total: number; terbuka: number; selesai: number; terlambat: number; prioritas_tinggi: number; rata_hari: number | null; tepat_waktu: number | null; kepuasan: number | null; kompensasi: number }
  per_status: Record<string, number>; per_kategori: { kategori: string; n: number }[]; per_bulan: { bulan: string; n: number; selesai: number }[]; top_customer: { nama: string; n: number; terbuka: number }[]
  can: { create: boolean; manage: boolean }
}
type Options = { customers: { id: number; name: string; customer_no: string | null; phone: string | null }[]; users: { id: number; name: string; divisi: string | null }[]; divisions: string[] }

const todayWib = () => new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10)
const addDays = (ymd: string, n: number) => { const d = new Date(`${ymd}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
const monthStart = (ymd: string, back = 0) => { const d = new Date(`${ymd.slice(0, 7)}-01T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() - back); return d.toISOString().slice(0, 10) }
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des']
const dueText = (c: Complaint, today: string) => {
  if (!c.target_selesai) return null
  if (c.status === 'selesai' || c.status === 'ditolak') return null
  const d = Math.round((Date.parse(c.target_selesai) - Date.parse(today)) / 864e5)
  return d < 0 ? `Lewat ${-d} hari` : d === 0 ? 'Target hari ini' : `${d} hari lagi`
}

export function ComplaintPage({ user, focusId }: { user: UserProfile; focusId?: number | null }) {
  const today = todayWib()
  const [periode, setPeriode] = useState<'bulan' | '3bulan' | 'tahun' | 'semua'>('3bulan')
  const [status, setStatus] = useState('')
  const [kategori, setKategori] = useState('')
  const [prioritas, setPrioritas] = useState('')
  const [q, setQ] = useState('')
  const [data, setData] = useState<ListRes | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [detailId, setDetailId] = useState<number | null>(focusId ?? null)
  const [form, setForm] = useState<{ item: Complaint | null } | null>(null)

  const range = useMemo(() => {
    if (periode === 'bulan') return { from: monthStart(today), to: '' }
    if (periode === '3bulan') return { from: monthStart(today, 2), to: '' }
    if (periode === 'tahun') return { from: `${today.slice(0, 4)}-01-01`, to: '' }
    return { from: '', to: '' }
  }, [periode, today])
  const params = useMemo(() => {
    const p = new URLSearchParams()
    if (range.from) p.set('from', range.from)
    if (status) p.set('status', status)
    if (kategori) p.set('kategori', kategori)
    if (prioritas) p.set('prioritas', prioritas)
    if (q.trim()) p.set('q', q.trim())
    return p.toString()
  }, [range, status, kategori, prioritas, q])
  const load = useCallback(async () => {
    try {
      setData(await api<ListRes>(`/api/complaints?${params}`))
      setError('')
    } catch (e) {
      setError((e as Error).message)
    }
  }, [params])
  useEffect(() => {
    const t = setTimeout(load, q ? 300 : 0)
    return () => clearTimeout(t)
  }, [load, q])
  useEffect(() => { if (focusId) setDetailId(focusId) }, [focusId])
  const paged = usePaged(data?.items ?? [], [params])
  const s = data?.stats
  const toggle = (v: string) => setStatus(status === v ? '' : v)

  return (
    <>
      <div className="pap-page-heading">
        <div>
          <p className="pap-eyebrow">MARKETING · LAYANAN CUSTOMER</p>
          <h1>Kendala Customer</h1>
          <span>Catat keluhan customer (kualitas, ukuran, cetakan, pengiriman, administrasi) dan lacak penanganannya: investigasi akar masalah, tindakan perbaikan, solusi ke customer, sampai customer puas.</span>
        </div>
        <button className="pap-primary-button" onClick={() => setForm({ item: null })}><Plus /> Catat keluhan</button>
      </div>
      {error && <Notice onClose={() => setError('')}>{error}</Notice>}
      {notice && <Notice kind="success" onClose={() => setNotice('')}>{notice}</Notice>}

      <div className="pap-stat-grid four">
        <button className={`pap-stat-card pap-stat-button ${status === '' ? '' : ''}`} onClick={() => setStatus('')}>
          <div><span>Keluhan periode ini</span><strong className="pap-stat-text">{s?.total ?? 0}</strong><small className="neutral">{s ? `${s.selesai} selesai${s.kompensasi ? ` · kompensasi ${formatRupiah(s.kompensasi)}` : ''}` : '—'}</small></div>
          <div className="pap-stat-icon stat-1"><MessageSquareWarning /></div>
        </button>
        <button className={`pap-stat-card pap-stat-button ${status === 'terbuka' ? 'active' : ''}`} onClick={() => toggle('terbuka')}>
          <div><span>Masih terbuka</span><strong className="pap-stat-text">{s?.terbuka ?? 0}</strong><small className="neutral">{s?.prioritas_tinggi ? `${s.prioritas_tinggi} prioritas tinggi / kritis` : 'Belum selesai ditangani'}</small></div>
          <div className={`pap-stat-icon ${s?.terbuka ? 'stat-2' : 'stat-0'}`}><CircleDot /></div>
        </button>
        <button className={`pap-stat-card pap-stat-button ${status === 'terlambat' ? 'active' : ''}`} onClick={() => toggle('terlambat')}>
          <div><span>Lewat target</span><strong className="pap-stat-text">{s?.terlambat ?? 0}</strong><small className="neutral">{s?.terlambat ? 'Perlu segera ditindaklanjuti' : 'Semua masih sesuai target'}</small></div>
          <div className={`pap-stat-icon ${s?.terlambat ? 'stat-2' : 'stat-0'}`}><Timer /></div>
        </button>
        <div className="pap-stat-card">
          <div><span>Rata-rata penyelesaian</span><strong className="pap-stat-text">{s?.rata_hari === null || s?.rata_hari === undefined ? '—' : `${s.rata_hari.toLocaleString('id-ID', { maximumFractionDigits: 1 })} hari`}</strong>
            <small className="neutral">{s?.tepat_waktu !== null && s?.tepat_waktu !== undefined ? `${Math.round(s.tepat_waktu)}% tepat waktu` : 'Belum ada yang selesai'}{s?.kepuasan ? ` · kepuasan ${s.kepuasan.toLocaleString('id-ID', { maximumFractionDigits: 1 })}/5` : ''}</small></div>
          <div className="pap-stat-icon stat-0"><Clock3 /></div>
        </div>
      </div>

      <nav className="pap-cc-pipeline" aria-label="Tahap penanganan">
        {[...FLOW, 'ditolak' as Status].map((st, i) => (
          <button key={st} type="button" className={`pap-cc-stage ${STATUS_TONE[st]} ${status === st ? 'active' : ''}`} onClick={() => toggle(st)} title={STATUS_HINT[st]}>
            <span className="pap-cc-stage-n">{data?.per_status[st] ?? 0}</span>
            <span className="pap-cc-stage-l">{i < FLOW.length ? `${i + 1}. ` : ''}{STATUS[st]}</span>
          </button>
        ))}
      </nav>

      {data && data.stats.total > 0 && (
        <div className="pap-cc-insights">
          <section className="pap-table-card">
            <div className="pap-card-head"><div><h2>Kategori keluhan</h2><p>Jenis masalah yang paling sering dikeluhkan</p></div></div>
            <div className="pap-ma-card-body"><BarList items={data.per_kategori.map((k) => ({ key: k.kategori, label: KATEGORI[k.kategori] ?? k.kategori, value: k.n, tone: 's1' as const, display: `${k.n}`, onClick: () => setKategori(kategori === k.kategori ? '' : k.kategori) }))} /></div>
          </section>
          <section className="pap-table-card">
            <div className="pap-card-head"><div><h2>Tren keluhan</h2><p>Per bulan · selesai vs belum</p></div></div>
            <div className="pap-ma-card-body pap-viz-host">
              <ColumnChart ariaLabel="Tren keluhan per bulan" format={(v) => `${v} keluhan`} data={data.per_bulan.map((b) => ({
                key: b.bulan, label: `${MONTHS[Number(b.bulan.slice(5, 7)) - 1]} ${b.bulan.slice(2, 4)}`, value: b.n,
                detail: <><b>{MONTHS[Number(b.bulan.slice(5, 7)) - 1]} {b.bulan.slice(0, 4)}</b><br />{b.n} keluhan · {b.selesai} selesai</>,
                segments: [{ key: 'selesai', value: b.selesai, tone: 's2' }, { key: 'belum', value: b.n - b.selesai, tone: 's1' }],
              }))} />
              <div className="pap-viz-legend pap-ma-legend"><span><i className="swatch s2" />Selesai</span><span><i className="swatch s1" />Belum selesai</span></div>
            </div>
          </section>
          <section className="pap-table-card">
            <div className="pap-card-head"><div><h2>Customer terbanyak</h2><p>Perlu perhatian khusus</p></div></div>
            <ul className="pap-cc-top">
              {data.top_customer.map((c) => (
                <li key={c.nama}><button type="button" onClick={() => setQ(c.nama)}><span>{c.nama}</span><b>{c.n}</b>{c.terbuka > 0 && <small>{c.terbuka} terbuka</small>}</button></li>
              ))}
            </ul>
          </section>
        </div>
      )}

      <section className="pap-table-card">
        <div className="pap-card-head">
          <div><h2>Daftar keluhan</h2><p>Urut dari yang belum selesai & prioritas tertinggi. Klik keluhan untuk tracking penanganannya.</p></div>
          <div className="pap-chip-tabs pap-cc-period">
            {([['bulan', 'Bulan ini'], ['3bulan', '3 bulan'], ['tahun', 'Tahun ini'], ['semua', 'Semua']] as const).map(([k, l]) => <button key={k} type="button" className={periode === k ? 'active' : ''} onClick={() => setPeriode(k)}>{l}</button>)}
          </div>
        </div>
        <div className="pap-filters">
          <label className="pap-filter-search"><Search /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari nomor, customer, produk, no. SO / faktur..." /></label>
          <select className="pap-select" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
            <option value="">Semua status</option><option value="terbuka">Masih terbuka</option><option value="terlambat">Lewat target</option>
            {Object.entries(STATUS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
          <select className="pap-select" value={kategori} onChange={(e) => setKategori(e.target.value)} aria-label="Kategori">
            <option value="">Semua kategori</option>{Object.entries(KATEGORI).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
          <select className="pap-select" value={prioritas} onChange={(e) => setPrioritas(e.target.value)} aria-label="Prioritas">
            <option value="">Semua prioritas</option>{Object.entries(PRIORITAS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </div>
        <div className="pap-table-wrap">
          <table className="pap-cc-table">
            <thead><tr><th>Keluhan</th><th>Customer & produk</th><th>Prioritas</th><th>Status</th><th>PIC & target</th></tr></thead>
            <tbody>
              {paged.items.map((c) => {
                const due = dueText(c, today)
                const step = FLOW.indexOf(c.status)
                return (
                  <tr key={c.id} className="pap-clickable" tabIndex={0} onClick={() => setDetailId(c.id)} onKeyDown={(e) => e.key === 'Enter' && setDetailId(c.id)}>
                    <td>
                      <div className="pap-cc-nomor">{c.nomor} · {formatDate(c.tanggal)}{c.lampiran > 0 ? ` · ${c.lampiran} lampiran` : ''}</div>
                      <div className="pap-cell-title">{c.judul}</div>
                      <span className="pap-cc-kat">{KATEGORI[c.kategori] ?? c.kategori}</span>
                    </td>
                    <td><div className="pap-cell-title">{c.customer_nama}</div><div className="pap-cell-sub">{[c.produk, c.referensi].filter(Boolean).join(' · ') || CHANNEL[c.channel as keyof typeof CHANNEL]}</div></td>
                    <td><span className={`pap-cc-prio ${c.prioritas}`}>{PRIORITAS[c.prioritas as keyof typeof PRIORITAS] ?? c.prioritas}</span></td>
                    <td>
                      <span className={`pap-status ${STATUS_TONE[c.status]}`}>{STATUS[c.status]}</span>
                      {c.status !== 'ditolak' && <div className="pap-cc-mini" aria-hidden>{FLOW.map((f, i) => <i key={f} className={i <= step ? 'on' : ''} />)}</div>}
                    </td>
                    <td>
                      <div>{c.pic_nama ?? <span className="pap-muted">Belum ada PIC</span>}</div>
                      <div className={`pap-cell-sub ${c.terlambat ? 'pap-cc-late' : ''}`}>{c.status === 'selesai' ? `Selesai ${formatDate(c.selesai_at)} · ${c.umur_hari} hari` : c.status === 'ditolak' ? 'Ditutup' : `${c.target_selesai ? formatDate(c.target_selesai) : 'Tanpa target'}${due ? ` · ${due}` : ''}`}</div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {data && !data.items.length && <div className="pap-empty">{q || status || kategori || prioritas ? 'Tidak ada keluhan yang cocok.' : 'Belum ada keluhan customer pada periode ini. Klik "Catat keluhan" saat ada komplain masuk.'}</div>}
          {!data && !error && <div className="pap-empty">Memuat keluhan...</div>}
          <Pager {...paged.pager} noun="keluhan" />
        </div>
      </section>

      {detailId && <ComplaintDetail id={detailId} user={user} onClose={() => setDetailId(null)} onEdit={(c) => { setDetailId(null); setForm({ item: c }) }}
        onChanged={(msg) => { if (msg) setNotice(msg); load() }} onDeleted={(msg) => { setDetailId(null); setNotice(msg); load() }} />}
      {form && <ComplaintForm item={form.item} user={user} onClose={() => setForm(null)} onSaved={(id, msg) => { setForm(null); setNotice(msg); load(); setDetailId(id) }} />}
    </>
  )
}

// ---------- Form catat / ubah keluhan ----------
function ComplaintForm({ item, user, onClose, onSaved }: { item: Complaint | null; user: UserProfile; onClose: () => void; onSaved: (id: number, msg: string) => void }) {
  const today = todayWib()
  const [v, setV] = useState({
    tanggal: item?.tanggal ?? today, customer_id: item?.customer_id ?? null as number | null, customer_nama: item?.customer_nama ?? '', kontak: item?.kontak ?? '', channel: item?.channel ?? 'whatsapp',
    judul: item?.judul ?? '', kategori: item?.kategori ?? 'kualitas', prioritas: item?.prioritas ?? 'normal', deskripsi: item?.deskripsi ?? '', produk: item?.produk ?? '', referensi: item?.referensi ?? '',
    qty_terdampak: item?.qty_terdampak !== null && item?.qty_terdampak !== undefined ? String(item.qty_terdampak) : '', satuan: item?.satuan ?? 'kg',
    pic_id: item?.pic_id ?? null as number | null, divisi_terkait: item?.divisi_terkait ?? '', target_selesai: item?.target_selesai ?? '',
  })
  const [targetTouched, setTargetTouched] = useState(!!item)
  const [opts, setOpts] = useState<Options | null>(null)
  const [custQ, setCustQ] = useState('')
  const [custOpen, setCustOpen] = useState(false)
  const [files, setFiles] = useState<PendingAttachments>(emptyAttachments())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV({ ...v, [k]: e.target.value })

  useEffect(() => { api<Options>('/api/complaints/options').then(setOpts).catch(() => {}) }, [])
  function searchCustomer(text: string) {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => api<Options>(`/api/complaints/options?q=${encodeURIComponent(text)}`).then((o) => setOpts((p) => (p ? { ...p, customers: o.customers } : o))).catch(() => {}), 250)
  }
  const autoTarget = addDays(v.tanggal || today, SLA[v.prioritas] ?? 7)
  const target = targetTouched ? v.target_selesai : autoTarget

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const body = { ...v, target_selesai: target, qty_terdampak: v.qty_terdampak === '' ? null : Number(v.qty_terdampak.replace(',', '.')) }
      if (item) {
        await api(`/api/complaints/${item.id}`, { method: 'PUT', json: body })
        onSaved(item.id, `Keluhan ${item.nomor} diperbarui.`)
      } else {
        const res = await api<{ id: number; nomor: string }>('/api/complaints', { method: 'POST', json: body })
        const failed = pendingCount(files) ? await uploadNoteAttachments('complaint', res.id, files).catch(() => ['lampiran']) : []
        onSaved(res.id, `Keluhan ${res.nomor} dicatat.${Array.isArray(failed) && failed.length ? ' Sebagian lampiran gagal diunggah, tambahkan lagi dari detail.' : ''}`)
      }
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
    }
  }

  return (
    <Modal title={item ? `Ubah ${item.nomor}` : 'Catat keluhan customer'} subtitle={item ? item.customer_nama : `Dicatat oleh ${user.name}`} wide onClose={onClose}
      footer={<><span className="pap-spacer" /><button type="button" className="pap-btn" onClick={onClose}>Batal</button><button className="pap-primary-button" form="pap-cc-form" disabled={busy}>{busy ? 'Menyimpan...' : item ? 'Simpan perubahan' : 'Simpan keluhan'}</button></>}>
      <form id="pap-cc-form" className="pap-cc-form" onSubmit={save}>
        {error && <Notice onClose={() => setError('')}>{error}</Notice>}
        <section>
          <h3>Customer</h3>
          <div className="pap-form-grid">
            <div className="pap-field pap-cc-cust">
              <span>Customer *</span>
              <input className="pap-input" required value={v.customer_nama} placeholder="Cari customer atau ketik nama baru..."
                onFocus={() => { setCustOpen(true); searchCustomer(v.customer_nama) }} onBlur={() => setTimeout(() => setCustOpen(false), 180)}
                onChange={(e) => { setV({ ...v, customer_nama: e.target.value, customer_id: null }); setCustQ(e.target.value); setCustOpen(true); searchCustomer(e.target.value) }} />
              {v.customer_id ? <small className="pap-proj-tag">Customer terdaftar</small> : v.customer_nama ? <small className="pap-proj-tag manual">Customer baru / belum terdaftar</small> : null}
              {custOpen && !!opts?.customers.length && (
                <div className="pap-proj-drop" role="listbox">
                  {opts.customers.map((c) => (
                    <button type="button" role="option" aria-selected={c.id === v.customer_id} key={c.id} onMouseDown={(e) => e.preventDefault()}
                      onClick={() => { setV({ ...v, customer_id: c.id, customer_nama: c.name, kontak: v.kontak || c.phone || '' }); setCustOpen(false) }}>
                      <b>{c.name}</b><small>{[c.customer_no, c.phone].filter(Boolean).join(' · ') || custQ}</small>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <Field label="Kontak / PIC customer"><input className="pap-input" maxLength={150} value={v.kontak} onChange={set('kontak')} placeholder="mis. Bu Dea · 0812..." /></Field>
            <Field label="Diterima lewat"><select className="pap-select" value={v.channel} onChange={set('channel')}>{Object.entries(CHANNEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
            <Field label="Tanggal keluhan *"><input className="pap-input" type="date" required max={today} value={v.tanggal} onChange={set('tanggal')} /></Field>
          </div>
        </section>
        <section>
          <h3>Keluhan</h3>
          <div className="pap-form-grid">
            <Field label="Ringkasan keluhan *" full><input className="pap-input" required maxLength={200} value={v.judul} onChange={set('judul')} placeholder="mis. Kantong jinjing sobek di bagian sealing" /></Field>
            <Field label="Kategori" hint={KATEGORI_HINT[v.kategori]}><select className="pap-select" value={v.kategori} onChange={set('kategori')}>{Object.entries(KATEGORI).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
            <div className="pap-field">
              <span>Prioritas</span>
              <div className="pap-segmented pap-cc-prio-pick" role="radiogroup" aria-label="Prioritas">
                {Object.entries(PRIORITAS).map(([k, l]) => <button type="button" key={k} role="radio" aria-checked={v.prioritas === k} className={`${v.prioritas === k ? 'active' : ''} ${k}`} onClick={() => setV({ ...v, prioritas: k })}>{l}</button>)}
              </div>
            </div>
            <Field label="Kronologi / detail keluhan *" full><textarea className="pap-input" rows={4} required maxLength={10000} value={v.deskripsi} onChange={set('deskripsi')} placeholder="Apa yang dikeluhkan, kapan ditemukan, berapa banyak, permintaan customer..." /></Field>
          </div>
        </section>
        <section>
          <h3>Produk & referensi</h3>
          <div className="pap-form-grid">
            <Field label="Produk"><input className="pap-input" maxLength={255} value={v.produk} onChange={set('produk')} placeholder="mis. HD Jinjing Gusset Uk 45 Print Logo" /></Field>
            <Field label="No. SO / faktur / surat jalan / batch"><input className="pap-input" maxLength={150} value={v.referensi} onChange={set('referensi')} placeholder="mis. SO.2026.11.00048" /></Field>
            <div className="pap-field"><span>Jumlah terdampak</span><div className="pap-proj-unit"><input className="pap-input" inputMode="decimal" value={v.qty_terdampak} onChange={(e) => setV({ ...v, qty_terdampak: e.target.value.replace(/[^\d.,]/g, '') })} placeholder="0" /><input className="pap-input" maxLength={40} value={v.satuan} onChange={set('satuan')} aria-label="Satuan" /></div></div>
          </div>
        </section>
        <section>
          <h3>Penanganan</h3>
          <div className="pap-form-grid">
            <Field label="PIC penanganan">
              <select className="pap-select" value={v.pic_id ?? ''} onChange={(e) => setV({ ...v, pic_id: e.target.value ? Number(e.target.value) : null })}>
                <option value="">— Pilih PIC —</option>
                {opts?.users.map((u) => <option key={u.id} value={u.id}>{u.name}{u.divisi ? ` · ${u.divisi}` : ''}</option>)}
              </select>
            </Field>
            <Field label="Divisi terkait">
              <select className="pap-select" value={v.divisi_terkait} onChange={set('divisi_terkait')}>
                <option value="">—</option>{opts?.divisions.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </Field>
            <Field label="Target selesai" hint={targetTouched ? undefined : `Otomatis ${SLA[v.prioritas]} hari dari tanggal keluhan (prioritas ${PRIORITAS[v.prioritas as keyof typeof PRIORITAS]})`}>
              <input className="pap-input" type="date" value={target} min={v.tanggal} onChange={(e) => { setTargetTouched(true); setV({ ...v, target_selesai: e.target.value }) }} />
            </Field>
          </div>
        </section>
        {!item && (
          <section>
            <h3>Foto / video / dokumen bukti</h3>
            <AttachmentInput value={files} onChange={setFiles} allowVideo />
          </section>
        )}
      </form>
    </Modal>
  )
}

// ---------- Detail & tracking ----------
function ComplaintDetail({ id, user, onClose, onEdit, onChanged, onDeleted }: {
  id: number; user: UserProfile; onClose: () => void; onEdit: (c: Complaint) => void; onChanged: (msg?: string) => void; onDeleted: (msg: string) => void
}) {
  const [data, setData] = useState<{ item: Complaint; updates: Update[]; can: { process: boolean; manage: boolean; delete: boolean } } | null>(null)
  const [error, setError] = useState('')
  const [tab, setTab] = useState<'tracking' | 'info' | 'penanganan'>('tracking')
  const [statusTo, setStatusTo] = useState<Status | null>(null)
  const today = todayWib()

  const load = useCallback(async () => {
    try {
      setData(await api(`/api/complaints/${id}`))
      setError('')
    } catch (e) {
      setError((e as Error).message)
    }
  }, [id])
  useEffect(() => { load() }, [load])
  const refresh = (msg?: string) => { load(); onChanged(msg) }

  if (!data) return <Modal title="Kendala customer" onClose={onClose}>{error ? <Notice>{error}</Notice> : <p className="pap-muted">Memuat...</p>}</Modal>
  const c = data.item
  const step = FLOW.indexOf(c.status)
  const next = step >= 0 && step < FLOW.length - 1 ? FLOW[step + 1] : null
  const closed = c.status === 'selesai' || c.status === 'ditolak'
  const stepDate = (st: Status) => (st === 'baru' ? c.created_at : data.updates.filter((u) => u.status_ke === st).at(-1)?.created_at ?? null)
  const due = dueText(c, today)

  async function remove() {
    if (!(await confirmDialog({ title: 'Hapus keluhan?', message: `${c.nomor} · ${c.customer_nama}\n${c.judul}\n\nKeluhan & riwayatnya dipindah ke Data Terhapus dan bisa dipulihkan.`, confirmLabel: 'Hapus', tone: 'danger' }))) return
    try {
      await api(`/api/complaints/${c.id}`, { method: 'DELETE' })
      onDeleted(`Keluhan ${c.nomor} dihapus.`)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return (
    <Modal title={c.judul} subtitle={`${c.nomor} · ${c.customer_nama} · ${formatDate(c.tanggal)}`} wide onClose={onClose}
      footer={<>
        {data.can.delete && <button type="button" className="pap-btn danger" onClick={remove}><Trash2 /> Hapus</button>}
        <span className="pap-spacer" />
        {data.can.process && <button type="button" className="pap-btn" onClick={() => onEdit(c)}><Pencil /> Ubah data</button>}
        {data.can.process && !closed && <button type="button" className="pap-btn" onClick={() => setStatusTo('ditolak')}><XCircle /> Tolak</button>}
        {data.can.process && closed && <button type="button" className="pap-btn" onClick={() => setStatusTo('investigasi')}>Buka lagi</button>}
        {data.can.process && next && <button type="button" className="pap-primary-button" onClick={() => setStatusTo(next)}>{next === 'selesai' ? <CheckCircle2 /> : <ChevronRight />} {next === 'selesai' ? 'Tutup: selesai' : `Lanjut: ${STATUS[next]}`}</button>}
      </>}>
      <div className="pap-cc-detail">
        {error && <Notice onClose={() => setError('')}>{error}</Notice>}
        <div className="pap-cc-badges">
          <span className={`pap-status ${STATUS_TONE[c.status]}`}>{STATUS[c.status]}</span>
          <span className={`pap-cc-prio ${c.prioritas}`}>{PRIORITAS[c.prioritas as keyof typeof PRIORITAS]}</span>
          <span className="pap-cc-kat">{KATEGORI[c.kategori] ?? c.kategori}</span>
          {c.terlambat && <span className="pap-cc-late-badge"><AlertTriangle /> {due}</span>}
          {!c.terlambat && due && <span className="pap-muted pap-cc-due">{due}</span>}
        </div>

        {c.status !== 'ditolak' ? (
          <ol className="pap-cc-stepper" aria-label="Tahap penanganan">
            {FLOW.map((st, i) => {
              const d = stepDate(st)
              return (
                <li key={st} className={i < step ? 'done' : i === step ? 'current' : ''}>
                  <span className="pap-cc-dot">{i < step || (i === step && st === 'selesai') ? <CheckCircle2 /> : i + 1}</span>
                  <b>{STATUS[st]}</b>
                  <small>{i <= step && d ? formatDate(d, true) : STATUS_HINT[st]}</small>
                </li>
              )
            })}
          </ol>
        ) : <Notice>Keluhan ditolak / ditutup tanpa tindak lanjut. Lihat alasannya di riwayat.</Notice>}

        <div className="pap-cc-summary">
          <div><span>PIC</span><b>{c.pic_nama ?? '—'}</b><small>{c.pic_divisi ?? c.divisi_terkait ?? ''}</small></div>
          <div><span>Target selesai</span><b className={c.terlambat ? 'pap-cc-late' : ''}>{c.target_selesai ? formatDate(c.target_selesai) : '—'}</b><small>{closed ? (c.selesai_at ? `ditutup ${formatDate(c.selesai_at)}` : '') : `umur ${c.umur_hari} hari`}</small></div>
          <div><span>Solusi</span><b>{c.solusi ? SOLUSI[c.solusi as keyof typeof SOLUSI] : '—'}</b><small>{c.nilai_kompensasi ? formatRupiah(c.nilai_kompensasi) : ''}</small></div>
          <div><span>Kepuasan</span><b>{c.kepuasan ? <Stars value={c.kepuasan} /> : '—'}</b><small>{c.pelapor_nama ? `dicatat ${c.pelapor_nama}` : ''}</small></div>
        </div>

        <div className="pap-segmented pap-page-tabs" role="tablist" aria-label="Detail keluhan">
          <button role="tab" aria-selected={tab === 'tracking'} className={tab === 'tracking' ? 'active' : ''} onClick={() => setTab('tracking')}>Tracking ({data.updates.length})</button>
          <button role="tab" aria-selected={tab === 'penanganan'} className={tab === 'penanganan' ? 'active' : ''} onClick={() => setTab('penanganan')}>Penanganan</button>
          <button role="tab" aria-selected={tab === 'info'} className={tab === 'info' ? 'active' : ''} onClick={() => setTab('info')}>Detail & lampiran{c.lampiran ? ` (${c.lampiran})` : ''}</button>
        </div>

        {tab === 'tracking' && <Timeline complaint={c} updates={data.updates} onAdded={() => refresh()} />}
        {tab === 'penanganan' && <HandlingForm complaint={c} canEdit={data.can.process} onSaved={(msg) => refresh(msg)} />}
        {tab === 'info' && (
          <div className="pap-cc-info">
            <dl className="pap-cc-dl">
              <div><dt>Customer</dt><dd>{c.customer_nama}{c.customer_no ? ` (${c.customer_no})` : ''}</dd></div>
              <div><dt>Kontak</dt><dd>{c.kontak ?? '—'}</dd></div>
              <div><dt>Diterima lewat</dt><dd>{CHANNEL[c.channel as keyof typeof CHANNEL] ?? c.channel}</dd></div>
              <div><dt>Produk</dt><dd>{c.produk ?? '—'}</dd></div>
              <div><dt>Referensi</dt><dd>{c.referensi ?? '—'}</dd></div>
              <div><dt>Jumlah terdampak</dt><dd>{c.qty_terdampak !== null ? `${c.qty_terdampak.toLocaleString('id-ID')} ${c.satuan ?? ''}` : '—'}</dd></div>
            </dl>
            <div className="pap-cc-desc"><span>Kronologi / detail keluhan</span><p>{c.deskripsi}</p></div>
            <AttachmentPanel title="Foto / video / dokumen bukti" basePath={`/api/notes/complaint/${c.id}/attachments`} fileBase="/api/notes/attachments" canAdd={data.can.process} currentUserId={user.id} isAdmin={user.role.isAdmin} allowVideo />
          </div>
        )}
      </div>
      {statusTo && <StatusDialog complaint={c} to={statusTo} onClose={() => setStatusTo(null)} onDone={(msg) => { setStatusTo(null); refresh(msg); if (statusTo !== 'ditolak' && statusTo !== 'selesai') setTab('tracking') }}
        onNeedHandling={() => { setStatusTo(null); setTab('penanganan') }} />}
    </Modal>
  )
}

function Stars({ value }: { value: number }) {
  return <span className="pap-cc-stars" aria-label={`${value} dari 5`}>{[1, 2, 3, 4, 5].map((i) => <Star key={i} className={i <= value ? 'on' : ''} />)}</span>
}

const UPDATE_ICON: Record<string, typeof MessageSquare> = { komentar: MessageSquare, status: ChevronRight, tindakan: Wrench, sistem: ShieldCheck }

function Timeline({ complaint: c, updates, onAdded }: { complaint: Complaint; updates: Update[]; onAdded: () => void }) {
  const [pesan, setPesan] = useState('')
  const [jenis, setJenis] = useState<'komentar' | 'tindakan'>('komentar')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function send(e: React.FormEvent) {
    e.preventDefault()
    if (!pesan.trim()) return
    setBusy(true)
    try {
      await api(`/api/complaints/${c.id}/updates`, { method: 'POST', json: { pesan, jenis } })
      setPesan('')
      onAdded()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="pap-cc-timeline-wrap">
      <ol className="pap-cc-timeline">
        {[...updates].reverse().map((u) => {
          const Icon = UPDATE_ICON[u.jenis] ?? MessageSquare
          return (
            <li key={u.id} className={u.jenis}>
              <span className={`pap-cc-tl-icon ${u.jenis} ${u.status_ke ?? ''}`}><Icon /></span>
              <div>
                <div className="pap-cc-tl-head"><b>{u.user_nama ?? 'Sistem'}</b><span>{u.jenis === 'status' ? 'mengubah status' : u.jenis === 'tindakan' ? 'mencatat tindakan' : u.jenis === 'sistem' ? '' : 'menulis'}</span><time>{formatDate(u.created_at, true)}</time></div>
                {u.jenis === 'status' && u.status_ke && <span className={`pap-status ${STATUS_TONE[u.status_ke as Status] ?? 'info'}`}>{STATUS[u.status_ke as Status] ?? u.status_ke}</span>}
                <p>{u.pesan}</p>
              </div>
            </li>
          )
        })}
      </ol>
      <form className="pap-cc-comment" onSubmit={send}>
        {error && <Notice onClose={() => setError('')}>{error}</Notice>}
        <div className="pap-segmented" role="radiogroup" aria-label="Jenis catatan">
          <button type="button" role="radio" aria-checked={jenis === 'komentar'} className={jenis === 'komentar' ? 'active' : ''} onClick={() => setJenis('komentar')}>Komentar</button>
          <button type="button" role="radio" aria-checked={jenis === 'tindakan'} className={jenis === 'tindakan' ? 'active' : ''} onClick={() => setJenis('tindakan')}>Progres tindakan</button>
        </div>
        <div className="pap-cc-comment-row">
          <textarea className="pap-input" rows={2} maxLength={5000} value={pesan} onChange={(e) => setPesan(e.target.value)} placeholder={jenis === 'tindakan' ? 'mis. Sampel retur sudah diterima QC, cek sealing mesin bag making 2...' : 'Tulis catatan / update untuk tim...'} />
          <button className="pap-primary-button" disabled={busy || !pesan.trim()} aria-label="Kirim"><Send /></button>
        </div>
      </form>
    </div>
  )
}

function HandlingForm({ complaint: c, canEdit, onSaved }: { complaint: Complaint; canEdit: boolean; onSaved: (msg: string) => void }) {
  const [v, setV] = useState({
    akar_masalah: c.akar_masalah ?? '', tindakan_perbaikan: c.tindakan_perbaikan ?? '', tindakan_pencegahan: c.tindakan_pencegahan ?? '',
    solusi: c.solusi ?? '', solusi_detail: c.solusi_detail ?? '', nilai_kompensasi: c.nilai_kompensasi !== null ? String(c.nilai_kompensasi) : '',
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV({ ...v, [k]: e.target.value })
  const dirty = JSON.stringify(v) !== JSON.stringify({
    akar_masalah: c.akar_masalah ?? '', tindakan_perbaikan: c.tindakan_perbaikan ?? '', tindakan_pencegahan: c.tindakan_pencegahan ?? '',
    solusi: c.solusi ?? '', solusi_detail: c.solusi_detail ?? '', nilai_kompensasi: c.nilai_kompensasi !== null ? String(c.nilai_kompensasi) : '',
  })
  async function save(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await api(`/api/complaints/${c.id}`, { method: 'PATCH', json: { action: 'handling', ...v, nilai_kompensasi: v.nilai_kompensasi === '' ? null : Number(v.nilai_kompensasi.replace(/\./g, '').replace(',', '.')) } })
      onSaved('Penanganan disimpan.')
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <form className="pap-cc-handling" onSubmit={save}>
      {error && <Notice onClose={() => setError('')}>{error}</Notice>}
      <p className="pap-muted pap-cc-capa">Isi berurutan: <b>akar masalah</b> → <b>tindakan perbaikan</b> (untuk keluhan ini) → <b>tindakan pencegahan</b> (agar tidak terulang) → <b>solusi ke customer</b>. Akar masalah / tindakan dan solusi wajib sebelum keluhan dikonfirmasi atau ditutup.</p>
      <div className="pap-form-grid">
        <Field label="1. Akar masalah" full><textarea className="pap-input" rows={3} maxLength={10000} value={v.akar_masalah} onChange={set('akar_masalah')} disabled={!canEdit} placeholder="mis. Suhu sealing mesin bag making 2 kurang, pisau tumpul (5W/why-why)" /></Field>
        <Field label="2. Tindakan perbaikan" full><textarea className="pap-input" rows={3} maxLength={10000} value={v.tindakan_perbaikan} onChange={set('tindakan_perbaikan')} disabled={!canEdit} placeholder="mis. Sortir ulang stok, produksi ulang 300 kg, setting ulang suhu sealing" /></Field>
        <Field label="3. Tindakan pencegahan" full><textarea className="pap-input" rows={2} maxLength={10000} value={v.tindakan_pencegahan} onChange={set('tindakan_pencegahan')} disabled={!canEdit} placeholder="mis. Cek suhu sealing tiap awal shift, tambah tes tarik di QC" /></Field>
        <Field label="4. Solusi ke customer"><select className="pap-select" value={v.solusi} onChange={set('solusi')} disabled={!canEdit}><option value="">— Pilih solusi —</option>{Object.entries(SOLUSI).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        <Field label="Nilai kompensasi / biaya (Rp)"><input className="pap-input" inputMode="decimal" value={v.nilai_kompensasi} onChange={(e) => setV({ ...v, nilai_kompensasi: e.target.value.replace(/[^\d.,]/g, '') })} disabled={!canEdit} placeholder="0" /></Field>
        <Field label="Detail solusi" full><input className="pap-input" maxLength={500} value={v.solusi_detail} onChange={set('solusi_detail')} disabled={!canEdit} placeholder="mis. Ganti 300 kg dikirim 25 Nov bersama order berikutnya" /></Field>
      </div>
      {canEdit && <div className="pap-inline-actions pap-cc-save"><button className="pap-primary-button" disabled={busy || !dirty}>{busy ? 'Menyimpan...' : 'Simpan penanganan'}</button></div>}
    </form>
  )
}

function StatusDialog({ complaint: c, to, onClose, onDone, onNeedHandling }: { complaint: Complaint; to: Status; onClose: () => void; onDone: (msg: string) => void; onNeedHandling: () => void }) {
  const [pesan, setPesan] = useState('')
  const [kepuasan, setKepuasan] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const needHandling = (to === 'konfirmasi' || to === 'selesai') && (!(c.akar_masalah || c.tindakan_perbaikan) || !c.solusi)
  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await api(`/api/complaints/${c.id}`, { method: 'PATCH', json: { action: 'status', status: to, pesan, kepuasan: kepuasan || null } })
      onDone(`Status ${c.nomor}: ${STATUS[to]}.`)
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
    }
  }
  const title = to === 'selesai' ? 'Tutup keluhan (selesai)' : to === 'ditolak' ? 'Tolak keluhan' : `Ubah status ke ${STATUS[to]}`
  return (
    <Modal title={title} subtitle={`${c.nomor} · ${c.customer_nama}`} onClose={onClose}
      footer={<><span className="pap-spacer" /><button type="button" className="pap-btn" onClick={onClose}>Batal</button>
        {needHandling ? <button type="button" className="pap-primary-button" onClick={onNeedHandling}>Isi penanganan dulu</button>
          : <button className={to === 'ditolak' ? 'pap-btn danger' : 'pap-primary-button'} form="pap-cc-status" disabled={busy}>{busy ? 'Menyimpan...' : to === 'ditolak' ? 'Tolak keluhan' : 'Simpan status'}</button>}</>}>
      <form id="pap-cc-status" className="pap-shift-form" onSubmit={submit}>
        {error && <Notice onClose={() => setError('')}>{error}</Notice>}
        <p className="pap-muted">{STATUS_HINT[to]}.</p>
        {needHandling ? <Notice>Sebelum {to === 'selesai' ? 'ditutup' : 'dikonfirmasi ke customer'}, isi dulu akar masalah / tindakan perbaikan dan solusi ke customer di tab Penanganan.</Notice> : <>
          {to === 'selesai' && (
            <div className="pap-field">
              <span>Kepuasan customer</span>
              <div className="pap-cc-rate" role="radiogroup" aria-label="Kepuasan customer">
                {[1, 2, 3, 4, 5].map((i) => <button type="button" key={i} role="radio" aria-checked={kepuasan === i} aria-label={`${i} dari 5`} className={i <= kepuasan ? 'on' : ''} onClick={() => setKepuasan(kepuasan === i ? 0 : i)}><Star /></button>)}
                <small className="pap-muted">{kepuasan ? ['', 'Sangat tidak puas', 'Kurang puas', 'Cukup', 'Puas', 'Sangat puas'][kepuasan] : 'opsional'}</small>
              </div>
            </div>
          )}
          <label className="pap-field"><span>{to === 'ditolak' ? 'Alasan ditolak *' : to === 'selesai' ? 'Catatan penutupan' : 'Catatan (opsional)'}</span>
            <textarea className="pap-input" rows={3} maxLength={5000} required={to === 'ditolak'} value={pesan} onChange={(e) => setPesan(e.target.value)}
              placeholder={to === 'selesai' ? 'mis. Barang pengganti diterima, customer konfirmasi OK via WA' : to === 'ditolak' ? 'mis. Kerusakan akibat penyimpanan di gudang customer' : 'mis. Sampel retur dikirim ke QC'} />
          </label>
        </>}
      </form>
    </Modal>
  )
}
