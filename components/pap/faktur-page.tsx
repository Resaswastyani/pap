'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { CheckCircle2, Factory, FileText, Pencil, Plus, Printer, Receipt, Search, Send, Trash2 } from 'lucide-react'
import type { UserProfile } from '@/lib/users'
import { formatRupiah } from './accurate'
import { MonthNav, monthLabel, useDebounced } from './accurate-production'
import { ItemPicker } from './purchasing-forms'
import { api, Field, formatDate, Modal, Notice, Pager, usePaged } from './ui'

// Faktur Produksi: faktur penjualan Accurate untuk pesanan (SO) yang produksinya selesai.
type ReadyLine = { item_no: string; item_name: string; quantity: number; unit: string | null; diproduksi: boolean; diproduksi_qty: number }
type Ready = {
  so_id: number; so_number: string; tanggal: string; ship_date: string | null; status: string; total: number; customer_name: string | null; customer_no: string | null
  selesai_tanggal: string | null; produksi: 'selesai' | 'sebagian' | 'belum' | 'tanpa_produksi'; baris_selesai: number; baris_produksi: number; lines: ReadyLine[]
}
type Invoice = { id: number; number: string; trans_date: string; due_date: string | null; total_amount: number | null; owing: number | null; status: string | null; customer_name: string | null; customer_no: string | null; created_name: string | null; updated_name: string | null }
type Can = { create: boolean; update: boolean; delete: boolean }
const PRODUKSI: Record<Ready['produksi'], [string, string]> = { selesai: ['Produksi selesai', 'success'], tanpa_produksi: ['Tanpa produksi', 'info'], sebagian: ['Produksi sebagian', 'warning'], belum: ['Belum diproduksi', 'neutral'] }
const qty = (v: number, unit: string | null) => `${v.toLocaleString('id-ID', { maximumFractionDigits: 2 })}${unit ? ` ${unit}` : ''}`

export function FakturPage(_props: { user: UserProfile }) {
  const [tab, setTab] = useState<'siap' | 'faktur'>('siap')
  const [form, setForm] = useState<{ id: number | null; soId: number | null } | null>(null)
  const [message, setMessage] = useState('')
  const [reload, setReload] = useState(0)
  const done = (text: string) => {
    setForm(null)
    setMessage(text)
    setTimeout(() => setMessage(''), 6000)
    setReload((r) => r + 1)
  }
  return (
    <>
      <div className="pap-page-heading">
        <div>
          <p className="pap-eyebrow">PRODUKSI · ACCURATE</p>
          <h1>Faktur Produksi</h1>
          <span>Pesanan (SO) yang produksinya selesai siap dibuatkan faktur penjualan. Faktur dibuat, diubah, dan dihapus langsung di Accurate, lalu bisa dicetak sebagai invoice.</span>
        </div>
      </div>
      <div className="pap-segmented pap-page-tabs" role="tablist" aria-label="Faktur produksi">
        <button role="tab" aria-selected={tab === 'siap'} className={tab === 'siap' ? 'active' : ''} onClick={() => setTab('siap')}><Factory /> Siap difakturkan</button>
        <button role="tab" aria-selected={tab === 'faktur'} className={tab === 'faktur' ? 'active' : ''} onClick={() => setTab('faktur')}><Receipt /> Daftar faktur</button>
      </div>
      {message && <Notice kind="success" onClose={() => setMessage('')}>{message}</Notice>}
      {tab === 'siap'
        ? <ReadyList key={`r${reload}`} onCreate={(soId) => setForm({ id: null, soId })} />
        : <InvoiceList key={`i${reload}`} onEdit={(id) => setForm({ id, soId: null })} onCreate={() => setForm({ id: null, soId: null })} onDeleted={done} />}
      {form && <InvoiceForm id={form.id} soId={form.soId} onClose={() => setForm(null)} onSaved={(text) => { done(text); setTab('faktur') }} />}
    </>
  )
}

