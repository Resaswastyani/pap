'use client'

import { Children, cloneElement, isValidElement, useCallback, useEffect, useMemo, useState, type ReactElement, type ReactNode } from 'react'
import { ArrowDown, ArrowUp, Eye, EyeOff, GripVertical, LayoutGrid, RotateCcw } from 'lucide-react'
import { api } from './ui'

// Kartu (section) di Dashboard / Monitoring bisa diurutkan ulang dan disembunyikan per user.
// Setiap anak <ArrangeGrid> berupa elemen dengan `key` tetap dan `data-title`; anak yang `false` (tidak relevan) diabaikan.
type Layout = { order: string[]; hidden: string[] }
type Item = { key: string; title: string; el: ReactElement<{ className?: string; children?: ReactNode }> }

export function useArrange(page: 'dashboard' | 'monitoring') {
  const [layout, setLayout] = useState<Layout>({ order: [], hidden: [] })
  const [editing, setEditing] = useState(false)
  useEffect(() => {
    api<Layout>(`/api/preferences/layout?page=${page}`).then(setLayout).catch(() => {})
  }, [page])
  const save = useCallback((next: Layout) => {
    setLayout(next)
    api('/api/preferences/layout', { method: 'PUT', json: { page, ...next } }).catch(() => {})
  }, [page])
  return { layout, save, editing, setEditing }
}
export type Arrange = ReturnType<typeof useArrange>

// Tombol di judul halaman: "Atur tampilan" / "Selesai" + kembalikan susunan bawaan
export function ArrangeButton({ arrange, hiddenCount }: { arrange: Arrange; hiddenCount: number }) {
  const { editing, setEditing, layout, save } = arrange
  const custom = layout.order.length > 0 || layout.hidden.length > 0
  return (
    <div className="pap-inline-actions pap-wrap">
      {editing && custom && <button className="pap-btn" onClick={() => save({ order: [], hidden: [] })}><RotateCcw /> Susunan bawaan</button>}
      <button className={editing ? 'pap-primary-button' : 'pap-btn'} onClick={() => setEditing(!editing)} aria-pressed={editing}>
        <LayoutGrid /> {editing ? 'Selesai' : `Atur tampilan${hiddenCount ? ` (${hiddenCount} disembunyikan)` : ''}`}
      </button>
    </div>
  )
}

const keyOf = (el: ReactElement) => String(el.key ?? '').replace(/^\.\$/, '')

export function ArrangeGrid({ arrange, className, children }: { arrange: Arrange; className: string; children: ReactNode }) {
  const { layout, save, editing } = arrange
  const [drag, setDrag] = useState<string | null>(null)
  const [over, setOver] = useState<string | null>(null)
  // Kartu yang tampil saat ini, dalam urutan bawaan
  const items = useMemo(() => Children.toArray(children).filter(isValidElement).map((el) => {
    const e = el as Item['el']
    return { key: keyOf(e), title: String((e.props as Record<string, unknown>)['data-title'] ?? keyOf(e)), el: e }
  }), [children])
  // Urutan tersimpan; kartu baru (belum pernah diatur) tetap di posisi bawaannya
  const ordered = useMemo(() => {
    const saved = layout.order.filter((k) => items.some((i) => i.key === k))
    if (!saved.length) return items
    const out = saved.map((k) => items.find((i) => i.key === k)!)
    items.forEach((it, idx) => {
      if (saved.includes(it.key)) return
      const prev = items.slice(0, idx).reverse().find((p) => out.includes(p))
      out.splice(prev ? out.indexOf(prev) + 1 : 0, 0, it)
    })
    return out
  }, [items, layout.order])
  const hidden = new Set(layout.hidden)
  const commit = (keys: string[], nextHidden = layout.hidden) => {
    // Simpan urutan lengkap: kartu yang saat ini tidak tampil tetap di urutan tersimpan sebelumnya
    const rest = layout.order.filter((k) => !keys.includes(k))
    save({ order: [...keys, ...rest], hidden: nextHidden })
  }
  const move = (key: string, delta: number) => {
    const keys = ordered.map((i) => i.key)
    const from = keys.indexOf(key)
    const to = Math.max(0, Math.min(keys.length - 1, from + delta))
    if (from === to) return
    keys.splice(to, 0, keys.splice(from, 1)[0])
    commit(keys)
  }
  const dropOn = (target: string) => {
    if (!drag || drag === target) return
    const keys = ordered.map((i) => i.key).filter((k) => k !== drag)
    keys.splice(keys.indexOf(target), 0, drag)
    commit(keys)
  }
  const toggle = (key: string) => {
    const next = hidden.has(key) ? layout.hidden.filter((k) => k !== key) : [...layout.hidden, key]
    commit(ordered.map((i) => i.key), next)
  }

  return (
    <div className={`${className} ${editing ? 'pap-arrange-editing' : ''}`}>
      {ordered.map((it, idx) => {
        const isHidden = hidden.has(it.key)
        if (isHidden && !editing) return null
        if (!editing) return cloneElement(it.el, { key: it.key })
        const bar = (
          <div className="pap-arrange-bar" key="__arrange">
            <span className="pap-arrange-grip" title="Seret untuk memindah"><GripVertical /></span>
            <b>{it.title}</b>
            <button type="button" onClick={() => move(it.key, -1)} disabled={idx === 0} aria-label={`Naikkan ${it.title}`} title="Naikkan"><ArrowUp /></button>
            <button type="button" onClick={() => move(it.key, 1)} disabled={idx === ordered.length - 1} aria-label={`Turunkan ${it.title}`} title="Turunkan"><ArrowDown /></button>
            <button type="button" className={isHidden ? 'on' : ''} onClick={() => toggle(it.key)} aria-label={isHidden ? `Tampilkan ${it.title}` : `Sembunyikan ${it.title}`} title={isHidden ? 'Tampilkan' : 'Sembunyikan'}>
              {isHidden ? <Eye /> : <EyeOff />}<span>{isHidden ? 'Tampilkan' : 'Sembunyikan'}</span>
            </button>
          </div>
        )
        const props = it.el.props as Record<string, unknown>
        return cloneElement(it.el, {
          key: it.key,
          className: `${String(props.className ?? '')} pap-arrange-item ${isHidden ? 'is-hidden' : ''} ${drag === it.key ? 'is-drag' : ''} ${over === it.key && drag && drag !== it.key ? 'is-over' : ''}`,
          draggable: true,
          onDragStart: (e: React.DragEvent) => { setDrag(it.key); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', it.key) },
          onDragOver: (e: React.DragEvent) => { e.preventDefault(); if (over !== it.key) setOver(it.key) },
          onDrop: (e: React.DragEvent) => { e.preventDefault(); dropOn(it.key); setDrag(null); setOver(null) },
          onDragEnd: () => { setDrag(null); setOver(null) },
          children: [bar, <div key="__content" className="pap-arrange-content">{props.children as ReactNode}</div>],
        } as Record<string, unknown>)
      })}
    </div>
  )
}
