'use client'

import { useEffect, useMemo, useRef, useState, type InputHTMLAttributes, type ReactNode } from 'react'
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Eye, EyeOff, Pencil, Search, Trash2, X } from 'lucide-react'
import { PLANNING_STATUS, type PlanningStatus } from '@/lib/permissions'
import { clientHintHeaders } from './client-hints'

// Panggil API JSON; lempar Error berisi pesan dari server bila gagal
export async function api<T = unknown>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, ...rest } = init
  // Model HP untuk log aktivitas (Chrome Android menyamarkannya di User-Agent)
  const hints = await clientHintHeaders()
  const res = await fetch(path, {
    ...rest,
    headers: { ...hints, ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(rest.headers as Record<string, string> | undefined) },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error ?? `Permintaan gagal (${res.status}).`)
  // Aksi yang mengubah data bisa membuat notifikasi baru (mis. meeting/planning dibuat): segarkan lonceng
  if (rest.method && rest.method !== 'GET' && !path.startsWith('/api/notifications')) window.dispatchEvent(new Event('pap-notif-refresh'))
  return data as T
}

export function Modal({ title, subtitle, onClose, children, footer, wide }: { title: string; subtitle?: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="pap-modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`pap-modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="pap-modal-head">
          <div>
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button className="pap-icon-button" onClick={onClose} aria-label="Tutup"><X /></button>
        </div>
        <div className="pap-modal-body">{children}</div>
        {footer && <div className="pap-modal-foot">{footer}</div>}
      </div>
    </div>
  )
}

export type UserOption = { id: number; name: string; division_id: number; division_name: string }

// Pilih banyak user dikelompokkan per divisi (peserta meeting, PIC planning). lockedId (opsional) selalu terpilih.
export function UserPicker({ users, selected, lockedId = null, lockedLabel = '', noun, onChange }: { users: UserOption[]; selected: Set<number>; lockedId?: number | null; lockedLabel?: string; noun: string; onChange: (next: Set<number>) => void }) {
  const [term, setTerm] = useState('')
  const filtered = useMemo(() => {
    const t = term.trim().toLowerCase()
    return users.filter((u) => !t || u.name.toLowerCase().includes(t) || u.division_name.toLowerCase().includes(t))
  }, [users, term])
  const groups = useMemo(() => {
    const map = new Map<string, UserOption[]>()
    for (const u of filtered) map.set(u.division_name, [...(map.get(u.division_name) ?? []), u])
    return [...map.entries()]
  }, [filtered])
  const toggle = (id: number) => {
    if (id === lockedId) return
    const next = new Set(selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    onChange(next)
  }
  const toggleGroup = (members: UserOption[]) => {
    const next = new Set(selected)
    const all = members.every((m) => next.has(m.id))
    for (const m of members) if (m.id !== lockedId) all ? next.delete(m.id) : next.add(m.id)
    onChange(next)
  }
  return (
    <div className="pap-picker">
      <label className="pap-filter-search pap-picker-search"><Search /><input value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Cari nama atau divisi..." /></label>
      <div className="pap-picker-list">
        {groups.map(([divisionName, members]) => (
          <div key={divisionName} className="pap-picker-group">
            <button type="button" className="pap-picker-group-head" onClick={() => toggleGroup(members)}>{divisionName} <span>{members.filter((m) => selected.has(m.id)).length}/{members.length}</span></button>
            {members.map((u) => (
              <label key={u.id} className="pap-check">
                <input type="checkbox" checked={selected.has(u.id)} disabled={u.id === lockedId} onChange={() => toggle(u.id)} />
                <span>{u.name}{u.id === lockedId && <small className="pap-hint-inline"> ({lockedLabel})</small>}</span>
              </label>
            ))}
          </div>
        ))}
        {!groups.length && <p className="pap-muted">Tidak ada user yang cocok.</p>}
      </div>
      <small className="pap-hint">{selected.size} {noun} dipilih. Klik nama divisi untuk memilih satu divisi sekaligus.</small>
    </div>
  )
}

export function Field({ label, hint, children, full }: { label: string; hint?: string; children: ReactNode; full?: boolean }) {
  return (
    <label className={`pap-field ${full ? 'full' : ''}`}>
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  )
}

// ---- Modal alasan (pengganti window.prompt) ----
// Pakai: const alasan = await askReason({ title: 'Tolak sample', label: 'Alasan ditolak' }); null = dibatalkan.
// <ReasonHost /> dipasang sekali di AppShell.
export type ReasonOptions = { title: string; label?: string; placeholder?: string; required?: boolean; confirmLabel?: string; danger?: boolean }
type ReasonRequest = ReasonOptions & { resolve: (value: string | null) => void }
const REASON_EVENT = 'pap-ask-reason'

export function askReason(options: ReasonOptions) {
  return new Promise<string | null>((resolve) => {
    window.dispatchEvent(new CustomEvent<ReasonRequest>(REASON_EVENT, { detail: { required: true, danger: true, ...options, resolve } }))
  })
}

export function ReasonHost() {
  const [req, setReq] = useState<ReasonRequest | null>(null)
  const [value, setValue] = useState('')
  useEffect(() => {
    const onAsk = (e: Event) => {
      const next = (e as CustomEvent<ReasonRequest>).detail
      setReq((prev) => { prev?.resolve(null); return next })
      setValue('')
    }
    window.addEventListener(REASON_EVENT, onAsk)
    return () => window.removeEventListener(REASON_EVENT, onAsk)
  }, [])
  if (!req) return null
  const close = (result: string | null) => { req.resolve(result); setReq(null) }
  const text = value.trim()
  const submit = () => { if (!req.required || text) close(text) }
  return (
    <Modal
      title={req.title}
      onClose={() => close(null)}
      footer={<><span className="pap-spacer" /><button type="button" className="pap-btn" onClick={() => close(null)}>Batal</button><button type="submit" form="pap-reason-form" className={req.danger ? 'pap-btn danger' : 'pap-primary-button'} disabled={req.required && !text}>{req.confirmLabel ?? 'Kirim'}</button></>}
    >
      <form id="pap-reason-form" className="pap-form-grid" onSubmit={(e) => { e.preventDefault(); submit() }}>
        <Field label={`${req.label ?? 'Alasan'}${req.required ? '' : ' (opsional)'}`} full>
          <textarea className="pap-input" rows={4} autoFocus maxLength={1000} value={value} onChange={(e) => setValue(e.target.value)} placeholder={req.placeholder} onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); submit() } }} />
        </Field>
      </form>
    </Modal>
  )
}

