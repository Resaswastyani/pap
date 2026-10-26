'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Save, Search } from 'lucide-react'
import { api, Notice } from './ui'

type MenuItem = { label: string; key: string; permission: string | null }
type Division = { id: number; code: string; name: string; users: number; menus: string[] }
type Data = { groups: { label: string; items: MenuItem[] }[]; divisions: Division[] }

// Manajemen Role > Menu per divisi: menu sidebar yang terbuka untuk tiap divisi (berlaku ke semua user divisi itu)
export function DivisionMenus() {
  const [data, setData] = useState<Data | null>(null)
  const [divisionId, setDivisionId] = useState<number | null>(null)
  const [draft, setDraft] = useState<Set<string>>(new Set())
  const [q, setQ] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  const load = useCallback(async (keep?: number | null) => {
    try {
      const res = await api<Data>('/api/divisions/menus')
      setData(res)
      const id = keep ?? res.divisions[0]?.id ?? null
      setDivisionId(id)
      setDraft(new Set(res.divisions.find((d) => d.id === id)?.menus ?? []))
    } catch (e) {
      setError((e as Error).message)
    }
  }, [])
  useEffect(() => { load() }, [load])

  const division = data?.divisions.find((d) => d.id === divisionId) ?? null
  const changed = useMemo(() => {
    if (!division) return false
    const saved = new Set(division.menus)
    return saved.size !== draft.size || [...draft].some((k) => !saved.has(k))
  }, [division, draft])

  function pick(id: number) {
    if (changed && !confirm('Perubahan menu divisi ini belum disimpan. Pindah divisi tanpa menyimpan?')) return
    setDivisionId(id)
    setDraft(new Set(data?.divisions.find((d) => d.id === id)?.menus ?? []))
    setMessage('')
  }
  const toggle = (key: string) => setDraft((prev) => {
    const next = new Set(prev)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    return next
  })
  const toggleGroup = (items: MenuItem[]) => setDraft((prev) => {
    const next = new Set(prev)
    const all = items.every((i) => next.has(i.key))
    for (const i of items) if (all) next.delete(i.key); else next.add(i.key)
    return next
  })

  async function save() {
    if (!division) return
    setSaving(true)
    setError('')
    try {
      await api('/api/divisions/menus', { method: 'PUT', json: { division_id: division.id, menus: [...draft] } })
      setMessage(`Menu divisi ${division.name} disimpan. Berlaku saat user divisi ini memuat ulang aplikasi.`)
      await load(division.id)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const term = q.trim().toLowerCase()
  const divisions = (data?.divisions ?? []).filter((d) => !term || d.name.toLowerCase().includes(term) || d.code.includes(term))

  return (
    <>
      {error && <Notice onClose={() => setError('')}>{error}</Notice>}
      {message && <Notice kind="success" onClose={() => setMessage('')}>{message}</Notice>}
      <div className="pap-divmenu">
        <aside className="pap-table-card pap-divmenu-list">
          <div className="pap-card-head"><div><h2>Divisi</h2><p>{data?.divisions.length ?? 0} divisi</p></div></div>
          <label className="pap-filter-search pap-divmenu-search"><Search /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari divisi..." /></label>
          <select className="pap-select pap-divmenu-select" value={divisionId ?? ''} onChange={(e) => pick(Number(e.target.value))} aria-label="Pilih divisi">
            {data?.divisions.map((d) => <option key={d.id} value={d.id}>{d.name} ({d.menus.length} menu)</option>)}
          </select>
          <ul>
            {divisions.map((d) => (
              <li key={d.id}>
                <button className={d.id === divisionId ? 'active' : ''} onClick={() => pick(d.id)}>
                  <b>{d.name}</b>
                  <small>{d.menus.length} menu · {d.users} user aktif</small>
                </button>
              </li>
            ))}
          </ul>
        </aside>
        <section className="pap-table-card pap-divmenu-body">
          <div className="pap-card-head">
            <div><h2>{division ? `Menu ${division.name}` : 'Memuat...'}</h2><p>Centang menu yang tampil di sidebar untuk semua user divisi ini. Super Admin selalu melihat semua menu; Pengaturan selalu terbuka.</p></div>
            <button className="pap-primary-button" disabled={!changed || saving} onClick={save}><Save /> {saving ? 'Menyimpan...' : `Simpan (${draft.size} menu)`}</button>
          </div>
          <div className="pap-divmenu-groups">
            {data?.groups.map((g) => {
              const on = g.items.filter((i) => draft.has(i.key)).length
              return (
                <fieldset key={g.label} className="pap-divmenu-group">
                  <legend>
                    <button type="button" onClick={() => toggleGroup(g.items)} title="Centang / hapus semua di grup ini">{g.label}</button>
                    <span>{on}/{g.items.length}</span>
                  </legend>
                  {g.items.map((i) => (
                    <label key={i.key} className="pap-check">
                      <input type="checkbox" checked={draft.has(i.key)} onChange={() => toggle(i.key)} disabled={!division} />
                      <span>{i.label}{i.permission && <small className="pap-hint-inline"> · juga terbuka lewat permission</small>}</span>
                    </label>
                  ))}
                </fieldset>
              )
            })}
          </div>
        </section>
      </div>
    </>
  )
}
