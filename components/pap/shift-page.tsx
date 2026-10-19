'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { CalendarDays, ChevronLeft, ChevronRight, ExternalLink, FileSpreadsheet, Moon, RefreshCw, Search, Sun, Sunrise, Users } from 'lucide-react'
import type { UserProfile } from '@/lib/users'
import { api, Field, formatDate, Modal, Notice } from './ui'

type Row = { id: number; urut: number; nama: string; bagian: string | null; nomor_induk: string | null; pilihan_shift: string | null; jadwal: string[] }
type Data = {
  periode: string; periods: string[]; days: number; canSync: boolean; rows: Row[]
  schedule: { judul: string | null; sheet_tab: string | null; synced_at: string; synced_name: string | null } | null
}

const MONTHS = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember']
// Inisial hari seperti di sheet: M(inggu) S(enin) S(elasa) R(abu) K(amis) J(umat) S(abtu)
const DAY_INITIAL = ['M', 'S', 'S', 'R', 'K', 'J', 'S']
const DAY_NAME = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu']
const SHIFTS = [
  { code: '1', label: 'Shift 1', icon: Sunrise },
  { code: '2', label: 'Shift 2', icon: Sun },
  { code: '3', label: 'Shift 3', icon: Moon },
]
const pad = (n: number) => String(n).padStart(2, '0')
const monthLabel = (p: string) => `${MONTHS[Number(p.slice(5, 7)) - 1]} ${p.slice(0, 4)}`
const shiftMonth = (p: string, d: number) => {
  const x = new Date(Number(p.slice(0, 4)), Number(p.slice(5, 7)) - 1 + d, 1)
  return `${x.getFullYear()}-${pad(x.getMonth() + 1)}`
}
const cellClass = (v: string) => (v === '' ? 'off' : ['1', '2', '3'].includes(v) ? `s${v}` : 'other')

