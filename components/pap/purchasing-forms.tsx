'use client'

import { useEffect, useMemo, useState } from 'react'
import { Plus, Save, Send, Trash2 } from 'lucide-react'
import { formatRupiah } from './accurate'
import { api, Field, formatDate, Modal, Notice } from './ui'

// Form Purchasing yang menulis ke Accurate: PO pembelian (seperti form Pesanan Pembelian Accurate), harga beli acuan, supplier.

type Named = { id: number; name: string }
type PoOptions = { vendors: { id: number; vendor_no: string; name: string }[]; paymentTerms: Named[]; fobs: Named[]; shipments: Named[]; defaultAddress: string }
type ItemHit = { id: number; item_no: string; name: string; unit: string | null; category: string | null; vendor_price: number | null; harga_terakhir: number | null }
type Line = { key: number; id: number | null; item_no: string; nama: string; quantity: string; unit: string; unit_price: string; disc_pct: string; catatan: string; shipped?: number }
type PoValues = {
  vendor_no: string; tanggal: string; nomor: string; ship_date: string; payment_term: string; fob: string; shipment: string
  alamat: string; keterangan: string; taxable: boolean; inclusive_tax: boolean; disc_pct: string
}
const PPN = 11 // tarif PPN Accurate (tax1Rate); total final dihitung Accurate
let seq = 0
const blankLine = (): Line => ({ key: ++seq, id: null, item_no: '', nama: '', quantity: '', unit: '', unit_price: '', disc_pct: '', catatan: '' })
const dec = (v: string) => Number(v.replace(',', '.')) || 0
const today = () => new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10)

// Pilih barang Accurate: ketik nama / kode, saran dari data barang (+ harga beli terakhir)
export function ItemPicker({ line, onPick, onText, endpoint = '/api/purchasing/items' }: { line: Pick<Line, 'key' | 'item_no' | 'nama'>; onPick: (item: ItemHit) => void; onText: (text: string) => void; endpoint?: string }) {
  const [text, setText] = useState(line.item_no ? `${line.item_no} · ${line.nama}` : '')
  const [hits, setHits] = useState<ItemHit[]>([])
  const listId = `pap-po-items-${line.key}`
  useEffect(() => {
    const q = text.includes(' · ') ? '' : text.trim()
    const timer = setTimeout(() => {
      api<{ items: ItemHit[] }>(`${endpoint}${q ? `?q=${encodeURIComponent(q)}` : ''}`).then((r) => setHits(r.items)).catch(() => {})
    }, 250)
    return () => clearTimeout(timer)
  }, [text, endpoint])
  return (
    <>
      <input
        className="pap-input" list={listId} value={text} placeholder="Cari barang (nama / kode)" aria-label="Barang"
        onChange={(e) => {
          const v = e.target.value
          setText(v)
          const hit = hits.find((h) => `${h.item_no} · ${h.name}` === v)
          if (hit) onPick(hit)
          else onText(v)
        }}
      />
      <datalist id={listId}>
        {hits.map((h) => <option key={h.id} value={`${h.item_no} · ${h.name}`}>{[h.category, h.harga_terakhir ? `terakhir ${formatRupiah(h.harga_terakhir)}` : null].filter(Boolean).join(' · ')}</option>)}
      </datalist>
    </>
  )
}

