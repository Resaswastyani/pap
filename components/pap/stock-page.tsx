'use client'

import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Boxes, CalendarDays, Eye, History, Pencil, PackageX, Plus, RefreshCw, Search, Trash2, Wallet } from 'lucide-react'
import type { UserProfile } from '@/lib/users'
import { AccurateSyncBar, formatNumber } from './accurate'
import { api, confirmDialog, Field, formatDate, Modal, Notice, Pager } from './ui'

type StockItem = { accurate_id: number; item_no: string | null; name: string; item_type: string | null; category: string | null; unit: string | null; quantity: number | null; quantity_on_hand: number | null; min_quantity: number | null; vendor_price: number | null; unit_cost: number | null; nilai: number | null; synced_at: string }
type Summary = { total: number; low: number; empty: number; synced_at: string | null; nilai: number; tanggal?: string; dihitung?: number; harian?: number }
const todayIso = () => new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10)
const rupiah = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `Rp ${Math.round(v).toLocaleString('id-ID')}`)

// Status memakai stok fisik; bila fisik ada tapi semua sudah dipesan, tandai 'Terpesan'
function stockState(item: StockItem) {
  const fisik = item.quantity_on_hand ?? item.quantity
  if (fisik !== null && fisik <= 0) return { label: 'Habis', tone: 'danger' }
  if (item.min_quantity && fisik !== null && fisik <= item.min_quantity) return { label: 'Menipis', tone: 'warning' }
  if (item.quantity !== null && item.quantity <= 0) return { label: 'Terpesan semua', tone: 'info' }
  return { label: 'Aman', tone: 'success' }
}

// Dikelompokkan menurut kategori barang di Accurate (lihat app/api/stock/route.ts):
// bahan baku = Biji Plastik & Roll Mika; bahan pembantu = Tinta, Solven & Box Mika; barang jadi = barang yang diproduksi PAP
const JENIS = {
  bahan: { title: 'Stok Bahan Baku', desc: 'Stok bahan baku dari Accurate Online: barang berkategori Biji Plastik dan Roll Mika.', noun: 'bahan baku' },
  pembantu: { title: 'Stok Bahan Pembantu', desc: 'Stok bahan pembantu dari Accurate Online: barang berkategori Tinta, Solven, dan Box Mika.', noun: 'bahan pembantu' },
  jadi: { title: 'Stok Barang Jadi', desc: 'Stok barang jadi dari Accurate Online (barang yang dicentang "Diproduksi"): kantong, hanger, roll, mika, dan produk PAP lainnya.', noun: 'barang jadi' },
} as const