export function ShiftPage(_props: { user: UserProfile }) {
  const [periode, setPeriode] = useState('')
  const [data, setData] = useState<Data | null>(null)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [search, setSearch] = useState('')
  const [view, setView] = useState<'bulan' | 'hari'>('bulan')
  const [day, setDay] = useState(0)
  const [sheetOpen, setSheetOpen] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await api<Data>(`/api/shift-schedule${periode ? `?periode=${periode}` : ''}`)
      setData(res)
      setPeriode(res.periode)
      setError('')
    } catch (e) {
      setError((e as Error).message)
    }
  }, [periode])
  useEffect(() => { load() }, [load])

  const now = new Date()
  const thisMonth = `${now.getFullYear()}-${pad(now.getMonth() + 1)}`
  const today = data?.periode === thisMonth ? now.getDate() : 0
  // Tampilan per hari: default hari ini (atau tanggal 1 di bulan lain)
  const selectedDay = Math.min(day || today || 1, data?.days ?? 31)
  const dates = useMemo(() => Array.from({ length: data?.days ?? 0 }, (_, i) => {
    const d = new Date(Number(periode.slice(0, 4)), Number(periode.slice(5, 7)) - 1, i + 1)
    return { day: i + 1, dow: d.getDay() }
  }), [data?.days, periode])

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (data?.rows ?? []).filter((r) => !q || `${r.nama} ${r.bagian ?? ''} ${r.nomor_induk ?? ''} ${r.pilihan_shift ?? ''}`.toLowerCase().includes(q))
  }, [data, search])
  // Rekap per tanggal (seperti baris "Jumlah" di sheet)
  const totals = useMemo(() => dates.map((_, i) => {
    const count: Record<string, number> = { '1': 0, '2': 0, '3': 0, off: 0 }
    for (const r of rows) {
      const v = r.jadwal[i]
      if (v === '') count.off++
      else if (v in count) count[v]++
    }
    return count
  }), [dates, rows])
  const focus = totals[selectedDay - 1]

  return (
    <>
      <div className="pap-page-heading">
        <div>
          <p className="pap-eyebrow">PRODUKSI</p>
          <h1>Jadwal Shift</h1>
          <span>{data?.schedule?.judul ?? 'Jadwal karyawan produksi per bulan'}: shift 1, shift 2, shift 3, dan libur, disinkron dari spreadsheet di Google Drive.</span>
        </div>
        <div className="pap-inline-actions">
          <button className="pap-btn" onClick={() => setSheetOpen(true)}><FileSpreadsheet /> Google Sheet</button>
        </div>
      </div>
      {sheetOpen && <SheetSync onClose={() => setSheetOpen(false)} onImported={(t) => { setSheetOpen(false); setMessage(t); load() }} />}
      {message && <Notice kind="success" onClose={() => setMessage('')}>{message}</Notice>}
      {error && <Notice onClose={() => setError('')}>{error}</Notice>}

      {data && data.rows.length > 0 && focus && (
        <div className="pap-stat-grid four">
          <div className="pap-stat-card"><div><span>Karyawan</span><strong>{data.rows.length}</strong><small className="neutral">{monthLabel(data.periode)}</small></div><div className="pap-stat-icon stat-1"><Users /></div></div>
          {SHIFTS.slice(0, 3).map(({ code, label, icon: Icon }) => (
            <div className="pap-stat-card" key={code}>
              <div><span>{label} · {today === selectedDay ? 'hari ini' : `tgl ${selectedDay}`}</span><strong>{focus[code]}</strong><small className={code === '1' ? 'neutral' : ''}>{code === '3' ? `${focus.off} libur` : 'orang'}</small></div>
              <div className={`pap-stat-icon stat-${code === '3' ? 2 : code === '2' ? 0 : 1}`}><Icon /></div>
            </div>
          ))}
        </div>
      )}

      <div className="pap-table-card">
        <div className="pap-calendar-bar pap-visit-bar">
          <div className="pap-calendar-nav">
            <button className="pap-icon-button" aria-label="Bulan sebelumnya" onClick={() => { setDay(0); setPeriode(shiftMonth(periode, -1)) }} disabled={!periode}><ChevronLeft /></button>
            <button className="pap-icon-button" aria-label="Bulan berikutnya" onClick={() => { setDay(0); setPeriode(shiftMonth(periode, 1)) }} disabled={!periode}><ChevronRight /></button>
            <h3>{periode ? monthLabel(periode) : '...'}</h3>
          </div>
          <div className="pap-inline-actions">
            <label className="pap-table-search pap-shift-search"><Search /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Cari nama / bagian..." /></label>
            <div className="pap-segmented" role="tablist">
              <button className={view === 'bulan' ? 'active' : ''} onClick={() => setView('bulan')}><CalendarDays /> Bulanan</button>
              <button className={view === 'hari' ? 'active' : ''} onClick={() => setView('hari')}><Users /> Per hari</button>
            </div>
          </div>
        </div>

        {!data ? <div className="pap-empty">Memuat...</div> : !data.rows.length ? (
          <div className="pap-empty">
            Belum ada jadwal shift untuk {monthLabel(data.periode)}.
            {data.periods.length > 0 && <> Jadwal tersedia: {data.periods.map((p) => <button key={p} className="pap-link-button" onClick={() => setPeriode(p)}>{monthLabel(p)}</button>)}.</>}
            {data.canSync && <> Klik <b>Google Sheet</b> untuk sinkron dari spreadsheet.</>}
          </div>
        ) : view === 'bulan' ? (
          <>
            <div className="pap-shift-legend">
              {SHIFTS.map((s) => <span key={s.code}><i className={`pap-shift-cell s${s.code}`}>{s.code}</i>{s.label}</span>)}
              <span><i className="pap-shift-cell off" />Libur</span>
              {data.schedule && <span className="pap-muted">Sinkron {formatDate(data.schedule.synced_at, true)}{data.schedule.synced_name ? ` oleh ${data.schedule.synced_name}` : ''}</span>}
            </div>
            <div className="pap-shift-wrap">
              <table className="pap-shift-table">
                <thead>
                  <tr>
                    <th rowSpan={2} className="sticky no">No</th>
                    <th rowSpan={2} className="sticky nama">Nama</th>
                    <th rowSpan={2} className="induk">No. Induk</th>
                    <th rowSpan={2} className="pilihan">Pilihan Shift</th>
                    {dates.map((d) => <th key={d.day} className={`dow ${d.dow === 0 ? 'sunday' : ''} ${d.day === today ? 'today' : ''}`} title={DAY_NAME[d.dow]}>{DAY_INITIAL[d.dow]}</th>)}
                  </tr>
                  <tr>{dates.map((d) => <th key={d.day} className={`date ${d.dow === 0 ? 'sunday' : ''} ${d.day === today ? 'today' : ''}`}><button onClick={() => { setDay(d.day); setView('hari') }} title={`Lihat ${DAY_NAME[d.dow]}, ${d.day} ${monthLabel(periode)}`}>{d.day}</button></th>)}</tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id}>
                      <td className="sticky no">{r.urut}</td>
                      <td className="sticky nama"><span className="pap-shift-name">{r.nama}</span>{r.bagian && <span className={`pap-shift-tag ${/kashift|kepala/i.test(r.bagian) ? 'lead' : ''}`}>{r.bagian}</span>}</td>
                      <td className="induk">{r.nomor_induk ?? '-'}</td>
                      <td className="pilihan">{r.pilihan_shift ?? '-'}</td>
                      {r.jadwal.map((v, i) => <td key={i} className={`pap-shift-cell ${cellClass(v)} ${i + 1 === today ? 'today' : ''}`} title={`${r.nama} · ${DAY_NAME[dates[i].dow]} ${i + 1}: ${v ? (['1', '2', '3'].includes(v) ? `Shift ${v}` : v) : 'Libur'}`}>{v}</td>)}
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  {SHIFTS.map((s, n) => (
                    <tr key={s.code}>
                      {n === 0 && <td rowSpan={4} colSpan={2} className="sticky jumlah">Jumlah</td>}
                      <td colSpan={2} className="label">{s.label}</td>
                      {totals.map((t, i) => <td key={i} className={i + 1 === today ? 'today' : ''}>{t[s.code]}</td>)}
                    </tr>
                  ))}
                  <tr className="off-row"><td colSpan={2} className="label">Libur</td>{totals.map((t, i) => <td key={i} className={i + 1 === today ? 'today' : ''}>{t.off}</td>)}</tr>
                </tfoot>
              </table>
            </div>
          </>
        ) : (
          <>
            <div className="pap-shift-days">
              {dates.map((d) => (
                <button key={d.day} className={`${d.day === selectedDay ? 'active' : ''} ${d.day === today ? 'today' : ''} ${d.dow === 0 ? 'sunday' : ''}`} onClick={() => setDay(d.day)}>
                  <small>{DAY_NAME[d.dow].slice(0, 3)}</small><b>{d.day}</b>
                </button>
              ))}
            </div>
            <div className="pap-shift-board">
              {[...SHIFTS.map((s) => ({ key: s.code, label: s.label, icon: s.icon })), { key: 'off', label: 'Libur', icon: CalendarDays }].map(({ key, label, icon: Icon }) => {
                const people = rows.filter((r) => (key === 'off' ? r.jadwal[selectedDay - 1] === '' : r.jadwal[selectedDay - 1] === key))
                return (
                  <section key={key} className={`pap-shift-column ${key === 'off' ? 'off' : `s${key}`}`}>
                    <header><Icon /><strong>{label}</strong><span>{people.length} orang</span></header>
                    {people.length ? people.map((r) => (
                      <div key={r.id} className="pap-shift-person">
                        <span>{r.nama}</span>
                        {r.bagian && <span className={`pap-shift-tag ${/kashift|kepala/i.test(r.bagian) ? 'lead' : ''}`}>{r.bagian}</span>}
                      </div>
                    )) : <p className="pap-muted">Tidak ada.</p>}
                  </section>
                )
              })}
              {(() => {
                const others = rows.filter((r) => !['', '1', '2', '3'].includes(r.jadwal[selectedDay - 1]))
                return others.length > 0 && (
                  <section className="pap-shift-column other">
                    <header><strong>Keterangan lain</strong><span>{others.length} orang</span></header>
                    {others.map((r) => <div key={r.id} className="pap-shift-person"><span>{r.nama}</span><span className="pap-shift-tag">{r.jadwal[selectedDay - 1]}</span></div>)}
                  </section>
                )
              })()}
            </div>
          </>
        )}
      </div>
      {!data?.canSync && data && <p className="pap-muted pap-shift-footnote">Jadwal dikelola PPIC, HRD, dan kepala Produksi. Hubungi mereka bila ada perubahan.</p>}
    </>
  )
}

