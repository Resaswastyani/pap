'use client'

import { useState } from 'react'
import { Briefcase, Save, UserRound, Wallet } from 'lucide-react'
import { api, Field, Modal, Notice } from './ui'

// Form tambah / ubah karyawan oleh HRD: Data Diri, Pekerjaan, Payroll (mengikuti form HRIS Altius)
export type EmployeeOption = { nip: string; nama: string; jabatan: string | null; divisi: string | null; departemen: string | null; level_posisi: string | null; hari_kerja: string | null; status_karyawan: string | null; tgl_berhenti: string | null }
type Values = Record<string, string>
type Tab = 'diri' | 'pekerjaan' | 'payroll'

const GOL_DARAH = ['A', 'B', 'AB', 'O']
const TIPE_ID = ['KTP', 'SIM', 'Paspor', 'KITAS']
const JENIS_KELAMIN = ['PRIA', 'WANITA']
const STATUS_MENIKAH = ['Belum Menikah', 'Menikah', 'Cerai Hidup', 'Cerai Mati']
const AGAMA = ['ISLAM', 'Kristen', 'Katolik', 'Hindu', 'Buddha', 'Konghucu']
const PENDIDIKAN = ['SD', 'SMP', 'SMA', 'SMK', 'D1', 'D2', 'D3', 'D4', 'S1', 'S2', 'S3']
const STATUS_KERJA = ['Tetap', 'Kontrak', 'Masa Percobaan', 'Harian', 'Magang', 'Resign']
const STATUS_PAJAK = ['TK/0', 'TK/1', 'TK/2', 'TK/3', 'K/0', 'K/1', 'K/2', 'K/3', 'K/I/0', 'K/I/1', 'K/I/2', 'K/I/3']
const BANK = ['CIMB', 'BCA', 'BRI', 'BNI', 'MANDIRI', 'BSI', 'BTN', 'DANAMON', 'PERMATA']
const KEYS = ['nip', 'id_finger', 'nama_depan', 'nama_belakang', 'email', 'handphone', 'tempat_lahir', 'tgl_lahir', 'golongan_darah', 'tipe_id', 'no_id', 'tgl_akhir_id',
  'jenis_kelamin', 'status_menikah', 'agama', 'nama_ibu', 'jumlah_anak', 'kontak_darurat', 'hp_darurat', 'pendidikan_jenjang', 'pendidikan_tempat', 'pendidikan_jurusan',
  'kode_pos', 'alamat_id', 'alamat_tinggal', 'tgl_masuk', 'departemen', 'divisi', 'jabatan', 'level_posisi', 'nip_atasan', 'hari_kerja', 'status_karyawan',
  'tgl_akhir_kontrak', 'tgl_akhir_percobaan', 'tgl_berhenti', 'no_bpjs_tk', 'no_bpjs_kes', 'npwp', 'status_pajak', 'bank', 'no_rek', 'rek_an']
// Kolom wajib (tanda * di form); dicek per tab agar HRD langsung dibawa ke tab yang belum lengkap
const REQUIRED: Record<Tab, [string, string][]> = {
  diri: [['nip', 'Nomor Induk Pegawai'], ['nama_depan', 'Nama depan']],
  pekerjaan: [['tgl_masuk', 'Tanggal bergabung'], ['status_karyawan', 'Status pekerjaan']],
  payroll: [],
}

const fromItem = (item: Record<string, unknown> | null): Values => {
  const v: Values = Object.fromEntries(KEYS.map((k) => [k, item?.[k] == null ? '' : String(item[k]).slice(0, k.startsWith('tgl_') ? 10 : undefined)]))
  if (item) {
    // Data dari spreadsheet: nama belum dipisah, pendidikan "Jenjang · Tempat · Jurusan"
    if (!v.nama_depan) v.nama_depan = String(item.nama ?? '')
    const [jenjang = '', tempat = '', jurusan = ''] = String(item.pendidikan ?? '').split(' · ')
    Object.assign(v, { pendidikan_jenjang: jenjang, pendidikan_tempat: tempat, pendidikan_jurusan: jurusan })
  } else {
    Object.assign(v, { tipe_id: 'KTP', status_karyawan: 'Masa Percobaan', hari_kerja: 'Senin - Sabtu', bank: 'CIMB', status_pajak: 'TK/0' })
  }
  return v
}

const uniq = (list: (string | null | undefined)[]) => [...new Set(list.filter((x): x is string => !!x && x !== '-'))].sort()

