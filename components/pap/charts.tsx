'use client'

import { useEffect, useState, type ReactNode } from 'react'

// Grafik ringan tanpa library: kolom (1 seri), batang horizontal, dan Gantt.
// Warna diambil dari token --viz-* di globals.css agar ikut tema terang/gelap.

// true bila media query cocok (mis. layar HP); ikut berubah saat layar diputar / diubah ukurannya
export function useMediaQuery(query: string) {
  const [match, setMatch] = useState(false)
  useEffect(() => {
    const mql = window.matchMedia(query)
    const update = () => setMatch(mql.matches)
    update()
    mql.addEventListener('change', update)
    return () => mql.removeEventListener('change', update)
  }, [query])
  return match
}

type Tip = { x: number; y: number; content: ReactNode } | null

function Tooltip({ tip }: { tip: Tip }) {
  if (!tip) return null
  return <div className="pap-viz-tip" style={{ left: tip.x, top: tip.y }} role="tooltip">{tip.content}</div>
}

// Posisi tooltip relatif ke kartu grafik (elemen .pap-viz-host terdekat)
function tipAt(event: { currentTarget: Element }, content: ReactNode): Tip {
  const host = event.currentTarget.closest('.pap-viz-host')
  const box = event.currentTarget.getBoundingClientRect()
  const base = host?.getBoundingClientRect() ?? { left: 0, top: 0, width: 0 }
  const x = Math.min(Math.max(box.left + box.width / 2 - base.left, 90), Math.max(90, base.width - 90))
  return { x, y: box.top - base.top, content }
}

// Skala sumbu yang "bulat": 1, 2, 2.5, 5 x 10^n
function niceMax(value: number, ticks = 4) {
  if (value <= 0) return 1
  const raw = value / ticks
  const pow = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? raw
  return step * ticks
}

// segments: kolom bertumpuk (mis. omzet per sektor); tone = kelas warna s1..s4, urutan dari bawah ke atas
export type ColumnSegment = { key: string; value: number; tone: string }
export type ColumnDatum = { key: string; label: string; value: number; partial?: boolean; detail?: ReactNode; segments?: ColumnSegment[] }

export function ColumnChart({ data, format, axisFormat, ariaLabel }: { data: ColumnDatum[]; format: (v: number) => string; axisFormat?: (v: number) => string; ariaLabel: string }) {
  const [tip, setTip] = useState<Tip>(null)
  const top = niceMax(Math.max(0, ...data.map((d) => d.value)))
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * top)
  const maxIndex = data.reduce((best, d, i) => (d.value > data[best].value ? i : best), 0)
  return (
    <div className="pap-viz-host pap-colchart" onMouseLeave={() => setTip(null)}>
      <div className="pap-colchart-plot" role="img" aria-label={ariaLabel}>
        {ticks.map((t) => (
          <div key={t} className={`pap-colchart-grid ${t === 0 ? 'base' : ''}`} style={{ bottom: `${(t / top) * 100}%` }}>
            <span>{(axisFormat ?? format)(t)}</span>
          </div>
        ))}
        <div className="pap-colchart-bars" style={{ gridTemplateColumns: `repeat(${data.length}, minmax(0, 1fr))` }}>
          {data.map((d, i) => {
            // Label nilai hanya pada puncak dan bulan terakhir agar tidak ramai
            const showLabel = i === maxIndex || i === data.length - 1
            const content = <><b>{d.label}{d.partial ? ' (berjalan)' : ''}</b><span>{format(d.value)}</span>{d.detail}</>
            return (
              <button
                key={d.key}
                className={`pap-colchart-col ${d.partial ? 'partial' : ''}`}
                onMouseEnter={(e) => setTip(tipAt(e, content))}
                onFocus={(e) => setTip(tipAt(e, content))}
                onBlur={() => setTip(null)}
                aria-label={`${d.label}: ${format(d.value)}`}
              >
                <span className={`pap-colchart-fill ${d.segments ? 'stacked' : ''}`} style={{ height: `${Math.max(d.value > 0 ? 1.5 : 0, (d.value / top) * 100)}%` }}>
                  {d.segments?.filter((s) => s.value > 0).map((s) => <i key={s.key} className={s.tone} style={{ flexGrow: s.value }} />)}
                  {showLabel && d.value > 0 && <em>{format(d.value)}</em>}
                </span>
              </button>
            )
          })}
        </div>
      </div>
      <div className="pap-colchart-x" style={{ gridTemplateColumns: `repeat(${data.length}, minmax(0, 1fr))` }}>
        {data.map((d) => <span key={d.key}>{d.label}</span>)}
      </div>
      <Tooltip tip={tip} />
    </div>
  )
}

export type BarItem = { key: string; label: string; value: number; display?: string; tone?: 'critical' | 'muted' | 's1' | 's2' | 's3' | 's4' | 's5'; icon?: ReactNode; onClick?: () => void }

export function BarList({ items, max }: { items: BarItem[]; max?: number }) {
  const top = max ?? Math.max(1, ...items.map((i) => i.value))
  return (
    <ul className="pap-barlist">
      {items.map((item) => {
        const body = (
          <>
            <span className="pap-barlist-label">{item.icon}{item.label}</span>
            <span className="pap-barlist-track"><span className={`pap-barlist-fill ${item.tone ?? ''}`} style={{ width: `${item.value > 0 ? Math.max(1.5, (item.value / top) * 100) : 0}%` }} /></span>
            <b>{item.display ?? item.value.toLocaleString('id-ID')}</b>
          </>
        )
        return <li key={item.key}>{item.onClick ? <button onClick={item.onClick}>{body}</button> : <div>{body}</div>}</li>
      })}
    </ul>
  )
}

