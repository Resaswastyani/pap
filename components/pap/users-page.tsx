'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { KeyRound, Pencil, Plus, Search, ShieldCheck, Trash2 } from 'lucide-react'
import type { UserProfile } from '@/lib/users'
import { api, Field, formatDate, Modal, Notice, PasswordInput } from './ui'

type Division = { id: number; code: string; name: string; has_levels: boolean }
type Role = { id: number; code: string; name: string; description: string | null; is_super_admin: boolean }
type ManagedUser = {
  id: number
  name: string
  email: string
  is_active: boolean
  last_login_at: string | null
  division_id: number
  division_name: string
  role_id: number
  role_code: string
  role_name: string
  is_super_admin: boolean
  override_count: number
}
type PermissionState = { id: number; code: string; name: string; module: string; from_role: boolean; override: 'inherit' | 'allow' | 'deny'; effective: boolean }

// Divisi tanpa Lead/Staff: role bawaannya
const DEFAULT_ROLE: Record<string, string> = { staff_it: 'super_admin', general_manager: 'admin', hrd: 'lead', general_affair: 'lead' }

export function UsersPage({ user }: { user: UserProfile }) {
  const [items, setItems] = useState<ManagedUser[]>([])
  const [divisions, setDivisions] = useState<Division[]>([])
  const [roles, setRoles] = useState<Role[]>([])
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [q, setQ] = useState('')
  const [division, setDivision] = useState('')
  const [form, setForm] = useState<ManagedUser | 'new' | null>(null)
  const [permUser, setPermUser] = useState<ManagedUser | null>(null)

  const load = useCallback(async () => {
    try {
      const [u, d, r] = await Promise.all([
        api<{ items: ManagedUser[] }>('/api/users'),
        api<{ items: Division[] }>('/api/divisions'),
        api<{ items: Role[] }>('/api/roles'),
      ])
      setItems(u.items)
      setDivisions(d.items)
      setRoles(r.items)
    } catch (e) {
      setError((e as Error).message)
    }
  }, [])
  useEffect(() => { load() }, [load])

  const flash = (text: string) => {
    setMessage(text)
    setTimeout(() => setMessage(''), 4000)
  }

  const visible = useMemo(() => {
    const term = q.trim().toLowerCase()
    return items.filter((item) => (!division || String(item.division_id) === division) && (!term || item.name.toLowerCase().includes(term) || item.email.includes(term)))
  }, [items, q, division])

  async function remove(target: ManagedUser) {
    if (!window.confirm(`Hapus user "${target.name}"? Tindakan ini tidak bisa dibatalkan.`)) return
    try {
      await api(`/api/users/${target.id}`, { method: 'DELETE' })
      flash('User dihapus.')
      load()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return (
    <>
      <div className="pap-page-heading">
        <div>
          <p className="pap-eyebrow">SISTEM</p>
          <h1>Manajemen User</h1>
          <span>Kelola akun, divisi, role, dan permission khusus per user.</span>
        </div>
        <button className="pap-primary-button" onClick={() => setForm('new')}><Plus /> Tambah user</button>
      </div>
      {message && <Notice kind="success" onClose={() => setMessage('')}>{message}</Notice>}
      {error && <Notice onClose={() => setError('')}>{error}</Notice>}
      <div className="pap-table-card">
        <div className="pap-card-head"><div><h2>Daftar user</h2><p>{items.length} akun · {items.filter((i) => i.is_active).length} aktif</p></div></div>
        <div className="pap-filters">
          <label className="pap-filter-search"><Search /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari nama atau email..." /></label>
          <select className="pap-select" value={division} onChange={(e) => setDivision(e.target.value)} aria-label="Filter divisi">
            <option value="">Semua divisi</option>
            {divisions.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </div>
        <div className="pap-table-wrap">
          <table>
            <thead><tr><th>Nama / Email</th><th>Divisi</th><th>Role</th><th>Status</th><th>Login terakhir</th><th aria-label="Aksi" /></tr></thead>
            <tbody>
              {visible.map((item) => (
                <tr key={item.id}>
                  <td><div className="pap-cell-title">{item.name}{item.id === user.id && <span className="pap-chip">Anda</span>}</div><div className="pap-cell-sub">{item.email}</div></td>
                  <td>{item.division_name}</td>
                  <td>
                    <span className={`pap-status ${item.is_super_admin ? 'danger' : item.role_code === 'admin' ? 'info' : item.role_code === 'lead' ? 'success' : 'neutral'}`}>{item.role_name}</span>
                    {item.override_count > 0 && <div className="pap-cell-sub">+{item.override_count} permission khusus</div>}
                  </td>
                  <td><span className={`pap-status ${item.is_active ? 'success' : 'neutral'}`}>{item.is_active ? 'Aktif' : 'Nonaktif'}</span></td>
                  <td className="pap-nowrap">{formatDate(item.last_login_at, true)}</td>
                  <td>
                    <div className="pap-row-actions">
                      <button className="pap-icon-button" title="Edit user" aria-label={`Edit ${item.name}`} onClick={() => setForm(item)}><Pencil /></button>
                      <button className="pap-icon-button" title="Permission user" aria-label={`Permission ${item.name}`} onClick={() => setPermUser(item)}><KeyRound /></button>
                      {item.id !== user.id && <button className="pap-icon-button danger" title="Hapus user" aria-label={`Hapus ${item.name}`} onClick={() => remove(item)}><Trash2 /></button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!visible.length && <div className="pap-empty">Tidak ada user yang cocok.</div>}
        </div>
      </div>
      {form && (
        <UserForm
          actor={user}
          initial={form === 'new' ? null : form}
          divisions={divisions}
          roles={user.role.isSuperAdmin ? roles : roles.filter((r) => !r.is_super_admin)}
          onClose={() => setForm(null)}
          onSaved={(text) => { setForm(null); flash(text); load() }}
        />
      )}
      {permUser && <UserPermissions target={permUser} onClose={() => setPermUser(null)} onSaved={() => { setPermUser(null); flash('Permission user disimpan.'); load() }} />}
    </>
  )
}

function UserForm({ actor, initial, divisions, roles, onClose, onSaved }: { actor: UserProfile; initial: ManagedUser | null; divisions: Division[]; roles: Role[]; onClose: () => void; onSaved: (message: string) => void }) {
  const [values, setValues] = useState({
    name: initial?.name ?? '',
    email: initial?.email ?? '',
    password: '',
    division_id: String(initial?.division_id ?? divisions.find((d) => d.code === 'marketing')?.id ?? divisions[0]?.id ?? ''),
    role_id: String(initial?.role_id ?? roles.find((r) => r.code === 'staff')?.id ?? ''),
    is_active: initial?.is_active ?? true,
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const self = initial?.id === actor.id
  const selectedDivision = divisions.find((d) => String(d.id) === values.division_id)

  function changeDivision(id: string) {
    const division = divisions.find((d) => String(d.id) === id)
    const roleCode = division && DEFAULT_ROLE[division.code]
    const role = roleCode && roles.find((r) => r.code === roleCode)
    setValues((v) => ({ ...v, division_id: id, role_id: role ? String(role.id) : v.role_id }))
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError('')
    try {
      const payload: Record<string, unknown> = { name: values.name, email: values.email, division_id: Number(values.division_id), role_id: Number(values.role_id), is_active: values.is_active }
      if (values.password) payload.password = values.password
      if (initial) await api(`/api/users/${initial.id}`, { method: 'PATCH', json: payload })
      else await api('/api/users', { method: 'POST', json: payload })
      onSaved(initial ? 'User diperbarui.' : 'User ditambahkan.')
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      title={initial ? 'Edit user' : 'Tambah user'}
      subtitle={initial?.email}
      onClose={onClose}
      footer={<><button type="button" className="pap-btn" onClick={onClose}>Batal</button><button type="submit" form="user-form" className="pap-primary-button" disabled={saving}>{saving ? 'Menyimpan...' : 'Simpan'}</button></>}
    >
      <form id="user-form" className="pap-form-grid" onSubmit={submit}>
        {error && <div className="full"><Notice onClose={() => setError('')}>{error}</Notice></div>}
        <Field label="Nama lengkap"><input className="pap-input" required maxLength={100} value={values.name} onChange={(e) => setValues((v) => ({ ...v, name: e.target.value }))} /></Field>
        <Field label="Email"><input className="pap-input" type="email" required value={values.email} onChange={(e) => setValues((v) => ({ ...v, email: e.target.value }))} /></Field>
        <Field label={initial ? 'Password baru' : 'Password'} hint={initial ? 'Kosongkan bila tidak diganti. Minimal 8 karakter.' : 'Minimal 8 karakter.'} full>
          <PasswordInput autoComplete="new-password" required={!initial} minLength={8} value={values.password} onChange={(e) => setValues((v) => ({ ...v, password: e.target.value }))} />
        </Field>
        <Field label="Divisi">
          <select className="pap-select" value={values.division_id} onChange={(e) => changeDivision(e.target.value)}>
            {divisions.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </Field>
        <Field label="Role" hint={selectedDivision && !selectedDivision.has_levels ? 'Divisi ini tidak memiliki level Lead/Staff.' : roles.find((r) => String(r.id) === values.role_id)?.description ?? undefined}>
          <select className="pap-select" value={values.role_id} onChange={(e) => setValues((v) => ({ ...v, role_id: e.target.value }))} disabled={self}>
            {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </Field>
        <label className="pap-check full">
          <input type="checkbox" checked={values.is_active} disabled={self} onChange={(e) => setValues((v) => ({ ...v, is_active: e.target.checked }))} />
          <span>Akun aktif (bisa login)</span>
        </label>
      </form>
    </Modal>
  )
}

function UserPermissions({ target, onClose, onSaved }: { target: ManagedUser; onClose: () => void; onSaved: () => void }) {
  const [items, setItems] = useState<PermissionState[]>([])
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    api<{ items: PermissionState[] }>(`/api/users/${target.id}/permissions`).then((res) => setItems(res.items)).catch((e) => setError(e.message))
  }, [target.id])

  const setOverride = (code: string, override: PermissionState['override']) =>
    setItems((list) => list.map((p) => (p.code === code ? { ...p, override, effective: override === 'inherit' ? p.from_role : override === 'allow' } : p)))

  async function save() {
    setSaving(true)
    try {
      await api(`/api/users/${target.id}/permissions`, { method: 'PUT', json: { overrides: Object.fromEntries(items.map((p) => [p.code, p.override])) } })
      onSaved()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      wide
      title={`Permission: ${target.name}`}
      subtitle={`${target.role_name} · ${target.division_name}`}
      onClose={onClose}
      footer={target.is_super_admin ? <button className="pap-btn" onClick={onClose}>Tutup</button> : <><button className="pap-btn" onClick={onClose}>Batal</button><button className="pap-primary-button" disabled={saving} onClick={save}>{saving ? 'Menyimpan...' : 'Simpan permission'}</button></>}
    >
      {error && <Notice onClose={() => setError('')}>{error}</Notice>}
      {target.is_super_admin ? (
        <div className="pap-note"><strong><ShieldCheck className="pap-inline-icon" /> Super Admin</strong><p>Akun ini selalu memiliki akses ke semua menu dan permission.</p></div>
      ) : (
        <p className="pap-hint">Default mengikuti role <strong>{target.role_name}</strong>. Pilih <em>Izinkan</em> untuk menambah akses atau <em>Cabut</em> untuk menghapus akses khusus user ini.</p>
      )}
      <div className="pap-table-wrap bordered">
        <table className="pap-perm-table">
          <thead><tr><th>Permission</th><th>Dari role</th><th>Pengaturan user</th><th>Hasil</th></tr></thead>
          <tbody>
            {items.map((p) => (
              <tr key={p.code}>
                <td><div className="pap-cell-title">{p.name}</div><div className="pap-cell-sub">{p.module} · {p.code}</div></td>
                <td>{p.from_role ? <span className="pap-status success">Ya</span> : <span className="pap-status neutral">Tidak</span>}</td>
                <td>
                  <select className="pap-select" value={p.override} disabled={target.is_super_admin} onChange={(e) => setOverride(p.code, e.target.value as PermissionState['override'])} aria-label={`Pengaturan ${p.name}`}>
                    <option value="inherit">Ikuti role</option>
                    <option value="allow">Izinkan</option>
                    <option value="deny">Cabut</option>
                  </select>
                </td>
                <td>{p.effective ? <span className="pap-status success">Punya akses</span> : <span className="pap-status danger">Tidak</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Modal>
  )
}
