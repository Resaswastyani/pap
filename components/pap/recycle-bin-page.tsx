'use client'

import { useCallback, useEffect, useState } from 'react'
import { ArchiveRestore, RotateCcw, Search, Trash2 } from 'lucide-react'
import type { UserProfile } from '@/lib/users'
import { useDebounced } from './accurate-production'
import { api, formatDate, formatSize, Notice, Pager, confirmDialog } from './ui'

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

  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [bulkBusy, setBulkBusy] = useState(false)

  useEffect(() => setPage(1), [status, modul, term])
  useEffect(() => setSelected(new Set()), [status, modul, term, page, pageSize])
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
    if (!(await confirmDialog(`Pulihkan ${item.modul}: ${item.label}?`))) return
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
  // Pulihkan banyak: yang dicentang, atau semua yang cocok dengan filter (semua halaman)
  async function restoreMany(mode: 'selected' | 'all') {
    const count = mode === 'selected' ? selected.size : data?.total ?? 0
    if (!count) return
    const scope = mode === 'selected' ? `${count} data terpilih` : `semua ${count} data terhapus${modul ? ` modul ${modul}` : ''}${term ? ` yang cocok dengan "${term}"` : ''}`
    if (!(await confirmDialog({ title: 'Pulihkan data', message: `Pulihkan ${scope}? Data akan tampil lagi di modul asalnya.`, confirmLabel: 'Ya, pulihkan' }))) return
    setBulkBusy(true)
    setError('')
    try {
      const res = await api<{ restored: number; failed: { label: string; error: string }[] }>('/api/recycle-bin/restore', {
        method: 'POST', json: mode === 'selected' ? { ids: [...selected] } : { all: true, modul, q: term },
      })
      setNotice(`${res.restored} data berhasil dipulihkan.`)
      if (res.failed.length) setError(`${res.failed.length} data gagal dipulihkan:\n${res.failed.slice(0, 5).map((f) => `• ${f.label} — ${f.error}`).join('\n')}`)
      setSelected(new Set())
      load()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBulkBusy(false)
    }
  }
  const toggle = (id: number) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })

  async function purge(item: Item) {
    if (!(await confirmDialog(`Hapus PERMANEN ${item.modul}: ${item.label}? Data ini tidak bisa dipulihkan lagi.`))) return
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
        {open && !!data?.total && (
          <div className="pap-bulk-bar">
            <span>{selected.size ? `${selected.size} data dipilih` : `${data.total} data terhapus${modul || term ? ' (sesuai filter)' : ''}`}</span>
            <span className="pap-spacer" />
            {!!selected.size && <button type="button" className="pap-btn" disabled={bulkBusy} onClick={() => setSelected(new Set())}>Batal pilih</button>}
            {!!selected.size && <button type="button" className="pap-primary-button" disabled={bulkBusy} onClick={() => restoreMany('selected')}><RotateCcw /> Pulihkan terpilih ({selected.size})</button>}
            <button type="button" className={selected.size ? 'pap-btn' : 'pap-primary-button'} disabled={bulkBusy} onClick={() => restoreMany('all')}><RotateCcw /> {bulkBusy ? 'Memulihkan…' : `Pulihkan semua (${data.total})`}</button>
          </div>
        )}
        {error && <div className="pap-card-notice"><Notice onClose={() => setError('')}><span style={{ whiteSpace: 'pre-line' }}>{error}</span></Notice></div>}
        <div className="pap-table-wrap">
          <table>
            <thead><tr>
              {open && <th className="pap-check-col"><input type="checkbox" aria-label="Pilih semua di halaman ini" checked={!!items.length && items.every((i) => selected.has(i.id))}
                onChange={(e) => setSelected(e.target.checked ? new Set([...selected, ...items.map((i) => i.id)]) : new Set([...selected].filter((id) => !items.some((i) => i.id === id))))} /></th>}
              <th>Data</th><th>Modul</th><th>{open ? 'Dihapus' : 'Dipulihkan'}</th><th>Isi</th><th className="pap-actions-col">Aksi</th>
            </tr></thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.id} className={selected.has(it.id) ? 'pap-row-selected' : undefined}>
                  {open && <td className="pap-check-col"><input type="checkbox" aria-label={`Pilih ${it.label}`} checked={selected.has(it.id)} onChange={() => toggle(it.id)} /></td>}
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