// ---- Gantt ----
const DAY_MS = 86400000
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des']
const DAYS = ['M', 'S', 'S', 'R', 'K', 'J', 'S']

// "YYYY-MM-DD[ HH:MM:SS]" -> hari (pecahan) sejak epoch, tanpa geser zona waktu
export function dayNumber(value: string) {
  const [date, time = '00:00:00'] = value.split(' ')
  const [y, m, d] = date.split('-').map(Number)
  const [hh, mm] = time.split(':').map(Number)
  return Date.UTC(y, m - 1, d) / DAY_MS + (hh * 60 + mm) / 1440
}

export function todayNumber() {
  const now = new Date()
  return Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / DAY_MS
}

export type GanttBar = { key: string; start: number; end: number; tone: string; label?: string; progress?: number; tip: ReactNode }
export type GanttMarker = { key: string; at: number; tone: 'due' | 'late'; tip: ReactNode }
export type GanttRow = { key: string; label: string; sub?: string; flag?: ReactNode; bars: GanttBar[]; markers?: GanttMarker[]; onClick?: () => void }

export function Gantt({ start, days, rows, legend, empty }: { start: number; days: number; rows: GanttRow[]; legend?: { tone: string; label: string; shape?: 'marker' }[]; empty: string }) {
  const [tip, setTip] = useState<Tip>(null)
  const today = todayNumber()
  const pct = (day: number) => ((day - start) / days) * 100
  const cols = Array.from({ length: days }, (_, i) => new Date((start + i) * DAY_MS))
  const todayPct = pct(today + 0.5)
  return (
    <div className="pap-viz-host pap-gantt2-wrap" onMouseLeave={() => setTip(null)}>
      {legend && (
        <div className="pap-viz-legend">
          {legend.map((l) => <span key={l.label}><i className={`${l.shape === 'marker' ? 'marker' : 'swatch'} ${l.tone}`} />{l.label}</span>)}
        </div>
      )}
      <div className="pap-gantt2-scroll">
        <div className="pap-gantt2" style={{ ['--gantt-days' as string]: days }}>
          <div className="pap-gantt2-head">
            <div className="pap-gantt2-label" />
            <div className="pap-gantt2-track">
              {cols.map((d, i) => {
                const weekend = d.getUTCDay() === 0 || d.getUTCDay() === 6
                const isToday = start + i === today
                return (
                  <span key={i} className={`${weekend ? 'weekend' : ''} ${isToday ? 'today' : ''}`} style={{ left: `${(i / days) * 100}%`, width: `${100 / days}%` }}>
                    {(i === 0 || d.getUTCDate() === 1) && <small>{MONTHS[d.getUTCMonth()]}</small>}
                    <b>{d.getUTCDate()}</b>
                    <i>{DAYS[d.getUTCDay()]}</i>
                  </span>
                )
              })}
            </div>
          </div>
          {rows.map((row) => (
            <div key={row.key} className="pap-gantt2-row">
              <button className="pap-gantt2-label" onClick={row.onClick} disabled={!row.onClick} title={row.label}>
                <strong>{row.flag}{row.label}</strong>
                {row.sub && <small>{row.sub}</small>}
              </button>
              <div className="pap-gantt2-track">
                {cols.map((d, i) => (d.getUTCDay() === 0 || d.getUTCDay() === 6) && <span key={i} className="pap-gantt2-weekend" style={{ left: `${(i / days) * 100}%`, width: `${100 / days}%` }} />)}
                {row.bars.map((bar) => {
                  const left = Math.max(0, pct(bar.start))
                  const right = Math.min(100, pct(bar.end))
                  if (right <= 0 || left >= 100 || right <= left) return null
                  return (
                    <button
                      key={bar.key}
                      className={`pap-gantt2-bar ${bar.tone} ${pct(bar.start) < 0 ? 'cut-left' : ''} ${pct(bar.end) > 100 ? 'cut-right' : ''}`}
                      style={{ left: `${left}%`, width: `${right - left}%` }}
                      onClick={row.onClick}
                      onMouseEnter={(e) => setTip(tipAt(e, bar.tip))}
                      onFocus={(e) => setTip(tipAt(e, bar.tip))}
                      onBlur={() => setTip(null)}
                    >
                      {bar.progress !== undefined && <span className="progress" style={{ width: `${bar.progress}%` }} />}
                      {bar.label && <em>{bar.label}</em>}
                    </button>
                  )
                })}
                {row.markers?.map((m) => {
                  const at = pct(m.at)
                  if (at > 100) return null
                  // Tenggat yang sudah lewat sebelum jendela ditempel di tepi kiri agar tetap terlihat
                  const clamped = at < 0
                  return (
                    <span
                      key={m.key}
                      className={`pap-gantt2-marker ${m.tone} ${clamped ? 'clamped' : ''}`}
                      style={{ left: clamped ? '6px' : `${at}%` }}
                      onMouseEnter={(e) => setTip(tipAt(e, m.tip))}
                    />
                  )
                })}
              </div>
            </div>
          ))}
          {!rows.length && <div className="pap-gantt2-empty">{empty}</div>}
          {todayPct >= 0 && todayPct <= 100 && (
            <div className="pap-gantt2-today" style={{ left: `calc(var(--gantt-label) + (100% - var(--gantt-label)) * ${todayPct / 100})` }}><span>Hari ini</span></div>
          )}
        </div>
      </div>
      <Tooltip tip={tip} />
    </div>
  )
}
