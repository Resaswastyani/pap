'use client'

import { useCallback, useEffect, useState } from 'react'
import { ArchiveRestore, RotateCcw, Search, Trash2 } from 'lucide-react'
import type { UserProfile } from '@/lib/users'
import { useDebounced } from './accurate-production'
import { api, formatDate, formatSize, Notice, Pager } from './ui'

type Item = {
  id: number; modul: string; label: string; row_count: number; size_bytes: number
  deleted_at: string; deleted_by: number | null; deleted_name: string | null; restored_at: string | null; restored_name: string | null
}
type Res = { items: Item[]; total: number; moduls: { modul: string; n: number }[]; can: { all: boolean; purge: boolean } }

// Data Terhapus: semua data yang dihapus di modul mana pun bisa dipulihkan dari sini
export function RecycleBinPage({ user }: { user: UserProfile }) {
  const [status, setStatus] = useState<'terhapus' | 'dipulihkan'>('terhapus')
  const [modul, setModul] = useState('')
  const [q, setQ] = useState('')
  const term = useDebounced(q)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const [data, setData] = useState<Res | null>(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState<number | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  useEffect(() => setPage(1), [status, modul, term])
  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ status, page: String(page), pageSize: String(pageSize) })
      if (modul) params.set('modul', modul)
      if (term) params.set('q', term)
      setData(await api<Res>(`/api/recycle-bin?${params}`))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [status, modul, term, page, pageSize])
  useEffect(() => { load() }, [load])

  async function restore(item: Item) {
    if (!window.confirm(`Pulihkan ${item.modul}: ${item.label}?`)) return
    setBusy(item.id)
    setError('')
    try {
      await api(`/api/recycle-bin/${item.id}`, { method: 'POST' })
      setNotice(`${item.modul} "${item.label}" sudah dipulihkan dan tampil lagi di menu ${item.modul}.`)
      load()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(null)
    }
  }
  async function purge(item: Item) {
    if (!window.confirm(`Hapus PERMANEN ${item.modul}: ${item.label}? Data ini tidak bisa dipulihkan lagi.`)) return
    setBusy(item.id)
    setError('')
    try {
      await api(`/api/recycle-bin/${item.id}`, { method: 'DELETE' })
      setNotice(`${item.label} dihapus permanen.`)
      load()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  const items = data?.items ?? []
  const open = status === 'terhapus'
  return (
    <>
      <div className="pap-page-heading">
        <div>
          <p className="pap-eyebrow">SISTEM</p>
          <h1>Data Terhapus</h1>
          <span>
            Data yang dihapus di semua modul disimpan di sini dan bisa dipulihkan kapan saja, lengkap dengan rincian & lampirannya.
            {data?.can.all ? ' Admin melihat data terhapus seluruh pengguna.' : ' Anda melihat data yang Anda hapus sendiri.'}
          </span>
        </div>
      </div>
      {notice && <Notice kind="success" onClose={() => setNotice('')}>{notice}</Notice>}
      <div className="pap-table-card">
        <div className="pap-filters">
          <div className="pap-segmented" role="tablist">
            <button role="tab" aria-selected={open} className={open ? 'active' : ''} onClick={() => setStatus('terhapus')}>Terhapus</button>
            <button role="tab" aria-selected={!open} className={!open ? 'active' : ''} onClick={() => setStatus('dipulihkan')}>Sudah dipulihkan</button>
          </div>
          <select className="pap-select" value={modul} onChange={(e) => setModul(e.target.value)} aria-label="Filter modul">
            <option value="">Semua modul</option>
            {data?.moduls.map((m) => <option key={m.modul} value={m.modul}>{m.modul} ({m.n})</option>)}
          </select>
          <label className="pap-filter-search"><Search /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari nama data, modul, atau penghapus..." /></label>
        </div>
        {error && <div className="pap-card-notice"><Notice onClose={() => setError('')}>{error}</Notice></div>}
        <div className="pap-table-wrap">
          <table>
            <thead><tr><th>Data</th><th>Modul</th><th>{open ? 'Dihapus' : 'Dipulihkan'}</th><th>Isi</th><th className="pap-actions-col">Aksi</th></tr></thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.id}>
                  <td><div className="pap-cell-title">{it.label}</div></td>
                  <td><span className="pap-status info">{it.modul}</span></td>
                  <td className="pap-nowrap">
                    {open ? formatDate(it.deleted_at, true) : formatDate(it.restored_at, true)}
                    <div className="pap-cell-sub">{open ? `oleh ${it.deleted_name ?? '—'}` : `oleh ${it.restored_name ?? '—'} · dihapus ${formatDate(it.deleted_at)}`}</div>
                  </td>
                  <td className="pap-nowrap">{it.row_count} baris<div className="pap-cell-sub">{formatSize(it.size_bytes) || '< 1 KB'}</div></td>
                  <td className="pap-actions-cell">
                    {open ? (
                      <div className="pap-row-actions">
                        <button type="button" className="pap-row-action edit" disabled={busy === it.id} onClick={() => restore(it)} title="Pulihkan"><RotateCcw /><span>Pulihkan</span></button>
                        {data?.can.purge && <button type="button" className="pap-row-action danger" disabled={busy === it.id} onClick={() => purge(it)} title="Hapus permanen"><Trash2 /><span>Permanen</span></button>}
                      </div>
                    ) : <span className="pap-status success">Dipulihkan</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!loading && !items.length && (
            <div className="pap-empty"><ArchiveRestore style={{ width: 22, height: 22, opacity: 0.5 }} /><div>{open ? 'Tidak ada data terhapus.' : 'Belum ada data yang dipulihkan.'}</div></div>
          )}
          {loading && !items.length && <div className="pap-empty">Memuat...</div>}
        </div>
        <Pager page={page} pageSize={pageSize} total={data?.total ?? 0} onPage={setPage} onPageSize={(n) => { setPageSize(n); setPage(1) }} noun="data" />
      </div>
      {user.role.isAdmin && <p className="pap-muted" style={{ fontSize: 11, marginTop: 10 }}>Catatan: data yang tersinkron ke Accurate atau Google Sheet (supplier, PO, bahan, kalender konten, data mesin, karyawan, log kerusakan) dihapus langsung di sumbernya, sehingga tidak masuk Data Terhapus.</p>}
    </>
  )
}
