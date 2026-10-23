'use client'

import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle2, Clock, PackageCheck, Pencil, Plus, Printer, RefreshCw, Search, Settings, Trash2, Truck } from 'lucide-react'
import type { UserProfile } from '@/lib/users'
import { formatNumber, formatRupiah } from './accurate'
import { api, Field, formatDate, Modal, Notice, Pager, RowActions, usePaged } from './ui'

// Inventory & Logistik: pengiriman order (surat jalan) & ekspedisi termurah per tujuan

type Status = 'packing' | 'siap_kirim' | 'dikirim' | 'diterima' | 'batal'
const STATUS: Record<Status, [string, string]> = { packing: ['Packing', 'warning'], siap_kirim: ['Siap kirim', 'info'], dikirim: ['Dikirim', 'info'], diterima: ['Diterima', 'success'], batal: ['Batal', 'neutral'] }
type Candidate = {
  id: number; number: string; tanggal: string; ship_date: string | null; status: string | null; total: number; customer_accurate_id: number | null; customer_name: string | null
  customer_no: string | null; baris: number; berat_kg: number | null; ekspedisi: string | null; tujuan: string | null; terlambat: boolean; hari_lewat: number
}
type Shipment = {
  id: number; nomor: string; status: Status; customer_name: string; customer_no: string | null; customer_accurate_id: number | null; alamat: string | null; telepon: string | null
  expedition_id: number | null; ekspedisi_nama: string | null; ekspedisi_telepon: string | null; no_resi: string | null; koli: number | null; berat_kg: number | null; tarif_per_kg: number | null
  ongkir: number | null; rencana_kirim: string | null; tanggal_kirim: string | null; target_tiba: string | null; tanggal_diterima: string | null; penerima: string | null; sopir: string | null
  catatan: string | null; so_numbers: string | null; baris: number; created_name: string | null; created_at: string; tepat_waktu: boolean | null; terlambat_tiba: boolean
}
type ShipRes = {
  items: Shipment[]; candidates: Candidate[]; toleransi_hari: number; mulai_pantau: string; can: { manage: boolean }
  stats: { perlu_kirim: number; terlambat_kirim: number; disiapkan: number; dalam_perjalanan: number; terlambat_tiba: number; diterima_30: number; tepat_waktu_pct: number | null }
}
type Route = { id: number; nama: string; tujuan: string; telepon: string | null; tarif_per_kg: number | null; minimal_kg: number | null; estimasi_hari: string | null }
const today = () => new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10)