export function EmployeeForm({ item, employees, onClose, onSaved }: { item: Record<string, unknown> | null; employees: EmployeeOption[]; onClose: () => void; onSaved: (text: string) => void }) {
  const [tab, setTab] = useState<Tab>('diri')
  const [v, setV] = useState<Values>(() => fromItem(item))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setV((cur) => ({ ...cur, [k]: e.target.value }))
  const atasan = employees.filter((e) => !e.tgl_berhenti && !/resign/i.test(e.status_karyawan ?? '') && e.nip !== item?.nip).sort((a, b) => a.nama.localeCompare(b.nama))
  const lists = {
    departemen: uniq(employees.map((e) => e.departemen)), divisi: uniq(employees.map((e) => e.divisi)), jabatan: uniq(employees.map((e) => e.jabatan)),
    level: uniq(['Staff', 'Junior', 'Senior', 'Supervisor', 'Head', 'Manager', ...employees.map((e) => e.level_posisi)]), hari: uniq(['Senin - Sabtu', 'Senin - Jumat', 'Senin - Minggu (Shift)', ...employees.map((e) => e.hari_kerja)]),
  }
  const isNew = !item

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    for (const t of ['diri', 'pekerjaan', 'payroll'] as Tab[]) {
      const missing = REQUIRED[t].find(([k]) => !v[k]?.trim())
      if (missing) { setTab(t); setError(`${missing[1]} wajib diisi.`); return }
    }
    setBusy(true)
    setError('')
    try {
      if (isNew) await api('/api/hrd/employees', { method: 'POST', json: v })
      else await api(`/api/hrd/employees/${item.id}`, { method: 'PUT', json: v })
      const nama = [v.nama_depan, v.nama_belakang].filter(Boolean).join(' ')
      onSaved(isNew ? `Karyawan ${nama} ditambahkan.` : `Data ${nama} diperbarui.`)
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
    }
  }

  const input = (k: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => <input className="pap-input" value={v[k]} onChange={set(k)} {...props} />
  const select = (k: string, options: string[], placeholder: string) => (
    <select className="pap-select" value={v[k]} onChange={set(k)}>
      <option value="">{placeholder}</option>
      {v[k] && !options.includes(v[k]) && <option value={v[k]}>{v[k]}</option>}
      {options.map((o) => <option key={o} value={o}>{o}</option>)}
    </select>
  )
  const free = (k: string, options: string[], props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <><input className="pap-input" list={`emp-${k}`} value={v[k]} onChange={set(k)} {...props} /><datalist id={`emp-${k}`}>{options.map((o) => <option key={o} value={o} />)}</datalist></>
  )

  return (
    <Modal wide title={isNew ? 'Tambah karyawan' : `Ubah data ${String(item.nama)}`} subtitle={isNew ? 'Kolom bertanda * wajib diisi' : 'Setelah disimpan, data karyawan ini dikelola di PAP-MS dan tidak ditimpa sinkron spreadsheet.'} onClose={onClose}
      footer={<><span className="pap-spacer" /><button className="pap-btn" onClick={onClose}>Batal</button><button className="pap-primary-button" form="employee-form" disabled={busy}><Save /> {busy ? 'Menyimpan...' : 'Simpan'}</button></>}>
      <div className="pap-segmented pap-page-tabs" role="tablist" aria-label="Bagian form karyawan">
        <button type="button" role="tab" aria-selected={tab === 'diri'} className={tab === 'diri' ? 'active' : ''} onClick={() => setTab('diri')}><UserRound /> Data Diri</button>
        <button type="button" role="tab" aria-selected={tab === 'pekerjaan'} className={tab === 'pekerjaan' ? 'active' : ''} onClick={() => setTab('pekerjaan')}><Briefcase /> Pekerjaan</button>
        <button type="button" role="tab" aria-selected={tab === 'payroll'} className={tab === 'payroll' ? 'active' : ''} onClick={() => setTab('payroll')}><Wallet /> Payroll</button>
      </div>
      {error && <Notice onClose={() => setError('')}>{error}</Notice>}
      <form id="employee-form" className="pap-form-grid pap-employee-form" onSubmit={submit} noValidate>
        {tab === 'diri' && <>
          <Field label="Nomor Induk Pegawai *">{input('nip', { maxLength: 30, autoFocus: isNew })}</Field>
          <Field label="Nomor ID Finger">{input('id_finger', { maxLength: 40 })}</Field>
          <Field label="Nama depan *">{input('nama_depan', { maxLength: 100 })}</Field>
          <Field label="Nama belakang">{input('nama_belakang', { maxLength: 100 })}</Field>
          <Field label="Email">{input('email', { type: 'email', maxLength: 255 })}</Field>
          <Field label="Handphone">{input('handphone', { type: 'tel', maxLength: 40 })}</Field>
          <Field label="Tempat lahir">{input('tempat_lahir', { maxLength: 100 })}</Field>
          <Field label="Tanggal lahir">{input('tgl_lahir', { type: 'date' })}</Field>
          <Field label="Golongan darah">{select('golongan_darah', GOL_DARAH, 'Pilih golongan')}</Field>
          <Field label="Tipe identitas">{select('tipe_id', TIPE_ID, 'Pilih identitas')}</Field>
          <Field label="No identitas">{input('no_id', { maxLength: 40, inputMode: 'numeric' })}</Field>
          <Field label="Berakhir identitas" hint="Kosongkan bila berlaku seumur hidup">{input('tgl_akhir_id', { type: 'date' })}</Field>
          <Field label="Jenis kelamin">{select('jenis_kelamin', JENIS_KELAMIN, 'Pilih jenis kelamin')}</Field>
          <Field label="Status menikah">{select('status_menikah', STATUS_MENIKAH, 'Pilih status')}</Field>
          <Field label="Agama">{select('agama', AGAMA, 'Pilih agama')}</Field>
          <Field label="Nama ibu kandung">{input('nama_ibu', { maxLength: 150 })}</Field>
          <Field label="Jumlah anak">{input('jumlah_anak', { type: 'number', min: 0, max: 30 })}</Field>
          <Field label="Nama kontak darurat">{input('kontak_darurat', { maxLength: 150 })}</Field>
          <Field label="Nomor HP darurat">{input('hp_darurat', { type: 'tel', maxLength: 40 })}</Field>
          <Field label="Pendidikan terakhir">{select('pendidikan_jenjang', PENDIDIKAN, 'Pilih pendidikan')}</Field>
          <Field label="Tempat pendidikan">{input('pendidikan_tempat', { maxLength: 100 })}</Field>
          <Field label="Jurusan pendidikan">{input('pendidikan_jurusan', { maxLength: 100 })}</Field>
          <Field label="Kode pos">{input('kode_pos', { maxLength: 10, inputMode: 'numeric' })}</Field>
          <Field label="Alamat identitas" full><textarea className="pap-input" rows={3} maxLength={1000} value={v.alamat_id} onChange={set('alamat_id')} /></Field>
          <Field label="Alamat tinggal" full><textarea className="pap-input" rows={3} maxLength={1000} value={v.alamat_tinggal} onChange={set('alamat_tinggal')} placeholder="Kosongkan bila sama dengan alamat identitas" /></Field>
        </>}
        {tab === 'pekerjaan' && <>
          <Field label="Tanggal bergabung *">{input('tgl_masuk', { type: 'date' })}</Field>
          <Field label="Status pekerjaan *">{select('status_karyawan', STATUS_KERJA, 'Pilih status')}</Field>
          <Field label="Departemen">{free('departemen', lists.departemen, { maxLength: 100 })}</Field>
          <Field label="Divisi">{free('divisi', lists.divisi, { maxLength: 100 })}</Field>
          <Field label="Jabatan">{free('jabatan', lists.jabatan, { maxLength: 100 })}</Field>
          <Field label="Level pekerjaan">{free('level_posisi', lists.level, { maxLength: 60 })}</Field>
          <Field label="Atasan langsung">
            <select className="pap-select" value={v.nip_atasan} onChange={set('nip_atasan')}>
              <option value="">Pilih atasan</option>
              {atasan.map((e) => <option key={e.nip} value={e.nip}>{e.nama}{e.jabatan ? ` · ${e.jabatan}` : ''}</option>)}
            </select>
          </Field>
          <Field label="Hari kerja">{free('hari_kerja', lists.hari, { maxLength: 80 })}</Field>
          <Field label="Akhir masa percobaan">{input('tgl_akhir_percobaan', { type: 'date' })}</Field>
          <Field label="Berakhir kontrak">{input('tgl_akhir_kontrak', { type: 'date' })}</Field>
          <Field label="Tanggal berhenti" hint="Diisi bila karyawan resign / keluar">{input('tgl_berhenti', { type: 'date' })}</Field>
        </>}
        {tab === 'payroll' && <>
          <Field label="BPJS Ketenagakerjaan">{input('no_bpjs_tk', { maxLength: 40, inputMode: 'numeric' })}</Field>
          <Field label="BPJS Kesehatan">{input('no_bpjs_kes', { maxLength: 40, inputMode: 'numeric' })}</Field>
          <Field label="NPWP">{input('npwp', { maxLength: 40 })}</Field>
          <Field label="Status pajak (PTKP)">{select('status_pajak', STATUS_PAJAK, 'Pilih status')}</Field>
          <Field label="Nama bank">{free('bank', BANK, { maxLength: 80 })}</Field>
          <Field label="No rekening bank">{input('no_rek', { maxLength: 60, inputMode: 'numeric' })}</Field>
          <Field label="Nama pemilik rekening" full>{input('rek_an', { maxLength: 150, placeholder: [v.nama_depan, v.nama_belakang].filter(Boolean).join(' ') || undefined })}</Field>
        </>}
      </form>
    </Modal>
  )
}
