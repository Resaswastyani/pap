'use client'

import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, CalendarClock, CalendarDays, CheckCircle2, History, Pencil, Plus, Power, Search, Trash2, Wallet, Wrench } from 'lucide-react'
import type { UserProfile } from '@/lib/users'
import { formatRupiah } from './accurate'
import { ItemDetail, type Person } from './inventaris-page'
import { api, confirmDialog, Field, formatDate, Modal, Notice, Pager, usePaged } from './ui'

// Jadwal Service Inventaris: jadwal service berkala per barang inventaris dan pemantauannya.
// Service yang dicatat selesai masuk riwayat barang di menu Inventaris, dan jadwalnya maju sesuai interval.

type Status = 'terlambat' | 'segera' | 'terjadwal' | 'selesai'
export type Schedule = {
  id: number; item_id: number; nama: string; interval_bulan: number | null; jadwal: string; terakhir: string | null; vendor: string | null; perkiraan_biaya: number | null
  pic_id: number | null; pic: string | null; pic_lain: string | null; pengingat_hari: number; aktif: boolean; catatan: string | null
  item: { kode: string; nama: string; kategori: string | null; lokasi: string | null; nomor_seri: string | null; kondisi: string; status: string }
  jumlah_service: number; total_biaya: number; sisa_hari: number; status: Status
}
type Barang = { id: number; kode: string; nama: string; kategori: string | null; lokasi: string | null; nomor_seri: string | null }
type Riwayat = { id: number; item_id: number; schedule_id: number | null; tanggal: string; keterangan: string | null; biaya: number | null; vendor: string | null; created_name: string; item_kode: string; item_nama: string; schedule_nama: string | null; jenis: 'service' | 'perbaikan' }
type Summary = { aktif: number; terlambat: number; segera: number; bulan_ini: number; perkiraan_bulan_ini: number; biaya_tahun_ini: number }
type Data = { items: Schedule[]; riwayat: Riwayat[]; summary: Summary; barang: Barang[]; users: Person[]; can: { manage: boolean } }

export const SERVICE_TONE: Record<Status, string> = { terlambat: 'danger', segera: 'warning', terjadwal: 'info', selesai: 'neutral' }
const STATUS_LABEL: Record<Status, string> = { terlambat: 'Terlambat', segera: 'Segera', terjadwal: 'Terjadwal', selesai: 'Selesai / nonaktif' }
const JENIS_SARAN = ['Cuci AC', 'Isi freon AC', 'Servis berkala', 'Ganti oli', 'Tune up', 'Ganti ban', 'Ganti filter', 'Kalibrasi', 'Pembersihan', 'Cek aki']
const INTERVAL = [1, 2, 3, 4, 6, 12, 24]
const today = () => new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10)
const addMonths = (iso: string, months: number) => {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1 + months, 1))
  t.setUTCDate(Math.min(d, new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate()))
  return t.toISOString().slice(0, 10)
}
const intervalText = (n: number | null) => (n ? (n % 12 === 0 ? `Tiap ${n / 12} tahun` : `Tiap ${n} bulan`) : 'Sekali')
export function StatusBadge({ s }: { s: Schedule }) {
  const text = s.status === 'terlambat' ? `lewat ${-s.sisa_hari} hari` : s.status === 'segera' ? (s.sisa_hari === 0 ? 'hari ini' : `${s.sisa_hari} hari lagi`) : s.status === 'selesai' ? (s.aktif ? 'barang dihapuskan' : 'selesai') : `${s.sisa_hari} hari lagi`
  return <span className={`pap-status ${SERVICE_TONE[s.status]}`}>{text}</span>
}