export function PoFormModal({ id, onClose, onSaved }: { id: number | null; onClose: () => void; onSaved: (message: string) => void }) {
  const [options, setOptions] = useState<PoOptions | null>(null)
  const [v, setV] = useState<PoValues>({ vendor_no: '', tanggal: today(), nomor: '', ship_date: '', payment_term: '', fob: '', shipment: '', alamat: '', keterangan: '', taxable: true, inclusive_tax: false, disc_pct: '' })
  const [lines, setLines] = useState<Line[]>(() => [blankLine()])
  const [meta, setMeta] = useState<{ number: string; status: string | null; vendor: string } | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const opts = await api<PoOptions>('/api/purchasing/orders/options')
        if (!alive) return
        setOptions(opts)
        if (id) {
          const { item } = await api<{ item: PoValues & { number: string; status_name: string | null; vendor_name: string; percent_shipped: number; lines: Omit<Line, 'key'>[] } }>(`/api/purchasing/orders/${id}`)
          if (!alive) return
          setV({ vendor_no: item.vendor_no, tanggal: item.tanggal, nomor: item.number, ship_date: item.ship_date, payment_term: item.payment_term, fob: item.fob, shipment: item.shipment, alamat: item.alamat, keterangan: item.keterangan, taxable: item.taxable, inclusive_tax: item.inclusive_tax, disc_pct: item.disc_pct })
          setLines(item.lines.map((l) => ({ ...l, key: ++seq })))
          setMeta({ number: item.number, status: item.status_name, vendor: item.vendor_name })
          if (item.percent_shipped > 0) setError('PO ini sudah ada penerimaan barang; perubahan harus dilakukan di Accurate.')
        } else if (opts.defaultAddress) setV((cur) => ({ ...cur, alamat: opts.defaultAddress }))
      } catch (e) {
        if (alive) setError((e as Error).message)
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => { alive = false }
  }, [id])

  const set = <K extends keyof PoValues>(k: K, value: PoValues[K]) => setV((cur) => ({ ...cur, [k]: value }))
  const updateLine = (key: number, patch: Partial<Line>) => setLines((list) => list.map((l) => (l.key === key ? { ...l, ...patch } : l)))
  const lineTotal = (l: Line) => dec(l.quantity) * dec(l.unit_price) * (1 - dec(l.disc_pct) / 100)
  const totals = useMemo(() => {
    const sub = lines.reduce((s, l) => s + lineTotal(l), 0)
    const disc = sub * (dec(v.disc_pct) / 100)
    const base = sub - disc
    const tax = !v.taxable ? 0 : v.inclusive_tax ? base - base / (1 + PPN / 100) : base * (PPN / 100)
    return { sub, disc, tax, total: v.taxable && !v.inclusive_tax ? base + tax : base }
  }, [lines, v.disc_pct, v.taxable, v.inclusive_tax])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const payload = { ...v, lines: lines.filter((l) => l.item_no).map(({ key: _k, shipped: _s, ...l }) => l) }
      const res = await api<{ number: string | null }>(id ? `/api/purchasing/orders/${id}` : '/api/purchasing/orders', { method: id ? 'PUT' : 'POST', json: payload })
      onSaved(id ? `PO ${res.number ?? meta?.number ?? ''} diperbarui di Accurate.` : `PO ${res.number ?? ''} dibuat di Accurate.`)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const vendorKnown = !v.vendor_no || options?.vendors.some((x) => x.vendor_no === v.vendor_no)
  return (
    <Modal
      title={id ? `Ubah PO ${meta?.number ?? ''}` : 'Pesanan Pembelian baru'}
      subtitle={id ? `${meta?.vendor ?? ''}${meta?.status ? ` · ${meta.status}` : ''} · perubahan langsung tersimpan di Accurate` : 'PO dibuat langsung di Accurate (Pesanan Pembelian); nomor otomatis bila dikosongkan'}
      wide
      onClose={onClose}
      footer={<><span className="pap-spacer" /><button className="pap-btn" onClick={onClose}>Batal</button><button className="pap-primary-button" form="po-form" disabled={busy || loading}><Send /> {busy ? 'Mengirim ke Accurate...' : id ? 'Simpan ke Accurate' : 'Buat PO di Accurate'}</button></>}
    >
      {error && <Notice onClose={() => setError('')}>{error}</Notice>}
      {loading ? <p className="pap-muted">Memuat data dari Accurate...</p> : (
        <form id="po-form" className="pap-po-form" onSubmit={submit}>
          <div className="pap-form-grid">
            <Field label="Pemasok *">
              <select className="pap-select" required value={v.vendor_no} onChange={(e) => set('vendor_no', e.target.value)}>
                <option value="">Cari / pilih pemasok</option>
                {!vendorKnown && <option value={v.vendor_no}>{meta?.vendor ?? v.vendor_no}</option>}
                {options?.vendors.map((x) => <option key={x.id} value={x.vendor_no}>{x.name} ({x.vendor_no})</option>)}
              </select>
            </Field>
            <Field label="Tanggal *"><input className="pap-input" type="date" required value={v.tanggal} onChange={(e) => set('tanggal', e.target.value)} /></Field>
            <Field label="Nomor #" hint={id ? undefined : 'Kosongkan agar dinomori otomatis oleh Accurate'}><input className="pap-input" maxLength={50} value={v.nomor} onChange={(e) => set('nomor', e.target.value)} placeholder="Otomatis" /></Field>
          </div>

          <div className="pap-po-sections">
            <fieldset>
              <legend>Info lainnya</legend>
              <Field label="Syarat pembayaran">
                <select className="pap-select" value={v.payment_term} onChange={(e) => set('payment_term', e.target.value)}>
                  <option value="">Ikuti bawaan pemasok</option>
                  {v.payment_term && !options?.paymentTerms.some((p) => p.name === v.payment_term) && <option value={v.payment_term}>{v.payment_term}</option>}
                  {options?.paymentTerms.map((p) => <option key={p.id} value={p.name}>{p.name}</option>)}
                </select>
              </Field>
              <Field label="Alamat kirim"><textarea className="pap-input" rows={3} maxLength={1000} value={v.alamat} onChange={(e) => set('alamat', e.target.value)} /></Field>
              <Field label="Keterangan"><textarea className="pap-input" rows={2} maxLength={1000} value={v.keterangan} onChange={(e) => set('keterangan', e.target.value)} /></Field>
            </fieldset>
            <fieldset>
              <legend>Info pajak</legend>
              <label className="pap-check"><input type="checkbox" checked={v.taxable} onChange={(e) => setV({ ...v, taxable: e.target.checked, inclusive_tax: e.target.checked && v.inclusive_tax })} /><span>Kena pajak (PPN {PPN}%)</span></label>
              <label className="pap-check"><input type="checkbox" disabled={!v.taxable} checked={v.inclusive_tax} onChange={(e) => set('inclusive_tax', e.target.checked)} /><span>Total termasuk pajak</span></label>
              <legend className="pap-po-legend2">Info pengiriman</legend>
              <Field label="Tgl pengiriman"><input className="pap-input" type="date" value={v.ship_date} onChange={(e) => set('ship_date', e.target.value)} /></Field>
              <Field label="Pengiriman">
                <select className="pap-select" value={v.shipment} disabled={!options?.shipments.length && !v.shipment} onChange={(e) => set('shipment', e.target.value)}>
                  <option value="">{options?.shipments.length ? '—' : 'Belum ada data pengiriman di Accurate'}</option>
                  {v.shipment && !options?.shipments.some((p) => p.name === v.shipment) && <option value={v.shipment}>{v.shipment}</option>}
                  {options?.shipments.map((p) => <option key={p.id} value={p.name}>{p.name}</option>)}
                </select>
              </Field>
              <Field label="FOB">
                <select className="pap-select" value={v.fob} onChange={(e) => set('fob', e.target.value)}>
                  <option value="">—</option>
                  {v.fob && !options?.fobs.some((p) => p.name === v.fob) && <option value={v.fob}>{v.fob}</option>}
                  {options?.fobs.map((p) => <option key={p.id} value={p.name}>{p.name}</option>)}
                </select>
              </Field>
            </fieldset>
          </div>

          <div className="pap-field">
            <span>Rincian barang</span>
            <div className="pap-table-wrap bordered pap-po-lines">
              <table>
                <thead><tr><th>Barang</th><th className="pap-num">Kuantitas</th><th>Satuan</th><th className="pap-num">@ Harga</th><th className="pap-num">Disk %</th><th className="pap-num">Total</th><th /></tr></thead>
                <tbody>
                  {lines.map((l, i) => (
                    <tr key={l.key}>
                      <td>
                        <ItemPicker line={l} onPick={(h) => updateLine(l.key, { item_no: h.item_no, nama: h.name, unit: l.unit || h.unit || '', unit_price: l.unit_price || String(h.harga_terakhir ?? h.vendor_price ?? '') })} onText={() => updateLine(l.key, { item_no: '', nama: '' })} />
                        <input className="pap-input pap-po-note" maxLength={1000} value={l.catatan} onChange={(e) => updateLine(l.key, { catatan: e.target.value })} placeholder="Catatan baris (opsional)" aria-label={`Catatan barang ${i + 1}`} />
                        {!!l.shipped && <div className="pap-cell-sub">Sudah diterima {l.shipped}</div>}
                      </td>
                      <td><input className="pap-input pap-num" inputMode="decimal" required={!!l.item_no} value={l.quantity} onChange={(e) => updateLine(l.key, { quantity: e.target.value })} aria-label="Kuantitas" /></td>
                      <td><input className="pap-input" maxLength={40} value={l.unit} onChange={(e) => updateLine(l.key, { unit: e.target.value })} aria-label="Satuan" /></td>
                      <td><input className="pap-input pap-num" inputMode="decimal" required={!!l.item_no} value={l.unit_price} onChange={(e) => updateLine(l.key, { unit_price: e.target.value })} aria-label="Harga satuan" /></td>
                      <td><input className="pap-input pap-num" inputMode="decimal" value={l.disc_pct} onChange={(e) => updateLine(l.key, { disc_pct: e.target.value })} aria-label="Diskon persen" /></td>
                      <td className="pap-num pap-nowrap">{formatRupiah(lineTotal(l))}</td>
                      <td>{lines.length > 1 && <button type="button" className="pap-icon-button" aria-label={`Hapus barang ${i + 1}`} onClick={() => setLines((list) => list.filter((x) => x.key !== l.key))}><Trash2 /></button>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button type="button" className="pap-btn pap-add-item" onClick={() => setLines((list) => [...list, blankLine()])}><Plus /> Tambah barang</button>
          </div>

          <dl className="pap-po-totals">
            <div><dt>Sub total</dt><dd>{formatRupiah(totals.sub)}</dd></div>
            <div><dt>Diskon <input className="pap-input pap-num" inputMode="decimal" value={v.disc_pct} onChange={(e) => set('disc_pct', e.target.value)} aria-label="Diskon faktur persen" placeholder="0" /> %</dt><dd>{totals.disc ? `− ${formatRupiah(totals.disc)}` : '—'}</dd></div>
            {v.taxable && <div><dt>PPN {PPN}%{v.inclusive_tax ? ' (termasuk)' : ''}</dt><dd>{formatRupiah(totals.tax)}</dd></div>}
            <div className="total"><dt>Total</dt><dd>{formatRupiah(totals.total)}</dd></div>
            <p className="pap-hint">Perkiraan; total akhir dihitung Accurate.</p>
          </dl>
        </form>
      )}
    </Modal>
  )
}

// ---------- Harga beli acuan (Harga Beli di data barang Accurate) ----------
export function PriceEditor({ id, current, lastPrice, unit, logs, onSaved }: {
  id: number; current: number | null; lastPrice: number | null; unit: string | null
  logs: { harga_lama: number | null; harga_baru: number; catatan: string | null; created_at: string; user_name: string | null }[]; onSaved: () => void
}) {
  const [harga, setHarga] = useState(String(current || lastPrice || ''))
  const [catatan, setCatatan] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState('')
  async function save(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const res = await api<{ item: { vendor_price: number } }>(`/api/purchasing/prices/${id}`, { method: 'PUT', json: { harga, catatan } })
      setDone(`Harga beli acuan di Accurate menjadi ${formatRupiah(res.item.vendor_price)}.`)
      setCatatan('')
      onSaved()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="pap-detail-section">
      <h3>Harga beli acuan di Accurate{unit ? ` (per ${unit})` : ''}</h3>
      <p className="pap-muted">Saat ini {current ? <b>{formatRupiah(current)}</b> : 'belum diisi'}. Harga ini menjadi harga bawaan saat membuat PO / faktur pembelian di Accurate.</p>
      {error && <Notice onClose={() => setError('')}>{error}</Notice>}
      {done && <Notice kind="success" onClose={() => setDone('')}>{done}</Notice>}
      <form className="pap-inline-actions pap-wrap" onSubmit={save}>
        <input className="pap-input pap-num" inputMode="decimal" required value={harga} onChange={(e) => setHarga(e.target.value)} aria-label="Harga beli acuan" style={{ maxWidth: 160 }} />
        <input className="pap-input" maxLength={500} value={catatan} onChange={(e) => setCatatan(e.target.value)} placeholder="Alasan / catatan (opsional)" style={{ flex: 1, minWidth: 180 }} />
        <button className="pap-primary-button" disabled={busy}><Save /> {busy ? 'Menyimpan...' : 'Simpan ke Accurate'}</button>
      </form>
      {logs.length > 0 && (
        <ul className="pap-price-logs">
          {logs.map((l, i) => <li key={i}>{formatDate(l.created_at, true)} · {l.user_name ?? '—'}: {l.harga_lama === null ? '—' : formatRupiah(l.harga_lama)} → <b>{formatRupiah(l.harga_baru)}</b>{l.catatan ? ` · ${l.catatan}` : ''}</li>)}
        </ul>
      )}
    </section>
  )
}

// ---------- Supplier (pemasok Accurate) ----------
type VendorValues = { name: string; category: string; mobile_phone: string; work_phone: string; email: string; alamat: string; kota: string; npwp: string }
export function VendorFormModal({ id, onClose, onSaved }: { id: number | null; onClose: () => void; onSaved: (message: string) => void }) {
  const [v, setV] = useState<VendorValues>({ name: '', category: '', mobile_phone: '', work_phone: '', email: '', alamat: '', kota: '', npwp: '' })
  const [categories, setCategories] = useState<string[]>([])
  const [loading, setLoading] = useState(!!id)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => { api<{ categories: string[] }>('/api/purchasing/vendors/categories').then((r) => setCategories(r.categories)).catch(() => {}) }, [])
  // Ubah: isian terbaru langsung dari Accurate
  useEffect(() => {
    if (!id) return
    api<{ item: VendorValues }>(`/api/purchasing/vendors/${id}/accurate`)
      .then((r) => setV({ name: r.item.name, category: r.item.category, mobile_phone: r.item.mobile_phone, work_phone: r.item.work_phone, email: r.item.email, alamat: r.item.alamat, kota: r.item.kota, npwp: r.item.npwp }))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [id])
  const set = (k: keyof VendorValues) => (e: { target: { value: string } }) => setV({ ...v, [k]: e.target.value })
  async function save(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const res = await api<{ item: { vendor_no: string; name: string } }>(id ? `/api/purchasing/vendors/${id}` : '/api/purchasing/vendors', { method: id ? 'PATCH' : 'POST', json: v })
      onSaved(id ? `Data ${res.item.name} diperbarui di Accurate.` : `Pemasok ${res.item.name} (${res.item.vendor_no}) ditambahkan di Accurate.`)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal title={id ? 'Ubah data pemasok' : 'Tambah pemasok'} subtitle="Disimpan langsung ke data Pemasok di Accurate" onClose={onClose}
      footer={<><span className="pap-spacer" /><button className="pap-btn" onClick={onClose}>Batal</button><button className="pap-primary-button" form="vendor-acc-form" disabled={busy || loading}><Send /> {busy ? 'Mengirim...' : 'Simpan ke Accurate'}</button></>}>
      <form id="vendor-acc-form" className="pap-form-grid" onSubmit={save}>
        {error && <div className="full"><Notice onClose={() => setError('')}>{error}</Notice></div>}
        <Field label="Nama pemasok *" full><input className="pap-input" required maxLength={255} value={v.name} onChange={set('name')} /></Field>
        <Field label="Kategori">
          <input className="pap-input" list="pap-vendor-categories" maxLength={150} value={v.category} onChange={set('category')} placeholder="Mis. Umum" />
          <datalist id="pap-vendor-categories">{categories.map((c) => <option key={c} value={c} />)}</datalist>
        </Field>
        <Field label="NPWP"><input className="pap-input" maxLength={40} value={v.npwp} onChange={set('npwp')} /></Field>
        <Field label="No. HP"><input className="pap-input" maxLength={80} value={v.mobile_phone} onChange={set('mobile_phone')} /></Field>
        <Field label="Telepon kantor"><input className="pap-input" maxLength={80} value={v.work_phone} onChange={set('work_phone')} /></Field>
        <Field label="Email" full><input className="pap-input" type="email" maxLength={255} value={v.email} onChange={set('email')} /></Field>
        <Field label="Alamat" full><textarea className="pap-input" rows={2} maxLength={500} value={v.alamat} onChange={set('alamat')} /></Field>
        <Field label="Kota"><input className="pap-input" maxLength={150} value={v.kota} onChange={set('kota')} /></Field>
      </form>
    </Modal>
  )
}
