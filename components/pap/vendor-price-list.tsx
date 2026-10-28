'use client'

import { useCallback, useEffect, useState } from 'react'
import { Pencil, Plus, Search, Send, Trash2 } from 'lucide-react'
import { formatRupiah } from './accurate'
import { ItemPicker } from './purchasing-forms'
import { api, Field, formatDate, Modal, Notice, confirmDialog } from './ui'

// Harga Pemasok (dokumen VPA di Accurate): daftar harga beli per pemasok yang berlaku mulai tanggal tertentu.
type VpLine = { id: number | null; item_no: string; item_name: string; unit: string; price: number }
type Vp = { id: number; number: string; tanggal: string | null; vendor_no: string; vendor_name: string; keterangan: string; lines: VpLine[] }
type VpRes = { items: Vp[]; page: number; pageCount: number; total: number; can: { create: boolean; update: boolean; delete: boolean } }
type VendorOption = { id: number; vendor_no: string; name: string }

let seq = 0
const today = () => new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10)

export function VendorPriceList() {
  const [page, setPage] = useState(1)
  const [q, setQ] = useState('')
  const [query, setQuery] = useState('')
  const [data, setData] = useState<VpRes | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [form, setForm] = useState<Vp | 'baru' | null>(null)
  useEffect(() => {
    const t = setTimeout(() => { setQuery(q.trim()); setPage(1) }, 400)
    return () => clearTimeout(t)
  }, [q])
  const load = useCallback(async () => {
    setLoading(true)
    try {
      setData(await api<VpRes>(`/api/purchasing/vendor-prices?page=${page}${query ? `&q=${encodeURIComponent(query)}` : ''}`))
      setError('')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [page, query])
  useEffect(() => { load() }, [load])
  const flash = (text: string) => {
    setForm(null)
    setMessage(text)
    setTimeout(() => setMessage(''), 6000)
    load()
  }
  async function remove(d: Vp) {
    if (!(await confirmDialog(`Hapus harga pemasok ${d.number} (${d.vendor_name}) dari Accurate?`))) return
    try {
      await api(`/api/purchasing/vendor-prices/${d.id}`, { method: 'DELETE' })
      flash(`Harga pemasok ${d.number} dihapus dari Accurate.`)
    } catch (e) {
      setError((e as Error).message)
    }
  }
  return (
    <div className="pap-table-card">
      <div className="pap-card-head">
        <div><h2>Harga Pemasok (Accurate)</h2><p>Harga beli per pemasok yang berlaku mulai tanggal tertentu. Tersimpan langsung di modul Harga Pemasok Accurate dan dipakai saat membuat PO / faktur pembelian.</p></div>
        {data?.can.create && <button className="pap-primary-button" onClick={() => setForm('baru')}><Plus /> Tambah harga pemasok</button>}
      </div>
      <div className="pap-filters">
        <label className="pap-filter-search"><Search /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari nomor / pemasok..." /></label>
      </div>
      {message && <div className="pap-card-notice"><Notice kind="success" onClose={() => setMessage('')}>{message}</Notice></div>}
      {error && <div className="pap-card-notice"><Notice onClose={() => setError('')}>{error}</Notice></div>}
      <div className="pap-table-wrap">
        <table className="pap-plan-table">
          <thead><tr><th>Barang</th><th>Satuan</th><th className="pap-num">Harga</th></tr></thead>
          <tbody>
            {data?.items.flatMap((d) => [
              <tr key={`h${d.id}`} className="pap-group-row pap-plan-head">
                <td colSpan={3}>
                  <div className="pap-plan-title">
                    <span><b>{d.number}</b> · {d.vendor_name}</span>
                    <span className="pap-cell-sub">berlaku {formatDate(d.tanggal)}{d.keterangan ? ` · ${d.keterangan}` : ''}</span>
                  </div>
                  {(data.can.update || data.can.delete) && (
                    <div className="pap-po-actions">
                      {data.can.update && <button className="pap-btn" onClick={() => setForm(d)}><Pencil /> Ubah</button>}
                      {data.can.delete && <button className="pap-btn danger" onClick={() => remove(d)}><Trash2 /> Hapus</button>}
                    </div>
                  )}
                </td>
              </tr>,
              ...d.lines.map((l, i) => (
                <tr key={`l${d.id}-${i}`}>
                  <td><div className="pap-cell-title pap-plan-item">{l.item_name}</div><div className="pap-cell-sub">{l.item_no}</div></td>
                  <td>{l.unit || '—'}</td>
                  <td className="pap-num pap-nowrap"><strong>{formatRupiah(l.price)}</strong></td>
                </tr>
              )),
            ])}
          </tbody>
        </table>
        {!loading && !data?.items.length && <div className="pap-empty">{query ? 'Tidak ada harga pemasok yang cocok.' : 'Belum ada harga pemasok di Accurate.'}</div>}
        {loading && <div className="pap-empty">Memuat dari Accurate...</div>}
      </div>
      {data && data.pageCount > 1 && (
        <div className="pap-inline-actions pap-pager-simple">
          <button className="pap-btn" disabled={page <= 1} onClick={() => setPage(page - 1)}>Sebelumnya</button>
          <span className="pap-muted">Halaman {page} dari {data.pageCount} · {data.total} dokumen</span>
          <button className="pap-btn" disabled={page >= data.pageCount} onClick={() => setPage(page + 1)}>Berikutnya</button>
        </div>
      )}
      {form && <VendorPriceForm item={form === 'baru' ? null : form} onClose={() => setForm(null)} onSaved={flash} />}
    </div>
  )
}

type Row = { key: number; id: number | null; item_no: string; nama: string; unit: string; price: string }
const blank = (): Row => ({ key: ++seq, id: null, item_no: '', nama: '', unit: '', price: '' })

function VendorPriceForm({ item, onClose, onSaved }: { item: Vp | null; onClose: () => void; onSaved: (message: string) => void }) {
  const [vendors, setVendors] = useState<VendorOption[]>([])
  const [v, setV] = useState({ vendor_no: item?.vendor_no ?? '', tanggal: item?.tanggal?.slice(0, 10) ?? today(), nomor: item?.number ?? '', keterangan: item?.keterangan ?? '' })
  const [rows, setRows] = useState<Row[]>(() => (item?.lines.length ? item.lines.map((l) => ({ key: ++seq, id: l.id, item_no: l.item_no, nama: l.item_name, unit: l.unit, price: String(l.price) })) : [blank()]))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => { api<{ vendors: VendorOption[] }>('/api/purchasing/orders/options').then((r) => setVendors(r.vendors)).catch(() => {}) }, [])
  const update = (key: number, patch: Partial<Row>) => setRows((list) => list.map((r) => (r.key === key ? { ...r, ...patch } : r)))
  async function save(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const res = await api<{ number: string }>(item ? `/api/purchasing/vendor-prices/${item.id}` : '/api/purchasing/vendor-prices', {
        method: item ? 'PUT' : 'POST',
        json: { ...v, lines: rows.filter((r) => r.item_no).map(({ id, item_no, unit, price }) => ({ id, item_no, unit, price })) },
      })
      onSaved(item ? `Harga pemasok ${res.number || item.number} diperbarui di Accurate.` : `Harga pemasok ${res.number} ditambahkan di Accurate.`)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const known = !v.vendor_no || vendors.some((x) => x.vendor_no === v.vendor_no)
  return (
    <Modal
      title={item ? `Ubah harga pemasok ${item.number}` : 'Tambah harga pemasok'}
      subtitle="Disimpan langsung ke modul Harga Pemasok di Accurate"
      wide
      onClose={onClose}
      footer={<><span className="pap-spacer" /><button className="pap-btn" onClick={onClose}>Batal</button><button className="pap-primary-button" form="vp-form" disabled={busy}><Send /> {busy ? 'Mengirim...' : 'Simpan ke Accurate'}</button></>}
    >
      <form id="vp-form" className="pap-po-form" onSubmit={save}>
        {error && <Notice onClose={() => setError('')}>{error}</Notice>}
        <div className="pap-form-grid">
          <Field label="Pemasok *">
            <select className="pap-select" required value={v.vendor_no} onChange={(e) => setV({ ...v, vendor_no: e.target.value })}>
              <option value="">Pilih pemasok</option>
              {!known && <option value={v.vendor_no}>{item?.vendor_name ?? v.vendor_no}</option>}
              {vendors.map((x) => <option key={x.id} value={x.vendor_no}>{x.name} ({x.vendor_no})</option>)}
            </select>
          </Field>
          <Field label="Berlaku mulai *"><input className="pap-input" type="date" required value={v.tanggal} onChange={(e) => setV({ ...v, tanggal: e.target.value })} /></Field>
          <Field label="Nomor #" hint={item ? undefined : 'Kosongkan agar dinomori otomatis'}><input className="pap-input" maxLength={50} value={v.nomor} onChange={(e) => setV({ ...v, nomor: e.target.value })} placeholder="Otomatis" /></Field>
          <Field label="Keterangan" full><input className="pap-input" maxLength={1000} value={v.keterangan} onChange={(e) => setV({ ...v, keterangan: e.target.value })} /></Field>
        </div>
        <div className="pap-field">
          <span>Barang & harga</span>
          <div className="pap-table-wrap bordered pap-po-lines">
            <table>
              <thead><tr><th>Barang</th><th>Satuan</th><th className="pap-num">Harga</th><th /></tr></thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.key}>
                    <td><ItemPicker line={r} onPick={(h) => update(r.key, { item_no: h.item_no, nama: h.name, unit: r.unit || h.unit || '', price: r.price || String(h.harga_terakhir ?? h.vendor_price ?? '') })} onText={() => update(r.key, { item_no: '', nama: '' })} /></td>
                    <td><input className="pap-input" maxLength={40} value={r.unit} onChange={(e) => update(r.key, { unit: e.target.value })} aria-label="Satuan" /></td>
                    <td><input className="pap-input pap-num" inputMode="decimal" required={!!r.item_no} value={r.price} onChange={(e) => update(r.key, { price: e.target.value })} aria-label="Harga" /></td>
                    <td>{rows.length > 1 && <button type="button" className="pap-icon-button" aria-label={`Hapus barang ${i + 1}`} onClick={() => setRows((list) => list.filter((x) => x.key !== r.key))}><Trash2 /></button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button type="button" className="pap-btn pap-add-item" onClick={() => setRows((list) => [...list, blank()])}><Plus /> Tambah barang</button>
        </div>
      </form>
    </Modal>
  )
}
