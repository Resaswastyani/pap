'use client'

import { useState } from 'react'
import { ExternalLink, GraduationCap, Pencil, Plus, Trash2 } from 'lucide-react'
import { api, confirmDialog, Field, formatDate, Notice } from './ui'

// ---- Bagian tambahan detail karyawan: kehadiran, training, hasil tes ----

export type Attendance = {
  tahun: number; tahun_ada: number[]; dari: string | null; sampai: string | null; status: Record<string, number>; hari_tercatat: number
  terlambat_menit: number; pulang_cepat_menit: number; lembur_menit: number; pengajuan: { jenis: string; kali: number; hari: number }[]
}
export type TrainingItem = { sumber: 'modul' | 'jadwal'; judul: string; keterangan: string | null; tanggal: string | null; status: string; nilai: number | null }
export type EmployeeTest = { id: number; jenis: 'papikostik' | 'iq' | 'mata'; tanggal: string | null; hasil: string; skor: number | null; catatan: string | null; lampiran_url: string | null; oleh: string | null }

const jam = (menit: number) => (menit >= 60 ? `${Math.floor(menit / 60)} jam ${menit % 60} mnt` : `${menit} mnt`)
const LEAVE: Record<string, string> = { cuti: 'Cuti', izin: 'Izin', sakit: 'Sakit', dayoff: 'Day off', dinas: 'Dinas luar', cuti_khusus: 'Cuti khusus' }