// ---------------- Sinkron dari spreadsheet jadwal di Google Drive ----------------
type SheetPreview = {
  url: string; account: string | null; canSync: boolean
  tabs: { title: string; periode: string | null; rows: number; note: string | null }[]
  schedules: { periode: string; judul: string | null; tab: string; karyawan: number }[]
}

function SheetSync({ onClose, onImported }: { onClose: () => void; onImported: (message: string) => void }) {
  const [data, setData] = useState<SheetPreview | null>(null)
  const [url, setUrl] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const preview = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await api<SheetPreview & { error?: string }>('/api/shift-schedule/sheet')
      setData(res)
      setUrl(res.url)
      // Link tetap tampil & bisa diganti walau spreadsheet gagal dibaca
      if (res.error) setError(res.error)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => { preview() }, [preview])

  async function saveUrl() {
    setBusy(true)
    setError('')
    try {
      await api('/api/shift-schedule/sheet', { method: 'PUT', json: { url } })
      await preview()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  async function importAll() {
    setBusy(true)
    setError('')
    try {
      const res = await api<{ bulan: number; karyawan: number }>('/api/shift-schedule/sheet', { method: 'POST' })
      onImported(`Sinkron jadwal shift selesai: ${res.bulan} bulan, ${res.karyawan} baris karyawan.`)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const canSync = data?.canSync ?? false

  return (
    <Modal
      title="Sinkron Jadwal Shift dari Google Drive"
      subtitle={data?.account ? `Dibaca dengan akun Google ${data.account} (sama dengan Master Data > Logo & Desain)` : 'Memakai akun Google yang terhubung di Master Data > Logo & Desain'}
      wide
      onClose={onClose}
      footer={<><button className="pap-btn" disabled={loading || busy} onClick={preview}><RefreshCw /> Muat ulang</button><span className="pap-spacer" /><button className="pap-btn" onClick={onClose}>Tutup</button>{canSync && <button className="pap-primary-button" disabled={busy || loading || !data?.schedules.length} onClick={importAll}>{busy ? 'Menyinkron...' : `Sinkron ${data?.schedules.length ?? 0} bulan`}</button>}</>}
    >
      {error && <Notice onClose={() => setError('')}>{error}</Notice>}
      <Field label="Link spreadsheet jadwal karyawan produksi">
        <div className="pap-inline-actions">
          <input className="pap-input" value={url} disabled={!!data && !canSync} onChange={(e) => setUrl(e.target.value)} placeholder="https://docs.google.com/spreadsheets/d/..." />
          {url && <a className="pap-icon-button" href={url} target="_blank" rel="noreferrer" aria-label="Buka spreadsheet"><ExternalLink /></a>}
          {(!data || canSync) && url && url !== data?.url && <button className="pap-btn" disabled={busy} onClick={saveUrl}>Simpan link</button>}
        </div>
      </Field>
      <p className="pap-muted">Spreadsheet (Google Sheet atau file Excel di Drive) harus bisa dibuka akun Google tersebut (bagikan sebagai Viewer). Setiap tab dibaca: judul berisi bulan &amp; tahun (mis. “Bulan Oktober 2026”), kolom Nama, Nomer Induk, Pilihan Shift, dan tanggal 1–31 berisi 1 / 2 / 3; sel kosong dianggap libur. Sinkron ulang mengganti jadwal bulan yang sama.</p>
      {loading ? <p className="pap-muted">Membaca spreadsheet...</p> : data && (
        <>
          {data.tabs.map((t) => (
            <div key={t.title} className="pap-inline-panel">
              <strong>Tab “{t.title}”: {t.periode ? `${monthLabel(t.periode)}, ${t.rows} karyawan` : 'dilewati'}</strong>
              {t.note && <p className="pap-muted">{t.note}</p>}
            </div>
          ))}
          {!data.schedules.length && <div className="pap-empty">Belum ada tab yang dikenali sebagai jadwal shift.</div>}
        </>
      )}
    </Modal>
  )
}
