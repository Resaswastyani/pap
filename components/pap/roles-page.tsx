'use client'

import { useCallback, useEffect, useState } from 'react'
import { LayoutList, Save, ShieldCheck } from 'lucide-react'
import { DivisionMenus } from './division-menus'
import { api, Notice } from './ui'

type Role = { id: number; code: string; name: string; description: string | null; is_admin: boolean; is_super_admin: boolean; user_count: number; permissions: string[] }
type Permission = { id: number; code: string; name: string; module: string }

function RolePermissions() {
  const [roles, setRoles] = useState<Role[]>([])
  const [permissions, setPermissions] = useState<Permission[]>([])
  const [draft, setDraft] = useState<Record<number, Set<string>>>({})
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await api<{ items: Role[]; permissions: Permission[] }>('/api/roles')
      setRoles(res.items)
      setPermissions(res.permissions)
      setDraft(Object.fromEntries(res.items.map((r) => [r.id, new Set(r.permissions)])))
    } catch (e) {
      setError((e as Error).message)
    }
  }, [])
  useEffect(() => { load() }, [load])

  const changed = roles.filter((r) => !r.is_super_admin && draft[r.id] && (draft[r.id].size !== r.permissions.length || r.permissions.some((p) => !draft[r.id].has(p))))

  function toggle(roleId: number, code: string) {
    setDraft((d) => {
      const next = new Set(d[roleId])
      if (next.has(code)) next.delete(code)
      else next.add(code)
      return { ...d, [roleId]: next }
    })
  }

  async function save() {
    setSaving(true)
    setError('')
    try {
      for (const role of changed) await api(`/api/roles/${role.id}`, { method: 'PATCH', json: { permissions: [...draft[role.id]] } })
      setMessage(`Permission ${changed.map((r) => r.name).join(', ')} disimpan. Berlaku saat user membuka ulang aplikasi.`)
      setTimeout(() => setMessage(''), 5000)
      await load()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const modules = [...new Set(permissions.map((p) => p.module))]

  return (
    <>
      <div className="pap-page-heading">
        <div>
          <p className="pap-eyebrow">SISTEM</p>
          <h1>Manajemen Role</h1>
          <span>Atur permission bawaan setiap role. Permission khusus per user diatur di Manajemen User.</span>
        </div>
        <button className="pap-primary-button" disabled={!changed.length || saving} onClick={save}><Save /> {saving ? 'Menyimpan...' : changed.length ? `Simpan (${changed.length} role)` : 'Simpan'}</button>
      </div>
      {message && <Notice kind="success" onClose={() => setMessage('')}>{message}</Notice>}
      {error && <Notice onClose={() => setError('')}>{error}</Notice>}
      <div className="pap-role-grid">
        {roles.map((role) => (
          <div className="pap-role-card" key={role.id}>
            <span className={`pap-status ${role.is_super_admin ? 'danger' : role.is_admin ? 'info' : role.code === 'lead' ? 'success' : 'neutral'}`}>{role.name}</span>
            <p>{role.description}</p>
            <small>{role.user_count} user · {role.is_super_admin ? 'semua' : draft[role.id]?.size ?? 0} permission</small>
          </div>
        ))}
      </div>
      <div className="pap-table-card">
        <div className="pap-card-head"><div><h2>Matriks permission</h2><p>Centang permission yang dimiliki tiap role. Super Admin selalu memiliki semua permission.</p></div></div>
        <div className="pap-table-wrap">
          <table className="pap-perm-table">
            <thead>
              <tr><th>Permission</th>{roles.map((r) => <th key={r.id} className="center">{r.name}</th>)}</tr>
            </thead>
            <tbody>
              {modules.map((module) => [
                <tr key={module} className="pap-group-row"><td colSpan={roles.length + 1}>{module}</td></tr>,
                ...permissions.filter((p) => p.module === module).map((p) => (
                  <tr key={p.code}>
                    <td><div className="pap-cell-title">{p.name}</div><div className="pap-cell-sub">{p.code}</div></td>
                    {roles.map((r) => (
                      <td key={r.id} className="center">
                        <input
                          type="checkbox"
                          className="pap-checkbox"
                          checked={r.is_super_admin || !!draft[r.id]?.has(p.code)}
                          disabled={r.is_super_admin}
                          onChange={() => toggle(r.id, p.code)}
                          aria-label={`${p.name} untuk ${r.name}`}
                        />
                      </td>
                    ))}
                  </tr>
                )),
              ])}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}

// Manajemen Role: permission per role dan menu per divisi
export function RolesPage() {
  const [view, setView] = useState<'permission' | 'menu'>('permission')
  return (
    <>
      <div className="pap-segmented pap-view-switch" role="tablist" aria-label="Tampilan Manajemen Role">
        <button role="tab" aria-selected={view === 'permission'} className={view === 'permission' ? 'active' : ''} onClick={() => setView('permission')}><ShieldCheck /> Permission role</button>
        <button role="tab" aria-selected={view === 'menu'} className={view === 'menu' ? 'active' : ''} onClick={() => setView('menu')}><LayoutList /> Menu per divisi</button>
      </div>
      {view === 'permission' ? <RolePermissions /> : (
        <>
          <div className="pap-page-heading">
            <div>
              <p className="pap-eyebrow">SISTEM</p>
              <h1>Menu per Divisi</h1>
              <span>Atur menu yang tampil untuk tiap divisi, mis. Marketing Digital, Development, dan Maintenance dibedakan sesuai tugasnya.</span>
            </div>
          </div>
          <DivisionMenus />
        </>
      )}
    </>
  )
}