export function EmployeeAttendance({ data, onYear }: { data: Attendance; onYear: (tahun: number) => void }) {
  const s = data.status
  const n = (k: string) => s[k] ?? 0
  const hadir = n('hadir') + n('terlambat')
  const tiles: [string, number | string, string, string][] = [
    ['Hadir', hadir, n('terlambat') ? `${n('terlambat')}x terlambat` : 'tepat waktu', 'success'],
    ['Tidak hadir (alpa)', n('tidak_hadir'), 'tanpa keterangan', n('tidak_hadir') ? 'danger' : 'neutral'],
    ['Izin', n('izin'), 'hari', n('izin') ? 'warning' : 'neutral'],
    ['Sakit', n('sakit'), 'hari', n('sakit') ? 'warning' : 'neutral'],
    ['Cuti', n('cuti'), 'hari', 'info'],
    ['Tanpa scan', n('tanpa_scan'), 'lupa / tidak lengkap', n('tanpa_scan') ? 'warning' : 'neutral'],
  ]
  if (n('dinas')) tiles.push(['Dinas', n('dinas'), 'hari', 'info'])
  const years = [...new Set([data.tahun, ...data.tahun_ada, new Date().getFullYear()])].sort((a, b) => b - a)
  return (
    <section className="pap-detail-section">
      <div className="pap-section-head">
        <h3>Kehadiran {data.tahun}</h3>
        <select className="pap-select pap-emp-year" value={data.tahun} onChange={(e) => onYear(Number(e.target.value))} aria-label="Tahun absensi">
          {years.map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
      </div>
      {data.hari_tercatat ? (
        <>
          <div className="pap-emp-tiles">
            {tiles.map(([label, value, note, tone]) => (
              <div key={label} className={`pap-emp-tile ${tone}`}><span>{label}</span><strong>{value}</strong><small>{note}</small></div>
            ))}
          </div>
          <p className="pap-muted pap-emp-note">
            Data mesin absensi {data.dari ? `${formatDate(data.dari)} – ${formatDate(data.sampai!)}` : ''} · {data.hari_tercatat} hari tercatat
            {data.terlambat_menit ? ` · total terlambat ${jam(data.terlambat_menit)}` : ''}{data.pulang_cepat_menit ? ` · pulang cepat ${jam(data.pulang_cepat_menit)}` : ''}{data.lembur_menit ? ` · lembur ${jam(data.lembur_menit)}` : ''}
          </p>
        </>
      ) : <p className="pap-muted">Belum ada data absensi mesin untuk tahun {data.tahun}.</p>}
      <p className="pap-emp-note">
        <b>Pengajuan disetujui di SIMPAP:</b>{' '}
        {data.pengajuan.length ? data.pengajuan.map((p) => `${LEAVE[p.jenis] ?? p.jenis} ${p.kali}x (${p.hari.toLocaleString('id-ID')} hari)`).join(' · ') : 'belum ada izin / cuti.'}
      </p>
    </section>
  )
}

const TRAINING_STATUS: Record<string, [string, string]> = {
  selesai: ['success', 'Selesai'], tidak_lulus: ['danger', 'Tidak lulus'], terdaftar: ['info', 'Terdaftar'], hadir: ['success', 'Hadir'], tidak_hadir: ['danger', 'Tidak hadir'], batal: ['neutral', 'Batal'],
}
export function EmployeeTrainings({ items }: { items: TrainingItem[] }) {
  return (
    <section className="pap-detail-section">
      <h3>Riwayat training ({items.length})</h3>
      {items.length ? (
        <ul className="pap-emp-list">
          {items.map((t, i) => {
            const [tone, label] = TRAINING_STATUS[t.status] ?? ['neutral', t.status]
            return (
              <li key={i}>
                <GraduationCap />
                <div><strong>{t.judul}</strong><small>{[t.sumber === 'modul' ? 'Modul training' : 'Jadwal training', t.keterangan, t.tanggal ? formatDate(t.tanggal) : null, t.nilai !== null ? `nilai ${t.nilai}` : null].filter(Boolean).join(' · ')}</small></div>
                <span className={`pap-status ${tone}`}>{label}</span>
              </li>
            )
          })}
        </ul>
      ) : <p className="pap-muted">Belum pernah tercatat mengikuti training.</p>}
    </section>
  )
}

const JENIS: Record<EmployeeTest['jenis'], string> = { papikostik: 'Papikostik', iq: 'Tes IQ', mata: 'Tes mata' }
const HASIL_HINT: Record<EmployeeTest['jenis'], string> = { papikostik: 'mis. Ringkasan profil: kepemimpinan tinggi, teliti, butuh arahan', iq: 'mis. Rata-rata / Di atas rata-rata', mata: 'mis. Normal / Minus 1,5 / Buta warna parsial' }

export function EmployeeTests({ employeeId, items, onChanged }: { employeeId: number; items: EmployeeTest[]; onChanged: () => void }) {
  const [form, setForm] = useState<EmployeeTest | 'baru' | null>(null)
  const [error, setError] = useState('')
  async function remove(t: EmployeeTest) {
    if (!(await confirmDialog(`Hapus hasil ${JENIS[t.jenis]} (${t.hasil})?`))) return
    try {
      await api(`/api/hrd/employees/${employeeId}/tests/${t.id}`, { method: 'DELETE' })
      onChanged()
    } catch (e) {
      setError((e as Error).message)
    }
  }
  const latest = (j: EmployeeTest['jenis']) => items.find((t) => t.jenis === j)
  return (
    <section className="pap-detail-section">
      <div className="pap-section-head">
        <h3>Hasil tes <span className="pap-chip">HRD</span></h3>
        {!form && <button type="button" className="pap-btn" onClick={() => setForm('baru')}><Plus /> Tambah hasil tes</button>}
      </div>
      {error && <Notice onClose={() => setError('')}>{error}</Notice>}
      <div className="pap-emp-tiles three">
        {(Object.keys(JENIS) as EmployeeTest['jenis'][]).map((j) => {
          const t = latest(j)
          return (
            <div key={j} className={`pap-emp-tile ${t ? 'info' : 'neutral'}`}>
              <span>{JENIS[j]}</span><strong className="pap-emp-tile-text">{t ? (t.skor !== null ? `${t.skor.toLocaleString('id-ID')} · ${t.hasil}` : t.hasil) : '—'}</strong><small>{t?.tanggal ? formatDate(t.tanggal) : t ? 'tanpa tanggal' : 'belum diisi'}</small>
            </div>
          )
        })}
      </div>
      {form && <TestForm employeeId={employeeId} item={form === 'baru' ? null : form} onClose={() => setForm(null)} onSaved={() => { setForm(null); onChanged() }} />}
      {items.length > 0 && (
        <ul className="pap-emp-list">
          {items.map((t) => (
            <li key={t.id}>
              <div>
                <strong>{JENIS[t.jenis]}: {t.skor !== null ? `${t.skor.toLocaleString('id-ID')} · ` : ''}{t.hasil}</strong>
                <small>{[t.tanggal ? formatDate(t.tanggal) : null, t.catatan, t.oleh ? `dicatat ${t.oleh}` : null].filter(Boolean).join(' · ')}</small>
              </div>
              <span className="pap-inline-actions">
                {t.lampiran_url && <a className="pap-icon-button" href={t.lampiran_url} target="_blank" rel="noreferrer" aria-label="Buka file hasil tes" title="Buka file hasil tes"><ExternalLink /></a>}
                <button type="button" className="pap-icon-button" onClick={() => setForm(t)} aria-label="Ubah"><Pencil /></button>
                <button type="button" className="pap-icon-button" onClick={() => remove(t)} aria-label="Hapus"><Trash2 /></button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function TestForm({ employeeId, item, onClose, onSaved }: { employeeId: number; item: EmployeeTest | null; onClose: () => void; onSaved: () => void }) {
  const [v, setV] = useState({
    jenis: item?.jenis ?? 'papikostik', tanggal: item?.tanggal ?? '', hasil: item?.hasil ?? '', skor: item?.skor === null || item?.skor === undefined ? '' : String(item.skor),
    catatan: item?.catatan ?? '', lampiran_url: item?.lampiran_url ?? '',
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV({ ...v, [k]: e.target.value })
  async function save() {
    setBusy(true)
    setError('')
    try {
      await api(item ? `/api/hrd/employees/${employeeId}/tests/${item.id}` : `/api/hrd/employees/${employeeId}/tests`, { method: item ? 'PUT' : 'POST', json: v })
      onSaved()
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }
  return (
    <div className="pap-emp-test-form">
      {error && <Notice onClose={() => setError('')}>{error}</Notice>}
      <div className="pap-form-grid">
        <Field label="Jenis tes *">
          <select className="pap-select" value={v.jenis} onChange={set('jenis')}>{(Object.keys(JENIS) as EmployeeTest['jenis'][]).map((j) => <option key={j} value={j}>{JENIS[j]}</option>)}</select>
        </Field>
        <Field label="Tanggal tes"><input className="pap-input" type="date" value={v.tanggal} onChange={set('tanggal')} /></Field>
        <Field label="Hasil *" full hint={HASIL_HINT[v.jenis as EmployeeTest['jenis']]}><input className="pap-input" maxLength={255} value={v.hasil} onChange={set('hasil')} /></Field>
        {v.jenis === 'iq' && <Field label="Skor IQ"><input className="pap-input pap-num" inputMode="decimal" value={v.skor} onChange={set('skor')} placeholder="mis. 110" /></Field>}
        <Field label="Link file hasil (opsional)" full={v.jenis !== 'iq'} hint="Scan hasil tes di Google Drive"><input className="pap-input" type="url" maxLength={500} value={v.lampiran_url} onChange={set('lampiran_url')} placeholder="https://" /></Field>
        <Field label="Catatan" full><textarea className="pap-input" rows={2} maxLength={1000} value={v.catatan} onChange={set('catatan')} placeholder="Opsional: lembaga / psikolog, rekomendasi" /></Field>
      </div>
      <div className="pap-inline-actions pap-emp-test-actions">
        <button type="button" className="pap-btn" onClick={onClose}>Batal</button>
        <button type="button" className="pap-primary-button" disabled={busy} onClick={save}>{busy ? 'Menyimpan...' : item ? 'Simpan perubahan' : 'Simpan hasil tes'}</button>
      </div>
    </div>
  )
}