export function ServicePage({ focusId }: { user: UserProfile; focusId?: number | null }) {
  const [data, setData] = useState<Data | null>(null)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [tab, setTab] = useState<'jadwal' | 'riwayat'>('jadwal')
  const [tahun, setTahun] = useState(() => Number(today().slice(0, 4)))
  const [q, setQ] = useState('')
  const [status, setStatus] = useState<'' | Status | 'bulan_ini'>('')
  const [form, setForm] = useState<Schedule | 'new' | null>(null)
  const [done, setDone] = useState<Schedule | null>(null)
  const [detail, setDetail] = useState<number | null>(null)
  const load = useCallback(async () => {
    try {
      setData(await api<Data>(`/api/ga/service?tahun=${tahun}`))
      setError('')
    } catch (e) {
      setError((e as Error).message)
    }
  }, [tahun])
  useEffect(() => { load() }, [load])
  // Dari notifikasi / tautan: buka detail barang dari jadwal itu
  useEffect(() => {
    if (!focusId || !data) return
    const s = data.items.find((x) => x.id === focusId)
    if (s) setDetail(s.item_id)
  }, [focusId, data])
  const flash = (text: string) => {
    setMessage(text)
    setTimeout(() => setMessage(''), 6000)
    load()
  }
  async function remove(s: Schedule) {
    if (!(await confirmDialog(`Hapus jadwal "${s.nama}" untuk ${s.item.nama}? Riwayat service yang sudah dicatat tetap ada di barangnya.`))) return
    try {
      await api(`/api/ga/service/${s.id}`, { method: 'DELETE' })
      flash('Jadwal service dihapus.')
    } catch (e) {
      setError((e as Error).message)
    }
  }
  async function toggle(s: Schedule) {
    try {
      await api(`/api/ga/service/${s.id}`, { method: 'PATCH', json: { aktif: !s.aktif } })
      flash(s.aktif ? 'Jadwal service dihentikan.' : 'Jadwal service diaktifkan kembali.')
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const manage = !!data?.can.manage
  const sm = data?.summary
  const bulan = today().slice(0, 7)
  const term = q.trim().toLowerCase()
  const rows = (data?.items ?? []).filter((s) =>
    (status === '' ? s.status !== 'selesai' : status === 'bulan_ini' ? s.status !== 'selesai' && s.jadwal.startsWith(bulan) : s.status === status)
    && (!term || `${s.nama} ${s.item.nama} ${s.item.kode} ${s.item.lokasi ?? ''} ${s.vendor ?? ''} ${s.pic ?? ''} ${s.item.nomor_seri ?? ''}`.toLowerCase().includes(term)))
  const riwayat = (data?.riwayat ?? []).filter((r) => !term || `${r.item_nama} ${r.item_kode} ${r.keterangan ?? ''} ${r.vendor ?? ''}`.toLowerCase().includes(term))
  const paged = usePaged(rows, `${status}-${q}`)
  const pagedR = usePaged(riwayat, `r-${tahun}-${q}`)
  const pick = (s: typeof status) => { setTab('jadwal'); setStatus((v) => (v === s ? '' : s)) }
  const tiles = sm ? [
    { key: 'terlambat' as const, label: 'Terlambat', value: sm.terlambat, note: 'lewat dari jadwal service', icon: AlertTriangle, tone: sm.terlambat ? 'stat-2' : 'stat-0' },
    { key: 'segera' as const, label: 'Segera', value: sm.segera, note: 'masuk masa pengingat', icon: CalendarClock, tone: sm.segera ? 'stat-2' : 'stat-0' },
    { key: 'bulan_ini' as const, label: 'Jadwal bulan ini', value: sm.bulan_ini, note: sm.perkiraan_bulan_ini ? `perkiraan ${formatRupiah(sm.perkiraan_bulan_ini)} (termasuk yang terlambat)` : `${sm.aktif} jadwal aktif`, icon: CalendarDays, tone: 'stat-1' },
  ] : []

  return (
    <>
      <div className="pap-page-heading">
        <div>
          <p className="pap-eyebrow">GENERAL AFFAIR</p>
          <h1>Jadwal Service Inventaris</h1>
          <span>Atur jadwal service berkala barang inventaris (AC, kendaraan, genset, peralatan, ...) dan pantau yang terlambat atau segera jatuh tempo. Service yang dicatat selesai masuk riwayat barang di menu Inventaris, dan jadwal berikutnya dihitung otomatis.</span>
        </div>
        {manage && <button className="pap-primary-button" onClick={() => setForm('new')}><Plus /> Tambah jadwal</button>}
      </div>
      {message && <Notice kind="success" onClose={() => setMessage('')}>{message}</Notice>}
      {error && <Notice onClose={() => setError('')}>{error}</Notice>}
      {sm && (
        <div className="pap-stat-grid four">
          {tiles.map((t) => (
            <button key={t.key} className={`pap-stat-card pap-stat-button ${status === t.key && tab === 'jadwal' ? 'active' : ''}`} onClick={() => pick(t.key)}>
              <div><span>{t.label}</span><strong>{t.value}</strong><small className="neutral">{t.note}</small></div>
              <div className={`pap-stat-icon ${t.tone}`}><t.icon /></div>
            </button>
          ))}
          <button className={`pap-stat-card pap-stat-button ${tab === 'riwayat' ? 'active' : ''}`} onClick={() => { setTab('riwayat'); setTahun(Number(today().slice(0, 4))) }}>
            <div><span>Biaya service {today().slice(0, 4)}</span><strong className="pap-stat-text">{formatRupiah(sm.biaya_tahun_ini)}</strong><small className="neutral">service & perbaikan inventaris</small></div>
            <div className="pap-stat-icon stat-3"><Wallet /></div>
          </button>
        </div>
      )}
      <div className="pap-segmented pap-page-tabs" role="tablist" aria-label="Jadwal service">
        <button role="tab" aria-selected={tab === 'jadwal'} className={tab === 'jadwal' ? 'active' : ''} onClick={() => setTab('jadwal')}><CalendarClock /> Jadwal</button>
        <button role="tab" aria-selected={tab === 'riwayat'} className={tab === 'riwayat' ? 'active' : ''} onClick={() => setTab('riwayat')}><History /> Riwayat service</button>
      </div>
      <div className="pap-table-card">
        <div className="pap-filters pap-filters-top">
          <label className="pap-filter-search"><Search /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari barang, jenis service, lokasi, vendor, PIC..." /></label>
          {tab === 'jadwal' ? (
            <select className="pap-select" value={status} onChange={(e) => setStatus(e.target.value as typeof status)} aria-label="Filter status">
              <option value="">Semua jadwal aktif</option>
              <option value="terlambat">Terlambat</option>
              <option value="segera">Segera</option>
              <option value="bulan_ini">Jadwal bulan ini</option>
              <option value="terjadwal">Terjadwal</option>
              <option value="selesai">Selesai / nonaktif</option>
            </select>
          ) : (
            <select className="pap-select" value={tahun} onChange={(e) => setTahun(Number(e.target.value))} aria-label="Tahun riwayat">
              {Array.from({ length: 6 }, (_, i) => Number(today().slice(0, 4)) - i).map((y) => <option key={y} value={y}>Tahun {y}</option>)}
            </select>
          )}
        </div>
        <div className="pap-table-wrap">
          {tab === 'jadwal' ? (
            <table>
              <thead><tr><th>Barang</th><th>Service</th><th>Jadwal berikutnya</th><th>Terakhir</th><th className="pap-num">Perkiraan biaya</th>{manage && <th>Aksi</th>}</tr></thead>
              <tbody>
                {paged.items.map((s) => (
                  <tr key={s.id} className="pap-row-link" onClick={() => setDetail(s.item_id)}>
                    <td><div className="pap-cell-title">{s.item.nama}</div><div className="pap-cell-sub">{[s.item.kode, s.item.kategori, s.item.lokasi, s.item.nomor_seri].filter(Boolean).join(' · ')}</div></td>
                    <td><div className="pap-cell-title">{s.nama}</div><div className="pap-cell-sub">{[intervalText(s.interval_bulan), s.vendor, s.pic && `PIC ${s.pic}`].filter(Boolean).join(' · ')}</div>{s.catatan && <div className="pap-cell-sub">{s.catatan}</div>}</td>
                    <td className="pap-nowrap">{s.aktif ? formatDate(s.jadwal) : '—'}<div><StatusBadge s={s} /></div></td>
                    <td><span className="pap-nowrap">{s.terakhir ? formatDate(s.terakhir) : <span className="pap-muted">Belum ada</span>}</span><div className="pap-cell-sub">{s.jumlah_service}× service{s.total_biaya ? ` · ${formatRupiah(s.total_biaya)}` : ''}</div></td>
                    <td className="pap-num pap-nowrap">{s.perkiraan_biaya !== null ? formatRupiah(s.perkiraan_biaya) : '—'}</td>
                    {manage && <td className="pap-nowrap" onClick={(e) => e.stopPropagation()}>
                      <div className="pap-inline-actions">
                        {manage && s.aktif && s.item.status === 'aktif' && <button className="pap-btn" onClick={() => setDone(s)}><CheckCircle2 /> Selesai</button>}
                        {manage && !s.aktif && s.item.status === 'aktif' && <button className="pap-btn" onClick={() => toggle(s)}><Power /> Aktifkan</button>}
                        {manage && <button className="pap-icon-button" title="Ubah jadwal" aria-label={`Ubah jadwal ${s.nama}`} onClick={() => setForm(s)}><Pencil /></button>}
                        {manage && <button className="pap-icon-button" title="Hapus jadwal" aria-label={`Hapus jadwal ${s.nama}`} onClick={() => remove(s)}><Trash2 /></button>}
                      </div>
                    </td>}
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <table>
              <thead><tr><th>Tanggal</th><th>Barang</th><th>Service / perbaikan</th><th>Vendor</th><th className="pap-num">Biaya</th></tr></thead>
              <tbody>
                {pagedR.items.map((r) => (
                  <tr key={r.id} className="pap-row-link" onClick={() => setDetail(r.item_id)}>
                    <td className="pap-nowrap">{formatDate(r.tanggal)}</td>
                    <td><div className="pap-cell-title">{r.item_nama}</div><div className="pap-cell-sub">{r.item_kode}</div></td>
                    <td><span className={`pap-status ${r.jenis === 'service' ? 'success' : 'warning'}`}>{r.jenis === 'service' ? 'Service' : 'Perbaikan'}</span> {r.keterangan}<div className="pap-cell-sub">Dicatat {r.created_name}</div></td>
                    <td>{r.vendor ?? '—'}</td>
                    <td className="pap-num pap-nowrap">{r.biaya !== null ? formatRupiah(r.biaya) : '—'}</td>
                  </tr>
                ))}
                {riwayat.length > 0 && (
                  <tr className="pap-total-row"><td colSpan={4}><b>Total {riwayat.length} service & perbaikan {tahun}</b></td><td className="pap-num pap-nowrap"><b>{formatRupiah(riwayat.reduce((n, r) => n + (r.biaya ?? 0), 0))}</b></td></tr>
                )}
              </tbody>
            </table>
          )}
          {data && tab === 'jadwal' && !rows.length && <div className="pap-empty">{term || status ? 'Tidak ada jadwal yang cocok dengan filter.' : `Belum ada jadwal service.${manage ? ' Klik "Tambah jadwal" untuk mulai menjadwalkan service inventaris.' : ''}`}</div>}
          {data && tab === 'riwayat' && !riwayat.length && <div className="pap-empty">Belum ada service atau perbaikan inventaris yang dicatat pada {tahun}.</div>}
          {!data && !error && <div className="pap-empty">Memuat jadwal service...</div>}
        </div>
        {tab === 'jadwal' ? <Pager {...paged.pager} noun="jadwal" /> : <Pager {...pagedR.pager} noun="catatan" />}
      </div>
      {form && data && <ServiceForm initial={form === 'new' ? null : form} items={data.barang} people={data.users} onClose={() => setForm(null)} onSaved={(t) => { setForm(null); flash(t) }} />}
      {done && <ServiceDoneForm schedule={done} onClose={() => setDone(null)} onSaved={(t) => { setDone(null); flash(t) }} />}
      {detail && <ItemDetail id={detail} onClose={() => setDetail(null)} onChanged={(t) => flash(t)} />}
    </>
  )
}

// Tambah / ubah jadwal service. fixedItemId = dibuka dari detail barang (barang tidak bisa diganti).
export function ServiceForm({ initial, items, people, fixedItemId, onClose, onSaved }: { initial: Schedule | null; items: Barang[]; people: Person[]; fixedItemId?: number; onClose: () => void; onSaved: (text: string) => void }) {
  const [v, setV] = useState({
    item_id: String(initial?.item_id ?? fixedItemId ?? ''), nama: initial?.nama ?? '', interval_bulan: initial ? (initial.interval_bulan ? String(initial.interval_bulan) : '') : '3',
    jadwal: initial?.jadwal ?? '', vendor: initial?.vendor ?? '', perkiraan_biaya: initial?.perkiraan_biaya !== null && initial?.perkiraan_biaya !== undefined ? String(initial.perkiraan_biaya) : '',
    pic_id: initial?.pic_id ? String(initial.pic_id) : '', pic_lain: initial?.pic_lain ?? '', pengingat_hari: String(initial?.pengingat_hari ?? 7), catatan: initial?.catatan ?? '',
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV((x) => ({ ...x, [k]: e.target.value }))
  const custom = v.interval_bulan !== '' && !INTERVAL.includes(Number(v.interval_bulan))
  const groups = [...new Set(items.map((i) => i.kategori ?? 'Tanpa kategori'))]
  async function save(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await api(initial ? `/api/ga/service/${initial.id}` : '/api/ga/service', { method: initial ? 'PATCH' : 'POST', json: v })
      onSaved(initial ? 'Jadwal service diperbarui.' : 'Jadwal service ditambahkan.')
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal title={initial ? 'Ubah jadwal service' : 'Tambah jadwal service'} wide onClose={onClose}
      footer={<><span className="pap-spacer" /><button className="pap-btn" onClick={onClose}>Batal</button><button className="pap-primary-button" form="service-form" disabled={busy}>{busy ? 'Menyimpan...' : 'Simpan'}</button></>}>
      <form id="service-form" className="pap-form-grid" onSubmit={save}>
        {error && <div className="full"><Notice onClose={() => setError('')}>{error}</Notice></div>}
        <Field label="Barang inventaris" full>
          <select className="pap-select" required value={v.item_id} onChange={set('item_id')} disabled={!!fixedItemId}>
            <option value="">Pilih barang...</option>
            {groups.map((g) => (
              <optgroup key={g} label={g}>
                {items.filter((i) => (i.kategori ?? 'Tanpa kategori') === g).map((i) => <option key={i.id} value={i.id}>{i.nama} · {[i.kode, i.nomor_seri, i.lokasi].filter(Boolean).join(' · ')}</option>)}
              </optgroup>
            ))}
          </select>
        </Field>
        <Field label="Jenis service"><input className="pap-input" required maxLength={200} list="pap-svc-jenis" value={v.nama} onChange={set('nama')} placeholder="Mis. Cuci AC, Ganti oli" /></Field>
        <datalist id="pap-svc-jenis">{JENIS_SARAN.map((j) => <option key={j} value={j} />)}</datalist>
        <Field label="Interval" hint={v.interval_bulan ? 'Setelah dicatat selesai, jadwal berikutnya dihitung otomatis' : 'Jadwal selesai setelah service dicatat'}>
          <div className="pap-inline-actions">
            <select className="pap-select" value={custom ? 'lain' : v.interval_bulan} onChange={(e) => setV((x) => ({ ...x, interval_bulan: e.target.value === 'lain' ? '5' : e.target.value }))}>
              <option value="">Sekali saja</option>
              {INTERVAL.map((n) => <option key={n} value={n}>{intervalText(n)}</option>)}
              <option value="lain">Lainnya...</option>
            </select>
            {custom && <input className="pap-input" type="number" min={1} max={120} value={v.interval_bulan} onChange={set('interval_bulan')} aria-label="Interval (bulan)" style={{ width: 90 }} />}
          </div>
        </Field>
        <Field label={initial?.terakhir ? 'Jadwal berikutnya' : 'Jadwal service'}><input className="pap-input" type="date" required value={v.jadwal} onChange={set('jadwal')} /></Field>
        <Field label="Ingatkan (hari sebelum)" hint="Masuk status 'Segera' mulai H-n"><input className="pap-input" type="number" min={0} max={365} value={v.pengingat_hari} onChange={set('pengingat_hari')} /></Field>
        <Field label="Vendor / bengkel (opsional)"><input className="pap-input" maxLength={150} value={v.vendor} onChange={set('vendor')} placeholder="Mis. CV Sejuk Teknik" /></Field>
        <Field label="Perkiraan biaya (Rp, opsional)"><input className="pap-input" type="number" min={0} step={1} inputMode="numeric" value={v.perkiraan_biaya} onChange={set('perkiraan_biaya')} /></Field>
        <Field label="PIC">
          <select className="pap-select" value={v.pic_id} onChange={set('pic_id')}>
            <option value="">— Bukan user SIMPAP / belum ada —</option>
            {people.map((p) => <option key={p.id} value={p.id}>{p.name} · {p.division_name}</option>)}
          </select>
        </Field>
        {!v.pic_id && <Field label="Nama PIC lain (opsional)"><input className="pap-input" maxLength={150} value={v.pic_lain} onChange={set('pic_lain')} placeholder="Mis. Driver, Teknisi vendor" /></Field>}
        <Field label="Catatan (opsional)" full><textarea className="pap-input" rows={2} maxLength={5000} value={v.catatan} onChange={set('catatan')} placeholder="Mis. sekalian cek kebocoran, bawa ke bengkel resmi" /></Field>
      </form>
    </Modal>
  )
}

// Catat service selesai -> riwayat barang + jadwal berikutnya
export function ServiceDoneForm({ schedule: s, onClose, onSaved }: { schedule: Schedule; onClose: () => void; onSaved: (text: string) => void }) {
  const [v, setV] = useState({ tanggal: today(), vendor: s.vendor ?? '', biaya: s.perkiraan_biaya !== null ? String(s.perkiraan_biaya) : '', keterangan: '', kondisi: '', jadwal_berikutnya: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV((x) => ({ ...x, [k]: e.target.value }))
  const auto = s.interval_bulan && v.tanggal ? addMonths(v.tanggal, s.interval_bulan) : null
  async function save(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const res = await api<{ next: string | null }>(`/api/ga/service/${s.id}/selesai`, { method: 'POST', json: v })
      onSaved(`Service ${s.nama} ${s.item.nama} dicatat.${res.next ? ` Jadwal berikutnya ${formatDate(res.next)}.` : ' Jadwal ini selesai.'}`)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal title="Catat service selesai" subtitle={`${s.nama} · ${s.item.nama} (${s.item.kode})`} onClose={onClose}
      footer={<><span className="pap-spacer" /><button className="pap-btn" onClick={onClose}>Batal</button><button className="pap-primary-button" form="service-done" disabled={busy}><Wrench /> {busy ? 'Menyimpan...' : 'Simpan'}</button></>}>
      <form id="service-done" className="pap-form-grid" onSubmit={save}>
        {error && <div className="full"><Notice onClose={() => setError('')}>{error}</Notice></div>}
        <Field label="Tanggal service"><input className="pap-input" type="date" required max={today()} value={v.tanggal} onChange={set('tanggal')} /></Field>
        <Field label="Biaya (Rp)"><input className="pap-input" type="number" min={0} step={1} inputMode="numeric" value={v.biaya} onChange={set('biaya')} /></Field>
        <Field label="Vendor / bengkel"><input className="pap-input" maxLength={150} value={v.vendor} onChange={set('vendor')} /></Field>
        <Field label="Kondisi barang setelahnya">
          <select className="pap-select" value={v.kondisi} onChange={set('kondisi')}>
            <option value="">Tidak berubah</option>
            <option value="baik">Baik</option>
            <option value="perlu_perbaikan">Perlu perbaikan</option>
            <option value="rusak">Rusak</option>
          </select>
        </Field>
        <Field label="Yang dikerjakan (opsional)" full><textarea className="pap-input" rows={2} maxLength={5000} value={v.keterangan} onChange={set('keterangan')} placeholder="Mis. cuci indoor & outdoor, tambah freon 20 psi" /></Field>
        <Field label="Jadwal berikutnya" full hint={s.interval_bulan ? `Kosongkan untuk otomatis: ${intervalText(s.interval_bulan).toLowerCase()} → ${auto ? formatDate(auto) : '—'}` : 'Jadwal ini sekali saja; isi tanggal bila perlu service lagi'}>
          <input className="pap-input" type="date" min={v.tanggal} value={v.jadwal_berikutnya} onChange={set('jadwal_berikutnya')} />
        </Field>
      </form>
    </Modal>
  )
}
