'use client'

import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Clock, Pencil, Plus, Printer, Search, Settings, ShieldCheck, Trash2, UserPlus, Users, Wallet } from 'lucide-react'
import { formatNumber, formatRupiah } from './accurate'
import { ReportDownloadButton } from './report-download'
import { api, Field, formatDate, Modal, Notice, Pager, usePaged } from './ui'

// Grade & Gaji: pengaturan gaji per karyawan, pengaturan payroll, dan hitung gaji per periode cut off (lib/payroll.ts)

const TIPE_KALKULASI = { kehadiran_cutoff: 'Kehadiran Periode Cut Off', bulanan_tetap: 'Gaji Bulanan Tetap' }
const DITANGGUNG = { pegawai: 'Di Tanggung Pegawai', perusahaan: 'Di Tanggung Perusahaan' }
const PTKP: Record<string, string> = { 'TK/0': 'Tidak Kawin Tanggungan 0', 'TK/1': 'Tidak Kawin Tanggungan 1', 'TK/2': 'Tidak Kawin Tanggungan 2', 'TK/3': 'Tidak Kawin Tanggungan 3', 'K/0': 'Kawin Tanggungan 0', 'K/1': 'Kawin Tanggungan 1', 'K/2': 'Kawin Tanggungan 2', 'K/3': 'Kawin Tanggungan 3' }
const PRORATA = { bulan_berjalan: 'Prorata Bulan Berjalan', hari_kerja_fix: 'Hari Kerja Fix', tidak: 'Tanpa Prorata' }
const METODE_PAJAK = { non_gross_up: 'Non Gross Up', gross_up: 'Gross Up' }
const HARI = ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu', 'Minggu']
const BANKS = ['Bank Cimb Niaga', 'Bank BCA', 'Bank BRI', 'Bank BNI', 'Bank Mandiri', 'Bank BSI', 'Bank BTN']

const rp = (v: number | null | undefined) => (v === null || v === undefined ? '—' : formatRupiah(v))
const val = (v: number | string | null | undefined) => (v === null || v === undefined ? '' : String(v))

type Payroll = {
  id: number; nip: string; nama: string; jabatan: string | null; divisi: string | null; status_karyawan: string | null; tgl_berhenti: string | null
  tanggal_berlaku: string | null; gaji_pokok: number | null; gaji_harian: number | null; gaji_per_jam_aktif: boolean; gaji_per_jam: number | null; fix_hari_kerja: number | null
  tunjangan_lain: number | null; pendapatan_lain: number | null; potongan_lain: number | null; pendapatan_harian: number | null; tipe_kalkulasi: keyof typeof TIPE_KALKULASI
  lembur_per_jam: number | null; lembur_per_jam_libur: number | null; pokok_lembur: number | null; cuti_diuangkan: number | null
  no_bpjs_tk?: string | null; nilai_bpjs_tk: number | null; bpjs_tk_ditanggung: keyof typeof DITANGGUNG; no_bpjs_kes?: string | null; nilai_bpjs_kes: number | null
  bpjs_kes_ditanggung: keyof typeof DITANGGUNG; npwp?: string | null; status_ptkp: string | null; metode_pajak: string | null
  bank?: string | null; no_rekening?: string | null; nama_pemilik?: string | null
}
type PayrollList = { items: Payroll[]; tanpa_pengaturan: { nip: string; nama: string; jabatan: string | null }[]; can: { manage: boolean } }

function Tiles({ tiles }: { tiles: { label: string; value: string; note: string; icon: typeof Users; tone: string }[] }) {
  return (
    <div className="pap-stat-grid four">
      {tiles.map((t) => (
        <div key={t.label} className="pap-stat-card">
          <div><span>{t.label}</span><strong className="pap-stat-text">{t.value}</strong><small className="neutral">{t.note}</small></div>
          <div className={`pap-stat-icon ${t.tone}`}><t.icon /></div>
        </div>
      ))}
    </div>
  )
}

