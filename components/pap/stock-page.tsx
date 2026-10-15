'use client'

import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Boxes, PackageX, Search } from 'lucide-react'
import type { UserProfile } from '@/lib/users'
import { AccurateSyncBar, formatNumber } from './accurate'
import { api, formatDate, Notice } from './ui'

type StockItem = { accurate_id: number; item_no: string | null; name: string; item_type: string | null; category: string | null; unit: string | null; quantity: number | null; quantity_on_hand: number | null; min_quantity: number | null; synced_at: string }
type Summary = { total: number; low: number; empty: number; synced_at: string | null }

// Status memakai stok fisik; bila fisik ada tapi semua sudah dipesan, tandai 'Terpesan'
function stockState(item: StockItem) {
  const fisik = item.quantity_on_hand ?? item.quantity
  if (fisik !== null && fisik <= 0) return { label: 'Habis', tone: 'danger' }
  if (item.min_quantity && fisik !== null && fisik <= item.min_quantity) return { label: 'Menipis', tone: 'warning' }
  if (item.quantity !== null && item.quantity <= 0) return { label: 'Terpesan semua', tone: 'info' }
  return { label: 'Aman', tone: 'success' }
}

export function StockPage({ user }: { user: UserProfile }) {
  const [items, setItems] = useState<StockItem[]>([])
  const [categories, setCategories] = useState<string[]>([])
  const [summary, setSummary] = useState<Summary>({ total: 0, low: 0, empty: 0, synced_at: null })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [q, setQ] = useState('')
  const [category, setCategory] = useState('')
  const [low, setLow] = useState(false)
  const [inventoryOnly, setInventoryOnly] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (q.trim()) params.set('q', q.trim())
      if (category) params.set('category', category)
      if (low) params.set('low', '1')
      if (inventoryOnly) params.set('type', 'inventory')
      const res = await api<{ items: StockItem[]; categories: string[]; summary: Summary }>(`/api/stock?${params}`)
      setItems(res.items)
      setCategories(res.categories)
      setSummary(res.summary)
      setError('')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [q, category, low, inventoryOnly])

  useEffect(() => {
    const timer = setTimeout(load, q ? 300 : 0)
    return () => clearTimeout(timer)
  }, [load, q])

  const stats: [string, number, string, typeof Boxes, string, () => void][] = [
    ['Barang persediaan', summary.total, summary.synced_at ? `Data per ${formatDate(summary.synced_at, true)}` : 'Belum sinkron', Boxes, 'stat-1', () => setLow(false)],
    ['Stok menipis', summary.low, 'Di bawah stok minimum', AlertTriangle, 'stat-2', () => setLow(true)],
    ['Stok habis', summary.empty, 'Stok fisik 0 atau minus', PackageX, 'stat-2', () => setLow(false)],
  ]

  return (
    <>
      <div className="pap-page-heading">
        <div>
          <p className="pap-eyebrow">GUDANG</p>
          <h1>Stok</h1>
          <span>Stok barang dari Accurate Online untuk perencanaan bahan baku, produksi, dan pembelian.</span>
        </div>
      </div>
      <AccurateSyncBar entities={['item', 'stock']} canSync={user.menus.includes('stok')} onSynced={load} />
      <div className="pap-stat-grid">
        {stats.map(([label, value, note, Icon, tone, onClick]) => (
          <button key={label} className="pap-stat-card pap-stat-button" onClick={onClick}>
            <div><span>{label}</span><strong>{value}</strong><small className="neutral">{note}</small></div>
            <div className={`pap-stat-icon ${tone}`}><Icon /></div>
          </button>
        ))}
      </div>
      <div className="pap-table-card">
        <div className="pap-card-head"><div><h2>Daftar stok</h2><p>Stok fisik = jumlah di gudang. Tersedia dijual = stok fisik dikurangi pesanan yang belum dikirim. Semua gudang.</p></div></div>
        <div className="pap-filters">
          <label className="pap-filter-search"><Search /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari nama atau kode barang..." /></label>
          <select className="pap-select" value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Filter kategori">
            <option value="">Semua kategori</option>
            {categories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <label className="pap-check"><input type="checkbox" checked={low} onChange={(e) => setLow(e.target.checked)} /> Hanya stok menipis</label>
          <label className="pap-check"><input type="checkbox" checked={inventoryOnly} onChange={(e) => setInventoryOnly(e.target.checked)} /> Hanya barang persediaan</label>
        </div>
        {error && <div className="pap-card-notice"><Notice onClose={() => setError('')}>{error}</Notice></div>}
        <div className="pap-table-wrap">
          <table>
            <thead><tr><th>Barang</th><th>Kategori</th><th className="pap-num">Stok fisik</th><th className="pap-num">Tersedia dijual</th><th className="pap-num">Minimum</th><th>Status</th></tr></thead>
            <tbody>
              {items.map((item) => {
                const state = stockState(item)
                return (
                  <tr key={item.accurate_id}>
                    <td><div className="pap-cell-title">{item.name}</div><div className="pap-cell-sub">{item.item_no ?? '—'}</div></td>
                    <td>{item.category ?? '—'}</td>
                    <td className="pap-num pap-nowrap"><strong>{formatNumber(item.quantity_on_hand)}</strong> {item.unit ?? ''}</td>
                    <td className="pap-num pap-nowrap">{formatNumber(item.quantity)} {item.unit ?? ''}</td>
                    <td className="pap-num pap-nowrap">{item.min_quantity ? `${formatNumber(item.min_quantity)} ${item.unit ?? ''}` : '—'}</td>
                    <td><span className={`pap-status ${state.tone}`}>{state.label}</span></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {!loading && !items.length && <div className="pap-empty">{q || category || low ? 'Tidak ada barang yang cocok dengan filter.' : 'Belum ada data stok. Klik "Sinkron sekarang" untuk mengambil dari Accurate.'}</div>}
          {loading && !items.length && <div className="pap-empty">Memuat stok...</div>}
        </div>
      </div>
    </>
  )
}