export function ShipmentPage(_props: { user: UserProfile }) {
  const [tab, setTab] = useState<'kirim' | 'aktif' | 'selesai'>('kirim')
  const [q, setQ] = useState('')
  const [data, setData] = useState<ShipRes | null>(null)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [picked, setPicked] = useState<number[]>([])
  const [form, setForm] = useState<{ id: number | null; so: number[] } | null>(null)
  const [detail, setDetail] = useState<number | null>(null)
  const [settings, setSettings] = useState(false)
  const load = useCallback(() => {
    const status = tab === 'selesai' ? 'selesai' : 'aktif'
    api<ShipRes>(`/api/logistik/shipments?status=${status}${q.trim() ? `&q=${encodeURIComponent(q.trim())}` : ''}`).then((r) => { setData(r); setError('') }).catch((e) => setError(e.message))
  }, [tab, q])
  useEffect(() => { const t = setTimeout(load, q ? 300 : 0); return () => clearTimeout(t) }, [load, q])
  const flash = (text: string) => { setMessage(text); setTimeout(() => setMessage(''), 6000); load() }
  const term = q.trim().toLowerCase()
  const candidates = (data?.candidates ?? []).filter((c) => !term || `${c.number} ${c.customer_name ?? ''} ${c.ekspedisi ?? ''} ${c.tujuan ?? ''}`.toLowerCase().includes(term))
  const pagedC = usePaged(candidates, `${q}`, 50)
  const pagedS = usePaged(data?.items ?? [], `${tab}-${q}`, 50)
  const pickedCust = new Set(candidates.filter((c) => picked.includes(c.id)).map((c) => c.customer_accurate_id))
  const s = data?.stats
  const toggle = (c: Candidate) => setPicked((list) => (list.includes(c.id) ? list.filter((x) => x !== c.id) : [...list, c.id]))

  return (
    <>
      <div className="pap-page-heading">
        <div>
          <p className="pap-eyebrow">INVENTORY & LOGISTIK</p>
          <h1>Pengiriman</h1>
          <span>Order yang sudah jadi dipacking dan dikirim: buat pengiriman dari SO Accurate, cetak surat jalan, catat ekspedisi & nomor resi, dan pantau ketepatan waktu kirim maupun tiba.</span>
        </div>
        <div className="pap-inline-actions pap-wrap">
          {data?.can.manage && <button className="pap-btn" onClick={() => setSettings(true)}><Settings /> Standar waktu kirim</button>}
          {data?.can.manage && <button className="pap-primary-button" onClick={() => setForm({ id: null, so: [] })}><Plus /> Pengiriman manual</button>}
        </div>
      </div>
      {message && <Notice kind="success" onClose={() => setMessage('')}>{message}</Notice>}
      {error && <Notice onClose={() => setError('')}>{error}</Notice>}
      <div className="pap-stat-grid four">
        <button className={`pap-stat-card pap-stat-button ${tab === 'kirim' ? 'active' : ''}`} onClick={() => setTab('kirim')}>
          <div><span>Perlu dikirim</span><strong className="pap-stat-text">{s?.perlu_kirim ?? '…'}</strong><small className={s?.terlambat_kirim ? 'pap-text-danger' : 'neutral'}>{s ? `${s.terlambat_kirim} lewat tanggal kirim SO` : ''}</small></div>
          <div className={`pap-stat-icon ${s?.terlambat_kirim ? 'stat-2' : 'stat-1'}`}><PackageCheck /></div>
        </button>
        <button className={`pap-stat-card pap-stat-button ${tab === 'aktif' ? 'active' : ''}`} onClick={() => setTab('aktif')}>
          <div><span>Disiapkan / dalam perjalanan</span><strong className="pap-stat-text">{s ? `${s.disiapkan} / ${s.dalam_perjalanan}` : '…'}</strong><small className="neutral">Packing, siap kirim, dikirim</small></div>
          <div className="pap-stat-icon stat-1"><Truck /></div>
        </button>
        <div className="pap-stat-card">
          <div><span>Terlambat tiba</span><strong className="pap-stat-text">{s?.terlambat_tiba ?? '…'}</strong><small className="neutral">Lewat target tiba, belum diterima</small></div>
          <div className={`pap-stat-icon ${s?.terlambat_tiba ? 'stat-2' : 'stat-0'}`}><AlertTriangle /></div>
        </div>
        <button className={`pap-stat-card pap-stat-button ${tab === 'selesai' ? 'active' : ''}`} onClick={() => setTab('selesai')}>
          <div><span>Tepat waktu (30 hari)</span><strong className="pap-stat-text">{s?.tepat_waktu_pct === null || !s ? '—' : `${s.tepat_waktu_pct}%`}</strong><small className="neutral">{s ? `${s.diterima_30} kiriman diterima` : ''}</small></div>
          <div className="pap-stat-icon stat-0"><CheckCircle2 /></div>
        </button>
      </div>

      <div className="pap-table-card">
        <div className="pap-card-head">
          <div className="pap-segmented" role="tablist">
            <button role="tab" aria-selected={tab === 'kirim'} className={tab === 'kirim' ? 'active' : ''} onClick={() => setTab('kirim')}><PackageCheck /> Perlu dikirim ({data?.candidates.length ?? 0})</button>
            <button role="tab" aria-selected={tab === 'aktif'} className={tab === 'aktif' ? 'active' : ''} onClick={() => setTab('aktif')}><Truck /> Berjalan</button>
            <button role="tab" aria-selected={tab === 'selesai'} className={tab === 'selesai' ? 'active' : ''} onClick={() => setTab('selesai')}><CheckCircle2 /> Selesai</button>
          </div>
          {tab === 'kirim' && data?.can.manage && <button className="pap-primary-button" disabled={!picked.length} onClick={() => setForm({ id: null, so: picked })}><Truck /> Buat pengiriman ({picked.length} SO)</button>}
        </div>
        <div className="pap-filters">
          <label className="pap-filter-search"><Search /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari SO, customer, ekspedisi, resi..." /></label>
          {tab === 'kirim' && data && <span className="pap-muted">SO dipantau sejak {formatDate(data.mulai_pantau)} · toleransi {data.toleransi_hari} hari dari tanggal kirim SO</span>}
        </div>
        <div className="pap-table-wrap">
          {tab === 'kirim' ? (
            <table>
              <thead><tr>{data?.can.manage && <th />}<th>SO</th><th>Customer</th><th>Tujuan / ekspedisi</th><th>Tanggal kirim</th><th className="pap-num">Berat</th><th>Status SO</th></tr></thead>
              <tbody>
                {pagedC.items.map((c) => {
                  const blocked = pickedCust.size > 0 && !pickedCust.has(c.customer_accurate_id) && !picked.includes(c.id)
                  return (
                    <tr key={c.id} className={data?.can.manage ? 'pap-row-link' : ''} onClick={() => data?.can.manage && !blocked && toggle(c)}>
                      {data?.can.manage && <td onClick={(e) => e.stopPropagation()}><input type="checkbox" className="pap-checkbox" checked={picked.includes(c.id)} disabled={blocked} title={blocked ? 'Satu pengiriman untuk satu customer' : ''} onChange={() => toggle(c)} aria-label={`Pilih ${c.number}`} /></td>}
                      <td className="pap-nowrap"><div className="pap-cell-title">{c.number}</div><div className="pap-cell-sub">{formatDate(c.tanggal)} · {c.baris} barang</div></td>
                      <td><div>{c.customer_name ?? '—'}</div><div className="pap-cell-sub">{c.customer_no}</div></td>
                      <td><div>{c.tujuan ?? '—'}</div><div className="pap-cell-sub">{c.ekspedisi ?? 'Ekspedisi belum tertulis di SO'}</div></td>
                      <td className="pap-nowrap">{formatDate(c.ship_date)}{c.terlambat && <div className="pap-cell-sub pap-text-danger">lewat {c.hari_lewat} hari</div>}</td>
                      <td className="pap-num pap-nowrap">{c.berat_kg ? `${formatNumber(c.berat_kg)} kg` : '—'}</td>
                      <td><span className={`pap-status ${c.status === 'Terproses' ? 'success' : 'warning'}`}>{c.status ?? '—'}</span></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          ) : (
            <table>
              <thead><tr><th>Surat jalan</th><th>Customer</th><th>Ekspedisi / resi</th><th>Kirim</th><th>Target tiba</th><th>Status</th><th className="pap-actions-col">Aksi</th></tr></thead>
              <tbody>
                {pagedS.items.map((x) => (
                  <tr key={x.id} className="pap-row-link" onClick={() => setDetail(x.id)}>
                    <td className="pap-nowrap"><div className="pap-cell-title">{x.nomor}</div><div className="pap-cell-sub">{x.so_numbers}</div></td>
                    <td>{x.customer_name}<div className="pap-cell-sub">{x.baris} barang{x.berat_kg ? ` · ${formatNumber(x.berat_kg)} kg` : ''}{x.koli ? ` · ${x.koli} koli` : ''}</div></td>
                    <td>{x.ekspedisi_nama ?? '—'}<div className="pap-cell-sub">{x.no_resi ? `Resi ${x.no_resi}` : ''}</div></td>
                    <td className="pap-nowrap">{formatDate(x.tanggal_kirim ?? x.rencana_kirim)}{!x.tanggal_kirim && x.rencana_kirim && <div className="pap-cell-sub">rencana</div>}</td>
                    <td className="pap-nowrap">{formatDate(x.target_tiba)}{x.terlambat_tiba && <div className="pap-cell-sub pap-text-danger">terlambat</div>}{x.tepat_waktu !== null && <div className={`pap-cell-sub ${x.tepat_waktu ? 'pap-text-success' : 'pap-text-danger'}`}>{x.tepat_waktu ? 'tepat waktu' : 'terlambat'}</div>}</td>
                    <td><span className={`pap-status ${STATUS[x.status][1]}`}>{STATUS[x.status][0]}</span></td>
                    <td className="pap-actions-cell"><RowActions label={x.nomor} onView={() => setDetail(x.id)} onEdit={data?.can.manage && !['diterima', 'batal'].includes(x.status) ? () => setForm({ id: x.id, so: [] }) : undefined} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {data && tab === 'kirim' && !candidates.length && <div className="pap-empty">Semua SO sudah masuk pengiriman.</div>}
          {data && tab !== 'kirim' && !data.items.length && <div className="pap-empty">{tab === 'aktif' ? 'Belum ada pengiriman yang berjalan.' : 'Belum ada pengiriman selesai.'}</div>}
          {!data && !error && <div className="pap-empty">Memuat...</div>}
          {tab === 'kirim' ? <Pager {...pagedC.pager} noun="SO" /> : <Pager {...pagedS.pager} noun="pengiriman" />}
        </div>
      </div>
      {form && <ShipmentForm id={form.id} so={form.so} onClose={() => setForm(null)} onSaved={(text, id) => { setForm(null); setPicked([]); flash(text); setTab('aktif'); setDetail(id) }} />}
      {detail && <ShipmentDetail id={detail} onClose={() => setDetail(null)} onEdit={(id) => { setDetail(null); setForm({ id, so: [] }) }} onChanged={(t) => { flash(t) }} />}
      {settings && data && <SettingsForm toleransi={data.toleransi_hari} mulai={data.mulai_pantau} onClose={() => setSettings(false)} onSaved={() => { setSettings(false); flash('Standar waktu kirim disimpan.') }} />}
    </>
  )
}

function SettingsForm({ toleransi, mulai, onClose, onSaved }: { toleransi: number; mulai: string; onClose: () => void; onSaved: () => void }) {
  const [v, setV] = useState({ hari: String(toleransi), mulai })
  const [error, setError] = useState('')
  async function save(e: React.FormEvent) {
    e.preventDefault()
    try {
      await api('/api/logistik/shipments', { method: 'POST', json: { action: 'pengaturan', hari: Number(v.hari), mulai: v.mulai } })
      onSaved()
    } catch (err) {
      setError((err as Error).message)
    }
  }
  return (
    <Modal title="Standar waktu pengiriman" onClose={onClose} footer={<><span className="pap-spacer" /><button className="pap-btn" onClick={onClose}>Batal</button><button className="pap-primary-button" form="ship-settings">Simpan</button></>}>
      <form id="ship-settings" className="pap-form-grid" onSubmit={save}>
        {error && <div className="full"><Notice onClose={() => setError('')}>{error}</Notice></div>}
        <Field label="Toleransi kirim (hari setelah tanggal kirim SO)" hint="0 = harus dikirim pada tanggal kirim di SO"><input className="pap-input" type="number" min={0} max={30} value={v.hari} onChange={(e) => setV({ ...v, hari: e.target.value })} /></Field>
        <Field label="SO dipantau sejak" hint="SO dengan tanggal kirim sebelum ini dianggap sudah terkirim"><input className="pap-input" type="date" value={v.mulai} onChange={(e) => setV({ ...v, mulai: e.target.value })} /></Field>
      </form>
    </Modal>
  )
}

type Item = { key: number; so_accurate_id: number | null; so_number: string | null; item_no: string | null; item_name: string; qty: string; unit: string; koli: string; catatan: string }
let seq = 0
type Draft = {
  customer_accurate_id: number | null; customer_name: string; customer_no: string | null; telepon: string | null; alamat: string; rencana_kirim: string | null; expedition_id: number | null
  ekspedisi_nama: string | null; tarif_per_kg: number | null; berat_kg: number | null; koli?: number | null; no_resi?: string | null; sopir?: string | null; catatan?: string | null; ongkir?: number | null
  tujuan?: { kota: string | null; provinsi: string | null }
  items: { so_accurate_id: number | null; so_number: string | null; item_no: string | null; item_name: string; qty: number; unit: string | null; koli: number | null; catatan: string | null }[]
}

function ShipmentForm({ id, so, onClose, onSaved }: { id: number | null; so: number[]; onClose: () => void; onSaved: (text: string, id: number) => void }) {
  const [v, setV] = useState({ customer_accurate_id: null as number | null, customer_name: '', customer_no: '', telepon: '', alamat: '', rencana_kirim: today(), expedition_id: '', ekspedisi_nama: '', tarif_per_kg: '', berat_kg: '', koli: '', ongkir: '', no_resi: '', sopir: '', catatan: '' })
  const [items, setItems] = useState<Item[]>([])
  const [routes, setRoutes] = useState<Route[]>([])
  const [tujuan, setTujuan] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const s = (x: unknown) => (x === null || x === undefined ? '' : String(x))
  const fill = (d: Draft) => {
    setV({ customer_accurate_id: d.customer_accurate_id, customer_name: d.customer_name, customer_no: s(d.customer_no), telepon: s(d.telepon), alamat: s(d.alamat), rencana_kirim: s(d.rencana_kirim) || today(),
      expedition_id: s(d.expedition_id), ekspedisi_nama: s(d.ekspedisi_nama), tarif_per_kg: s(d.tarif_per_kg), berat_kg: s(d.berat_kg), koli: s(d.koli), ongkir: s(d.ongkir), no_resi: s(d.no_resi), sopir: s(d.sopir), catatan: s(d.catatan) })
    setItems(d.items.map((i) => ({ key: ++seq, so_accurate_id: i.so_accurate_id, so_number: i.so_number, item_no: i.item_no, item_name: i.item_name, qty: s(i.qty), unit: s(i.unit), koli: s(i.koli), catatan: s(i.catatan) })))
  }
  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        if (id) {
          const r = await api<{ item: Draft; items: Draft['items'] }>(`/api/logistik/shipments/${id}`)
          if (alive) fill({ ...r.item, items: r.items })
        } else if (so.length) {
          const r = await api<{ draft: Draft }>(`/api/logistik/shipments/draft?so=${so.join(',')}`)
          if (alive) { fill(r.draft); setTujuan(r.draft.tujuan?.kota ?? r.draft.tujuan?.provinsi ?? '') }
        } else setItems([{ key: ++seq, so_accurate_id: null, so_number: null, item_no: null, item_name: '', qty: '', unit: 'kg', koli: '', catatan: '' }])
      } catch (e) {
        if (alive) setError((e as Error).message)
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => { alive = false }
  }, [id, so])
  // Pilihan ekspedisi termurah ke tujuan
  useEffect(() => {
    if (!tujuan.trim()) return setRoutes([])
    const t = setTimeout(() => api<{ items: Route[] }>(`/api/logistik/expeditions/cheapest?tujuan=${encodeURIComponent(tujuan.trim())}`).then((r) => setRoutes(r.items)).catch(() => {}), 300)
    return () => clearTimeout(t)
  }, [tujuan])
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV((cur) => ({ ...cur, [k]: e.target.value }))
  const upd = (key: number, patch: Partial<Item>) => setItems((list) => list.map((i) => (i.key === key ? { ...i, ...patch } : i)))
  const ongkirAuto = Number(v.berat_kg) && Number(v.tarif_per_kg) ? Math.round(Number(v.berat_kg) * Number(v.tarif_per_kg)) : null
  const pickRoute = (r: Route) => setV((cur) => ({ ...cur, expedition_id: String(r.id), ekspedisi_nama: r.nama, tarif_per_kg: r.tarif_per_kg ? String(r.tarif_per_kg) : cur.tarif_per_kg }))
  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const payload = { ...v, expedition_id: v.expedition_id ? Number(v.expedition_id) : null, items: items.filter((i) => i.item_name.trim()).map(({ key: _k, ...i }) => i) }
      const r = await api<{ id: number }>(id ? `/api/logistik/shipments/${id}` : '/api/logistik/shipments', { method: id ? 'PUT' : 'POST', json: payload })
      onSaved(id ? 'Pengiriman diperbarui.' : 'Pengiriman dibuat. Cetak surat jalan dari detailnya.', r.id)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal title={id ? 'Ubah pengiriman' : 'Pengiriman baru'} subtitle={so.length ? `Dari ${so.length} SO Accurate · status awal Packing` : undefined} wide onClose={onClose}
      footer={<><span className="pap-spacer" /><button className="pap-btn" onClick={onClose}>Batal</button><button className="pap-primary-button" form="ship-form" disabled={busy || loading}><Truck /> {busy ? 'Menyimpan...' : 'Simpan'}</button></>}>
      {error && <Notice onClose={() => setError('')}>{error}</Notice>}
      {loading ? <p className="pap-muted">Memuat data SO dari Accurate...</p> : (
        <form id="ship-form" className="pap-po-form" onSubmit={submit}>
          <div className="pap-form-grid">
            <Field label="Customer *"><input className="pap-input" required maxLength={255} value={v.customer_name} onChange={set('customer_name')} /></Field>
            <Field label="Telepon penerima"><input className="pap-input" maxLength={80} value={v.telepon} onChange={set('telepon')} /></Field>
            <Field label="Alamat kirim" full><textarea className="pap-input" rows={3} maxLength={1000} value={v.alamat} onChange={set('alamat')} /></Field>
            <Field label="Rencana tanggal kirim"><input className="pap-input" type="date" value={v.rencana_kirim} onChange={set('rencana_kirim')} /></Field>
            <Field label="Sopir / pengantar"><input className="pap-input" maxLength={120} value={v.sopir} onChange={set('sopir')} /></Field>
          </div>
          <fieldset className="pap-ship-exp">
            <legend>Ekspedisi</legend>
            <div className="pap-form-grid">
              <Field label="Cari ekspedisi termurah ke"><input className="pap-input" value={tujuan} onChange={(e) => setTujuan(e.target.value)} placeholder="Kota / provinsi tujuan" /></Field>
              <Field label="Ekspedisi dipakai"><input className="pap-input" maxLength={120} value={v.ekspedisi_nama} onChange={(e) => setV({ ...v, ekspedisi_nama: e.target.value, expedition_id: '' })} placeholder="Nama ekspedisi" /></Field>
            </div>
            {routes.length > 0 && (
              <div className="pap-ship-routes">
                {routes.slice(0, 6).map((r, i) => (
                  <button type="button" key={r.id} className={`pap-ship-route ${String(r.id) === v.expedition_id ? 'active' : ''}`} onClick={() => pickRoute(r)}>
                    <b>{i === 0 && r.tarif_per_kg ? '★ ' : ''}{r.nama}</b><span>{r.tujuan}</span><span>{r.tarif_per_kg ? `${formatRupiah(r.tarif_per_kg)}/kg` : 'tarif ?'}{r.estimasi_hari ? ` · ${r.estimasi_hari}` : ''}</span>
                  </button>
                ))}
              </div>
            )}
            <div className="pap-form-grid">
              <Field label="Berat (kg)"><input className="pap-input pap-num" inputMode="decimal" value={v.berat_kg} onChange={set('berat_kg')} /></Field>
              <Field label="Tarif per kg"><input className="pap-input pap-num" inputMode="decimal" value={v.tarif_per_kg} onChange={set('tarif_per_kg')} /></Field>
              <Field label="Ongkir" hint={ongkirAuto ? `Otomatis ${formatRupiah(ongkirAuto)} bila dikosongkan` : undefined}><input className="pap-input pap-num" inputMode="decimal" value={v.ongkir} onChange={set('ongkir')} /></Field>
              <Field label="Jumlah koli"><input className="pap-input pap-num" inputMode="numeric" value={v.koli} onChange={set('koli')} /></Field>
            </div>
          </fieldset>
          <div className="pap-field">
            <span>Barang dikirim</span>
            <div className="pap-table-wrap bordered pap-po-lines">
              <table>
                <thead><tr><th>Barang</th><th className="pap-num">Qty</th><th>Satuan</th><th className="pap-num">Koli</th><th>Keterangan</th><th /></tr></thead>
                <tbody>
                  {items.map((i) => (
                    <tr key={i.key}>
                      <td><input className="pap-input" required maxLength={500} value={i.item_name} onChange={(e) => upd(i.key, { item_name: e.target.value })} aria-label="Nama barang" />{i.so_number && <div className="pap-cell-sub">{i.so_number}</div>}</td>
                      <td><input className="pap-input pap-num" inputMode="decimal" required value={i.qty} onChange={(e) => upd(i.key, { qty: e.target.value })} aria-label="Qty" /></td>
                      <td><input className="pap-input" maxLength={40} value={i.unit} onChange={(e) => upd(i.key, { unit: e.target.value })} aria-label="Satuan" /></td>
                      <td><input className="pap-input pap-num" inputMode="numeric" value={i.koli} onChange={(e) => upd(i.key, { koli: e.target.value })} aria-label="Koli" /></td>
                      <td><input className="pap-input" maxLength={500} value={i.catatan} onChange={(e) => upd(i.key, { catatan: e.target.value })} aria-label="Keterangan" /></td>
                      <td>{items.length > 1 && <button type="button" className="pap-icon-button" aria-label="Hapus barang" onClick={() => setItems((l) => l.filter((x) => x.key !== i.key))}><Trash2 /></button>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button type="button" className="pap-btn pap-add-item" onClick={() => setItems((l) => [...l, { key: ++seq, so_accurate_id: null, so_number: null, item_no: null, item_name: '', qty: '', unit: 'kg', koli: '', catatan: '' }])}><Plus /> Tambah barang</button>
          </div>
          <Field label="Catatan (tercetak di surat jalan)"><input className="pap-input" maxLength={1000} value={v.catatan} onChange={set('catatan')} /></Field>
        </form>
      )}
    </Modal>
  )
}

function ShipmentDetail({ id, onClose, onEdit, onChanged }: { id: number; onClose: () => void; onEdit: (id: number) => void; onChanged: (text: string) => void }) {
  const [data, setData] = useState<{ item: Shipment; items: Draft['items']; can: { manage: boolean } } | null>(null)
  const [error, setError] = useState('')
  const [step, setStep] = useState<{ status: Status; tanggal: string; no_resi: string; penerima: string; estimasi_hari: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const load = useCallback(() => api<{ item: Shipment; items: Draft['items']; can: { manage: boolean } }>(`/api/logistik/shipments/${id}`).then(setData).catch((e) => setError(e.message)), [id])
  useEffect(() => { load() }, [load])
  async function change(status: Status, extra: Record<string, string> = {}) {
    setBusy(true)
    try {
      await api(`/api/logistik/shipments/${id}`, { method: 'PATCH', json: { status, ...extra } })
      setStep(null)
      await load()
      onChanged(`Status ${data?.item.nomor} menjadi ${STATUS[status][0]}.`)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  async function remove() {
    if (!data || !window.confirm(`Hapus pengiriman ${data.item.nomor}?`)) return
    try {
      await api(`/api/logistik/shipments/${id}`, { method: 'DELETE' })
      onChanged(`Pengiriman ${data.item.nomor} dihapus.`)
      onClose()
    } catch (e) {
      setError((e as Error).message)
    }
  }
  if (!data) return <Modal title="Pengiriman" onClose={onClose}>{error ? <Notice>{error}</Notice> : <p className="pap-muted">Memuat...</p>}</Modal>
  const x = data.item
  const m = data.can.manage
  return (
    <Modal title={x.nomor} subtitle={`${x.customer_name}${x.so_numbers ? ` · ${x.so_numbers}` : ''}`} wide onClose={onClose}
      footer={<>
        {m && ['packing', 'batal'].includes(x.status) && <button className="pap-btn danger" onClick={remove}><Trash2 /> Hapus</button>}
        <a className="pap-btn" href={`/cetak/surat-jalan/${x.id}`} target="_blank" rel="noreferrer"><Printer /> Surat jalan</a>
        <span className="pap-spacer" />
        {m && !['diterima', 'batal'].includes(x.status) && <button className="pap-btn" onClick={() => onEdit(x.id)}><Pencil /> Ubah</button>}
        <button className="pap-btn" onClick={onClose}>Tutup</button>
      </>}>
      {error && <Notice onClose={() => setError('')}>{error}</Notice>}
      <ol className="pap-track">
        {(['packing', 'siap_kirim', 'dikirim', 'diterima'] as Status[]).map((st, i, arr) => {
          const cur = arr.indexOf(x.status)
          return <li key={st} className={x.status === 'batal' ? '' : i < cur || (x.status === 'diterima' && i === cur) ? 'done' : i === cur ? 'current' : ''}><span>{i + 1}</span>{STATUS[st][0]}</li>
        })}
      </ol>
      {x.status === 'batal' && <div className="pap-detail-badges"><span className="pap-status neutral">Batal</span></div>}
      <dl className="pap-detail-grid">
        <div><dt>Alamat</dt><dd className="pap-prewrap">{x.alamat ?? '—'}{x.telepon ? `\nTelp ${x.telepon}` : ''}</dd></div>
        <div><dt>Ekspedisi</dt><dd>{x.ekspedisi_nama ?? '—'}{x.ekspedisi_telepon ? ` · ${x.ekspedisi_telepon}` : ''}{x.no_resi && <div className="pap-cell-sub">Resi {x.no_resi}</div>}</dd></div>
        <div><dt>Berat / koli / ongkir</dt><dd>{x.berat_kg ? `${formatNumber(x.berat_kg)} kg` : '—'} · {x.koli ?? '—'} koli · {x.ongkir ? formatRupiah(x.ongkir) : '—'}{x.tarif_per_kg && <div className="pap-cell-sub">{formatRupiah(x.tarif_per_kg)}/kg</div>}</dd></div>
        <div><dt>Kirim</dt><dd>{x.tanggal_kirim ? formatDate(x.tanggal_kirim) : `rencana ${formatDate(x.rencana_kirim)}`}{x.target_tiba && <div className="pap-cell-sub">target tiba {formatDate(x.target_tiba)}</div>}</dd></div>
        <div><dt>Diterima</dt><dd>{x.tanggal_diterima ? `${formatDate(x.tanggal_diterima)}${x.penerima ? ` · ${x.penerima}` : ''}` : '—'}{x.tepat_waktu !== null && <div className={`pap-cell-sub ${x.tepat_waktu ? 'pap-text-success' : 'pap-text-danger'}`}>{x.tepat_waktu ? 'Tepat waktu' : 'Terlambat'}</div>}</dd></div>
        <div><dt>Dibuat</dt><dd>{x.created_name ?? '—'} · {formatDate(x.created_at, true)}</dd></div>
      </dl>
      <section className="pap-detail-section">
        <h3>Barang ({data.items.length})</h3>
        <div className="pap-table-wrap bordered">
          <table>
            <thead><tr><th>Barang</th><th className="pap-num">Qty</th><th className="pap-num">Koli</th><th>SO</th></tr></thead>
            <tbody>{data.items.map((i, k) => <tr key={k}><td>{i.item_name}{i.catatan && <div className="pap-cell-sub">{i.catatan}</div>}</td><td className="pap-num pap-nowrap">{formatNumber(i.qty)} {i.unit ?? ''}</td><td className="pap-num">{i.koli ?? '—'}</td><td>{i.so_number ?? '—'}</td></tr>)}</tbody>
          </table>
        </div>
      </section>
      {m && x.status !== 'batal' && (
        <section className="pap-detail-section">
          <h3>Proses</h3>
          {step ? (
            <div className="pap-form-grid">
              <Field label={step.status === 'diterima' ? 'Tanggal diterima' : 'Tanggal kirim'}><input className="pap-input" type="date" value={step.tanggal} onChange={(e) => setStep({ ...step, tanggal: e.target.value })} /></Field>
              {step.status === 'dikirim' && <Field label="No. resi"><input className="pap-input" maxLength={80} value={step.no_resi} onChange={(e) => setStep({ ...step, no_resi: e.target.value })} /></Field>}
              {step.status === 'dikirim' && <Field label="Estimasi tiba (hari)" hint="Kosong = estimasi ekspedisi"><input className="pap-input" type="number" min={0} max={60} value={step.estimasi_hari} onChange={(e) => setStep({ ...step, estimasi_hari: e.target.value })} /></Field>}
              {step.status === 'diterima' && <Field label="Nama penerima"><input className="pap-input" maxLength={120} value={step.penerima} onChange={(e) => setStep({ ...step, penerima: e.target.value })} /></Field>}
              <div className="pap-inline-actions full">
                <button className="pap-btn" onClick={() => setStep(null)}>Batal</button>
                <button className="pap-primary-button" disabled={busy} onClick={() => change(step.status, { tanggal: step.tanggal, no_resi: step.no_resi, penerima: step.penerima, estimasi_hari: step.estimasi_hari })}>Simpan</button>
              </div>
            </div>
          ) : (
            <div className="pap-inline-actions pap-wrap">
              {x.status === 'packing' && <button className="pap-primary-button" disabled={busy} onClick={() => change('siap_kirim')}><PackageCheck /> Selesai packing (siap kirim)</button>}
              {['packing', 'siap_kirim'].includes(x.status) && <button className="pap-primary-button" onClick={() => setStep({ status: 'dikirim', tanggal: today(), no_resi: x.no_resi ?? '', penerima: '', estimasi_hari: '' })}><Truck /> Tandai dikirim</button>}
              {x.status === 'dikirim' && <button className="pap-primary-button" onClick={() => setStep({ status: 'diterima', tanggal: today(), no_resi: '', penerima: '', estimasi_hari: '' })}><CheckCircle2 /> Tandai diterima</button>}
              {x.status === 'siap_kirim' && <button className="pap-btn" disabled={busy} onClick={() => change('packing')}><Clock /> Kembali ke packing</button>}
              {x.status === 'diterima' && <button className="pap-btn" disabled={busy} onClick={() => change('dikirim')}>Batalkan status diterima</button>}
              {['packing', 'siap_kirim'].includes(x.status) && <button className="pap-btn danger" disabled={busy} onClick={() => window.confirm('Batalkan pengiriman ini?') && change('batal')}>Batalkan pengiriman</button>}
            </div>
          )}
        </section>
      )}
      {m && x.status === 'batal' && <div className="pap-inline-actions"><button className="pap-btn" onClick={() => change('packing')}>Aktifkan lagi (packing)</button></div>}
    </Modal>
  )
}

// ---------- Ekspedisi ----------
type RouteRow = Route & { nama_key: string; kontak: string | null; keterangan: string | null; sumber: 'manual' | 'so'; aktif: boolean; pemakaian: number; terakhir: string | null; tarif_min: number | null; tarif_max: number | null; pengiriman: number }

export function ExpeditionPage(_props: { user: UserProfile }) {
  const [data, setData] = useState<{ items: RouteRow[]; synced_at: string | null; can: { manage: boolean } } | null>(null)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [syncing, setSyncing] = useState(false)
  const [tujuan, setTujuan] = useState('')
  const [cheap, setCheap] = useState<(Route & { pemakaian: number; terakhir: string | null; sumber: string })[] | null>(null)
  const [dests, setDests] = useState<{ kota: string; provinsi: string | null; n: number }[]>([])
  const [view, setView] = useState<'ekspedisi' | 'rute'>('ekspedisi')
  const [q, setQ] = useState('')
  const [form, setForm] = useState<RouteRow | 'baru' | null>(null)
  const load = useCallback(() => api<{ items: RouteRow[]; synced_at: string | null; can: { manage: boolean } }>('/api/logistik/expeditions').then((r) => { setData(r); setError('') }).catch((e) => setError(e.message)), [])
  useEffect(() => { load() }, [load])
  useEffect(() => {
    const t = setTimeout(() => api<{ items: typeof cheap; destinations: typeof dests }>(`/api/logistik/expeditions/cheapest${tujuan.trim() ? `?tujuan=${encodeURIComponent(tujuan.trim())}` : ''}`).then((r) => { setCheap(tujuan.trim() ? r.items : null); setDests(r.destinations) }).catch(() => {}), 300)
    return () => clearTimeout(t)
  }, [tujuan, data])
  async function sync() {
    setSyncing(true)
    try {
      const r = await api<{ so: number; tarif: number; ekspedisi: number; rute: number }>('/api/logistik/expeditions/sync', { method: 'POST' })
      setMessage(`${r.so} SO dibaca: ${r.ekspedisi} ekspedisi, ${r.rute} rute, ${r.tarif} catatan tarif.`)
      load()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSyncing(false)
    }
  }
  async function remove(r: RouteRow) {
    if (!window.confirm(`Hapus ${r.nama} → ${r.tujuan}?`)) return
    try {
      const res = await api<{ nonaktif?: boolean }>(`/api/logistik/expeditions/${r.id}`, { method: 'DELETE' })
      setMessage(res.nonaktif ? 'Rute sudah dipakai, jadi dinonaktifkan.' : 'Rute dihapus.')
      load()
    } catch (e) {
      setError((e as Error).message)
    }
  }
  // Ringkasan per ekspedisi
  const term = q.trim().toLowerCase()
  const rows = (data?.items ?? []).filter((r) => !term || `${r.nama} ${r.tujuan}`.toLowerCase().includes(term))
  const groups = [...rows.reduce((m, r) => {
    const g = m.get(r.nama_key) ?? { nama: r.nama, rute: 0, pemakaian: 0, tarif: [] as number[], terakhir: null as string | null, telepon: r.telepon, tujuan: [] as [string, number][] }
    g.rute++
    g.pemakaian += r.pemakaian
    if (r.tarif_per_kg) g.tarif.push(r.tarif_per_kg)
    if (r.terakhir && (!g.terakhir || r.terakhir > g.terakhir)) g.terakhir = r.terakhir
    if (r.pemakaian) g.tujuan.push([r.tujuan, r.pemakaian])
    m.set(r.nama_key, g)
    return m
  }, new Map<string, { nama: string; rute: number; pemakaian: number; tarif: number[]; terakhir: string | null; telepon: string | null; tujuan: [string, number][] }>()).values()].sort((a, b) => b.pemakaian - a.pemakaian)
  const pagedR = usePaged(rows, `${q}-${view}`, 50)

  return (
    <>
      <div className="pap-page-heading">
        <div>
          <p className="pap-eyebrow">INVENTORY & LOGISTIK</p>
          <h1>Ekspedisi</h1>
          <span>Daftar ekspedisi & tarif per tujuan, dibangun otomatis dari keterangan SO Accurate ("Pengiriman dengan ... Rp .../kg estimasi ... hari") dan bisa dilengkapi manual. Data yang sama dipakai di Master Data dan order Quotation.</span>
        </div>
        <div className="pap-inline-actions pap-wrap">
          {data?.can.manage && <button className="pap-btn" disabled={syncing} onClick={sync}><RefreshCw /> {syncing ? 'Membaca SO (±1 menit)...' : 'Perbarui dari SO Accurate'}</button>}
          {data?.can.manage && <button className="pap-primary-button" onClick={() => setForm('baru')}><Plus /> Tambah tarif</button>}
        </div>
      </div>
      {message && <Notice kind="success" onClose={() => setMessage('')}>{message}</Notice>}
      {error && <Notice onClose={() => setError('')}>{error}</Notice>}

      <div className="pap-table-card">
        <div className="pap-card-head"><div><h2>Ekspedisi termurah ke tujuan</h2><p>Tarif per kg terbaru per ekspedisi untuk kota / provinsi tujuan{data?.synced_at ? ` · data SO diperbarui ${formatDate(data.synced_at, true)}` : ''}.</p></div></div>
        <div className="pap-filters">
          <label className="pap-filter-search"><Search /><input list="pap-dests" value={tujuan} onChange={(e) => setTujuan(e.target.value)} placeholder="Ketik kota / provinsi tujuan, mis. Surabaya" /></label>
          <datalist id="pap-dests">{dests.map((d) => <option key={d.kota} value={d.kota}>{d.provinsi ?? ''} · {d.n} SO</option>)}</datalist>
        </div>
        {cheap && (
          <div className="pap-table-wrap">
            <table>
              <thead><tr><th>#</th><th>Ekspedisi</th><th>Tujuan</th><th className="pap-num">Tarif / kg</th><th>Estimasi</th><th className="pap-num">Dipakai</th><th>Terakhir</th></tr></thead>
              <tbody>
                {cheap.map((c, i) => (
                  <tr key={c.id}>
                    <td>{i + 1}</td><td><div className="pap-cell-title">{c.nama}{i === 0 && c.tarif_per_kg && <span className="pap-chip"> termurah</span>}</div><div className="pap-cell-sub">{c.telepon ?? ''}</div></td>
                    <td>{c.tujuan}</td><td className="pap-num pap-nowrap"><strong>{c.tarif_per_kg ? formatRupiah(c.tarif_per_kg) : '—'}</strong></td><td>{c.estimasi_hari ?? '—'}</td>
                    <td className="pap-num">{c.pemakaian}×</td><td className="pap-nowrap">{formatDate(c.terakhir)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!cheap.length && <div className="pap-empty">Belum ada tarif ekspedisi ke {tujuan}.</div>}
          </div>
        )}
        {!cheap && dests.length > 0 && <div className="pap-dash-body"><p className="pap-muted">Tujuan terbanyak: {dests.slice(0, 12).map((d) => <button key={d.kota} className="pap-link-button" onClick={() => setTujuan(d.kota)}>{d.kota} ({d.n})</button>).reduce((a: React.ReactNode[], b, i) => (i ? [...a, ', ', b] : [b]), [])}</p></div>}
      </div>

      <div className="pap-table-card pap-acc-spaced">
        <div className="pap-card-head">
          <div className="pap-segmented" role="tablist">
            <button role="tab" aria-selected={view === 'ekspedisi'} className={view === 'ekspedisi' ? 'active' : ''} onClick={() => setView('ekspedisi')}><Truck /> Per ekspedisi ({groups.length})</button>
            <button role="tab" aria-selected={view === 'rute'} className={view === 'rute' ? 'active' : ''} onClick={() => setView('rute')}>Rute & tarif ({rows.length})</button>
          </div>
          <label className="pap-filter-search"><Search /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari ekspedisi / tujuan..." /></label>
        </div>
        <div className="pap-table-wrap">
          {view === 'ekspedisi' ? (
            <table>
              <thead><tr><th>Ekspedisi</th><th className="pap-num">Rute</th><th className="pap-num">Dipakai (12 bln)</th><th className="pap-num">Tarif / kg</th><th>Tujuan utama</th><th>Terakhir</th></tr></thead>
              <tbody>
                {groups.map((g) => (
                  <tr key={g.nama} className="pap-row-link" onClick={() => { setView('rute'); setQ(g.nama) }}>
                    <td><div className="pap-cell-title">{g.nama}</div><div className="pap-cell-sub">{g.telepon ?? ''}</div></td>
                    <td className="pap-num">{g.rute}</td><td className="pap-num">{g.pemakaian}×</td>
                    <td className="pap-num pap-nowrap">{g.tarif.length ? (Math.min(...g.tarif) === Math.max(...g.tarif) ? formatRupiah(g.tarif[0]) : `${formatRupiah(Math.min(...g.tarif))} – ${formatRupiah(Math.max(...g.tarif))}`) : '—'}</td>
                    <td><div className="pap-cell-sub">{[...g.tujuan].sort((a, b) => b[1] - a[1]).slice(0, 5).map((t) => t[0]).join(', ')}{g.tujuan.length > 5 ? ` +${g.tujuan.length - 5}` : ''}</div></td>
                    <td className="pap-nowrap">{formatDate(g.terakhir)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <table>
              <thead><tr><th>Ekspedisi</th><th>Tujuan</th><th className="pap-num">Tarif / kg</th><th>Estimasi</th><th className="pap-num">Dipakai</th><th>Sumber</th><th className="pap-actions-col">Aksi</th></tr></thead>
              <tbody>
                {pagedR.items.map((r) => (
                  <tr key={r.id} className={r.aktif ? '' : 'pap-muted'}>
                    <td><div className="pap-cell-title">{r.nama}{!r.aktif && ' (nonaktif)'}</div><div className="pap-cell-sub">{[r.kontak, r.telepon].filter(Boolean).join(' · ')}</div></td>
                    <td>{r.tujuan}</td>
                    <td className="pap-num pap-nowrap"><strong>{r.tarif_per_kg ? formatRupiah(r.tarif_per_kg) : '—'}</strong>{r.tarif_min !== null && r.tarif_max !== null && r.tarif_min !== r.tarif_max && <div className="pap-cell-sub">{formatRupiah(r.tarif_min)}–{formatRupiah(r.tarif_max)}</div>}</td>
                    <td>{r.estimasi_hari ?? '—'}</td>
                    <td className="pap-num">{r.pemakaian}×<div className="pap-cell-sub">{formatDate(r.terakhir)}</div></td>
                    <td><span className={`pap-status ${r.sumber === 'so' ? 'info' : 'neutral'}`}>{r.sumber === 'so' ? 'Otomatis SO' : 'Manual'}</span></td>
                    <td className="pap-actions-cell">{data?.can.manage && <div className="pap-row-actions"><RowActions label={`${r.nama} ${r.tujuan}`} onEdit={() => setForm(r)} /><button className="pap-row-action" onClick={() => remove(r)} aria-label="Hapus"><Trash2 /></button></div>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {data && !rows.length && <div className="pap-empty">{q ? 'Tidak ada yang cocok.' : 'Belum ada data ekspedisi. Klik "Perbarui dari SO Accurate".'}</div>}
          {!data && !error && <div className="pap-empty">Memuat...</div>}
          {view === 'rute' && <Pager {...pagedR.pager} noun="rute" />}
        </div>
      </div>
      {form && <RouteForm item={form === 'baru' ? null : form} onClose={() => setForm(null)} onSaved={(t) => { setForm(null); setMessage(t); load() }} />}
    </>
  )
}

function RouteForm({ item, onClose, onSaved }: { item: RouteRow | null; onClose: () => void; onSaved: (text: string) => void }) {
  const s = (x: unknown) => (x === null || x === undefined ? '' : String(x))
  const [v, setV] = useState({ nama: s(item?.nama), tujuan: s(item?.tujuan), kontak: s(item?.kontak), telepon: s(item?.telepon), tarif_per_kg: s(item?.tarif_per_kg), minimal_kg: s(item?.minimal_kg), estimasi_hari: s(item?.estimasi_hari), keterangan: s(item?.keterangan), aktif: item?.aktif ?? true })
  const [error, setError] = useState('')
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV({ ...v, [k]: e.target.value })
  async function save(e: React.FormEvent) {
    e.preventDefault()
    try {
      await api(item ? `/api/logistik/expeditions/${item.id}` : '/api/logistik/expeditions', { method: item ? 'PUT' : 'POST', json: v })
      onSaved(item ? 'Tarif ekspedisi diperbarui.' : 'Tarif ekspedisi ditambahkan.')
    } catch (err) {
      setError((err as Error).message)
    }
  }
  return (
    <Modal title={item ? `Ubah ${item.nama} → ${item.tujuan}` : 'Tambah tarif ekspedisi'} subtitle={item?.sumber === 'so' ? 'Setelah diubah, baris ini tidak ditimpa lagi oleh data SO' : undefined} onClose={onClose}
      footer={<><span className="pap-spacer" /><button className="pap-btn" onClick={onClose}>Batal</button><button className="pap-primary-button" form="route-form">Simpan</button></>}>
      <form id="route-form" className="pap-form-grid" onSubmit={save}>
        {error && <div className="full"><Notice onClose={() => setError('')}>{error}</Notice></div>}
        <Field label="Nama ekspedisi *"><input className="pap-input" required maxLength={150} value={v.nama} onChange={set('nama')} /></Field>
        <Field label="Tujuan (kota / provinsi) *"><input className="pap-input" required maxLength={255} value={v.tujuan} onChange={set('tujuan')} /></Field>
        <Field label="Tarif per kg (Rp)"><input className="pap-input pap-num" inputMode="decimal" value={v.tarif_per_kg} onChange={set('tarif_per_kg')} /></Field>
        <Field label="Minimal kg"><input className="pap-input pap-num" inputMode="decimal" value={v.minimal_kg} onChange={set('minimal_kg')} /></Field>
        <Field label="Estimasi" hint="mis. 2-3 hari"><input className="pap-input" maxLength={30} value={v.estimasi_hari} onChange={set('estimasi_hari')} /></Field>
        <Field label="Kontak"><input className="pap-input" maxLength={150} value={v.kontak} onChange={set('kontak')} /></Field>
        <Field label="Telepon"><input className="pap-input" maxLength={40} value={v.telepon} onChange={set('telepon')} /></Field>
        <Field label="Keterangan" full><input className="pap-input" maxLength={500} value={v.keterangan} onChange={set('keterangan')} /></Field>
        <label className="pap-check full"><input type="checkbox" checked={v.aktif} onChange={(e) => setV({ ...v, aktif: e.target.checked })} /><span>Aktif</span></label>
      </form>
    </Modal>
  )
}
