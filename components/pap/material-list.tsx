'use client'

import { useCallback, useEffect, useState } from 'react'
import { Pencil, Plus, Search, Send, Trash2 } from 'lucide-react'
import { AccurateSyncBar, formatNumber, formatRupiah } from './accurate'
import { useDebounced } from './accurate-production'
import { api, Field, Modal, Notice, Pager, usePaged, confirmDialog } from './ui'

// Data Bahan: tambah / ubah / hapus barang bahan langsung di data Barang & Jasa Accurate.
type Material = {
  id: number; item_no: string | null; name: string; item_type: string; category: string | null; unit: string | null; vendor_price: number | null
  min_quantity: number | null; stok: number | null; harga_po: number | null; bahan_baku: boolean; suspended: boolean
}
type Res = { items: Material[]; categories: string[]; can: { create: boolean; update: boolean; delete: boolean } }
type Values = { no: string; name: string; type: string; category: string; unit: string; vendor_price: string; min_quantity: string; bahan_baku: boolean; suspended: boolean }

const TYPES: Record<string, string> = { INVENTORY: 'Persediaan (punya stok)', NON_INVENTORY: 'Non persediaan (ATK, perlengkapan)' }
const qty = (v: number | null, unit: string | null) => (v === null ? '—' : `${formatNumber(v)}${unit ? ` ${unit}` : ''}`)

