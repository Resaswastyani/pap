'use client'

import { useCallback, useEffect, useState } from 'react'
import { CalendarDays, CheckCircle2, Clock, ExternalLink, FileSpreadsheet, RefreshCw, Search, Users } from 'lucide-react'
import type { Schedule } from '@/lib/training-schedule'
import { api, formatDate, Notice } from './ui'

// Tab Jadwal Training: cermin spreadsheet jadwal (hanya baca, perubahan dilakukan di Google Sheet)

type Res = { schedule: Schedule | null; url: string | null; sync: { at: string | null; error: string | null }; warning: string | null; can: { manage: boolean } }

const wibToday = () => new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10)

export function JadwalTab() {
  const [data, setData] = useState<Res | null>(null)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [view, setView] = useState<'jadwal' | 'rekap'>('jadwal')
  const [batch, setBatch] = useState(0)
  const [q, setQ] = useState('')
  const [status, setStatus] = useState<'semua' | 'sudah' | 'belum'>('semua')
  const load = useCallback(() => api<Res>('/api/hrd/training/schedule').then((r) => { setData(r); setError('') }).catch((e) => setError(e.message)), [])
  useEffect(() => { load() }, [load])
  async function sync() {
    setBusy(true)
    try {
      await api('/api/hrd/training/schedule', { method: 'PUT' })
      setMessage('Jadwal disinkron dari Google Sheet.')
      await load()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const s = data?.schedule ?? null
  const manage = !!data?.can.manage
  const rekap = s?.rekap ?? []
  const sudah = rekap.filter((r) => r.hadir).length
  const current = s?.batches[batch] ?? null
  const today = wibToday()
  const term = q.trim().toLowerCase()
  const rows = rekap.filter((r) => (status === 'semua' || r.hadir === (status === 'sudah')) && (!term || [r.nama, r.ket].some((x) => x?.toLowerCase().includes(term))))
  const totalSesi = (s?.batches ?? []).reduce((n, b) => n + b.sesi.length, 0)

  return (
    <>
      <div className="pap-sync-bar">
        <div className="pap-sync-items">
          <span className="pap-sync-title">Google Sheet</span>
          <span className="pap-sync-item">{data?.sync.at ? `Jadwal sinkron ${formatDate(data.sync.at, true)}` : 'Jadwal belum pernah sinkron'}</span>
        </div>
        {manage && data?.url && <a className="pap-btn" href={data.url} target="_blank" rel="noreferrer"><FileSpreadsheet /> Buka sheet <ExternalLink className="pap-inline-icon" /></a>}
        {manage && <button className="pap-btn" disabled={busy} onClick={sync}><RefreshCw className={busy ? 'pap-spin' : ''} /> {busy ? 'Menyinkronkan...' : 'Sinkron'}</button>}
      </div>
      {message && <Notice kind="success" onClose={() => setMessage('')}>{message}</Notice>}
      {(error || data?.warning) && <Notice onClose={() => setError('')}>{error || data?.warning}</Notice>}
      {!data && !error && <div className="pap-table-card"><div className="pap-empty">Memuat jadwal...</div></div>}
      {data && !s && <div className="pap-table-card"><div className="pap-empty">Jadwal belum tersedia. {manage ? 'Isi link spreadsheet lewat tombol "Sumber Drive", lalu klik Sinkron.' : 'HRD akan menyiapkan jadwal training.'}</div></div>}
      {s && (
        <>
          <div className="pap-stat-grid four">
            {([
              ['Batch', `${s.batches.length}`, `${totalSesi} sesi terjadwal`, CalendarDays, 'stat-1'],
              ...(manage ? [
                ['Peserta', `${rekap.length}`, s.periode ?? 'Rekap data', Users, 'stat-1'],
                ['Sudah training', `${sudah}`, rekap.length ? `${Math.round(sudah / rekap.length * 100)}% peserta` : '—', CheckCircle2, 'stat-0'],
                ['Belum training', `${rekap.length - sudah}`, 'Perlu dijadwalkan', Clock, 'stat-2'],
              ] : []),
            ] as [string, string, string, typeof Users, string][]).map(([label, value, note, Icon, tone]) => (
              <div key={label} className="pap-stat-card"><div><span>{label}</span><strong className="pap-stat-text">{value}</strong><small className="neutral">{note}</small></div><div className={`pap-stat-icon ${tone}`}><Icon /></div></div>
            ))}
          </div>
          {manage && (
            <div className="pap-segmented pap-page-tabs" role="tablist" aria-label="Tampilan jadwal">
              <button role="tab" aria-selected={view === 'jadwal'} className={view === 'jadwal' ? 'active' : ''} onClick={() => setView('jadwal')}>Jadwal per batch</button>
              <button role="tab" aria-selected={view === 'rekap'} className={view === 'rekap' ? 'active' : ''} onClick={() => setView('rekap')}>Rekap kehadiran</button>
            </div>
          )}
          {view === 'jadwal' && (
            <div className="pap-table-card">
              <div className="pap-card-head"><div><h2>{s.judul ?? 'Jadwal training'}</h2><p>Sesi rencana per batch, sesuai spreadsheet.</p></div></div>
              <div className="pap-chip-tabs pap-jadwal-batches">
                {s.batches.map((b, i) => <button key={b.nama} type="button" className={i === batch ? 'active' : ''} onClick={() => setBatch(i)}>{b.nama} <small>{b.sesi.length} sesi</small></button>)}
              </div>
              <div className="pap-jadwal-list">
                {current?.sesi.map((x) => (
                  <article key={`${x.tanggal}-${x.jam}`} className="pap-jadwal-card">
                    <div className="pap-jadwal-date">
                      <strong>{Number(x.tanggal.slice(8, 10))}</strong>
                      <span>{formatDate(x.tanggal).replace(/^\d+\s*/, '')}</span>
                    </div>
                    <div className="pap-jadwal-body">
                      <div className="pap-jadwal-head">
                        <b>{x.hari ?? 'Sesi'}{x.jam ? ` · ${x.jam} WIB` : ''}</b>
                        <span className={`pap-status ${x.tanggal < today ? 'neutral' : x.tanggal === today ? 'warning' : 'info'}`}>{x.tanggal < today ? 'Sudah lewat' : x.tanggal === today ? 'Hari ini' : 'Akan datang'}</span>
                      </div>
                      <div className="pap-jadwal-people">{x.peserta.map((p) => <span key={p} className="pap-chip">{p}</span>)}</div>
                      <small className="pap-muted">{x.peserta.length} peserta</small>
                    </div>
                  </article>
                ))}
                {current && !current.sesi.length && <div className="pap-empty">Belum ada sesi di batch ini.</div>}
              </div>
              {!!current?.catatan_peserta.length && <p className="pap-hint pap-jadwal-note">Catatan: {current.catatan_peserta.map((c) => `${c.nama} (${c.catatan})`).join(', ')}</p>}
              {!!s.catatan.length && (
                <div className="pap-jadwal-info">
                  <h3>Ketentuan training</h3>
                  <ul>{s.catatan.map((c) => <li key={c}>{c}</li>)}</ul>
                </div>
              )}
            </div>
          )}
          {view === 'rekap' && manage && (
            <div className="pap-table-card">
              <div className="pap-card-head"><div><h2>{s.periode ?? 'Rekap kehadiran'}</h2><p>Tanggal training, materi yang sudah diterima, dan kehadiran tiap peserta.</p></div></div>
              <div className="pap-filters">
                <div className="pap-segmented" role="tablist">
                  {(['semua', 'sudah', 'belum'] as const).map((k) => <button key={k} role="tab" aria-selected={status === k} className={status === k ? 'active' : ''} onClick={() => setStatus(k)}>{k === 'semua' ? `Semua (${rekap.length})` : k === 'sudah' ? `Sudah (${sudah})` : `Belum (${rekap.length - sudah})`}</button>)}
                </div>
                <label className="pap-filter-search"><Search /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari peserta..." /></label>
              </div>
              <div className="pap-table-wrap">
                <table>
                  <thead><tr><th>Peserta</th><th>Tanggal training</th><th>Materi</th><th>Kehadiran</th></tr></thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={`${r.no}-${r.nama}`}>
                        <td><div className="pap-cell-title">{r.nama}</div>{r.ket && <div className="pap-cell-sub">{r.ket}</div>}</td>
                        <td className="pap-nowrap">{r.tanggal ? formatDate(r.tanggal) : '—'}</td>
                        <td>
                          <span className="pap-jadwal-materi">
                            {([['Jobdesc', r.materi.jobdesc], ['Video', r.materi.video], ['PPT', r.materi.ppt]] as const).map(([label, ok]) => <span key={label} className={`pap-status ${ok ? 'success' : 'neutral'}`}>{ok ? '✓ ' : ''}{label}</span>)}
                          </span>
                        </td>
                        <td><span className={`pap-status ${r.hadir ? 'success' : 'warning'}`}>{r.hadir ? 'Hadir' : r.kehadiran ?? 'Belum'}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!rows.length && <div className="pap-empty">Tidak ada peserta yang cocok.</div>}
              </div>
            </div>
          )}
        </>
      )}
    </>
  )
}