export function StockPage({ user, jenis }: { user: UserProfile; jenis: keyof typeof JENIS }) {
  const meta = JENIS[jenis]
  const [items, setItems] = useState<StockItem[]>([])
  const [categories, setCategories] = useState<string[]>([])
  const [summary, setSummary] = useState<Summary>({ total: 0, low: 0, empty: 0, synced_at: null, nilai: 0 })
  const [canManage, setCanManage] = useState(false)
  const [form, setForm] = useState<StockItem | 'baru' | null>(null)
  const [message, setMessage] = useState('')
  // Per tanggal: kosong = hari ini (data terbaru Accurate)
  const [tanggal, setTanggal] = useState('')
  const [history, setHistory] = useState<StockItem | null>(null)
  const past = !!tanggal && tanggal < todayIso()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [q, setQ] = useState('')
  const [category, setCategory] = useState('')
  const [low, setLow] = useState(false)
  const [inventoryOnly, setInventoryOnly] = useState(true)
  const [page, setPage] = useState(1)
  const [size, setSize] = useState(50)
  const [total, setTotal] = useState(0)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: String(size), jenis })
      if (q.trim()) params.set('q', q.trim())
      if (category) params.set('category', category)
      if (low) params.set('low', '1')
      if (inventoryOnly) params.set('type', 'inventory')
      if (past) params.set('tanggal', tanggal)
      const res = await api<{ items: StockItem[]; total: number; categories: string[]; summary: Summary; can?: { manage: boolean } }>(`/api/stock?${params}`)
      setCanManage(!!res.can?.manage && jenis !== 'pembantu')
      setItems(res.items)
      setTotal(res.total)
      setCategories(res.categories)
      setSummary(res.summary)
      setError('')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [q, category, low, inventoryOnly, page, size, jenis, past, tanggal])
  async function fillAll() {
    try {
      const res = await api<{ sisa: number; started: boolean }>('/api/stock', { method: 'POST', json: { jenis, tanggal } })
      setMessage(res.sisa ? `Menghitung ${res.sisa} barang dari Accurate di latar (beberapa menit). Buka ulang tanggal ini nanti untuk total lengkap.` : 'Semua barang sudah dihitung.')
    } catch (e) {
      setError((e as Error).message)
    }
  }
  async function remove(item: StockItem) {
    if (!(await confirmDialog({ title: 'Hapus barang', message: `Hapus ${item.name} dari Accurate? Barang yang sudah dipakai transaksi tidak dihapus tetapi dinonaktifkan.`, confirmLabel: 'Ya, hapus', tone: 'danger' }))) return
    try {
      const res = await api<{ deleted: boolean; name: string }>(`/api/stock/items/${item.accurate_id}`, { method: 'DELETE' })
      setMessage(res.deleted ? `${res.name} dihapus dari Accurate.` : `${res.name} sudah dipakai transaksi, jadi dinonaktifkan di Accurate.`)
      load()
    } catch (e) {
      setError((e as Error).message)
    }
  }
  // Filter berubah -> kembali ke halaman 1
  useEffect(() => setPage(1), [q, category, low, inventoryOnly, tanggal])

  useEffect(() => {
    const timer = setTimeout(load, q ? 300 : 0)
    return () => clearTimeout(timer)
  }, [load, q])

  const stats: [string, number | string, string, typeof Boxes, string, () => void][] = [
    [`Jenis ${meta.noun}`, summary.total, past ? `Stok per ${formatDate(tanggal)}` : summary.synced_at ? `Data per ${formatDate(summary.synced_at, true)}` : 'Belum sinkron', Boxes, 'stat-1', () => setLow(false)],
    ['Stok menipis', summary.low, 'Di bawah stok minimum', AlertTriangle, 'stat-2', () => setLow(true)],
    ['Stok habis', summary.empty, 'Stok fisik 0 atau minus', PackageX, 'stat-2', () => setLow(false)],
    ['Nilai stok', rupiah(summary.nilai), past ? (summary.dihitung !== undefined && summary.dihitung < summary.total ? `dari ${summary.dihitung} / ${summary.total} barang yang sudah dihitung` : `per ${formatDate(tanggal)}`) : 'Stok fisik x harga pokok rata-rata', Wallet, 'stat-0', () => setLow(false)],
  ]

  return (
    <>
      <div className="pap-page-heading">
        <div>
          <p className="pap-eyebrow">GUDANG</p>
          <h1>{meta.title}</h1>
          <span>{meta.desc}</span>
        </div>
        {canManage && <button className="pap-primary-button" onClick={() => setForm('baru')}><Plus /> Tambah {meta.noun}</button>}
      </div>
      {message && <Notice kind="success" onClose={() => setMessage('')}>{message}</Notice>}
      <AccurateSyncBar entities={['item', 'stock']} canSync={user.menus.includes('stok')} onSynced={load} />
      <div className="pap-stat-grid four">
        {stats.map(([label, value, note, Icon, tone, onClick]) => (
          <button key={label} className="pap-stat-card pap-stat-button" onClick={onClick}>
            <div><span>{label}</span><strong>{value}</strong><small className="neutral">{note}</small></div>
            <div className={`pap-stat-icon ${tone}`}><Icon /></div>
          </button>
        ))}
      </div>
      <div className="pap-table-card">
        <div className="pap-card-head"><div><h2>Daftar {meta.noun}</h2><p>Stok fisik = jumlah di gudang. Tersedia dijual = stok fisik dikurangi pesanan yang belum dikirim. Semua gudang.</p></div></div>
        <div className="pap-filters">
          <label className="pap-filter-search"><Search /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Cari nama atau kode ${meta.noun}...`} /></label>
          <select className="pap-select" value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Filter kategori">
            <option value="">Semua kategori</option>
            {categories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <label className="pap-check"><input type="checkbox" checked={low} onChange={(e) => setLow(e.target.checked)} /> Hanya stok menipis</label>
          <label className="pap-check"><input type="checkbox" checked={inventoryOnly} onChange={(e) => setInventoryOnly(e.target.checked)} /> Hanya barang persediaan</label>
          <label className="pap-stock-date" title="Lihat stok per tanggal"><CalendarDays /><span>Per tanggal</span><input className="pap-input" type="date" max={todayIso()} value={tanggal || todayIso()} onChange={(e) => setTanggal(e.target.value === todayIso() ? '' : e.target.value)} /></label>
          {past && <button type="button" className="pap-btn" onClick={() => setTanggal('')}>Hari ini</button>}
        </div>
        {past && (
          <div className="pap-card-notice">
            <Notice kind="success">
              Stok per <b>{formatDate(tanggal)}</b>{summary.harian ? ' dari catatan harian SIMPAP' : ' dihitung dari Accurate'}. Nilai memakai harga pokok {summary.harian ? 'hari itu' : 'saat ini (perkiraan)'}; kolom "Tersedia dijual" hanya untuk hari ini.
              {summary.dihitung !== undefined && summary.dihitung < summary.total && <> {summary.dihitung} dari {summary.total} barang sudah dihitung (barang di halaman ini dihitung otomatis). <button type="button" className="pap-link-button" onClick={fillAll}><RefreshCw className="pap-inline-icon" /> Hitung semua</button></>}
            </Notice>
          </div>
        )}
        {error && <div className="pap-card-notice"><Notice onClose={() => setError('')}>{error}</Notice></div>}
        <div className="pap-table-wrap">
          <table>
            <thead><tr><th>Barang</th><th>Kategori</th><th className="pap-num">Stok fisik</th><th className="pap-num">Tersedia dijual</th><th className="pap-num">Minimum</th><th className="pap-num">Harga pokok</th><th className="pap-num">Nilai stok</th><th>Status</th><th aria-label="Aksi" /></tr></thead>
            <tbody>
              {items.map((item) => {
                const state = stockState(item)
                return (
                  <tr key={item.accurate_id}>
                    <td><div className="pap-cell-title">{item.name}</div><div className="pap-cell-sub">{item.item_no ?? '—'}</div></td>
                    <td>{item.category ?? '—'}</td>
                    <td className="pap-num pap-nowrap"><strong>{formatNumber(item.quantity_on_hand)}</strong> {item.unit ?? ''}</td>
                    <td className="pap-num pap-nowrap">{past ? '—' : `${formatNumber(item.quantity)} ${item.unit ?? ''}`}</td>
                    <td className="pap-num pap-nowrap">{item.min_quantity ? `${formatNumber(item.min_quantity)} ${item.unit ?? ''}` : '—'}</td>
                    <td className="pap-num pap-nowrap">{item.unit_cost ? `${rupiah(item.unit_cost)}/${item.unit ?? 'unit'}` : '—'}</td>
                    <td className="pap-num pap-nowrap"><strong>{item.nilai ? rupiah(item.nilai) : '—'}</strong></td>
                    <td><span className={`pap-status ${state.tone}`}>{state.label}</span></td>
                    <td className="pap-nowrap">
                      <span className="pap-inline-actions">
                        <button className="pap-icon-button" onClick={() => setHistory(item)} aria-label={`Detail ${item.name}`} title="Detail stok per tanggal"><Eye /></button>
                        {canManage && <button className="pap-icon-button" onClick={() => setForm(item)} aria-label={`Ubah ${item.name}`} title="Ubah"><Pencil /></button>}
                        {canManage && <button className="pap-icon-button" onClick={() => remove(item)} aria-label={`Hapus ${item.name}`} title="Hapus"><Trash2 /></button>}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {!loading && !items.length && <div className="pap-empty">{q || category || low ? 'Tidak ada barang yang cocok dengan filter.' : 'Belum ada data stok. Klik "Sinkron sekarang" untuk mengambil dari Accurate.'}</div>}
          {loading && !items.length && <div className="pap-empty">Memuat stok...</div>}
          <Pager page={page} pageSize={size} total={total} onPage={setPage} onPageSize={(v) => { setSize(v); setPage(1) }} noun={meta.noun} />
        </div>
      </div>
      {history && <StockHistory item={history} onClose={() => setHistory(null)} />}
      {form && jenis !== 'pembantu' && <StockItemForm jenis={jenis} item={form === 'baru' ? null : form} onClose={() => setForm(null)} onSaved={(t) => { setForm(null); setMessage(t); load() }} />}
    </>
  )
}

// Form tambah / ubah barang stok: disimpan langsung ke Barang & Jasa Accurate
function StockItemForm({ jenis, item, onClose, onSaved }: { jenis: 'bahan' | 'jadi'; item: StockItem | null; onClose: () => void; onSaved: (message: string) => void }) {
  const [v, setV] = useState({ no: item?.item_no ?? '', name: item?.name ?? '', category: item?.category ?? '', unit: item?.unit ?? (jenis === 'bahan' ? 'kg' : 'pcs'), vendor_price: item?.vendor_price ? String(item.vendor_price) : '', min_quantity: item?.min_quantity ? String(item.min_quantity) : '' })
  const [categories, setCategories] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV((cur) => ({ ...cur, [k]: e.target.value }))
  useEffect(() => {
    api<{ categories: string[] }>(`/api/stock/items?jenis=${jenis}`).then((r) => setCategories(r.categories)).catch(() => {})
    // Isian ubah diambil langsung dari Accurate agar yang diubah adalah data terbaru
    if (item) api<{ item: Record<string, unknown> }>(`/api/stock/items/${item.accurate_id}`).then(({ item: d }) => setV({
      no: String(d.no ?? ''), name: String(d.name ?? ''), category: String(d.category ?? ''), unit: String(d.unit ?? ''),
      vendor_price: d.vendor_price === '' || d.vendor_price === null || d.vendor_price === 0 ? '' : String(d.vendor_price), min_quantity: d.min_quantity === '' || d.min_quantity === null || d.min_quantity === 0 ? '' : String(d.min_quantity),
    })).catch((e) => setError(e.message))
  }, [item, jenis])
  async function save() {
    setBusy(true)
    setError('')
    try {
      const res = await api<{ item: { name: string; no: string } }>(item ? `/api/stock/items/${item.accurate_id}` : '/api/stock/items', { method: item ? 'PATCH' : 'POST', json: { ...v, jenis } })
      onSaved(`${res.item.name} (${res.item.no}) ${item ? 'diperbarui' : 'ditambahkan'} di Accurate.`)
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }
  const noun = jenis === 'bahan' ? 'bahan baku' : 'barang jadi'
  return (
    <Modal title={item ? `Ubah ${noun}` : `Tambah ${noun}`} subtitle="Disimpan langsung ke Barang & Jasa di Accurate Online" onClose={onClose}
      footer={<><span className="pap-spacer" /><button className="pap-btn" onClick={onClose}>Batal</button><button className="pap-primary-button" disabled={busy} onClick={save}>{busy ? 'Menyimpan ke Accurate...' : 'Simpan'}</button></>}>
      {error && <Notice onClose={() => setError('')}>{error}</Notice>}
      <div className="pap-form-grid">
        <Field label="Nama barang *" full><input className="pap-input" maxLength={255} value={v.name} onChange={set('name')} placeholder={jenis === 'bahan' ? 'mis. Biji PP Lotte' : 'mis. Kantong PP 16x25'} /></Field>
        <Field label="Kode barang" hint={item ? '' : 'Kosongkan agar dibuat otomatis oleh Accurate'}><input className="pap-input" maxLength={50} value={v.no} onChange={set('no')} /></Field>
        <Field label={jenis === 'bahan' ? 'Kategori *' : 'Kategori'}>
          {jenis === 'bahan' ? (
            <select className="pap-select" value={v.category} onChange={set('category')}>
              <option value="">— Pilih kategori —</option>
              {[...new Set([...categories, ...(v.category ? [v.category] : [])])].map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          ) : (
            <><input className="pap-input" list="pap-stock-categories" maxLength={150} value={v.category} onChange={set('category')} /><datalist id="pap-stock-categories">{categories.map((c) => <option key={c} value={c} />)}</datalist></>
          )}
        </Field>
        <Field label="Satuan *"><input className="pap-input" maxLength={40} value={v.unit} onChange={set('unit')} placeholder="kg / roll / pcs" /></Field>
        <Field label="Stok minimum"><input className="pap-input pap-num" inputMode="decimal" value={v.min_quantity} onChange={set('min_quantity')} placeholder="0" /></Field>
        <Field label="Harga beli (Rp)" hint="Harga beli default di Accurate"><input className="pap-input pap-num" inputMode="decimal" value={v.vendor_price} onChange={set('vendor_price')} placeholder="0" /></Field>
      </div>
      <p className="pap-muted">Jumlah stok tidak diubah di sini: stok bertambah / berkurang lewat transaksi di Accurate (penerimaan barang, pemakaian, hasil produksi, penyesuaian persediaan).{jenis === 'jadi' ? ' Barang baru otomatis ditandai "Diproduksi".' : ' Barang baru otomatis ditandai "Bahan Baku".'}</p>
    </Modal>
  )
}

// Detail barang: stok & nilai per tanggal yang tercatat, perubahan (masuk / keluar) dari tanggal sebelumnya
type HistoryRow = { tanggal: string; qty: number | null; unit_cost: number | null; nilai: number | null; perubahan: number | null; sumber: string }
function StockHistory({ item, onClose }: { item: StockItem; onClose: () => void }) {
  const [rows, setRows] = useState<HistoryRow[] | null>(null)
  const [error, setError] = useState('')
  useEffect(() => { api<{ items: HistoryRow[] }>(`/api/stock/items/${item.accurate_id}/history`).then((r) => setRows(r.items)).catch((e) => setError(e.message)) }, [item.accurate_id])
  const unit = item.unit ?? ''
  return (
    <Modal title={item.name} subtitle={[item.item_no, item.category, 'Riwayat stok per tanggal'].filter(Boolean).join(' · ')} wide onClose={onClose}
      footer={<><span className="pap-spacer" /><button className="pap-btn" onClick={onClose}>Tutup</button></>}>
      {error && <Notice onClose={() => setError('')}>{error}</Notice>}
      <div className="pap-stat-grid">
        <div className="pap-stat-card"><div><span>Stok sekarang</span><strong className="pap-stat-text">{formatNumber(item.quantity_on_hand ?? item.quantity)} {unit}</strong><small className="neutral">tersedia dijual {formatNumber(item.quantity)} {unit}</small></div></div>
        <div className="pap-stat-card"><div><span>Harga pokok</span><strong className="pap-stat-text">{rupiah(item.unit_cost)}</strong><small className="neutral">rata-rata per {unit || 'unit'}</small></div></div>
        <div className="pap-stat-card"><div><span>Nilai stok</span><strong className="pap-stat-text">{rupiah(item.nilai)}</strong><small className="neutral">stok x harga pokok</small></div></div>
      </div>
      <div className="pap-table-wrap">
        <table>
          <thead><tr><th>Tanggal</th><th className="pap-num">Stok</th><th className="pap-num">Perubahan</th><th className="pap-num">Harga pokok</th><th className="pap-num">Nilai (Rp)</th><th>Sumber</th></tr></thead>
          <tbody>
            {(rows ?? []).map((r) => (
              <tr key={r.tanggal}>
                <td className="pap-nowrap">{formatDate(r.tanggal)}</td>
                <td className="pap-num pap-nowrap"><strong>{formatNumber(r.qty)}</strong> {unit}</td>
                <td className={`pap-num pap-nowrap ${r.perubahan && r.perubahan > 0 ? 'pap-text-success' : r.perubahan && r.perubahan < 0 ? 'pap-text-danger' : ''}`}>{r.perubahan ? `${r.perubahan > 0 ? '+' : ''}${formatNumber(r.perubahan)} ${unit}` : '—'}</td>
                <td className="pap-num pap-nowrap">{rupiah(r.unit_cost)}</td>
                <td className="pap-num pap-nowrap">{rupiah(r.nilai)}</td>
                <td><span className="pap-status neutral">{r.sumber === 'harian' ? 'Catatan harian' : 'Dihitung dari Accurate'}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows && !rows.length && <div className="pap-empty"><History /> Belum ada riwayat. Stok dicatat otomatis setiap hari mulai sekarang; tanggal lampau bisa dilihat lewat pilihan "Per tanggal".</div>}
        {!rows && !error && <div className="pap-empty">Memuat riwayat...</div>}
      </div>
    </Modal>
  )
}