// Input password dengan ikon mata untuk menampilkan/menyembunyikan isian
export function PasswordInput(props: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>) {
  const [visible, setVisible] = useState(false)
  return (
    <span className="pap-password-field">
      <input {...props} type={visible ? 'text' : 'password'} className={`pap-input ${props.className ?? ''}`} />
      <button type="button" className="pap-password-toggle" onClick={() => setVisible((v) => !v)} aria-label={visible ? 'Sembunyikan password' : 'Tampilkan password'} aria-pressed={visible}>
        {visible ? <EyeOff /> : <Eye />}
      </button>
    </span>
  )
}

export function Notice({ kind = 'error', children, onClose }: { kind?: 'error' | 'success'; children: ReactNode; onClose?: () => void }) {
  return (
    <div className={`pap-notice ${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
      <span>{children}</span>
      {onClose && <button onClick={onClose} aria-label="Tutup pesan"><X /></button>}
    </div>
  )
}

const STATUS_TONE: Record<PlanningStatus, string> = { belum_mulai: 'neutral', berjalan: 'info', selesai: 'success', ditunda: 'warning', dibatalkan: 'danger' }

export const StatusBadge = ({ value }: { value: PlanningStatus }) => <span className={`pap-status ${STATUS_TONE[value]}`}>{PLANNING_STATUS[value]}</span>

export function Progress({ value }: { value: number }) {
  return (
    <div className="pap-progress" aria-label={`Progress ${value}%`}>
      <div className="pap-progress-track"><div style={{ width: `${value}%` }} className={value >= 100 ? 'done' : ''} /></div>
      <span>{value}%</span>
    </div>
  )
}

// Tabel tampil sebagai kartu di layar HP (lihat CSS .pap-table-wrap @max-width:640px): setiap sel diberi
// data-label dari judul kolomnya, dan sel judul pertama ditandai data-title. Tabel matriks dikecualikan.
const CARD_TABLES = '.pap-table-wrap table:not(.pap-perm-table):not(.pap-shift-table):not(.pap-fin-list)'
function labelTables(root: ParentNode) {
  root.querySelectorAll<HTMLTableElement>(CARD_TABLES).forEach((table) => {
    const heads = [...table.querySelectorAll('thead th')].map((th) => th.textContent?.trim() ?? '')
    if (!heads.length) return
    const titleIndex = heads.findIndex((h) => h && h !== '#')
    table.querySelectorAll('tbody tr').forEach((tr) => {
      let col = 0
      for (const cell of tr.children) {
        const label = heads[col] ?? ''
        if (cell.getAttribute('data-label') !== label) cell.setAttribute('data-label', label)
        cell.toggleAttribute('data-title', col === titleIndex)
        col += (cell as HTMLTableCellElement).colSpan || 1
      }
    })
  })
}

export function useCardTables() {
  useEffect(() => {
    let frame = 0
    const run = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(() => labelTables(document)) }
    const observer = new MutationObserver(run)
    observer.observe(document.body, { childList: true, subtree: true })
    run()
    return () => { observer.disconnect(); cancelAnimationFrame(frame) }
  }, [])
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des']
export function formatDate(value: string | null | undefined, withTime = false) {
  if (!value) return '—'
  const [date, time] = value.split(' ')
  const [y, m, d] = date.split('-').map(Number)
  return `${d} ${MONTHS[m - 1]} ${y}${withTime && time ? ` ${time.slice(0, 5)}` : ''}`
}

export function formatSize(bytes: number | null) {
  if (!bytes) return ''
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

// ---------- Pagination (dipakai semua halaman daftar) ----------
export const PAGE_SIZES = [25, 50, 100] as const

// Nomor halaman ringkas: 1 … 4 5 6 … 20
function pageNumbers(page: number, count: number): (number | '…')[] {
  const pages = new Set([1, count, page - 1, page, page + 1].filter((p) => p >= 1 && p <= count))
  const sorted = [...pages].sort((a, b) => a - b)
  const out: (number | '…')[] = []
  sorted.forEach((p, i) => {
    if (i && p - sorted[i - 1] > 1) out.push('…')
    out.push(p)
  })
  return out
}

export type PagerProps = { page: number; pageSize: number; total: number; onPage: (page: number) => void; onPageSize?: (size: number) => void; noun?: string }

// Baris pagination di bawah tabel: "1–25 dari 312 data", pilihan baris per halaman, nomor halaman
export function Pager({ page, pageSize, total, onPage, onPageSize, noun = 'data' }: PagerProps) {
  const count = Math.max(1, Math.ceil(total / pageSize))
  if (total <= PAGE_SIZES[0] && !(onPageSize && pageSize < total)) return null
  const go = (p: number) => onPage(Math.min(count, Math.max(1, p)))
  return (
    <nav className="pap-pager" aria-label="Pagination">
      <span className="pap-pager-info">{total ? `${((page - 1) * pageSize + 1).toLocaleString('id-ID')}–${Math.min(page * pageSize, total).toLocaleString('id-ID')} dari ${total.toLocaleString('id-ID')} ${noun}` : `0 ${noun}`}</span>
      {onPageSize && (
        <label className="pap-pager-size">
          <select className="pap-select" value={pageSize} onChange={(e) => onPageSize(Number(e.target.value))} aria-label="Baris per halaman">
            {PAGE_SIZES.map((s) => <option key={s} value={s}>{s} / halaman</option>)}
          </select>
        </label>
      )}
      {count > 1 && (
        <div className="pap-pager-pages">
          <button className="pap-icon-button" aria-label="Halaman pertama" disabled={page <= 1} onClick={() => go(1)}><ChevronsLeft /></button>
          <button className="pap-icon-button" aria-label="Sebelumnya" disabled={page <= 1} onClick={() => go(page - 1)}><ChevronLeft /></button>
          {pageNumbers(page, count).map((p, i) => p === '…'
            ? <span key={`gap-${i}`} className="pap-pager-gap">…</span>
            : <button key={p} className={`pap-pager-num ${p === page ? 'active' : ''}`} aria-current={p === page ? 'page' : undefined} onClick={() => go(p)}>{p}</button>)}
          <button className="pap-icon-button" aria-label="Berikutnya" disabled={page >= count} onClick={() => go(page + 1)}><ChevronRight /></button>
          <button className="pap-icon-button" aria-label="Halaman terakhir" disabled={page >= count} onClick={() => go(count)}><ChevronsRight /></button>
        </div>
      )}
    </nav>
  )
}

// Pagination di sisi tampilan untuk daftar yang sudah dimuat semua.
// resetKey berubah (mis. filter / pencarian) -> kembali ke halaman 1; data berkurang -> halaman disesuaikan.
export function usePaged<T>(items: T[], resetKey: unknown = null, initialSize: number = PAGE_SIZES[0]) {
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(initialSize)
  const key = JSON.stringify(resetKey)
  useEffect(() => setPage(1), [key])
  const count = Math.max(1, Math.ceil(items.length / pageSize))
  const current = Math.min(page, count)
  const pageItems = useMemo(() => items.slice((current - 1) * pageSize, current * pageSize), [items, current, pageSize])
  return {
    items: pageItems,
    offset: (current - 1) * pageSize,
    pager: { page: current, pageSize, total: items.length, onPage: setPage, onPageSize: (s: number) => { setPageSize(s); setPage(1) } } satisfies PagerProps,
  }
}

// Tombol aksi di baris tabel: lihat detail & ubah (tidak ikut memicu klik baris)
export function RowActions({ label, onView, onEdit, onDelete }: { label: string; onView?: () => void; onEdit?: () => void; onDelete?: () => void }) {
  return (
    <div className="pap-row-actions" onClick={(e) => e.stopPropagation()}>
      {onView && <button type="button" className="pap-row-action" title="Lihat detail" aria-label={`Lihat detail ${label}`} onClick={onView}><Eye /><span>Detail</span></button>}
      {onEdit && <button type="button" className="pap-row-action edit" title="Ubah" aria-label={`Ubah ${label}`} onClick={onEdit}><Pencil /><span>Ubah</span></button>}
      {onDelete && <button type="button" className="pap-row-action danger" title="Hapus" aria-label={`Hapus ${label}`} onClick={onDelete}><Trash2 /><span>Hapus</span></button>}
    </div>
  )
}

// ---------- Aksi cepat (tombol "+ Lapor" di HP) ----------
// Shell menitipkan nama aksi lalu membuka menunya; halaman tujuan menjalankan aksinya (mis. membuka form) saat tampil.
// Bila halaman itu sudah terbuka, aksi dikirim lewat event agar tetap dijalankan.
const QUICK_EVENT = 'pap-quick-action'
const quickState = globalThis as unknown as { papQuickAction?: string | null }

export function requestQuickAction(name: string) {
  quickState.papQuickAction = name
  window.dispatchEvent(new CustomEvent(QUICK_EVENT, { detail: name }))
}
// Lihat aksi yang dititipkan tanpa menjalankannya (mis. untuk memilih tab awal)
export const peekQuickAction = () => quickState.papQuickAction ?? null

export function useQuickAction(name: string, run: () => void) {
  const runRef = useRef(run)
  runRef.current = run
  useEffect(() => {
    const take = () => {
      if (quickState.papQuickAction !== name) return
      quickState.papQuickAction = null
      runRef.current()
    }
    take()
    window.addEventListener(QUICK_EVENT, take)
    return () => window.removeEventListener(QUICK_EVENT, take)
  }, [name])
}

// Amati aksi cepat tanpa mengambilnya (mis. pembungkus halaman berpindah tab agar halaman tujuan yang menjalankannya)
export function useQuickActionWatch(onAction: (name: string) => void) {
  const ref = useRef(onAction)
  ref.current = onAction
  useEffect(() => {
    const watch = (e: Event) => ref.current((e as CustomEvent<string>).detail)
    window.addEventListener(QUICK_EVENT, watch)
    return () => window.removeEventListener(QUICK_EVENT, watch)
  }, [])
}