export function MaterialList() {
  const [q, setQ] = useState('')
  const query = useDebounced(q)
  const [kategori, setKategori] = useState('')
  const [nonaktif, setNonaktif] = useState(false)
  const [data, setData] = useState<Res | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [form, setForm] = useState<number | 'baru' | null>(null)
  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (query) params.set('q', query)
      if (kategori) params.set('kategori', kategori)
      if (nonaktif) params.set('nonaktif', '1')
      setData(await api<Res>(`/api/purchasing/materials?${params}`))
      setError('')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [query, kategori, nonaktif])
  useEffect(() => { load() }, [load])
  const paged = usePaged(data?.items ?? [], [query, kategori, nonaktif])
  const flash = (text: string) => {
    setForm(null)
    setMessage(text)
    setTimeout(() => setMessage(''), 6000)
    load()
  }
  async function remove(m: Material) {
    if (!(await confirmDialog(`Hapus bahan ${m.name} dari Accurate?\nBila bahan sudah dipakai di transaksi, bahan dinonaktifkan sebagai gantinya.`))) return
    try {
      const res = await api<{ deleted: boolean; name: string }>(`/api/purchasing/materials/${m.id}`, { method: 'DELETE' })
      flash(res.deleted ? `${res.name} dihapus dari Accurate.` : `${res.name} sudah dipakai transaksi, jadi dinonaktifkan di Accurate.`)
    } catch (e) {
      setError((e as Error).message)
    }
  }
  const can = data?.can

  return (
    <>
      <AccurateSyncBar entities={['item', 'item-detail']} canSync onSynced={load} />
      <div className="pap-table-card">
        <div className="pap-card-head">
          <div><h2>Data Bahan</h2><p>Bahan baku, bahan pendukung, dan perlengkapan di data Barang & Jasa Accurate. Tambah / ubah / hapus di sini langsung tersimpan di Accurate.</p></div>
          {can?.create && <button className="pap-primary-button" onClick={() => setForm('baru')}><Plus /> Tambah bahan</button>}
        </div>
        <div className="pap-filters">
          <label className="pap-filter-search"><Search /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari nama atau kode bahan..." /></label>
          <select className="pap-select" value={kategori} onChange={(e) => setKategori(e.target.value)} aria-label="Filter kategori">
            <option value="">Semua kategori</option>
            {data?.categories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <label className="pap-check"><input type="checkbox" checked={nonaktif} onChange={(e) => setNonaktif(e.target.checked)} /><span>Tampilkan nonaktif</span></label>
        </div>
        {message && <div className="pap-card-notice"><Notice kind="success" onClose={() => setMessage('')}>{message}</Notice></div>}
        {error && <div className="pap-card-notice"><Notice onClose={() => setError('')}>{error}</Notice></div>}
        <div className="pap-table-wrap">
          <table>
            <thead><tr><th>Bahan</th><th>Kategori</th><th className="pap-num">Harga beli acuan</th><th className="pap-num">Harga PO terakhir</th><th className="pap-num">Stok</th>{(can?.update || can?.delete) && <th />}</tr></thead>
            <tbody>
              {paged.items.map((m) => (
                <tr key={m.id}>
                  <td>
                    <div className="pap-cell-title">{m.name}{m.suspended && <span className="pap-status neutral"> Nonaktif</span>}</div>
                    <div className="pap-cell-sub">{[m.item_no, m.bahan_baku ? 'Bahan baku' : m.item_type === 'NON_INVENTORY' ? 'Non persediaan' : null].filter(Boolean).join(' · ')}</div>
                  </td>
                  <td>{m.category ?? '—'}</td>
                  <td className="pap-num pap-nowrap">{m.vendor_price ? <>{formatRupiah(m.vendor_price)}{m.unit && <span className="pap-cell-sub"> /{m.unit}</span>}</> : '—'}</td>
                  <td className="pap-num pap-nowrap">{m.harga_po ? formatRupiah(m.harga_po) : '—'}</td>
                  <td className={`pap-num pap-nowrap ${m.min_quantity && (m.stok ?? 0) < m.min_quantity ? 'pap-text-danger' : ''}`}>{m.item_type === 'INVENTORY' ? qty(m.stok, m.unit) : '—'}</td>
                  {(can?.update || can?.delete) && (
                    <td className="pap-nowrap"><span className="pap-inline-actions">
                      {can.update && <button className="pap-icon-button" aria-label={`Ubah ${m.name}`} title="Ubah" onClick={() => setForm(m.id)}><Pencil /></button>}
                      {can.delete && !m.suspended && <button className="pap-icon-button" aria-label={`Hapus ${m.name}`} title="Hapus" onClick={() => remove(m)}><Trash2 /></button>}
                    </span></td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          {!loading && !data?.items.length && <div className="pap-empty">{q || kategori ? 'Tidak ada bahan yang cocok.' : 'Belum ada data bahan. Klik "Sinkron sekarang" untuk mengambil data barang dari Accurate.'}</div>}
          {loading && !data && <div className="pap-empty">Memuat data bahan...</div>}
          <Pager {...paged.pager} noun="bahan" />
        </div>
      </div>
      {form && <MaterialForm id={form === 'baru' ? null : form} onClose={() => setForm(null)} onSaved={flash} />}
    </>
  )
}

function MaterialForm({ id, onClose, onSaved }: { id: number | null; onClose: () => void; onSaved: (message: string) => void }) {
  const [v, setV] = useState<Values>({ no: '', name: '', type: 'INVENTORY', category: '', unit: '', vendor_price: '', min_quantity: '', bahan_baku: true, suspended: false })
  const [categories, setCategories] = useState<string[]>([])
  const [loading, setLoading] = useState(!!id)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => { api<{ categories: string[] }>('/api/purchasing/materials/categories').then((r) => setCategories(r.categories)).catch(() => {}) }, [])
  // Ubah: isian terbaru langsung dari Accurate
  useEffect(() => {
    if (!id) return
    api<{ item: Record<string, unknown> }>(`/api/purchasing/materials/${id}`)
      .then(({ item: d }) => setV({
        no: String(d.no ?? ''), name: String(d.name ?? ''), type: String(d.type ?? 'INVENTORY'), category: String(d.category ?? ''), unit: String(d.unit ?? ''),
        vendor_price: String(d.vendor_price ?? ''), min_quantity: String(d.min_quantity ?? ''), bahan_baku: d.bahan_baku === true, suspended: d.suspended === true,
      }))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [id])
  const set = (k: keyof Values) => (e: { target: { value: string } }) => setV({ ...v, [k]: e.target.value })
  async function save(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const res = await api<{ item: { no: string; name: string } }>(id ? `/api/purchasing/materials/${id}` : '/api/purchasing/materials', { method: id ? 'PATCH' : 'POST', json: v })
      onSaved(id ? `${res.item.name} diperbarui di Accurate.` : `${res.item.name} (${res.item.no}) ditambahkan di Accurate.`)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal title={id ? 'Ubah bahan' : 'Tambah bahan'} subtitle="Disimpan langsung ke data Barang & Jasa di Accurate" onClose={onClose}
      footer={<><span className="pap-spacer" /><button className="pap-btn" onClick={onClose}>Batal</button><button className="pap-primary-button" form="material-form" disabled={busy || loading}><Send /> {busy ? 'Mengirim...' : 'Simpan ke Accurate'}</button></>}>
      <form id="material-form" className="pap-form-grid" onSubmit={save}>
        {error && <div className="full"><Notice onClose={() => setError('')}>{error}</Notice></div>}
        <Field label="Nama bahan *" full><input className="pap-input" required maxLength={255} value={v.name} onChange={set('name')} placeholder="Mis. Tinta Gravure Merah" /></Field>
        <Field label="Kode barang" hint={id ? undefined : 'Kosongkan bila kode dibuat otomatis oleh Accurate'}><input className="pap-input" maxLength={50} value={v.no} onChange={set('no')} placeholder="Mis. RM-0010" /></Field>
        <Field label="Jenis">
          <select className="pap-select" value={v.type} disabled={!!id} onChange={set('type')}>
            {Object.entries(TYPES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </Field>
        <Field label="Kategori">
          <input className="pap-input" list="pap-item-categories" maxLength={150} value={v.category} onChange={set('category')} placeholder="Mis. BIJI PLASTIK" />
          <datalist id="pap-item-categories">{categories.map((c) => <option key={c} value={c} />)}</datalist>
        </Field>
        <Field label="Satuan *"><input className="pap-input" required maxLength={40} value={v.unit} onChange={set('unit')} placeholder="kg / roll / pcs" /></Field>
        <Field label="Harga beli acuan (Rp)"><input className="pap-input" type="number" min={0} step="any" value={v.vendor_price} onChange={set('vendor_price')} /></Field>
        {v.type === 'INVENTORY' && <Field label="Stok minimum"><input className="pap-input" type="number" min={0} step="any" value={v.min_quantity} onChange={set('min_quantity')} /></Field>}
        {v.type === 'INVENTORY' && <label className="pap-check full"><input type="checkbox" checked={v.bahan_baku} onChange={(e) => setV({ ...v, bahan_baku: e.target.checked })} /><span>Tandai sebagai Bahan Baku (bisa dipakai di formula produksi)</span></label>}
        {id && <label className="pap-check full"><input type="checkbox" checked={v.suspended} onChange={(e) => setV({ ...v, suspended: e.target.checked })} /><span>Nonaktif (tidak dipakai lagi)</span></label>}
      </form>
    </Modal>
  )
}