// ---------- Gaji per karyawan ----------
export function PayrollEmployees() {
  const [data, setData] = useState<PayrollList | null>(null)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [q, setQ] = useState('')
  const [form, setForm] = useState<{ item: Payroll | null } | null>(null)
  const load = useCallback(() => api<PayrollList>('/api/hrd/payroll/karyawan').then((r) => { setData(r); setError('') }).catch((e) => setError(e.message)), [])
  useEffect(() => { load() }, [load])
  const term = q.trim().toLowerCase()
  const shown = (data?.items ?? []).filter((p) => !term || p.nama.toLowerCase().includes(term) || p.nip.includes(term))
  const paged = usePaged(shown, q, 50)
  const manage = !!data?.can.manage
  async function seed() {
    try {
      const res = await api<{ ditambah: number }>('/api/hrd/payroll/karyawan', { method: 'POST', json: { action: 'seed' } })
      setMessage(res.ditambah ? `${res.ditambah} karyawan ditambahkan dari Data Karyawan & spreadsheet kebijakan gaji.` : 'Semua karyawan aktif sudah punya pengaturan gaji.')
      load()
    } catch (e) {
      setError((e as Error).message)
    }
  }
  async function remove(p: Payroll) {
    if (!window.confirm(`Hapus pengaturan gaji ${p.nama}?`)) return
    try {
      await api(`/api/hrd/payroll/karyawan/${p.id}`, { method: 'DELETE' })
      setMessage(`Pengaturan gaji ${p.nama} dihapus.`)
      load()
    } catch (e) {
      setError((e as Error).message)
    }
  }
  const items = data?.items ?? []
  return (
    <>
      {message && <Notice kind="success" onClose={() => setMessage('')}>{message}</Notice>}
      {error && <Notice onClose={() => setError('')}>{error}</Notice>}
      <Tiles tiles={[
        { label: 'Karyawan berpengaturan gaji', value: `${items.length}`, note: `${items.filter((p) => p.tipe_kalkulasi === 'kehadiran_cutoff').length} dihitung dari kehadiran`, icon: Users, tone: 'stat-1' },
        { label: 'Gaji per jam', value: `${items.filter((p) => p.gaji_per_jam_aktif).length}`, note: 'karyawan memakai tarif per jam', icon: Wallet, tone: 'stat-0' },
        { label: 'BPJS belum lengkap', value: `${items.filter((p) => manage && (!p.no_bpjs_tk || !p.no_bpjs_kes)).length}`, note: manage ? 'tanpa No. BPJS TK / Kesehatan' : 'hanya terlihat oleh HRD', icon: ShieldCheck, tone: 'stat-2' },
        { label: 'Belum ada pengaturan', value: `${data?.tanpa_pengaturan.length ?? 0}`, note: 'karyawan aktif di Data Karyawan', icon: AlertTriangle, tone: 'stat-3' },
      ]} />
      <div className="pap-table-card">
        <div className="pap-card-head">
          <div><h2>Pengaturan gaji per karyawan</h2><p>Seperti isian Payroll pada data Pegawai di Altius. Dipakai di tab Hitung gaji.</p></div>
          {manage && <div className="pap-inline-actions">
            {!!data?.tanpa_pengaturan.length && <button className="pap-btn" onClick={seed}><UserPlus /> Lengkapi dari Data Karyawan</button>}
            <button className="pap-primary-button" onClick={() => setForm({ item: null })} disabled={!data?.tanpa_pengaturan.length}><Plus /> Tambah</button>
          </div>}
        </div>
        <div className="pap-filters"><label className="pap-filter-search"><Search /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari nama / NIP..." /></label></div>
        <div className="pap-table-wrap">
          <table>
            <thead><tr><th>Karyawan</th><th>Tipe kalkulasi</th><th className="pap-num">Gaji</th><th className="pap-num">Lembur / jam</th><th className="pap-num">Tunjangan & lain</th><th>BPJS</th><th>Pajak</th>{manage && <th>Rekening</th>}{manage && <th aria-label="Aksi" />}</tr></thead>
            <tbody>
              {paged.items.map((p) => (
                <tr key={p.id}>
                  <td><div className="pap-cell-title">{p.nama}</div><div className="pap-cell-sub">{p.nip}{p.jabatan ? ` · ${p.jabatan}` : ''}{p.tgl_berhenti ? ' · berhenti' : ''}</div></td>
                  <td>{TIPE_KALKULASI[p.tipe_kalkulasi] ?? p.tipe_kalkulasi}<div className="pap-cell-sub">{p.tanggal_berlaku ? `Berlaku ${formatDate(p.tanggal_berlaku)}` : ''}</div></td>
                  <td className="pap-num pap-nowrap">
                    {p.gaji_pokok ? <div>{rp(p.gaji_pokok)} <small className="pap-muted">/ bln</small></div> : null}
                    {p.gaji_harian ? <div>{rp(p.gaji_harian)} <small className="pap-muted">/ hari</small></div> : null}
                    {p.gaji_per_jam_aktif && p.gaji_per_jam ? <div>{rp(p.gaji_per_jam)} <small className="pap-muted">/ jam</small></div> : null}
                    {!p.gaji_pokok && !p.gaji_harian && !(p.gaji_per_jam_aktif && p.gaji_per_jam) && <span className="pap-status warning">Belum diisi</span>}
                  </td>
                  <td className="pap-num pap-nowrap">{rp(p.lembur_per_jam)}<div className="pap-cell-sub">libur {rp(p.lembur_per_jam_libur)}</div></td>
                  <td className="pap-num pap-nowrap">{rp((p.tunjangan_lain ?? 0) + (p.pendapatan_lain ?? 0))}<div className="pap-cell-sub">{p.pendapatan_harian ? `+${formatRupiah(p.pendapatan_harian)}/hari` : ''}{p.potongan_lain ? ` −${formatRupiah(p.potongan_lain)}` : ''}</div></td>
                  <td className="pap-nowrap">
                    <div>TK {manage ? (p.no_bpjs_tk ? '✓' : '—') : ''} · {p.bpjs_tk_ditanggung === 'perusahaan' ? 'perusahaan' : 'pegawai'}</div>
                    <div className="pap-cell-sub">Kes {manage ? (p.no_bpjs_kes ? '✓' : '—') : ''} · {p.bpjs_kes_ditanggung === 'perusahaan' ? 'perusahaan' : 'pegawai'}</div>
                  </td>
                  <td>{p.status_ptkp ?? '—'}<div className="pap-cell-sub">{p.metode_pajak ? METODE_PAJAK[p.metode_pajak as keyof typeof METODE_PAJAK] : 'ikut pengaturan'}</div></td>
                  {manage && <td>{p.bank ?? '—'}<div className="pap-cell-sub">{p.no_rekening ?? ''}</div></td>}
                  {manage && <td><div className="pap-row-actions">
                    <button className="pap-icon-button" title="Ubah" aria-label={`Ubah gaji ${p.nama}`} onClick={() => setForm({ item: p })}><Pencil /></button>
                    <button className="pap-icon-button" title="Hapus" aria-label={`Hapus gaji ${p.nama}`} onClick={() => remove(p)}><Trash2 /></button>
                  </div></td>}
                </tr>
              ))}
            </tbody>
          </table>
          {data && !items.length && <div className="pap-empty">Belum ada pengaturan gaji karyawan.{manage ? ' Klik "Lengkapi dari Data Karyawan" untuk mengisi otomatis.' : ''}</div>}
          {!data && !error && <div className="pap-empty">Memuat...</div>}
          <Pager {...paged.pager} noun="karyawan" />
        </div>
      </div>
      {form && data && <PayrollForm item={form.item} options={data.tanpa_pengaturan} onClose={() => setForm(null)} onSaved={(t) => { setForm(null); setMessage(t); load() }} />}
    </>
  )
}