// ---------- SO siap difakturkan ----------
function ReadyList({ onCreate }: { onCreate: (soId: number) => void }) {
  const [semua, setSemua] = useState(false)
  const [q, setQ] = useState('')
  const query = useDebounced(q)
  const [data, setData] = useState<{ items: Ready[]; total: number; can: Can } | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    setData(null)
    api<{ items: Ready[]; total: number; can: Can }>(`/api/faktur?tab=siap${semua ? '&semua=1' : ''}${query ? `&q=${encodeURIComponent(query)}` : ''}`).then(setData).catch((e) => setError(e.message))
  }, [semua, query])
  const paged = usePaged(data?.items ?? [], [semua, query])
  return (
    <div className="pap-table-card">
      <div className="pap-card-head">
        <div><h2>Pesanan siap difakturkan</h2><p>SO terbuka 120 hari terakhir. Produksi dianggap selesai bila barang yang diproduksi sudah punya Penyelesaian Barang Jadi sejak tanggal SO sebanyak pesanan.</p></div>
      </div>
      <div className="pap-filters">
        <label className="pap-filter-search"><Search /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari SO, pelanggan, barang..." /></label>
        <label className="pap-check"><input type="checkbox" checked={semua} onChange={(e) => setSemua(e.target.checked)} /><span>Tampilkan juga yang produksinya belum selesai</span></label>
      </div>
      {error && <div className="pap-card-notice"><Notice onClose={() => setError('')}>{error}</Notice></div>}
      <div className="pap-table-wrap">
        <table className="pap-plan-table">
          <thead><tr><th>Barang</th><th className="pap-num">Pesanan</th><th className="pap-num">Hasil produksi</th></tr></thead>
          <tbody>
            {paged.items.flatMap((o) => [
              <tr key={`so${o.so_id}`} className="pap-group-row pap-plan-head">
                <td colSpan={3}>
                  <div className="pap-plan-title">
                    <span><b>{o.so_number}</b> · {o.customer_name ?? '—'} <span className={`pap-status ${PRODUKSI[o.produksi][1]}`}>{PRODUKSI[o.produksi][0]}{o.produksi === 'selesai' && o.selesai_tanggal ? ` ${formatDate(o.selesai_tanggal)}` : ''}</span></span>
                    <span className="pap-cell-sub">{formatDate(o.tanggal)}{o.ship_date ? ` · kirim ${formatDate(o.ship_date)}` : ''} · {formatRupiah(o.total)} · {o.status}</span>
                  </div>
                  {data?.can.create && <div className="pap-po-actions"><button className="pap-btn" onClick={() => onCreate(o.so_id)}><FileText /> Buat faktur</button></div>}
                </td>
              </tr>,
              ...o.lines.map((l, i) => (
                <tr key={`l${o.so_id}-${i}`}>
                  <td><div className="pap-cell-title pap-plan-item">{l.item_name}</div><div className="pap-cell-sub">{l.item_no}{l.diproduksi ? '' : ' · tidak diproduksi'}</div></td>
                  <td className="pap-num pap-nowrap">{qty(l.quantity, l.unit)}</td>
                  <td className={`pap-num pap-nowrap ${l.diproduksi && l.diproduksi_qty < l.quantity ? 'pap-text-warning' : ''}`}>{l.diproduksi ? <>{qty(l.diproduksi_qty, l.unit)}{l.diproduksi_qty >= l.quantity && <CheckCircle2 className="pap-inline-icon" />}</> : '—'}</td>
                </tr>
              )),
            ])}
          </tbody>
        </table>
        {data && !data.items.length && <div className="pap-empty">{query ? 'Tidak ada pesanan yang cocok.' : semua ? 'Tidak ada SO terbuka.' : 'Belum ada pesanan yang produksinya selesai dan belum difakturkan.'}</div>}
        {!data && !error && <div className="pap-empty">Memuat pesanan...</div>}
        <Pager {...paged.pager} noun="pesanan" />
      </div>
    </div>
  )
}

