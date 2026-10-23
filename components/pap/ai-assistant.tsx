'use client'

import { Fragment, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { ArrowUp, Maximize2, Minimize2, RotateCcw, Sparkles, Table2, X, BarChart3 } from 'lucide-react'
import { formatNumber, formatRupiah } from './accurate'
import { api } from './ui'

type Chart = { jenis: 'bar' | 'line' | 'hbar'; judul: string; label: string[]; seri: { nama: string; data: number[] }[]; format: 'rupiah' | 'angka' | 'persen'; catatan?: string }
type Message = { role: 'user' | 'model'; text: string; charts?: Chart[]; sources?: string[]; error?: boolean }
type Caps = { sales: boolean; customer: boolean; prospek: boolean; keuangan: boolean }

const TONES = ['var(--viz-s1)', 'var(--viz-s2)', 'var(--viz-s3)', 'var(--viz-s4)']
const STEPS = ['Membaca pertanyaan…', 'Mengambil data SIMPAP…', 'Menganalisis angka…', 'Menyusun grafik & rekomendasi…']

// ---------- Format angka ----------
function shortRupiah(v: number) {
  const a = Math.abs(v)
  if (a >= 1e9) return `Rp ${formatNumber(v / 1e9, 2)} M`
  if (a >= 1e6) return `Rp ${formatNumber(v / 1e6, 1)} jt`
  if (a >= 1e3) return `Rp ${formatNumber(v / 1e3, 0)} rb`
  return formatRupiah(v)
}
const fmt = (f: Chart['format'], v: number, short = false) => (f === 'rupiah' ? (short ? shortRupiah(v) : formatRupiah(v)) : f === 'persen' ? `${formatNumber(v, 1)}%` : formatNumber(v, Number.isInteger(v) ? 0 : 1))
function niceMax(v: number) {
  if (v <= 0) return 1
  const p = 10 ** Math.floor(Math.log10(v))
  return [1, 2, 2.5, 5, 10].map((m) => m * p).find((m) => m >= v) ?? v
}

// ---------- Markdown ringan (tanpa HTML mentah) ----------
function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`|\*[^*\s][^*]*\*)/g).filter(Boolean).map((t, i) => {
    if (t.startsWith('**') && t.endsWith('**')) return <strong key={i}>{t.slice(2, -2)}</strong>
    if (t.startsWith('`') && t.endsWith('`')) return <code key={i}>{t.slice(1, -1)}</code>
    if (t.startsWith('*') && t.endsWith('*') && t.length > 2) return <em key={i}>{t.slice(1, -1)}</em>
    return <Fragment key={i}>{t}</Fragment>
  })
}
function Markdown({ text }: { text: string }) {
  const lines = text.replace(/\r/g, '').split('\n')
  const out: ReactNode[] = []
  for (let i = 0; i < lines.length;) {
    const line = lines[i]
    const trimmed = line.trim()
    if (!trimmed) { i++; continue }
    if (/^([-*_])\1{2,}$/.test(trimmed)) { out.push(<hr key={i} />); i++; continue }
    const heading = trimmed.match(/^(#{1,4})\s+(.*)$/)
    if (heading) { out.push(<h4 key={i}>{inline(heading[2])}</h4>); i++; continue }
    if (trimmed.startsWith('|')) {
      const rows: string[][] = []
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        const cells = lines[i].trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim())
        if (!cells.every((c) => /^:?-{2,}:?$/.test(c))) rows.push(cells)
        i++
      }
      const [head, ...body] = rows
      out.push(
        <div className="pap-ai-table" key={`t${i}`}><table>
          <thead><tr>{head.map((c, j) => <th key={j}>{inline(c)}</th>)}</tr></thead>
          <tbody>{body.map((r, k) => <tr key={k}>{r.map((c, j) => <td key={j}>{inline(c)}</td>)}</tr>)}</tbody>
        </table></div>,
      )
      continue
    }
    if (/^([-*•]|\d+[.)])\s+/.test(trimmed)) {
      const ordered = /^\d/.test(trimmed)
      const items: ReactNode[] = []
      while (i < lines.length && /^\s*([-*•]|\d+[.)])\s+/.test(lines[i])) {
        const nested = /^\s{2,}/.test(lines[i])
        items.push(<li key={i} className={nested ? 'nested' : undefined}>{inline(lines[i].trim().replace(/^([-*•]|\d+[.)])\s+/, ''))}</li>)
        i++
      }
      out.push(ordered ? <ol key={`l${i}`}>{items}</ol> : <ul key={`l${i}`}>{items}</ul>)
      continue
    }
    const para: string[] = []
    while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|\||\s*([-*•]|\d+[.)])\s)/.test(lines[i].trim()) && !/^([-*_])\1{2,}$/.test(lines[i].trim())) para.push(lines[i++].trim())
    out.push(<p key={`p${i}`}>{inline(para.join(' '))}</p>)
  }
  return <div className="pap-ai-md">{out}</div>
}

// ---------- Grafik ----------
function useWidth() {
  const ref = useRef<HTMLDivElement>(null)
  const [w, setW] = useState(360)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setW(Math.max(220, Math.round(e.contentRect.width))))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, w] as const
}

function XYChart({ chart }: { chart: Chart }) {
  const [ref, width] = useWidth()
  const [hover, setHover] = useState<number | null>(null)
  const H = 210, padL = 58, padR = 10, padT = 12, padB = 30
  const n = chart.label.length
  const all = chart.seri.flatMap((s) => s.data)
  const min = Math.min(0, ...all)
  const max = niceMax(Math.max(...all, 0))
  const lo = min < 0 ? -niceMax(-min) : 0
  const plotW = width - padL - padR, plotH = H - padT - padB
  const y = (v: number) => padT + plotH - ((v - lo) / (max - lo || 1)) * plotH
  const slot = plotW / n
  const x = (i: number) => padL + slot * i + slot / 2
  const ticks = [0, 1, 2, 3, 4].map((k) => lo + ((max - lo) * k) / 4)
  const every = Math.max(1, Math.ceil(n / Math.floor(plotW / 54)))
  const groupW = Math.min(slot * 0.72, 18 * chart.seri.length + 8)
  const barW = Math.max(3, (groupW - 2 * (chart.seri.length - 1)) / chart.seri.length)
  const shortLabel = (l: string) => (/^\d{4}-\d{2}$/.test(l) ? `${['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'][Number(l.slice(5)) - 1]} ${l.slice(2, 4)}` : l.length > 10 ? `${l.slice(0, 9)}…` : l)
  return (
    <div className="pap-ai-plot" ref={ref} onMouseLeave={() => setHover(null)}>
      <svg width={width} height={H} role="img" aria-label={chart.judul}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={padL} x2={width - padR} y1={y(t)} y2={y(t)} stroke={t === 0 ? 'var(--viz-axis)' : 'var(--viz-grid)'} />
            <text x={padL - 6} y={y(t) + 3.5} textAnchor="end" className="pap-ai-axis">{fmt(chart.format, t, true).replace('Rp ', '')}</text>
          </g>
        ))}
        {chart.label.map((l, i) => i % every === 0 && <text key={l + i} x={x(i)} y={H - 10} textAnchor="middle" className="pap-ai-axis">{shortLabel(l)}</text>)}
        {hover !== null && <rect x={padL + slot * hover} y={padT} width={slot} height={plotH} fill="var(--viz-grid)" opacity={0.6} />}
        {chart.jenis === 'bar'
          ? chart.seri.map((s, si) => s.data.map((v, i) => {
            const top = y(Math.max(v, 0)), bottom = y(Math.min(v, 0))
            return <rect key={`${si}-${i}`} x={x(i) - groupW / 2 + si * (barW + 2)} y={top} width={barW} height={Math.max(1, bottom - top)} rx={Math.min(4, barW / 2)} fill={chart.seri.length === 1 ? 'var(--viz-brand)' : TONES[si]} />
          }))
          : chart.seri.map((s, si) => (
            <g key={si}>
              <polyline fill="none" stroke={chart.seri.length === 1 ? 'var(--viz-brand)' : TONES[si]} strokeWidth={2} strokeLinejoin="round" points={s.data.map((v, i) => `${x(i)},${y(v)}`).join(' ')} />
              {s.data.map((v, i) => (hover === i || n <= 12) && <circle key={i} cx={x(i)} cy={y(v)} r={hover === i ? 4.5 : 3} fill={chart.seri.length === 1 ? 'var(--viz-brand)' : TONES[si]} stroke="var(--pap-surface)" strokeWidth={2} />)}
            </g>
          ))}
        {chart.label.map((l, i) => <rect key={`h${i}`} x={padL + slot * i} y={padT} width={slot} height={plotH + padB} fill="transparent" onMouseEnter={() => setHover(i)} onClick={() => setHover(i)} />)}
      </svg>
      {hover !== null && (
        <div className="pap-ai-tip" style={{ left: Math.min(Math.max(x(hover), 80), width - 80) }}>
          <b>{chart.label[hover]}</b>
          {chart.seri.map((s, si) => <span key={si}>{chart.seri.length > 1 && <i style={{ background: TONES[si] }} />}{chart.seri.length > 1 ? `${s.nama}: ` : ''}<strong>{fmt(chart.format, s.data[hover] ?? 0)}</strong></span>)}
        </div>
      )}
    </div>
  )
}

function HBarChart({ chart }: { chart: Chart }) {
  const s = chart.seri[0]
  const max = Math.max(...s.data.map(Math.abs), 1)
  const total = s.data.reduce((a, b) => a + b, 0)
  return (
    <div className="pap-ai-hbars">
      {chart.label.map((l, i) => (
        <div className="pap-ai-hbar" key={l + i} title={`${l}: ${fmt(chart.format, s.data[i])}`}>
          <div className="pap-ai-hbar-head"><span>{l}</span><b>{fmt(chart.format, s.data[i], true)}{chart.format !== 'persen' && total > 0 && s.data.every((v) => v >= 0) ? <small> · {formatNumber((s.data[i] / total) * 100, 0)}%</small> : null}</b></div>
          <div className="pap-ai-hbar-track"><span style={{ width: `${(Math.abs(s.data[i]) / max) * 100}%` }} /></div>
        </div>
      ))}
    </div>
  )
}

function ChartCard({ chart }: { chart: Chart }) {
  const [table, setTable] = useState(false)
  return (
    <figure className="pap-ai-chart">
      <figcaption>
        <span>{chart.judul}</span>
        <button type="button" onClick={() => setTable(!table)} aria-label={table ? 'Lihat grafik' : 'Lihat tabel'} title={table ? 'Lihat grafik' : 'Lihat tabel'}>{table ? <BarChart3 /> : <Table2 />}</button>
      </figcaption>
      {chart.seri.length > 1 && !table && <div className="pap-ai-legend">{chart.seri.map((s, i) => <span key={i}><i style={{ background: TONES[i] }} />{s.nama}</span>)}</div>}
      {table ? (
        <div className="pap-ai-table"><table>
          <thead><tr><th />{chart.seri.map((s, i) => <th key={i} className="num">{s.nama || 'Nilai'}</th>)}</tr></thead>
          <tbody>{chart.label.map((l, i) => <tr key={i}><td>{l}</td>{chart.seri.map((s, j) => <td key={j} className="num">{fmt(chart.format, s.data[i] ?? 0)}</td>)}</tr>)}</tbody>
        </table></div>
      ) : chart.jenis === 'hbar' ? <HBarChart chart={chart} /> : <XYChart chart={chart} />}
      {chart.catatan && <p className="pap-ai-chart-note">{chart.catatan}</p>}
    </figure>
  )
}

// ---------- Panel ----------
function suggestions(c: Caps | null) {
  const list: string[] = []
  if (!c || c.sales) list.push('Bagaimana tren penjualan 12 bulan terakhir per sektor?')
  if (!c || c.customer) list.push('Cari peluang customer laundry: wilayah potensial & customer pasif yang perlu dihubungi', 'Analisis customer sektor beras dan rekomendasi strategi')
  if (c?.prospek) list.push('Bagaimana pipeline prospek saat ini?')
  if (c?.keuangan) list.push('Analisis laba rugi bulan ini dibanding bulan lalu', 'Bagaimana kondisi piutang dan arus kas 13 minggu ke depan?')
  return list.slice(0, 5)
}

export function AiAssistant({ userId, userName }: { userId: number; userName: string }) {
  const storeKey = `pap-ai:${userId}`
  const [open, setOpen] = useState(false)
  const [wide, setWide] = useState(false)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [step, setStep] = useState(0)
  const [caps, setCaps] = useState<Caps | null>(null)
  const [enabled, setEnabled] = useState(true)
  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // Riwayat chat disimpan di browser ini saja (kenyamanan), bukan di server
  useEffect(() => {
    try {
      const saved = localStorage.getItem(storeKey)
      if (saved) setMessages(JSON.parse(saved))
    } catch { /* abaikan */ }
  }, [storeKey])
  useEffect(() => {
    try { localStorage.setItem(storeKey, JSON.stringify(messages.slice(-30))) } catch { /* abaikan */ }
  }, [messages, storeKey])
  useEffect(() => {
    if (!open || caps) return
    api<{ enabled: boolean; can: Caps }>('/api/ai/chat').then((r) => { setCaps(r.can); setEnabled(r.enabled) }).catch(() => {})
  }, [open, caps])
  useEffect(() => {
    if (open) window.setTimeout(() => inputRef.current?.focus(), 150)
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    if (open) window.addEventListener('keydown', onKey)
    // Kunci scroll halaman di HP saat panel penuh layar
    document.body.classList.toggle('pap-ai-lock', open)
    return () => { window.removeEventListener('keydown', onKey); document.body.classList.remove('pap-ai-lock') }
  }, [open])
  useEffect(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' }) }, [messages, busy, open])
  useEffect(() => {
    if (!busy) return
    setStep(0)
    const t = window.setInterval(() => setStep((s) => Math.min(s + 1, STEPS.length - 1)), 2600)
    return () => window.clearInterval(t)
  }, [busy])
  useLayoutEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    // Kosong = satu baris (placeholder panjang tidak ikut menambah tinggi)
    if (input) el.style.height = `${Math.min(el.scrollHeight, 140)}px`
  }, [input, open])

  async function send(text: string) {
    const q = text.trim()
    if (!q || busy) return
    const next: Message[] = [...messages, { role: 'user', text: q }]
    setMessages(next)
    setInput('')
    setBusy(true)
    try {
      const res = await api<{ reply: string; charts: Chart[]; sources: string[] }>('/api/ai/chat', {
        method: 'POST', json: { messages: next.filter((m) => !m.error).slice(-12).map(({ role, text }) => ({ role, text })) },
      })
      setMessages((m) => [...m, { role: 'model', text: res.reply, charts: res.charts, sources: res.sources }])
    } catch (e) {
      setMessages((m) => [...m, { role: 'model', text: (e as Error).message || 'PAP AI gagal menjawab. Coba lagi.', error: true }])
    } finally {
      setBusy(false)
    }
  }

  const first = userName.split(' ')[0]
  return (
    <>
      <button type="button" className={`pap-ai-fab ${open ? 'hidden' : ''}`} onClick={() => setOpen(true)} aria-label="Buka PAP AI">
        <Sparkles /><span className="pap-ai-fab-badge">AI</span><span className="pap-ai-fab-label">Tanya PAP AI</span>
      </button>
      {open && <button type="button" className="pap-ai-backdrop" aria-label="Tutup PAP AI" onClick={() => setOpen(false)} />}
      <aside className={`pap-ai-panel ${open ? 'open' : ''} ${wide ? 'wide' : ''}`} aria-label="PAP AI" aria-hidden={!open}>
        <header className="pap-ai-head">
          <span className="pap-ai-logo"><Sparkles /></span>
          <div><strong>PAP AI</strong><small>Asisten analisis data SIMPAP</small></div>
          <span className="pap-spacer" />
          {messages.length > 0 && <button type="button" onClick={() => setMessages([])} aria-label="Percakapan baru" title="Percakapan baru" disabled={busy}><RotateCcw /></button>}
          <button type="button" className="pap-ai-wide-btn" onClick={() => setWide(!wide)} aria-label={wide ? 'Perkecil' : 'Perlebar'} title={wide ? 'Perkecil' : 'Perlebar'}>{wide ? <Minimize2 /> : <Maximize2 />}</button>
          <button type="button" onClick={() => setOpen(false)} aria-label="Tutup" title="Tutup"><X /></button>
        </header>
        <div className="pap-ai-body" ref={listRef}>
          {!messages.length ? (
            <div className="pap-ai-welcome">
              <span className="pap-ai-logo big"><Sparkles /></span>
              <h3>Halo {first}, ada yang ingin dianalisis?</h3>
              <p>PAP AI membaca data SIMPAP sesuai akses Anda (penjualan, customer, prospek, keuangan), lalu memberi ringkasan, grafik, dan rekomendasi.</p>
              {!enabled && <p className="pap-ai-warn">PAP AI belum aktif: GEMINI_API_KEY belum diset di server.</p>}
              <div className="pap-ai-chips">{suggestions(caps).map((s) => <button type="button" key={s} onClick={() => send(s)}>{s}</button>)}</div>
            </div>
          ) : messages.map((m, i) => (
            <div key={i} className={`pap-ai-msg ${m.role} ${m.error ? 'error' : ''}`}>
              {m.role === 'user' ? <p>{m.text}</p> : (
                <>
                  <Markdown text={m.text} />
                  {m.charts?.map((c, j) => <ChartCard key={j} chart={c} />)}
                  {!!m.sources?.length && <div className="pap-ai-sources">Data: {m.sources.join(' · ')}</div>}
                </>
              )}
            </div>
          ))}
          {busy && <div className="pap-ai-msg model pending"><span className="pap-ai-dots"><i /><i /><i /></span>{STEPS[step]}</div>}
        </div>
        <form className="pap-ai-input" onSubmit={(e) => { e.preventDefault(); send(input) }}>
          <textarea ref={inputRef} rows={1} value={input} placeholder="Tanya soal penjualan, customer, keuangan…" onChange={(e) => setInput(e.target.value)} maxLength={2000}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(input) } }} />
          <button type="submit" disabled={busy || !input.trim()} aria-label="Kirim"><ArrowUp /></button>
        </form>
        <p className="pap-ai-foot">PAP AI bisa keliru. Cek angka penting di menu terkait.</p>
      </aside>
    </>
  )
}