function PayrollForm({ item, options, onClose, onSaved }: { item: Payroll | null; options: PayrollList['tanpa_pengaturan']; onClose: () => void; onSaved: (text: string) => void }) {
  const [v, setV] = useState(() => ({
    nip: item?.nip ?? options[0]?.nip ?? '', tanggal_berlaku: item?.tanggal_berlaku ?? '', gaji_pokok: val(item?.gaji_pokok), gaji_harian: val(item?.gaji_harian),
    gaji_per_jam_aktif: item?.gaji_per_jam_aktif ?? false, gaji_per_jam: val(item?.gaji_per_jam), fix_hari_kerja: val(item?.fix_hari_kerja),
    tunjangan_lain: val(item?.tunjangan_lain), pendapatan_lain: val(item?.pendapatan_lain), potongan_lain: val(item?.potongan_lain), pendapatan_harian: val(item?.pendapatan_harian),
    tipe_kalkulasi: item?.tipe_kalkulasi ?? 'kehadiran_cutoff', lembur_per_jam: val(item?.lembur_per_jam), lembur_per_jam_libur: val(item?.lembur_per_jam_libur),
    pokok_lembur: val(item?.pokok_lembur), cuti_diuangkan: val(item?.cuti_diuangkan), no_bpjs_tk: item?.no_bpjs_tk ?? '', nilai_bpjs_tk: val(item?.nilai_bpjs_tk),
    bpjs_tk_ditanggung: item?.bpjs_tk_ditanggung ?? 'pegawai', no_bpjs_kes: item?.no_bpjs_kes ?? '', nilai_bpjs_kes: val(item?.nilai_bpjs_kes),
    bpjs_kes_ditanggung: item?.bpjs_kes_ditanggung ?? 'pegawai', npwp: item?.npwp ?? '', status_ptkp: item?.status_ptkp ?? '', metode_pajak: item?.metode_pajak ?? '',
    bank: item?.bank ?? '', no_rekening: item?.no_rekening ?? '', nama_pemilik: item?.nama_pemilik ?? '',
  }))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setV({ ...v, [k]: e.target.value })
  const money = (k: keyof typeof v, label: string, hint?: string) => <Field label={label} hint={hint}><input className="pap-input" type="number" min={0} step="any" value={String(v[k])} onChange={set(k)} /></Field>
  const nama = item?.nama ?? options.find((o) => o.nip === v.nip)?.nama ?? ''
  async function save(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await api(item ? `/api/hrd/payroll/karyawan/${item.id}` : '/api/hrd/payroll/karyawan', { method: item ? 'PATCH' : 'POST', json: v })
      onSaved(item ? `Pengaturan gaji ${nama} disimpan.` : `Pengaturan gaji ${nama} ditambahkan.`)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal title={item ? `Pengaturan gaji ${item.nama}` : 'Tambah pengaturan gaji'} subtitle={item ? `NIP ${item.nip}${item.jabatan ? ` · ${item.jabatan}` : ''}` : 'Pilih karyawan dari Data Karyawan'} wide onClose={onClose}
      footer={<><span className="pap-spacer" /><button className="pap-btn" onClick={onClose}>Batal</button><button className="pap-primary-button" form="payroll-form" disabled={busy}>{busy ? 'Menyimpan...' : 'Simpan'}</button></>}>
      <form id="payroll-form" className="pap-form-grid" onSubmit={save}>
        {error && <div className="full"><Notice onClose={() => setError('')}>{error}</Notice></div>}
        {!item && (
          <Field label="Karyawan *" full>
            <select className="pap-select" required value={v.nip} onChange={set('nip')}>
              {options.map((o) => <option key={o.nip} value={o.nip}>{o.nama} · {o.nip}{o.jabatan ? ` · ${o.jabatan}` : ''}</option>)}
            </select>
          </Field>
        )}
        <h3 className="full">Payroll</h3>
        <Field label="Tanggal Berlaku"><input className="pap-input" type="date" value={v.tanggal_berlaku} onChange={set('tanggal_berlaku')} /></Field>
        <Field label="Tipe Kalkulasi *">
          <select className="pap-select" value={v.tipe_kalkulasi} onChange={set('tipe_kalkulasi')}>
            {Object.entries(TIPE_KALKULASI).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </Field>
        {money('gaji_pokok', 'Gaji Pokok (per bulan)', v.tipe_kalkulasi === 'bulanan_tetap' ? 'Dibayar penuh per periode (prorata sesuai pengaturan)' : undefined)}
        {money('gaji_harian', 'Gaji Harian', 'Kosong = gaji per jam × 7 jam')}
        <Field label="Gaji Per Jam">
          <div className="pap-inline-actions">
            <label className="pap-check"><input type="checkbox" checked={v.gaji_per_jam_aktif} onChange={(e) => setV({ ...v, gaji_per_jam_aktif: e.target.checked })} /><span>Aktif</span></label>
            <input className="pap-input" type="number" min={0} step="any" value={v.gaji_per_jam} onChange={set('gaji_per_jam')} disabled={!v.gaji_per_jam_aktif} />
          </div>
        </Field>
        <Field label="Fix Hari Kerja" hint="Kosong = ikut pengaturan payroll"><input className="pap-input" type="number" min={1} max={31} value={v.fix_hari_kerja} onChange={set('fix_hari_kerja')} /></Field>
        {money('tunjangan_lain', 'Tunjangan Lain (per bulan)')}
        {money('pendapatan_lain', 'Pendapatan Lainnya (per bulan)')}
        {money('potongan_lain', 'Potongan Lain (per bulan)')}
        {money('pendapatan_harian', 'Pendapatan Harian', 'Per hari hadir (uang makan / transport)')}
        <h3 className="full">Lembur & cuti</h3>
        {money('lembur_per_jam', 'Nilai Lembur Per Jam')}
        {money('lembur_per_jam_libur', 'Nilai Lembur Per Jam Libur')}
        {money('pokok_lembur', 'Nilai Pokok Lembur', 'Dasar lembur bila tarif per jam kosong (÷ 173)')}
        {money('cuti_diuangkan', 'Cuti Diuangkan Per Hari')}
        <h3 className="full">BPJS</h3>
        <Field label="No BPJS Ketenagakerjaan"><input className="pap-input" maxLength={40} value={v.no_bpjs_tk} onChange={set('no_bpjs_tk')} /></Field>
        {money('nilai_bpjs_tk', 'Nilai BPJS Ketenagakerjaan', 'Upah dasar iuran; kosong = gaji bulanan (min. UMR)')}
        <Field label="Ket Di Tanggung">
          <select className="pap-select" value={v.bpjs_tk_ditanggung} onChange={set('bpjs_tk_ditanggung')}>{Object.entries(DITANGGUNG).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        </Field>
        <Field label="No BPJS Kesehatan"><input className="pap-input" maxLength={40} value={v.no_bpjs_kes} onChange={set('no_bpjs_kes')} /></Field>
        {money('nilai_bpjs_kes', 'Nilai BPJS Kesehatan', 'Upah dasar iuran; kosong = gaji bulanan (min. UMR)')}
        <Field label="Kes Di Tanggung">
          <select className="pap-select" value={v.bpjs_kes_ditanggung} onChange={set('bpjs_kes_ditanggung')}>{Object.entries(DITANGGUNG).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        </Field>
        <h3 className="full">Pajak & rekening</h3>
        <Field label="NPWP"><input className="pap-input" maxLength={40} value={v.npwp} onChange={set('npwp')} /></Field>
        <Field label="Status">
          <select className="pap-select" value={v.status_ptkp} onChange={set('status_ptkp')}>
            <option value="">Pilih</option>
            {Object.entries(PTKP).map(([k, l]) => <option key={k} value={k}>{l} ({k})</option>)}
          </select>
        </Field>
        <Field label="Metode Perhitungan">
          <select className="pap-select" value={v.metode_pajak} onChange={set('metode_pajak')}>
            <option value="">Ikut pengaturan payroll</option>
            {Object.entries(METODE_PAJAK).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </Field>
        <Field label="Nama Bank">
          <input className="pap-input" list="pap-payroll-banks" maxLength={80} value={v.bank} onChange={set('bank')} />
          <datalist id="pap-payroll-banks">{BANKS.map((b) => <option key={b} value={b} />)}</datalist>
        </Field>
        <Field label="No Rekening Bank"><input className="pap-input" maxLength={60} value={v.no_rekening} onChange={set('no_rekening')} /></Field>
        <Field label="Nama Pemilik"><input className="pap-input" maxLength={150} value={v.nama_pemilik} onChange={set('nama_pemilik')} placeholder={nama} /></Field>
      </form>
    </Modal>
  )
}

// ---------- Pengaturan payroll ----------
type Settings = {
  bpjs_kes_perusahaan: number; bpjs_jht_perusahaan: number; bpjs_jkk: number; bpjs_jkm: number; bpjs_jpn_perusahaan: number; usia_pensiun: number
  bpjs_kes_pegawai: number; bpjs_jht_pegawai: number; bpjs_jpn_pegawai: number; max_bpjs_kes: number; max_bpjs_jpn: number; umr: number; lembur_umr: boolean
  cutoff_tanggal: number; cutoff_mingguan: string | null; prorata: keyof typeof PRORATA; hari_kerja_fix: number; metode_pajak: keyof typeof METODE_PAJAK; updated_at: string | null
}

export function PayrollSettingsView() {
  const [data, setData] = useState<{ item: Settings; can: { manage: boolean } } | null>(null)
  const [v, setV] = useState<Record<string, string | boolean>>({})
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const fill = (s: Settings) => setV(Object.fromEntries(Object.entries(s).map(([k, x]) => [k, typeof x === 'boolean' ? x : x === null ? '' : String(x)])))
  useEffect(() => {
    api<{ item: Settings; can: { manage: boolean } }>('/api/hrd/payroll/settings').then((r) => { setData(r); fill(r.item) }).catch((e) => setError(e.message))
  }, [])
  const manage = !!data?.can.manage
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setV({ ...v, [k]: e.target.value })
  const num = (k: string, label: string, step = 'any') => <Field label={label}><input className="pap-input" type="number" min={0} step={step} value={String(v[k] ?? '')} onChange={set(k)} disabled={!manage} required /></Field>
  async function save(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const res = await api<{ item: Settings }>('/api/hrd/payroll/settings', { method: 'PUT', json: v })
      fill(res.item)
      setMessage('Pengaturan payroll disimpan.')
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }
  if (!data) return error ? <Notice onClose={() => setError('')}>{error}</Notice> : <div className="pap-table-card"><div className="pap-empty">Memuat...</div></div>
  return (
    <div className="pap-table-card">
      <div className="pap-card-head"><div><h2>Pengaturan payroll</h2><p>Seperti Pengaturan Payroll di Altius{data.item.updated_at ? ` · diubah ${formatDate(data.item.updated_at, true)}` : ''}</p></div>{manage && <button className="pap-primary-button" form="payroll-settings" disabled={busy}><Settings /> {busy ? 'Menyimpan...' : 'Simpan'}</button>}</div>
      <div className="pap-dash-body">
        {message && <Notice kind="success" onClose={() => setMessage('')}>{message}</Notice>}
        {error && <Notice onClose={() => setError('')}>{error}</Notice>}
        <form id="payroll-settings" className="pap-form-grid" onSubmit={save}>
          <h3 className="full">Rate BPJS Perusahaan</h3>
          {num('bpjs_kes_perusahaan', 'BPJS Kesehatan (%)')}
          {num('bpjs_jht_perusahaan', 'BPJS JHT (%)')}
          {num('bpjs_jkk', 'BPJS JKK (%)')}
          {num('bpjs_jkm', 'BPJS JKM (%)')}
          {num('bpjs_jpn_perusahaan', 'BPJS JPN (%)')}
          {num('usia_pensiun', 'Usia Pensiun', '1')}
          <h3 className="full">Rate BPJS Pegawai</h3>
          {num('bpjs_kes_pegawai', 'BPJS Kesehatan (%)')}
          {num('bpjs_jht_pegawai', 'BPJS JHT (%)')}
          {num('bpjs_jpn_pegawai', 'BPJS JPN (%)')}
          <h3 className="full">Maksimum Nilai Yang Diperhitungkan</h3>
          {num('max_bpjs_kes', 'Maksimum BPJS Kesehatan (Rp)')}
          {num('max_bpjs_jpn', 'Maksimum BPJS JPN (Rp)')}
          <h3 className="full">Nilai UMR</h3>
          {num('umr', 'Minimum UMR (Rp)')}
          <label className="pap-check full"><input type="checkbox" checked={!!v.lembur_umr} disabled={!manage} onChange={(e) => setV({ ...v, lembur_umr: e.target.checked })} /><span>Lembur berdasarkan UMR (bila nilai pokok lembur karyawan kosong)</span></label>
          <h3 className="full">Tanggal Cut Off</h3>
          {num('cutoff_tanggal', 'Tanggal Cut Off Bulanan', '1')}
          <Field label="Hari Cut Off Mingguan (Jika Ada)">
            <select className="pap-select" value={String(v.cutoff_mingguan ?? '')} onChange={set('cutoff_mingguan')} disabled={!manage}>
              <option value="">Kosong</option>
              {HARI.map((h) => <option key={h} value={h}>{h}</option>)}
            </select>
          </Field>
          <Field label="Tipe Prorata Bulanan">
            <select className="pap-select" value={String(v.prorata ?? '')} onChange={set('prorata')} disabled={!manage}>
              {Object.entries(PRORATA).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </Field>
          {num('hari_kerja_fix', 'Hari Kerja Fix Perbulan', '1')}
          <h3 className="full">Jam Kerja & Lembur (pekerja per jam)</h3>
          {num('jam_kerja_harian', 'Jam kerja per hari')}
          {num('istirahat_jam', 'Istirahat per hari (jam)')}
          {num('batas_jam_mingguan', 'Batas jam kerja per minggu')}
          {num('toleransi_lembur_menit', 'Toleransi pembulatan jam (menit)', '1')}
          {num('faktor_lembur', 'Faktor lembur hari kerja (× tarif per jam)')}
          {num('faktor_lembur_libur', 'Faktor lembur hari libur (× tarif per jam)')}
          <p className="pap-hint full">Minggu dimulai dari hari libur rutin karyawan di Jadwal Shift. Jam kerja di atas batas mingguan = Lembur Rutin; jam di luar shift atau kerja di hari libur = Lembur Variabel. Faktor dipakai bila nilai lembur per jam karyawan kosong.</p>
          <h3 className="full">Pajak</h3>
          <Field label="Metode Perhitungan">
            <select className="pap-select" value={String(v.metode_pajak ?? '')} onChange={set('metode_pajak')} disabled={!manage}>
              {Object.entries(METODE_PAJAK).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </Field>
        </form>
        {!manage && <p className="pap-muted">Pengaturan payroll diubah oleh HRD.</p>}
      </div>
    </div>
  )
}

// ---------- Hitung gaji per periode ----------
type Slip = {
  nip: string; nama: string; jabatan: string | null; tipe: string; hadir: number; cuti: number; lembur_jam: number; lembur_libur_jam: number
  upah: number; pendapatan_harian: number; lembur: number; tunjangan: number; pendapatan_lain: number; cuti_dibayar: number; bruto: number
  bpjs_pegawai: { jht: number; jpn: number; kes: number }; potongan_bpjs: number; potongan_lain: number; diterima: number
  bpjs_perusahaan: { kes: number; jht: number; jkk: number; jkm: number; jpn: number; total: number }; catatan: string[]
  lembur_rutin_jam: number; rincian: { penghasilan: Line[]; tambahan: Line[]; potongan: Line[] }; mingguan: Weekly | null
}
type Line = { label: string; nominal: number }
type Week = { no: number; dari: string; sampai: string; jam_kerja: number; jam_dibayar: number; lembur_rutin: number; lembur_variabel: number; lembur_libur: number }
type Weekly = { libur_rutin: number; sumber_libur: 'jadwal' | 'bawaan'; minggu: Week[]; jam_dibayar: number; lembur_rutin: number; lembur_variabel: number; lembur_libur: number }
type Hitung = { periode: string; dari: string; sampai: string; slips: Slip[] }
const HARI_MINGGU = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu']

export function PayrollCalc() {
  const [periode, setPeriode] = useState('')
  const [data, setData] = useState<Hitung | null>(null)
  const [error, setError] = useState('')
  const [q, setQ] = useState('')
  const [detail, setDetail] = useState<Slip | null>(null)
  useEffect(() => {
    api<Hitung>(`/api/hrd/payroll/hitung${periode ? `?periode=${periode}` : ''}`).then((r) => { setData(r); setError(''); if (!periode) setPeriode(r.periode) }).catch((e) => setError(e.message))
  }, [periode])
  const term = q.trim().toLowerCase()
  const slips = data?.slips ?? []
  const shown = slips.filter((s) => !term || s.nama.toLowerCase().includes(term) || s.nip.includes(term))
  const paged = usePaged(shown, `${q}-${periode}`, 50)
  const sum = (f: (s: Slip) => number) => slips.reduce((t, s) => t + f(s), 0)
  const short = (v: number) => (v >= 1e6 ? `Rp ${formatNumber(v / 1e6, 1)} jt` : formatRupiah(v))
  return (
    <>
      {error && <Notice onClose={() => setError('')}>{error}</Notice>}
      <Tiles tiles={[
        { label: 'Total diterima', value: short(sum((s) => s.diterima)), note: `${slips.length} karyawan`, icon: Wallet, tone: 'stat-0' },
        { label: 'Total bruto', value: short(sum((s) => s.bruto)), note: `Lembur ${short(sum((s) => s.lembur))}`, icon: Wallet, tone: 'stat-1' },
        { label: 'Potongan BPJS pegawai', value: short(sum((s) => s.potongan_bpjs)), note: `Potongan lain ${short(sum((s) => s.potongan_lain))}`, icon: ShieldCheck, tone: 'stat-2' },
        { label: 'Iuran BPJS perusahaan', value: short(sum((s) => s.bpjs_perusahaan.total)), note: 'Biaya perusahaan di luar gaji', icon: ShieldCheck, tone: 'stat-3' },
      ]} />
      <div className="pap-table-card">
        <div className="pap-card-head">
          <div><h2>Hitung gaji periode {data ? `${formatDate(data.dari)} – ${formatDate(data.sampai)}` : ''}</h2><p>Dari pengaturan gaji per karyawan, pengaturan payroll, kehadiran di menu Absensi (sampai hari ini), dan lembur manual. PPh 21 belum dihitung.</p></div>
          {data && <div className="pap-inline-actions pap-wrap"><ReportDownloadButton jenis="gaji" periode={data.periode} />{slips.length > 0 && <a className="pap-btn" href={`/cetak/slip-gaji?periode=${data.periode}`} target="_blank" rel="noreferrer"><Printer /> Cetak semua slip</a>}</div>}
        </div>
        <div className="pap-filters">
          <label className="pap-filter-search"><Search /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari nama / NIP..." /></label>
          <input className="pap-input" type="month" value={periode} onChange={(e) => e.target.value && setPeriode(e.target.value)} aria-label="Periode (bulan cut off)" />
        </div>
        <div className="pap-table-wrap">
          <table>
            <thead><tr><th>Karyawan</th><th className="pap-num">Hadir</th><th className="pap-num">Lembur</th><th className="pap-num">Upah</th><th className="pap-num">Lembur (Rp)</th><th className="pap-num">Tunjangan & lain</th><th className="pap-num">Bruto</th><th className="pap-num">Potongan</th><th className="pap-num">Diterima</th></tr></thead>
            <tbody>
              {paged.items.map((s) => (
                <tr key={s.nip} className="pap-row-link" onClick={() => setDetail(s)}>
                  <td><div className="pap-cell-title">{s.nama}</div><div className="pap-cell-sub">{s.tipe}{s.catatan.length ? <> · <span className="pap-status warning">{s.catatan[0]}</span></> : null}</div></td>
                  <td className="pap-num">{s.hadir}<div className="pap-cell-sub">{s.cuti ? `cuti ${s.cuti}` : ''}</div></td>
                  <td className="pap-num pap-nowrap">{formatNumber(s.lembur_jam, 1)} j<div className="pap-cell-sub">{s.lembur_rutin_jam ? `rutin ${formatNumber(s.lembur_rutin_jam, 1)} · ` : ''}libur {formatNumber(s.lembur_libur_jam, 1)} j</div></td>
                  <td className="pap-num pap-nowrap">{rp(s.upah)}</td>
                  <td className="pap-num pap-nowrap">{rp(s.lembur)}</td>
                  <td className="pap-num pap-nowrap">{rp(s.tunjangan + s.pendapatan_lain + s.pendapatan_harian + s.cuti_dibayar)}</td>
                  <td className="pap-num pap-nowrap">{rp(s.bruto)}</td>
                  <td className="pap-num pap-nowrap">{rp(s.potongan_bpjs + s.potongan_lain)}</td>
                  <td className="pap-num pap-nowrap"><strong>{rp(s.diterima)}</strong></td>
                </tr>
              ))}
            </tbody>
          </table>
          {data && !slips.length && <div className="pap-empty">Belum ada karyawan dengan pengaturan gaji untuk periode ini. Isi di tab Gaji karyawan.</div>}
          {!data && !error && <div className="pap-empty">Menghitung...</div>}
          <Pager {...paged.pager} noun="karyawan" />
        </div>
      </div>
      {detail && data && (
        <Modal title={`Rincian gaji ${detail.nama}`} subtitle={`${detail.nip} · periode ${formatDate(data.dari)} – ${formatDate(data.sampai)}`} wide onClose={() => setDetail(null)}
          footer={<><a className="pap-btn" href={`/cetak/slip-gaji?periode=${data.periode}&nip=${encodeURIComponent(detail.nip)}`} target="_blank" rel="noreferrer"><Printer /> Slip gaji</a><span className="pap-spacer" /><button className="pap-btn" onClick={() => setDetail(null)}>Tutup</button></>}>
          {detail.mingguan && (
            <section className="pap-detail-section">
              <h3>Jam kerja per minggu <span className="pap-muted">· libur rutin {HARI_MINGGU[detail.mingguan.libur_rutin]}{detail.mingguan.sumber_libur === 'bawaan' ? ' (bawaan, belum ada di Jadwal Shift)' : ' (Jadwal Shift)'}</span></h3>
              <div className="pap-table-wrap bordered">
                <table>
                  <thead><tr><th>Minggu</th><th className="pap-num">Jam kerja</th><th className="pap-num">Dibayar</th><th className="pap-num">Lembur rutin</th><th className="pap-num">Lembur variabel</th><th className="pap-num">Lembur libur</th></tr></thead>
                  <tbody>
                    {detail.mingguan.minggu.map((m) => (
                      <tr key={m.no}>
                        <td className="pap-nowrap"><b>{m.no}</b> <span className="pap-cell-sub">{formatDate(m.dari)}{m.sampai !== m.dari ? ` – ${formatDate(m.sampai)}` : ''}</span></td>
                        <td className="pap-num">{formatNumber(m.jam_kerja, 2)}</td>
                        <td className="pap-num">{formatNumber(m.jam_dibayar, 2)}</td>
                        <td className="pap-num">{m.lembur_rutin ? formatNumber(m.lembur_rutin, 2) : '—'}</td>
                        <td className="pap-num">{m.lembur_variabel ? formatNumber(m.lembur_variabel, 2) : '—'}</td>
                        <td className="pap-num">{m.lembur_libur ? formatNumber(m.lembur_libur, 2) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
          <section className="pap-detail-section">
            <h3>Baris slip gaji</h3>
            <dl className="pap-detail-grid">
              {[...detail.rincian.penghasilan, ...detail.rincian.tambahan].map((l, i) => <div key={i}><dt>{l.label}</dt><dd>{rp(l.nominal)}</dd></div>)}
              {detail.rincian.potongan.map((l, i) => <div key={`p${i}`}><dt>{l.label}</dt><dd>−{rp(l.nominal)}</dd></div>)}
            </dl>
          </section>
          <dl className="pap-detail-grid">
            <div><dt>Kehadiran</dt><dd>{detail.hadir} hari{detail.cuti ? ` · cuti ${detail.cuti} hari` : ''}</dd></div>
            <div><dt>Upah ({detail.tipe})</dt><dd>{rp(detail.upah)}</dd></div>
            <div><dt>Pendapatan harian</dt><dd>{rp(detail.pendapatan_harian)}</dd></div>
            <div><dt>Lembur {formatNumber(detail.lembur_jam, 1)} j + libur {formatNumber(detail.lembur_libur_jam, 1)} j</dt><dd>{rp(detail.lembur)}</dd></div>
            <div><dt>Tunjangan lain</dt><dd>{rp(detail.tunjangan)}</dd></div>
            <div><dt>Pendapatan lainnya</dt><dd>{rp(detail.pendapatan_lain)}</dd></div>
            <div><dt>Cuti diuangkan</dt><dd>{rp(detail.cuti_dibayar)}</dd></div>
            <div><dt><strong>Bruto</strong></dt><dd><strong>{rp(detail.bruto)}</strong></dd></div>
            <div><dt>BPJS JHT pegawai</dt><dd>{rp(detail.bpjs_pegawai.jht)}</dd></div>
            <div><dt>BPJS JP pegawai</dt><dd>{rp(detail.bpjs_pegawai.jpn)}</dd></div>
            <div><dt>BPJS Kesehatan pegawai</dt><dd>{rp(detail.bpjs_pegawai.kes)}</dd></div>
            <div><dt>Dipotong dari gaji (BPJS)</dt><dd>−{rp(detail.potongan_bpjs)}</dd></div>
            <div><dt>Potongan lain</dt><dd>−{rp(detail.potongan_lain)}</dd></div>
            <div><dt><strong>Diterima</strong></dt><dd><strong>{rp(detail.diterima)}</strong></dd></div>
            <div><dt>Iuran BPJS perusahaan</dt><dd>{rp(detail.bpjs_perusahaan.total)}<div className="pap-cell-sub">Kes {rp(detail.bpjs_perusahaan.kes)} · JHT {rp(detail.bpjs_perusahaan.jht)} · JKK {rp(detail.bpjs_perusahaan.jkk)} · JKM {rp(detail.bpjs_perusahaan.jkm)} · JP {rp(detail.bpjs_perusahaan.jpn)}</div></dd></div>
          </dl>
          {!!detail.catatan.length && <ul className="pap-muted">{detail.catatan.map((c) => <li key={c}>{c}</li>)}</ul>}
          <p className="pap-muted">Perkiraan sebelum PPh 21. Iuran BPJS bagian pegawai yang ditanggung perusahaan tidak memotong gaji dan masuk iuran perusahaan.</p>
        </Modal>
      )}
    </>
  )
}

// ---------- Lembur variabel manual ----------
type Overtime = { id: number; nip: string; nama: string; jabatan: string | null; tanggal: string; jam: number; hari: 'kerja' | 'libur'; mode: 'tambah' | 'ganti'; keterangan: string | null; created_name: string | null }
type OvertimeRes = { periode: string; dari: string; sampai: string; items: Overtime[]; employees: { nip: string; nama: string; jabatan: string | null }[]; can: { manage: boolean } }

export function PayrollOvertime() {
  const [periode, setPeriode] = useState(() => {
    const now = new Date(Date.now() + 7 * 3600e3)
    return (now.getUTCDate() > 27 ? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)) : now).toISOString().slice(0, 7)
  })
  const [data, setData] = useState<OvertimeRes | null>(null)
  const [error, setError] = useState('')
  const [q, setQ] = useState('')
  const [form, setForm] = useState<Overtime | 'baru' | null>(null)
  const load = useCallback(() => api<OvertimeRes>(`/api/hrd/payroll/lembur?periode=${periode}`).then((r) => { setData(r); setError('') }).catch((e) => setError(e.message)), [periode])
  useEffect(() => { load() }, [load])
  const term = q.trim().toLowerCase()
  const items = (data?.items ?? []).filter((o) => !term || o.nama.toLowerCase().includes(term) || o.nip.includes(term))
  const paged = usePaged(items, `${q}-${periode}`, 50)
  async function remove(o: Overtime) {
    if (!window.confirm(`Hapus lembur ${o.nama} ${formatDate(o.tanggal)}?`)) return
    try {
      await api(`/api/hrd/payroll/lembur/${o.id}`, { method: 'DELETE' })
      load()
    } catch (e) {
      setError((e as Error).message)
    }
  }
  return (
    <>
      {error && <Notice onClose={() => setError('')}>{error}</Notice>}
      <div className="pap-table-card">
        <div className="pap-card-head">
          <div><h2>Lembur variabel manual {data ? `· ${formatDate(data.dari)} – ${formatDate(data.sampai)}` : ''}</h2><p>Lembur variabel otomatis dihitung dari Absensi (jam di luar shift & kerja di hari libur). Tambahkan di sini lembur yang tidak tercatat mesin, atau ganti lembur otomatis di tanggal tertentu. Lembur rutin (&gt; 40 jam/minggu) dihitung otomatis.</p></div>
          {data?.can.manage && <button className="pap-primary-button" onClick={() => setForm('baru')}><Plus /> Input lembur</button>}
        </div>
        <div className="pap-filters">
          <label className="pap-filter-search"><Search /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari nama / NIP..." /></label>
          <input className="pap-input" type="month" value={periode} onChange={(e) => e.target.value && setPeriode(e.target.value)} aria-label="Periode (bulan cut off)" />
        </div>
        <div className="pap-table-wrap">
          <table>
            <thead><tr><th>Tanggal</th><th>Karyawan</th><th className="pap-num">Jam</th><th>Jenis</th><th>Keterangan</th>{data?.can.manage && <th />}</tr></thead>
            <tbody>
              {paged.items.map((o) => (
                <tr key={o.id}>
                  <td className="pap-nowrap">{formatDate(o.tanggal)}</td>
                  <td><div className="pap-cell-title">{o.nama}</div><div className="pap-cell-sub">{o.nip}{o.jabatan ? ` · ${o.jabatan}` : ''}</div></td>
                  <td className="pap-num">{formatNumber(o.jam, 2)}</td>
                  <td><span className={`pap-status ${o.hari === 'libur' ? 'warning' : 'info'}`}>{o.hari === 'libur' ? 'Hari libur' : 'Hari kerja'}</span>{o.mode === 'ganti' && <div className="pap-cell-sub">mengganti lembur otomatis</div>}</td>
                  <td>{o.keterangan ?? '—'}<div className="pap-cell-sub">{o.created_name}</div></td>
                  {data?.can.manage && <td className="pap-nowrap"><button className="pap-icon-button" aria-label="Ubah" onClick={() => setForm(o)}><Pencil /></button><button className="pap-icon-button" aria-label="Hapus" onClick={() => remove(o)}><Trash2 /></button></td>}
                </tr>
              ))}
            </tbody>
          </table>
          {data && !items.length && <div className="pap-empty">Belum ada lembur manual di periode ini.</div>}
          {!data && !error && <div className="pap-empty">Memuat...</div>}
          <Pager {...paged.pager} noun="lembur" />
        </div>
      </div>
      {form && data && <OvertimeForm item={form === 'baru' ? null : form} employees={data.employees} range={data} onClose={() => setForm(null)} onSaved={() => { setForm(null); load() }} />}
    </>
  )
}

function OvertimeForm({ item, employees, range, onClose, onSaved }: { item: Overtime | null; employees: OvertimeRes['employees']; range: { dari: string; sampai: string }; onClose: () => void; onSaved: () => void }) {
  const [v, setV] = useState({ nip: item?.nip ?? '', tanggal: item?.tanggal ?? range.sampai, jam: item ? String(item.jam) : '', hari: item?.hari ?? 'kerja', mode: item?.mode ?? 'tambah', keterangan: item?.keterangan ?? '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function save(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    try {
      await api(item ? `/api/hrd/payroll/lembur/${item.id}` : '/api/hrd/payroll/lembur', { method: item ? 'PUT' : 'POST', json: v })
      onSaved()
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
    }
  }
  return (
    <Modal title={item ? 'Ubah lembur' : 'Input lembur variabel'} onClose={onClose}
      footer={<><span className="pap-spacer" /><button className="pap-btn" onClick={onClose}>Batal</button><button className="pap-primary-button" form="overtime-form" disabled={busy}><Clock /> Simpan</button></>}>
      <form id="overtime-form" className="pap-form-grid" onSubmit={save}>
        {error && <div className="full"><Notice onClose={() => setError('')}>{error}</Notice></div>}
        <Field label="Karyawan" full>
          <select className="pap-select" required value={v.nip} onChange={(e) => setV({ ...v, nip: e.target.value })}>
            <option value="">Pilih karyawan</option>
            {employees.map((e) => <option key={e.nip} value={e.nip}>{e.nama} ({e.nip}){e.jabatan ? ` · ${e.jabatan}` : ''}</option>)}
          </select>
        </Field>
        <Field label="Tanggal"><input className="pap-input" type="date" required value={v.tanggal} onChange={(e) => setV({ ...v, tanggal: e.target.value })} /></Field>
        <Field label="Jam lembur"><input className="pap-input pap-num" inputMode="decimal" required value={v.jam} onChange={(e) => setV({ ...v, jam: e.target.value })} placeholder="mis. 4" /></Field>
        <Field label="Tarif">
          <select className="pap-select" value={v.hari} onChange={(e) => setV({ ...v, hari: e.target.value as 'kerja' | 'libur' })}><option value="kerja">Lembur hari kerja (×1,2)</option><option value="libur">Lembur hari libur (×1,5)</option></select>
        </Field>
        <Field label="Lembur otomatis tanggal ini">
          <select className="pap-select" value={v.mode} onChange={(e) => setV({ ...v, mode: e.target.value as 'tambah' | 'ganti' })}><option value="tambah">Tetap dihitung (ditambah)</option><option value="ganti">Diganti dengan isian ini</option></select>
        </Field>
        <Field label="Keterangan" full><input className="pap-input" maxLength={500} value={v.keterangan} onChange={(e) => setV({ ...v, keterangan: e.target.value })} placeholder="mis. lembur bongkar muat, SPL no. ..." /></Field>
      </form>
    </Modal>
  )
}
