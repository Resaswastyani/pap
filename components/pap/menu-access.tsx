'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Copy, Eye, Pencil, Plus, RotateCcw, Save, Search, ShieldCheck, Trash2, Undo2 } from 'lucide-react'
import { api, confirmDialog, Notice } from './ui'

// Matriks akses Menu x Aksi per role: centang = diizinkan. Bawaan semua diizinkan; tim IT mencabut seperlunya.
// Ditegakkan di server untuk semua modul (Lihat = menu tampil; Tambah / Ubah / Hapus = setiap simpan / ubah / hapus).
type Action = 'view' | 'create' | 'update' | 'delete'
type Item = { key: string; label: string; actions: Action[] }
type Group = { label: string; items: Item[] }
type Role = { id: number; code: string; name: string; description: string | null; is_admin: boolean; is_super_admin: boolean; users: number; denied: string[] }
type Data = { actions: Record<Action, string>; groups: Group[]; divisions: Record<string, string[]>; roles: Role[] }

const ACTIONS: Action[] = ['view', 'create', 'update', 'delete']
const ICON = { view: Eye, create: Plus, update: Pencil, delete: Trash2 } as const

export function MenuAccess() {
  const [data, setData] = useState<Data | null>(null)
  const [roleId, setRoleId] = useState<number | null>(null)
  const [draft, setDraft] = useState<Record<number, Set<string>>>({})
  const [q, setQ] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    try {
      const d = await api<Data>('/api/roles/menu-access')
      setData(d)
      setDraft(Object.fromEntries(d.roles.map((r) => [r.id, new Set(r.denied)])))
      setRoleId((cur) => cur ?? d.roles.find((r) => !r.is_super_admin)?.id ?? null)
      setError('')
    } catch (e) {
      setError((e as Error).message)
    }
  }, [])
  // aislop-ignore-next-line react/set-state-in-effect -- memuat data matriks dari server sekali saat dibuka
  useEffect(() => { load() }, [load])

  const role = data?.roles.find((r) => r.id === roleId) ?? null
  const denied = (roleId && draft[roleId]) || new Set<string>()
  const locked = !!role?.is_super_admin
  const changedRoles = (data?.roles ?? []).filter((r) => draft[r.id] && (draft[r.id].size !== r.denied.length || r.denied.some((x) => !draft[r.id].has(x))))
  const dirty = !!role && changedRoles.some((r) => r.id === role.id)

  const query = q.trim().toLowerCase()
  const groups = useMemo(() => (data?.groups ?? [])
    .map((g) => ({ ...g, items: g.items.filter((i) => !query || i.label.toLowerCase().includes(query) || g.label.toLowerCase().includes(query)) }))
    .filter((g) => g.items.length), [data, query])
  const allItems = groups.flatMap((g) => g.items)

  const isAllowed = (key: string, a: Action) => locked || (!denied.has(`${key}:${a}`) && (a === 'view' || !denied.has(`${key}:view`)))
  function setMany(pairs: [string, Action][], allow: boolean) {
    if (!roleId || locked) return
    setDraft((d) => {
      const next = new Set(d[roleId])
      for (const [k, a] of pairs) {
        if (allow) { next.delete(`${k}:${a}`); if (a !== 'view') next.delete(`${k}:view`) } // membuka aksi = menu juga terlihat
        else next.add(`${k}:${a}`)
      }
      return { ...d, [roleId]: next }
    })
  }
  const pairsOf = (items: Item[], a?: Action) => items.flatMap((i) => (a ? (i.actions.includes(a) ? [[i.key, a] as [string, Action]] : []) : i.actions.map((x) => [i.key, x] as [string, Action])))
  const stateOf = (pairs: [string, Action][]) => {
    const on = pairs.filter(([k, a]) => isAllowed(k, a)).length
    return on === 0 ? 'off' : on === pairs.length ? 'on' : 'mixed'
  }

  async function save() {
    setSaving(true)
    setError('')
    try {
      for (const r of changedRoles) await api('/api/roles/menu-access', { method: 'PUT', json: { role_id: r.id, denied: [...draft[r.id]] } })
      await load()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }
  async function copyFrom(fromId: number) {
    const from = data?.roles.find((r) => r.id === fromId)
    if (!from || !roleId || !role) return
    if (!(await confirmDialog({ title: 'Salin akses?', message: `Akses menu ${role.name} diganti sama dengan ${from.name}. Belum tersimpan sampai klik Simpan.`, confirmLabel: 'Salin' }))) return
    setDraft((d) => ({ ...d, [roleId]: new Set(from.is_super_admin ? [] : d[fromId]) }))
  }

  if (!data) return error ? <Notice onClose={() => setError('')}>{error}</Notice> : <div className="pap-empty">Memuat akses menu...</div>
  const total = data.groups.flatMap((g) => g.items).reduce((n, i) => n + i.actions.length, 0)

  return (
    <>
      {error && <Notice onClose={() => setError('')}>{error}</Notice>}
      <div className="pap-ma-roles" role="tablist" aria-label="Pilih role">
        {data.roles.map((r) => {
          const n = (draft[r.id] ?? new Set()).size
          return (
            <button key={r.id} type="button" role="tab" aria-selected={r.id === roleId} className={`pap-ma-role ${r.id === roleId ? 'active' : ''}`} onClick={() => setRoleId(r.id)}>
              <span className={`pap-status ${r.is_super_admin ? 'danger' : r.is_admin ? 'info' : r.code === 'lead' ? 'success' : 'neutral'}`}>{r.name}</span>
              <b>{r.is_super_admin ? 'Semua akses' : `${total - n}/${total} akses`}</b>
              <small>{r.users} user aktif{!r.is_super_admin && n ? ` · ${n} dicabut` : ''}{changedRoles.some((c) => c.id === r.id) ? ' · belum disimpan' : ''}</small>
            </button>
          )
        })}
      </div>

      <div className="pap-table-card">
        <div className="pap-card-head">
          <div>
            <h2><ShieldCheck className="pap-inline-icon" /> Akses menu & aksi · {role?.name}</h2>
            <p>{locked ? 'Super Admin selalu memiliki semua akses (tidak bisa diubah).' : 'Centang = diizinkan. Lihat = menu tampil di sidebar; Tambah / Ubah / Hapus berlaku untuk semua simpan, ubah status, dan hapus di menu itu. Menu tetap harus dibuka untuk divisinya di tab Menu per divisi.'}</p>
          </div>
        </div>
        {!locked && (
          <div className="pap-filters pap-ma-tools">
            <label className="pap-filter-search"><Search /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari menu atau grup..." /></label>
            <button type="button" className="pap-btn" onClick={() => setMany(pairsOf(allItems), true)}><RotateCcw /> Izinkan semua</button>
            <button type="button" className="pap-btn" onClick={() => { setMany(pairsOf(allItems, 'view'), true); setMany(allItems.flatMap((i) => i.actions.filter((a) => a !== 'view').map((a) => [i.key, a] as [string, Action])), false) }}><Eye /> Hanya lihat</button>
            <label className="pap-ma-copy"><Copy />
              <select className="pap-select" value="" onChange={(e) => e.target.value && copyFrom(Number(e.target.value))} aria-label="Salin akses dari role lain">
                <option value="">Salin dari role…</option>
                {data.roles.filter((r) => r.id !== roleId).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </label>
          </div>
        )}
        <div className="pap-table-wrap">
          <table className="pap-ma-table">
            <thead>
              <tr>
                <th>Menu</th>
                {ACTIONS.map((a) => {
                  const Icon = ICON[a]
                  const st = stateOf(pairsOf(allItems, a))
                  return (
                    <th key={a} className="center">
                      <label className="pap-ma-head"><Icon />{data.actions[a]}
                        {!locked && <TriCheck state={st} onChange={(v) => setMany(pairsOf(allItems, a), v)} label={`${data.actions[a]} semua menu`} />}
                      </label>
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => [
                <tr key={`g-${g.label}`} className="pap-group-row">
                  <td>{g.label}</td>
                  {ACTIONS.map((a) => {
                    const pairs = pairsOf(g.items, a)
                    return <td key={a} className="center">{pairs.length && !locked ? <TriCheck state={stateOf(pairs)} onChange={(v) => setMany(pairs, v)} label={`${data.actions[a]} semua menu ${g.label}`} /> : null}</td>
                  })}
                </tr>,
                ...g.items.map((i) => {
                  const viewOff = !isAllowed(i.key, 'view')
                  const divs = data.divisions[i.key] ?? []
                  return (
                    <tr key={i.key} className={viewOff ? 'pap-ma-off' : ''}>
                      <td><div className="pap-cell-title">{i.label}</div><div className="pap-cell-sub" title={divs.join(', ')}>{divs.length ? `Divisi: ${divs.slice(0, 3).join(', ')}${divs.length > 3 ? ` +${divs.length - 3}` : ''}` : 'Belum dibuka untuk divisi mana pun'}</div></td>
                      {ACTIONS.map((a) => (
                        <td key={a} className="center">
                          {i.actions.includes(a) ? (
                            <input type="checkbox" className="pap-checkbox" checked={isAllowed(i.key, a)} disabled={locked || (a !== 'view' && viewOff)}
                              onChange={(e) => setMany([[i.key, a]], e.target.checked)} aria-label={`${data.actions[a]} ${i.label} untuk ${role?.name}`} />
                          ) : <span className="pap-muted" title="Menu ini hanya untuk dilihat">—</span>}
                        </td>
                      ))}
                    </tr>
                  )
                }),
              ])}
            </tbody>
          </table>
          {!groups.length && <div className="pap-empty">Menu tidak ditemukan.</div>}
        </div>
      </div>

      {changedRoles.length > 0 && (
        <div className="pap-ma-savebar">
          <span><b>{changedRoles.length} role</b> belum disimpan: {changedRoles.map((r) => r.name).join(', ')}{dirty ? '' : ' (bukan role yang sedang dibuka)'}</span>
          <button type="button" className="pap-btn" disabled={saving} onClick={() => setDraft(Object.fromEntries(data.roles.map((r) => [r.id, new Set(r.denied)])))}><Undo2 /> Batalkan</button>
          <button type="button" className="pap-primary-button" disabled={saving} onClick={save}><Save /> {saving ? 'Menyimpan...' : 'Simpan akses'}</button>
        </div>
      )}
    </>
  )
}

// Kotak centang 3 keadaan (semua / sebagian / tidak ada) untuk mengatur satu grup / kolom sekaligus
function TriCheck({ state, onChange, label }: { state: 'on' | 'off' | 'mixed'; onChange: (allow: boolean) => void; label: string }) {
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => { if (ref.current) ref.current.indeterminate = state === 'mixed' }, [state])
  return <input ref={ref} type="checkbox" className="pap-checkbox" checked={state === 'on'} onChange={() => onChange(state !== 'on')} aria-label={label} title={label} />
}
