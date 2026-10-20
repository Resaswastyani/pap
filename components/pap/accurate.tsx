'use client'

import { useCallback, useEffect, useState } from 'react'
import { AlertCircle, CheckCircle2, RefreshCw } from 'lucide-react'
import { api, formatDate, Notice } from './ui'

type SyncEntity = 'customer' | 'sales-invoice' | 'sales-order' | 'item' | 'stock' | 'sales-order-items' | 'customer-detail' | 'item-detail' | 'bill-of-material' | 'bill-of-material-detail'
type SyncRow = { entity: SyncEntity; last_success: string | null; status: 'ok' | 'berjalan' | 'gagal'; message: string | null; updated_at: string }

const LABEL: Record<SyncEntity, string> = { customer: 'Customer', 'sales-invoice': 'Faktur penjualan', 'sales-order': 'Sales order', item: 'Data barang', stock: 'Stok fisik', 'sales-order-items': 'Produk dari pesanan', 'customer-detail': 'Alamat customer', 'item-detail': 'Tanda "Diproduksi" barang', 'bill-of-material': 'Formula produksi (BOM)', 'bill-of-material-detail': 'Bahan formula produksi' }

export const formatRupiah = (value: number | null | undefined) =>
  value === null || value === undefined ? '—' : `Rp ${Math.round(value).toLocaleString('id-ID')}`

export const formatNumber = (value: number | null | undefined, digits = 2) =>
  value === null || value === undefined ? '—' : value.toLocaleString('id-ID', { maximumFractionDigits: digits })

// Bar status sinkronisasi Accurate + tombol "Sinkron sekarang"
export function AccurateSyncBar({ entities, canSync, onSynced }: { entities: SyncEntity[]; canSync: boolean; onSynced: () => void }) {
  const [enabled, setEnabled] = useState(true)
  const [rows, setRows] = useState<SyncRow[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  const load = useCallback(() => {
    api<{ enabled: boolean; status: SyncRow[] }>('/api/accurate/sync')
      .then((res) => {
        setEnabled(res.enabled)
        setRows(res.status)
      })
      .catch(() => {})
  }, [])
  useEffect(load, [load])

  async function sync() {
    setBusy(true)
    setError('')
    setMessage('')
    try {
      const res = await api<{ results: { entity: SyncEntity; saved: number; done: boolean; error?: string }[] }>('/api/accurate/sync', { method: 'POST', json: { entities } })
      const failed = res.results.filter((r) => r.error)
      if (failed.length) setError(failed.map((r) => `${LABEL[r.entity]}: ${r.error}`).join(' · '))
      const pending = res.results.some((r) => !r.done && !r.error)
      setMessage(`${res.results.reduce((n, r) => n + r.saved, 0)} data diperbarui dari Accurate.${pending ? ' Sebagian data masih berlanjut, klik Sinkron lagi untuk menyelesaikan.' : ''}`)
      onSynced()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
      load()
    }
  }

  if (!enabled) {
    return <Notice>Integrasi Accurate belum dikonfigurasi. Isi ACCURATE_API_TOKEN dan ACCURATE_SIGNATURE_SECRET di environment server.</Notice>
  }
  const shown = rows.filter((r) => entities.includes(r.entity))
  return (
    <div className="pap-sync-bar">
      <div className="pap-sync-items">
        <span className="pap-sync-title">Accurate Online</span>
        {entities.map((entity) => {
          const row = shown.find((r) => r.entity === entity)
          const failed = row?.status === 'gagal'
          return (
            <span key={entity} className={`pap-sync-item ${failed ? 'error' : ''}`} title={row?.message ?? ''}>
              {failed ? <AlertCircle /> : <CheckCircle2 />}
              {LABEL[entity]}: {row?.last_success ? formatDate(row.last_success, true) : 'belum pernah sinkron'}
            </span>
          )
        })}
      </div>
      {canSync && <button className="pap-btn" onClick={sync} disabled={busy}><RefreshCw className={busy ? 'pap-spin' : ''} /> {busy ? 'Menyinkronkan...' : 'Sinkron sekarang'}</button>}
      {error && <div className="pap-sync-msg"><Notice onClose={() => setError('')}>{error}</Notice></div>}
      {message && !error && <div className="pap-sync-msg"><Notice kind="success" onClose={() => setMessage('')}>{message}</Notice></div>}
    </div>
  )
}
