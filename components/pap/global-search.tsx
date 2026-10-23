'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { CornerDownLeft, LayoutGrid, Search, X } from 'lucide-react'
import type { NotificationTarget } from './notifications'
import { api } from './ui'

type Hit = { page: string; title: string; sub: string | null; target?: NotificationTarget; query?: string }
type Option = { key: string; group: string; title: string; sub?: string | null; run: () => void }

const PAGE_SEARCH = '.pap-content input[type="search"], .pap-content input[placeholder^="Cari" i]'

// Isi kotak pencarian milik halaman (semua halaman daftar punya input "Cari ...") lalu picu onChange React
export function fillPageSearch(term: string, timeout = 4000) {
  const started = Date.now()
  const tick = () => {
    const input = document.querySelector<HTMLInputElement>(PAGE_SEARCH)
    if (!input) {
      if (Date.now() - started < timeout) window.setTimeout(tick, 120)
      return
    }
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, term)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }
  tick()
}

// Kotak "Cari data..." di header: cari menu, data dari semua modul yang boleh dibuka, atau isi pencarian halaman aktif
export function GlobalSearch({ menus, active, onGo, onOpen }: { menus: string[]; active: string; onGo: (label: string) => void; onOpen: (target: NotificationTarget & { page?: string }) => void }) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [hits, setHits] = useState<Hit[]>([])
  const [loading, setLoading] = useState(false)
  const [cursor, setCursor] = useState(0)
  const [pageHasSearch, setPageHasSearch] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const term = q.trim()

  // Ctrl/⌘ + K membuka pencarian dari mana saja
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setOpen(true); input.current?.focus() }
    }
    const onClick = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false) }
    window.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onClick)
    return () => { window.removeEventListener('keydown', onKey); document.removeEventListener('mousedown', onClick) }
  }, [])

  useEffect(() => { if (open) setPageHasSearch(!!document.querySelector(PAGE_SEARCH)) }, [open, active])

  useEffect(() => {
    if (term.length < 2) { setHits([]); setLoading(false); return }
    setLoading(true)
    let cancelled = false
    const timer = window.setTimeout(async () => {
      try {
        const res = await api<{ items: Hit[] }>(`/api/search?q=${encodeURIComponent(term)}`)
        if (!cancelled) setHits(res.items)
      } catch {
        if (!cancelled) setHits([])
      } finally {
        if (!cancelled) setLoading(false)
      }
    }, 250)
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [term])

  const close = () => { setOpen(false); setQ(''); input.current?.blur() }
  const options = useMemo<Option[]>(() => {
    if (!term) return []
    const list: Option[] = []
    const lower = term.toLowerCase()
    if (pageHasSearch) list.push({ key: 'page', group: 'Halaman ini', title: `Cari “${term}” di ${active}`, run: () => fillPageSearch(term) })
    for (const label of menus.filter((m) => m.toLowerCase().includes(lower)).slice(0, 5)) {
      list.push({ key: `menu-${label}`, group: 'Menu', title: label, run: () => onGo(label) })
    }
    hits.forEach((h, i) => list.push({
      key: `hit-${i}`, group: h.page, title: h.title, sub: h.sub,
      run: () => {
        if (h.target) onOpen({ ...h.target, page: h.page })
        else { onGo(h.page); fillPageSearch(h.query ?? h.title) }
      },
    }))
    return list
  }, [term, pageHasSearch, active, menus, hits, onGo, onOpen])

  useEffect(() => setCursor(0), [options.length, term])

  function choose(o: Option | undefined) {
    if (!o) return
    o.run()
    close()
  }
  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setCursor((c) => Math.min(c + 1, options.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)) }
    else if (e.key === 'Enter') { e.preventDefault(); choose(options[cursor]) }
    else if (e.key === 'Escape') close()
  }

  return (
    <div className={`pap-search ${open ? 'open' : ''}`} ref={box}>
      <button type="button" className="pap-search-trigger" aria-label="Cari data" onClick={() => { setOpen(true); window.setTimeout(() => input.current?.focus(), 0) }}><Search /></button>
      <Search className="pap-search-icon" />
      <input ref={input} value={q} placeholder="Cari data..." aria-label="Cari data" onFocus={() => setOpen(true)} onChange={(e) => { setQ(e.target.value); setOpen(true) }} onKeyDown={onKeyDown} />
      {q ? <button type="button" className="pap-search-clear" aria-label="Hapus" onClick={() => { setQ(''); input.current?.focus() }}><X /></button> : <kbd>Ctrl K</kbd>}
      {open && (
        <div className="pap-search-panel" role="listbox">
          {!term ? <p className="pap-search-empty">Ketik nama customer, prospek, nomor quotation, produk, supplier, karyawan, mesin, atau nama menu.</p> : (
            <>
              {options.map((o, i) => (
                <div key={o.key}>
                  {(i === 0 || options[i - 1].group !== o.group) && <p className="pap-search-group">{o.group}</p>}
                  <button type="button" role="option" aria-selected={i === cursor} className={`pap-search-item ${i === cursor ? 'active' : ''}`} onMouseEnter={() => setCursor(i)} onClick={() => choose(o)}>
                    {o.group === 'Menu' ? <LayoutGrid /> : o.key === 'page' ? <Search /> : null}
                    <span><b>{o.title}</b>{o.sub && <small>{o.sub}</small>}</span>
                    {i === cursor && <CornerDownLeft className="pap-search-enter" />}
                  </button>
                </div>
              ))}
              {loading && <p className="pap-search-empty">Mencari…</p>}
              {!loading && term.length >= 2 && !hits.length && <p className="pap-search-empty">Tidak ada data yang cocok dengan “{term}”.</p>}
              {term.length < 2 && <p className="pap-search-empty">Ketik minimal 2 huruf untuk mencari data.</p>}
            </>
          )}
        </div>
      )}
    </div>
  )
}
