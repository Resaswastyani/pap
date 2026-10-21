'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Gauge, Pencil, Plus, Printer, Search, Trash2 } from 'lucide-react'
import type { UserProfile } from '@/lib/users'
import { api, Field, formatDate, Modal, Notice } from './ui'

type Machine = { id: number; kode: string; nama: string; tahap: string | null; lini: string | null; status: string; parameter: number; kelompok: number; diubah: string | null }
type Setting = { id: number; machine_id: number; produk: string | null; parameter: string; nilai: string; satuan: string | null; toleransi: string | null; urut: number; catatan: string | null; updated_at: string; updated_name: string | null }

export function SettingPage(_props: { user: UserProfile }) {
  const [machines, setMachines] = useState<Machine[]>([])
  const [machineId, setMachineId] = useState<number | null>(null)
  const [items, setItems] = useState<Setting[]>([])
  const [can, setCan] = useState({ manage: false })
  const [q, setQ] = useState('')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [form, setForm] = useState<{ setting: Setting | null; produk: string } | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await api<{ machines: Machine[]; items: Setting[]; can: typeof can }>(`/api/machine-settings${machineId ? `?machine=${machineId}` : ''}`)
      setMachines(res.machines)
      setItems(res.items)
      setCan(res.can)
      if (!machineId && res.machines.length) setMachineId((res.machines.find((m) => m.parameter) ?? res.machines[0]).id)
      setError('')
    } catch (e) {
      setError((e as Error).message)
    }
  }, [machineId])
  useEffect(() => { load() }, [load])
  const flash = (text: string) => {
    setMessage(text)
    setTimeout(() => setMessage(''), 4000)
    load()
  }

  const machine = machines.find((m) => m.id === machineId) ?? null
  const term = q.trim().toLowerCase()
  const visible = useMemo(() => items.filter((s) => !term || [s.parameter, s.produk, s.catatan].some((v) => v?.toLowerCase().includes(term))), [items, term])
  const groups = [...new Set(visible.map((s) => s.produk ?? ''))]

  async function remove(s: Setting) {
    if (!window.confirm(`Hapus parameter "${s.parameter}"?`)) return
    try {
      await api(`/api/machine-settings/${s.id}`, { method: 'DELETE' })
      flash('Parameter dihapus.')
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return (
    <>
      <div className="pap-page-heading">
        <div>
          <p className="pap-eyebrow">TEKNIK</p>
          <h1>Standar Setting Mesin</h1>
          <span>Standar setting penggunaan tiap mesin (suhu, kecepatan, tekanan, dll.) sebagai acuan operator. Parameter bisa berlaku umum atau khusus produk / ukuran tertentu, dan bisa dicetak.</span>
        </div>
        <div className="pap-inline-actions pap-wrap">
          {machine && <a className="pap-btn" href={`/cetak/standar-setting?mesin=${machine.id}`} target="_blank" rel="noreferrer"><Printer /> Cetak mesin ini</a>}
          <a className="pap-btn" href="/cetak/standar-setting" target="_blank" rel="noreferrer"><Printer /> Cetak semua</a>
          {can.manage && machine && <button className="pap-primary-button" onClick={() => setForm({ setting: null, produk: '' })}><Plus /> Tambah parameter</button>}
        </div>
      </div>
      {message && <Notice kind="success" onClose={() => setMessage('')}>{message}</Notice>}
      {error && <Notice onClose={() => setError('')}>{error}</Notice>}

      <div className="pap-setting-layout">
        <nav className="pap-setting-machines" aria-label="Pilih mesin">
          {machines.map((m) => (
            <button key={m.id} className={m.id === machineId ? 'active' : ''} onClick={() => setMachineId(m.id)}>
              <Gauge />
              <span><strong>{m.nama}</strong><small>{m.parameter ? `${m.parameter} parameter${m.kelompok > 1 ? ` · ${m.kelompok} kelompok` : ''}` : 'Belum ada setting'}</small></span>
            </button>
          ))}
          {!machines.length && <p className="pap-muted">Belum ada data mesin. Tambahkan di menu Data Mesin.</p>}
        </nav>

        <div className="pap-table-card">
          {machine && (
            <div className="pap-card-head">
              <div>
                <h2>{machine.nama}</h2>
                <p>{[machine.kode, machine.tahap, machine.lini].filter(Boolean).join(' · ')}{machine.diubah ? ` · diperbarui ${formatDate(machine.diubah, true)}` : ''}</p>
              </div>
              <label className="pap-filter-search"><Search /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari parameter / produk..." /></label>
            </div>
          )}
          {groups.map((g) => (
            <section key={g || 'umum'} className="pap-setting-group">
              <div className="pap-section-head">
                <h3>{g ? `Khusus: ${g}` : 'Setting umum'}</h3>
                {can.manage && <button className="pap-btn" onClick={() => setForm({ setting: null, produk: g })}><Plus /> Parameter</button>}
              </div>
              <div className="pap-table-wrap">
                <table>
                  <thead><tr><th>Parameter</th><th>Nilai standar</th><th>Toleransi</th><th>Catatan</th>{can.manage && <th aria-label="Aksi" />}</tr></thead>
                  <tbody>
                    {visible.filter((s) => (s.produk ?? '') === g).map((s) => (
                      <tr key={s.id}>
                        <td><div className="pap-cell-title">{s.parameter}</div></td>
                        <td className="pap-nowrap"><strong>{s.nilai}</strong> {s.satuan}</td>
                        <td className="pap-nowrap">{s.toleransi ?? '—'}</td>
                        <td>{s.catatan ?? ''}{s.updated_name && <div className="pap-cell-sub">{s.updated_name} · {formatDate(s.updated_at)}</div>}</td>
                        {can.manage && (
                          <td><div className="pap-row-actions">
                            <button className="pap-icon-button" aria-label={`Ubah ${s.parameter}`} onClick={() => setForm({ setting: s, produk: s.produk ?? '' })}><Pencil /></button>
                            <button className="pap-icon-button danger" aria-label={`Hapus ${s.parameter}`} onClick={() => remove(s)}><Trash2 /></button>
                          </div></td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ))}
          {machine && !visible.length && <div className="pap-empty">{items.length ? 'Tidak ada parameter yang cocok.' : can.manage ? 'Belum ada standar setting untuk mesin ini. Tambahkan parameter pertama.' : 'Belum ada standar setting untuk mesin ini.'}</div>}
        </div>
      </div>
      {form && machine && <SettingForm machine={machine} setting={form.setting} produk={form.produk} groups={[...new Set(items.map((s) => s.produk).filter((p): p is string => !!p))]} onClose={() => setForm(null)} onSaved={(text) => { setForm(null); flash(text) }} />}
    </>
  )
}

function SettingForm({ machine, setting, produk, groups, onClose, onSaved }: { machine: Machine; setting: Setting | null; produk: string; groups: string[]; onClose: () => void; onSaved: (text: string) => void }) {
  const [values, setValues] = useState({
    produk: setting?.produk ?? produk, parameter: setting?.parameter ?? '', nilai: setting?.nilai ?? '', satuan: setting?.satuan ?? '', toleransi: setting?.toleransi ?? '', catatan: setting?.catatan ?? '',
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const set = (k: keyof typeof values) => (e: { target: { value: string } }) => setValues((v) => ({ ...v, [k]: e.target.value }))
  async function submit(e: React.FormEvent, again = false) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await api(setting ? `/api/machine-settings/${setting.id}` : '/api/machine-settings', { method: setting ? 'PATCH' : 'POST', json: { ...values, machine_id: machine.id } })
      if (again) setValues((v) => ({ ...v, parameter: '', nilai: '', satuan: '', toleransi: '', catatan: '' }))
      else onSaved(setting ? 'Parameter diperbarui.' : 'Parameter ditambahkan.')
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal
      title={setting ? 'Ubah parameter' : 'Tambah parameter setting'}
      subtitle={machine.nama}
      onClose={onClose}
      footer={<>
        <span className="pap-spacer" />
        <button className="pap-btn" onClick={onClose}>{setting ? 'Batal' : 'Selesai'}</button>
        {!setting && <button className="pap-btn" disabled={busy} onClick={(e) => submit(e, true)}>Simpan &amp; tambah lagi</button>}
        <button className="pap-primary-button" form="setting-form" disabled={busy}>{busy ? 'Menyimpan...' : 'Simpan'}</button>
      </>}
    >
      <form id="setting-form" className="pap-form-grid" onSubmit={(e) => submit(e)}>
        {error && <div className="full"><Notice onClose={() => setError('')}>{error}</Notice></div>}
        <Field label="Berlaku untuk produk (opsional)" hint="Kosongkan untuk setting umum mesin ini." full>
          <input className="pap-input" list="pap-setting-produk" maxLength={200} value={values.produk} onChange={set('produk')} placeholder="Mis. Kantong PP 40x60, HD tebal 50 mikron" />
          <datalist id="pap-setting-produk">{groups.map((g) => <option key={g} value={g} />)}</datalist>
        </Field>
        <Field label="Parameter" full><input className="pap-input" required maxLength={150} value={values.parameter} onChange={set('parameter')} placeholder="Mis. Suhu zona 1, Kecepatan screw, Tekanan angin" /></Field>
        <Field label="Nilai standar"><input className="pap-input" required maxLength={100} value={values.nilai} onChange={set('nilai')} placeholder="180" /></Field>
        <Field label="Satuan"><input className="pap-input" list="pap-setting-satuan" maxLength={40} value={values.satuan} onChange={set('satuan')} placeholder="°C, rpm, bar" /></Field>
        <datalist id="pap-setting-satuan">{['°C', 'rpm', 'bar', 'Hz', 'm/menit', 'kg/jam', 'mm', 'mikron', '%'].map((s) => <option key={s} value={s} />)}</datalist>
        <Field label="Toleransi (opsional)"><input className="pap-input" maxLength={60} value={values.toleransi} onChange={set('toleransi')} placeholder="± 5" /></Field>
        <Field label="Catatan (opsional)" full><input className="pap-input" maxLength={500} value={values.catatan} onChange={set('catatan')} /></Field>
      </form>
    </Modal>
  )
}