// ---------- Daftar faktur ----------
function InvoiceList({ onEdit, onCreate, onDeleted }: { onEdit: (id: number) => void; onCreate: () => void; onDeleted: (text: string) => void }) {
  const [periode, setPeriode] = useState('')
  const [status, setStatus] = useState('')
  const [q, setQ] = useState('')
  const query = useDebounced(q)
  const [data, setData] = useState<{ periode: string; items: Invoice[]; can: Can } | null>(null)
  const [error, setError] = useState('')
  const load = useCallback(() => {
    const p = new URLSearchParams({ tab: 'faktur' })
    if (periode) p.set('periode', periode)
    if (status) p.set('status', status)
    if (query) p.set('q', query)
    api<{ periode: string; items: Invoice[]; can: Can }>(`/api/faktur?${p}`).then((r) => { setData(r); if (!periode) setPeriode(r.periode) }).catch((e) => setError(e.message))
  }, [periode, status, query])
  useEffect(() => { load() }, [load])
  const paged = usePaged(data?.items ?? [], [periode, status, query])
  async function remove(f: Invoice) {
    if (!window.confirm(`Hapus faktur ${f.number} (${f.customer_name ?? '-'}) dari Accurate? Jurnal & stok terkait ikut dibatalkan di Accurate.`)) return
    try {
      await api(`/api/faktur/${f.id}`, { method: 'DELETE' })
      onDeleted(`Faktur ${f.number} dihapus dari Accurate.`)
    } catch (e) {
      setError((e as Error).message)
    }
  }
  const can = data?.can
  return (
    <div className="pap-table-card">
      <div className="pap-card-head">
        <div><h2>Faktur penjualan</h2><p>{status === 'belum_lunas' ? 'Semua faktur belum lunas' : monthLabel(periode)} · data dari Accurate</p></div>
        <div className="pap-inline-actions pap-wrap">
          {status !== 'belum_lunas' && periode && <MonthNav periode={periode} onChange={setPeriode} />}
          {can?.create && <button className="pap-primary-button" onClick={onCreate}><Plus /> Buat faktur</button>}
        </div>
      </div>
      <div className="pap-filters">
        <label className="pap-filter-search"><Search /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari nomor faktur / pelanggan..." /></label>
        <select className="pap-select" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter status">
          <option value="">Semua faktur bulan ini</option>
          <option value="belum_lunas">Belum lunas (semua tanggal)</option>
        </select>
      </div>
      {error && <div className="pap-card-notice"><Notice onClose={() => setError('')}>{error}</Notice></div>}
      <div className="pap-table-wrap">
        <table>
          <thead><tr><th>Faktur</th><th>Pelanggan</th><th className="pap-num">Total</th><th className="pap-num">Sisa</th><th>Status</th><th /></tr></thead>
          <tbody>
            {paged.items.map((f) => (
              <tr key={f.id}>
                <td className="pap-nowrap"><div className="pap-cell-title">{f.number}</div><div className="pap-cell-sub">{formatDate(f.trans_date)}{f.created_name ? ` · dibuat ${f.created_name}` : ''}</div></td>
                <td><div>{f.customer_name ?? '—'}</div><div className="pap-cell-sub">{f.customer_no}</div></td>
                <td className="pap-num pap-nowrap"><strong>{formatRupiah(f.total_amount)}</strong></td>
                <td className="pap-num pap-nowrap">{f.owing ? formatRupiah(f.owing) : '—'}</td>
                <td><span className={`pap-status ${f.status === 'Lunas' ? 'success' : 'warning'}`}>{f.status ?? '—'}</span></td>
                <td className="pap-nowrap">
                  <a className="pap-icon-button" href={`/cetak/faktur/${f.id}`} target="_blank" rel="noreferrer" aria-label={`Cetak ${f.number}`} title="Cetak invoice"><Printer /></a>
                  {can?.update && <button className="pap-icon-button" aria-label={`Ubah ${f.number}`} title="Ubah" onClick={() => onEdit(f.id)}><Pencil /></button>}
                  {can?.delete && <button className="pap-icon-button" aria-label={`Hapus ${f.number}`} title="Hapus" onClick={() => remove(f)}><Trash2 /></button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {data && !data.items.length && <div className="pap-empty">{query || status ? 'Tidak ada faktur yang cocok.' : `Belum ada faktur di ${monthLabel(periode)}.`}</div>}
        {!data && !error && <div className="pap-empty">Memuat faktur...</div>}
        <Pager {...paged.pager} noun="faktur" />
      </div>
    </div>
  )
}

// ---------- Form faktur (buat dari SO / manual / ubah) ----------
type Line = { key: number; id: number | null; item_no: string; nama: string; quantity: string; unit: string; unit_price: string; disc_pct: string; so_number: string; catatan: string }
type Expense = { key: number; id: number | null; account_no: string; nama: string; amount: string; so_number: string }
type Values = { customer_no: string; tanggal: string; nomor: string; po_number: string; payment_term: string; ship_date: string; alamat: string; keterangan: string; taxable: boolean; inclusive_tax: boolean }
let seq = 0
const blankLine = (so = ''): Line => ({ key: ++seq, id: null, item_no: '', nama: '', quantity: '', unit: '', unit_price: '', disc_pct: '', so_number: so, catatan: '' })
const dec = (v: string) => Number(String(v).replace(',', '.')) || 0
const today = () => new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10)
const PPN = 11
type Raw = Record<string, unknown>
const s = (v: unknown) => (v === null || v === undefined ? '' : String(v))

function InvoiceForm({ id, soId, onClose, onSaved }: { id: number | null; soId: number | null; onClose: () => void; onSaved: (text: string) => void }) {
  const [options, setOptions] = useState<{ paymentTerms: { id: number; name: string }[]; customers: { id: number; customer_no: string; name: string }[] } | null>(null)
  const [v, setV] = useState<Values>({ customer_no: '', tanggal: today(), nomor: '', po_number: '', payment_term: '', ship_date: '', alamat: '', keterangan: '', taxable: false, inclusive_tax: false })
  const [lines, setLines] = useState<Line[]>(() => [blankLine()])
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [meta, setMeta] = useState<{ title: string; customer: string; status?: string } | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        setOptions(await api('/api/faktur/options'))
        const fill = (d: Raw, so: string) => {
          setV((cur) => ({
            ...cur, customer_no: s(d.customer_no), po_number: s(d.po_number), payment_term: s(d.payment_term), ship_date: s(d.ship_date).slice(0, 10), alamat: s(d.alamat), keterangan: s(d.keterangan),
            taxable: d.taxable === true, inclusive_tax: d.inclusive_tax === true, ...(d.tanggal ? { tanggal: s(d.tanggal).slice(0, 10) } : {}), ...(d.number ? { nomor: s(d.number) } : {}),
          }))
          setLines(((d.lines ?? d.items) as Raw[]).map((l) => ({ key: ++seq, id: (l.id as number) ?? null, item_no: s(l.item_no), nama: s(l.nama), quantity: s(l.quantity), unit: s(l.unit), unit_price: s(l.unit_price), disc_pct: s(l.disc_pct), so_number: s(l.so_number || so), catatan: s(l.catatan) })))
          setExpenses(((d.expenses ?? []) as Raw[]).map((e) => ({ key: ++seq, id: (e.id as number) ?? null, account_no: s(e.account_no), nama: s(e.nama), amount: s(e.amount), so_number: s(e.so_number || so) })))
        }
        if (id) {
          const { item } = await api<{ item: Raw }>(`/api/faktur/${id}`)
          if (!alive) return
          fill(item, '')
          setMeta({ title: `Ubah faktur ${s(item.number)}`, customer: s(item.customer_name), status: s(item.status) })
          if (Number(item.receipt) > 0) setError('Faktur ini sudah ada penerimaan pembayaran; perubahan harus dilakukan di Accurate.')
        } else if (soId) {
          const { draft } = await api<{ draft: Raw }>(`/api/faktur/draft?so=${soId}`)
          if (!alive) return
          fill(draft, s(draft.so_number))
          setMeta({ title: `Faktur dari ${s(draft.so_number)}`, customer: s(draft.customer_name) })
        } else setMeta({ title: 'Faktur penjualan baru', customer: '' })
      } catch (e) {
        if (alive) setError((e as Error).message)
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => { alive = false }
  }, [id, soId])

  const set = <K extends keyof Values>(k: K, value: Values[K]) => setV((cur) => ({ ...cur, [k]: value }))
  const updateLine = (key: number, patch: Partial<Line>) => setLines((list) => list.map((l) => (l.key === key ? { ...l, ...patch } : l)))
  const updateExpense = (key: number, patch: Partial<Expense>) => setExpenses((list) => list.map((e) => (e.key === key ? { ...e, ...patch } : e)))
  const lineTotal = (l: Line) => dec(l.quantity) * dec(l.unit_price) * (1 - dec(l.disc_pct) / 100)
  const totals = useMemo(() => {
    const sub = lines.reduce((t, l) => t + lineTotal(l), 0)
    const tax = !v.taxable ? 0 : v.inclusive_tax ? sub - sub / (1 + PPN / 100) : sub * (PPN / 100)
    const biaya = expenses.reduce((t, e) => t + dec(e.amount), 0)
    return { sub, tax, biaya, total: (v.taxable && !v.inclusive_tax ? sub + tax : sub) + biaya }
  }, [lines, expenses, v.taxable, v.inclusive_tax])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const payload = {
        ...v,
        lines: lines.filter((l) => l.item_no).map(({ key: _k, ...l }) => l),
        expenses: expenses.filter((x) => x.account_no).map(({ key: _k, ...x }) => x),
      }
      const res = await api<{ number: string }>(id ? `/api/faktur/${id}` : '/api/faktur', { method: id ? 'PUT' : 'POST', json: payload })
      onSaved(id ? `Faktur ${res.number} diperbarui di Accurate.` : `Faktur ${res.number} dibuat di Accurate.`)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const known = !v.customer_no || options?.customers.some((c) => c.customer_no === v.customer_no)
  return (
    <Modal
      title={meta?.title ?? 'Faktur penjualan'}
      subtitle={`${meta?.customer ? `${meta.customer} · ` : ''}${meta?.status ? `${meta.status} · ` : ''}disimpan langsung sebagai Faktur Penjualan di Accurate`}
      wide
      onClose={onClose}
      footer={<><span className="pap-spacer" /><button className="pap-btn" onClick={onClose}>Batal</button><button className="pap-primary-button" form="faktur-form" disabled={busy || loading}><Send /> {busy ? 'Mengirim ke Accurate...' : id ? 'Simpan ke Accurate' : 'Buat faktur di Accurate'}</button></>}
    >
      {error && <Notice onClose={() => setError('')}>{error}</Notice>}
      {loading ? <p className="pap-muted">Memuat data dari Accurate...</p> : (
        <form id="faktur-form" className="pap-po-form" onSubmit={submit}>
          <div className="pap-form-grid">
            <Field label="Pelanggan *">
              <select className="pap-select" required value={v.customer_no} onChange={(e) => set('customer_no', e.target.value)}>
                <option value="">Pilih pelanggan</option>
                {!known && <option value={v.customer_no}>{meta?.customer || v.customer_no}</option>}
                {options?.customers.map((c) => <option key={c.id} value={c.customer_no}>{c.name} ({c.customer_no})</option>)}
              </select>
            </Field>
            <Field label="Tanggal *"><input className="pap-input" type="date" required value={v.tanggal} onChange={(e) => set('tanggal', e.target.value)} /></Field>
            <Field label="Nomor invoice" hint={id ? undefined : 'Kosongkan agar dinomori otomatis oleh Accurate'}><input className="pap-input" maxLength={50} value={v.nomor} onChange={(e) => set('nomor', e.target.value)} placeholder="Otomatis" /></Field>
            <Field label="No. PO pelanggan"><input className="pap-input" maxLength={80} value={v.po_number} onChange={(e) => set('po_number', e.target.value)} /></Field>
          </div>
          <div className="pap-po-sections">
            <fieldset>
              <legend>Info lainnya</legend>
              <Field label="Syarat pembayaran (tempo)">
                <select className="pap-select" value={v.payment_term} onChange={(e) => set('payment_term', e.target.value)}>
                  <option value="">Ikuti bawaan pelanggan</option>
                  {v.payment_term && !options?.paymentTerms.some((p) => p.name === v.payment_term) && <option value={v.payment_term}>{v.payment_term}</option>}
                  {options?.paymentTerms.map((p) => <option key={p.id} value={p.name}>{p.name}</option>)}
                </select>
              </Field>
              <Field label="Alamat kirim"><textarea className="pap-input" rows={4} maxLength={1000} value={v.alamat} onChange={(e) => set('alamat', e.target.value)} /></Field>
            </fieldset>
            <fieldset>
              <legend>Pajak & pengiriman</legend>
              <label className="pap-check"><input type="checkbox" checked={v.taxable} onChange={(e) => setV({ ...v, taxable: e.target.checked, inclusive_tax: e.target.checked && v.inclusive_tax })} /><span>Kena pajak (PPN {PPN}%)</span></label>
              <label className="pap-check"><input type="checkbox" disabled={!v.taxable} checked={v.inclusive_tax} onChange={(e) => set('inclusive_tax', e.target.checked)} /><span>Total termasuk pajak</span></label>
              <Field label="Tanggal kirim"><input className="pap-input" type="date" value={v.ship_date} onChange={(e) => set('ship_date', e.target.value)} /></Field>
              <Field label="Keterangan"><textarea className="pap-input" rows={2} maxLength={2000} value={v.keterangan} onChange={(e) => set('keterangan', e.target.value)} /></Field>
            </fieldset>
          </div>

          <div className="pap-field">
            <span>Barang</span>
            <div className="pap-table-wrap bordered pap-po-lines">
              <table>
                <thead><tr><th>Nama barang</th><th className="pap-num">Quantity</th><th>Satuan</th><th className="pap-num">Harga @</th><th className="pap-num">Disk %</th><th className="pap-num">Jumlah</th><th /></tr></thead>
                <tbody>
                  {lines.map((l, i) => (
                    <tr key={l.key}>
                      <td>
                        <ItemPicker endpoint="/api/faktur/items" line={l} onPick={(h) => updateLine(l.key, { item_no: h.item_no, nama: h.name, unit: l.unit || h.unit || '', unit_price: l.unit_price || String(h.harga_terakhir ?? '') })} onText={() => updateLine(l.key, { item_no: '', nama: '' })} />
                        {l.so_number && <div className="pap-cell-sub">dari {l.so_number}</div>}
                      </td>
                      <td><input className="pap-input pap-num" inputMode="decimal" required={!!l.item_no} value={l.quantity} onChange={(e) => updateLine(l.key, { quantity: e.target.value })} aria-label="Quantity" /></td>
                      <td><input className="pap-input" maxLength={40} value={l.unit} onChange={(e) => updateLine(l.key, { unit: e.target.value })} aria-label="Satuan" /></td>
                      <td><input className="pap-input pap-num" inputMode="decimal" required={!!l.item_no} value={l.unit_price} onChange={(e) => updateLine(l.key, { unit_price: e.target.value })} aria-label="Harga" /></td>
                      <td><input className="pap-input pap-num" inputMode="decimal" value={l.disc_pct} onChange={(e) => updateLine(l.key, { disc_pct: e.target.value })} aria-label="Diskon persen" /></td>
                      <td className="pap-num pap-nowrap">{formatRupiah(lineTotal(l))}</td>
                      <td>{lines.length > 1 && <button type="button" className="pap-icon-button" aria-label={`Hapus barang ${i + 1}`} onClick={() => setLines((list) => list.filter((x) => x.key !== l.key))}><Trash2 /></button>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button type="button" className="pap-btn pap-add-item" onClick={() => setLines((list) => [...list, blankLine(list.find((x) => x.so_number)?.so_number ?? '')])}><Plus /> Tambah barang</button>
          </div>

          <div className="pap-field">
            <span>Biaya lain (mis. biaya kirim)</span>
            {expenses.length > 0 && (
              <div className="pap-table-wrap bordered pap-po-lines">
                <table>
                  <thead><tr><th>Nama biaya</th><th>No. akun Accurate</th><th className="pap-num">Jumlah</th><th /></tr></thead>
                  <tbody>
                    {expenses.map((x) => (
                      <tr key={x.key}>
                        <td><input className="pap-input" maxLength={255} value={x.nama} onChange={(e) => updateExpense(x.key, { nama: e.target.value })} aria-label="Nama biaya" placeholder="IGP - Biaya Kirim Online" /></td>
                        <td><input className="pap-input" maxLength={50} required={!!x.amount} value={x.account_no} onChange={(e) => updateExpense(x.key, { account_no: e.target.value })} aria-label="Nomor akun" placeholder="I1-51326" /></td>
                        <td><input className="pap-input pap-num" inputMode="decimal" value={x.amount} onChange={(e) => updateExpense(x.key, { amount: e.target.value })} aria-label="Jumlah biaya" /></td>
                        <td><button type="button" className="pap-icon-button" aria-label="Hapus biaya" onClick={() => setExpenses((list) => list.filter((y) => y.key !== x.key))}><Trash2 /></button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <button type="button" className="pap-btn pap-add-item" onClick={() => setExpenses((list) => [...list, { key: ++seq, id: null, account_no: list[0]?.account_no ?? '', nama: '', amount: '', so_number: lines.find((l) => l.so_number)?.so_number ?? '' }])}><Plus /> Tambah biaya</button>
          </div>

          <dl className="pap-po-totals">
            <div><dt>Jumlah</dt><dd>{formatRupiah(totals.sub)}</dd></div>
            {v.taxable && <div><dt>PPN {PPN}%{v.inclusive_tax ? ' (termasuk)' : ''}</dt><dd>{formatRupiah(totals.tax)}</dd></div>}
            {totals.biaya > 0 && <div><dt>Biaya lain</dt><dd>{formatRupiah(totals.biaya)}</dd></div>}
            <div className="total"><dt>Total</dt><dd>{formatRupiah(totals.total)}</dd></div>
            <p className="pap-hint">Perkiraan; total akhir dan uang muka (DP) dihitung Accurate.</p>
          </dl>
        </form>
      )}
    </Modal>
  )
}
