'use client'

import { useCallback, useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight, Copy, Target, TrendingDown, TrendingUp } from 'lucide-react'
import type { UserProfile } from '@/lib/users'
import { formatRupiah } from './accurate'
import { api, Field, Modal, Notice } from './ui'

type MetricInfo = { label: string; hint: string; satuan: string }
type KpiRow = {
  id: number; name: string; division_code: string; division_name: string
  nilai: Record<string, number>; sebelumnya: Record<string, number>; target: Record<string, number>
}
type KpiData = { periode: string; sebelumnya: string; metrics: Record<string, MetricInfo>; rows: KpiRow[]; canSetTarget: boolean }

const MONTHS = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember']
const periodeLabel = (p: string) => `${MONTHS[Number(p.slice(5, 7)) - 1]} ${p.slice(0, 4)}`
const shift = (p: string, delta: number) => {
  const d = new Date(Number(p.slice(0, 4)), Number(p.slice(5, 7)) - 1 + delta, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
const fmt = (v: number, satuan: string) => (satuan === 'Rp' ? formatRupiah(v) : v.toLocaleString('id-ID'))

export function KpiPage({ user }: { user: UserProfile }) {
  const [periode, setPeriode] = useState('')
  const [data, setData] = useState<KpiData | null>(null)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [editing, setEditing] = useState<KpiRow | null>(null)
  const load = useCallback(async () => {
    try {
      setData(await api<KpiData>(`/api/kpi${periode ? `?periode=${periode}` : ''}`))
      setError('')
    } catch (e) {
      setError((e as Error).message)
    }
  }, [periode])
  useEffect(() => { load() }, [load])
  const current = data?.periode ?? periode
  const metrics = data ? Object.entries(data.metrics) : []
  const totals = (key: 'nilai' | 'sebelumnya' | 'target') => Object.fromEntries(metrics.map(([k]) => [k, (data?.rows ?? []).reduce((n, r) => n + (r[key]?.[k] ?? 0), 0)]))
  const sum = totals('nilai')
  const prev = totals('sebelumnya')
  const tgt = totals('target')

  async function copyTargets() {
    if (!window.confirm(`Salin semua target ${periodeLabel(shift(current, -1))} ke ${periodeLabel(current)}?`)) return
    try {
      await api('/api/kpi', { method: 'PUT', json: { periode: current, copy: true } })
      setMessage('Target bulan lalu disalin.')
      load()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return (
    <>
      <div className="pap-page-heading">
        <div>
          <p className="pap-eyebrow">MARKETING</p>
          <h1>KPI Marketing</h1>
          <span>Pencapaian tiap sales per bulan dari aktivitas di PAP-MS: lead, follow-up, visit, penawaran, closing, nilai deal, dan follow-up customer.</span>
        </div>
        {data?.canSetTarget && <button className="pap-btn" onClick={copyTargets}><Copy /> Salin target bulan lalu</button>}
      </div>
      {message && <Notice kind="success" onClose={() => setMessage('')}>{message}</Notice>}
      {error && <Notice onClose={() => setError('')}>{error}</Notice>}
      <div className="pap-calendar-nav pap-kpi-period">
        <button className="pap-icon-button" aria-label="Bulan sebelumnya" onClick={() => setPeriode(shift(current, -1))} disabled={!current}><ChevronLeft /></button>
        <h3>{current ? periodeLabel(current) : '...'}</h3>
        <button className="pap-icon-button" aria-label="Bulan berikutnya" onClick={() => setPeriode(shift(current, 1))} disabled={!current}><ChevronRight /></button>
      </div>

      {data && (
        <div className="pap-kpi-summary">
          {metrics.map(([k, m]) => {
            const diff = prev[k] ? ((sum[k] - prev[k]) / prev[k]) * 100 : null
            return (
              <div key={k} className="pap-stat-card" title={m.hint}>
                <div>
                  <span>{m.label}</span>
                  <strong>{fmt(sum[k], m.satuan)}</strong>
                  <small className="neutral">
                    {tgt[k] ? `${Math.round((sum[k] / tgt[k]) * 100)}% dari target ${fmt(tgt[k], m.satuan)}` : 'Belum ada target'}
                    {diff !== null && <span className={`pap-trend ${diff >= 0 ? 'down' : 'up'}`}> {diff >= 0 ? <TrendingUp /> : <TrendingDown />}{Math.abs(diff).toFixed(0)}%</span>}
                  </small>
                </div>
              </div>
            )
          })}
        </div>
      )}

      <div className="pap-table-card">
        <div className="pap-card-head"><div><h2>Per sales</h2><p>Angka / target · warna menunjukkan pencapaian. {data?.canSetTarget ? 'Klik baris untuk mengatur target.' : ''}</p></div></div>
        <div className="pap-table-wrap">
          <table className="pap-kpi-table">
            <thead><tr><th>Sales</th>{metrics.map(([k, m]) => <th key={k} className="pap-num" title={m.hint}>{m.label}</th>)}</tr></thead>
            <tbody>
              {(data?.rows ?? []).map((r) => (
                <tr key={r.id} className={data?.canSetTarget ? 'pap-row-link' : ''} onClick={() => data?.canSetTarget && setEditing(r)}>
                  <td><div className="pap-cell-title">{r.name}{r.id === user.id ? ' (saya)' : ''}</div><div className="pap-cell-sub">{r.division_name}</div></td>
                  {metrics.map(([k, m]) => {
                    const v = r.nilai?.[k] ?? 0
                    const t = r.target?.[k]
                    const pct = t ? Math.round((v / t) * 100) : null
                    return (
                      <td key={k} className={`pap-num pap-kpi-cell ${pct === null ? '' : pct >= 100 ? 'ok' : pct >= 60 ? 'mid' : 'low'}`}>
                        <b>{m.satuan === 'Rp' ? formatRupiah(v) : v}</b>
                        {t ? <small>/ {m.satuan === 'Rp' ? formatRupiah(t) : t}</small> : null}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          {data && !data.rows.length && <div className="pap-empty">Belum ada user di divisi marketing.</div>}
        </div>
      </div>
      {editing && data && <TargetForm row={editing} periode={current} metrics={data.metrics} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); setMessage(`Target ${editing.name} disimpan.`); load() }} />}
    </>
  )
}

function TargetForm({ row, periode, metrics, onClose, onSaved }: { row: KpiRow; periode: string; metrics: Record<string, MetricInfo>; onClose: () => void; onSaved: () => void }) {
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(Object.keys(metrics).map((k) => [k, row.target?.[k] ? String(row.target[k]) : ''])))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      await api('/api/kpi', { method: 'PUT', json: { periode, user_id: row.id, targets: values } })
      onSaved()
    } catch (err) {
      setError((err as Error).message)
      setSaving(false)
    }
  }
  return (
    <Modal title={`Target ${row.name}`} subtitle={periodeLabel(periode)} onClose={onClose}
      footer={<><span className="pap-spacer" /><button type="button" className="pap-btn" onClick={onClose}>Batal</button><button type="submit" form="kpi-form" className="pap-primary-button" disabled={saving}><Target /> {saving ? 'Menyimpan...' : 'Simpan target'}</button></>}
    >
      <form id="kpi-form" className="pap-form-grid" onSubmit={submit}>
        {error && <div className="full"><Notice onClose={() => setError('')}>{error}</Notice></div>}
        {Object.entries(metrics).map(([k, m]) => (
          <Field key={k} label={`${m.label}${m.satuan === 'Rp' ? ' (Rp)' : ''}`} hint={`Realisasi: ${fmt(row.nilai?.[k] ?? 0, m.satuan)}. ${m.hint}`}>
            <input className="pap-input" inputMode="numeric" value={values[k]} onChange={(e) => setValues((v) => ({ ...v, [k]: e.target.value }))} placeholder="kosong = tanpa target" />
          </Field>
        ))}
        <p className="pap-hint full">Contoh target bulanan sales: 60 follow-up, 12 visit, 8 penawaran, 3 closing.</p>
      </form>
    </Modal>
  )
}
