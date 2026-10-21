'use client'

import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, ArrowDownToLine, ArrowUpFromLine, Boxes, ClipboardList, Pencil, Plus, Search, Wrench } from 'lucide-react'
import type { UserProfile } from '@/lib/users'
import { api, Field, formatDate, Modal, Notice, Pager, usePaged } from './ui'

type Jenis = 'sparepart' | 'peralatan' | 'bahan'
type Kondisi = 'baik' | 'perlu_perbaikan' | 'rusak'
type MoveJenis = 'masuk' | 'keluar' | 'penyesuaian'
type Item = {
  id: number; kode: string; nama: string; jenis: Jenis; kategori: string | null; machine_id: number | null; machine_nama: string | null; satuan: string
  stok: number; stok_minimum: number; lokasi: string | null; kondisi: Kondisi; catatan: string | null; aktif: boolean; gerak_terakhir: string | null
}
type Move = {
  id: number; tanggal: string; jenis: MoveJenis; jumlah: number; stok_setelah: number; repair_id: number | null; repair_nomor: string | null; repair_mesin: string | null
  purchase_request_id: number | null; pr_nomor: string | null; keterangan: string | null; created_name: string; created_at: string
}
type Machine = { id: number; kode: string; nama: string }
type Repair = { id: number; nomor: string; mesin: string; keluhan: string }
type Summary = { total: number; sparepart: number; peralatan: number; menipis: number; rusak: number }

const JENIS_LABEL: Record<Jenis, string> = { sparepart: 'Sparepart', peralatan: 'Peralatan', bahan: 'Bahan' }
const KONDISI_LABEL: Record<Kondisi, string> = { baik: 'Baik', perlu_perbaikan: 'Perlu perbaikan', rusak: 'Rusak' }
const KONDISI_TONE: Record<Kondisi, string> = { baik: 'success', perlu_perbaikan: 'warning', rusak: 'danger' }
const MOVE_LABEL: Record<MoveJenis, string> = { masuk: 'Masuk', keluar: 'Keluar', penyesuaian: 'Stok opname' }
const num = (n: number) => n.toLocaleString('id-ID', { maximumFractionDigits: 2 })
const low = (i: Item) => i.stok_minimum > 0 && i.stok <= i.stok_minimum

export function SparepartPage({ focusId }: { user: UserProfile; focusId?: number | null }) {
  const [items, setItems] = useState<Item[]>([])
  const [summary, setSummary] = useState<Summary | null>(null)
  const [machines, setMachines] = useState<Machine[]>([])
  const [repairs, setRepairs] = useState<Repair[]>([])
  const [can, setCan] = useState({ manage: false, receive: false })
  const [jenis, setJenis] = useState('')
  const [stok, setStok] = useState('')
  const [machine, setMachine] = useState('')
  const [q, setQ] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [form, setForm] = useState<Item | 'new' | null>(null)
  const [detailId, setDetailId] = useState<number | null>(focusId ?? null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (jenis) params.set('jenis', jenis)
      if (stok === 'nonaktif') params.set('nonaktif', '1')
      else if (stok) params.set('stok', stok)
      if (machine) params.set('machine', machine)
      if (q.trim()) params.set('q', q.trim())
      const res = await api<{ items: Item[]; summary: Summary; machines: Machine[]; repairs: Repair[]; can: typeof can }>(`/api/tech-items?${params}`)
      setItems(res.items)
      setSummary(res.summary)
      setMachines(res.machines)
      setRepairs(res.repairs)
      setCan(res.can)
      setError('')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [jenis, stok, machine, q])
  useEffect(() => {
    const timer = setTimeout(load, q ? 300 : 0)
    return () => clearTimeout(timer)
  }, [load, q])
  const flash = (text: string) => {
    setMessage(text)
    setTimeout(() => setMessage(''), 5000)
    load()
  }

  const paged = usePaged(items, `${jenis}-${stok}-${machine}-${q}`)
  const stats: [string, number, string, string, typeof Boxes, string][] = summary ? [
    ['menipis', summary.menipis, 'Stok menipis', 'Di bawah / sama dengan stok minimum', AlertTriangle, 'stat-2'],
    ['', summary.sparepart, 'Sparepart', 'Cadangan bila mesin rusak', Boxes, 'stat-1'],
    ['peralatan', summary.peralatan, 'Peralatan', 'Alat kerja Teknik', Wrench, 'stat-0'],
    ['rusak', summary.rusak, 'Perlu perbaikan / rusak', 'Kondisi peralatan', ClipboardList, 'stat-2'],
  ] : []

  return (
    <>
      <div className="pap-page-heading">
        <div>
          <p className="pap-eyebrow">TEKNIK</p>
          <h1>Sparepart &amp; Peralatan</h1>
          <span>Data peralatan Teknik dan stok sparepart cadangan mesin. Sparepart yang dipakai untuk perbaikan dicatat keluar; stok yang sampai batas minimum memberi peringatan ke Teknik dan Purchasing.</span>
        </div>
        {can.manage && <button className="pap-primary-button" onClick={() => setForm('new')}><Plus /> Tambah barang</button>}
      </div>
      {message && <Notice kind="success" onClose={() => setMessage('')}>{message}</Notice>}
      {summary && (
        <div className="pap-stat-grid four">
          {stats.map(([key, value, label, note, Icon, tone], i) => (
            <button key={i} className={`pap-stat-card pap-stat-button ${(key === 'peralatan' ? jenis === 'peralatan' : key ? stok === key : jenis === 'sparepart') ? 'active' : ''}`} onClick={() => {
              if (key === 'peralatan') { setJenis((j) => (j === 'peralatan' ? '' : 'peralatan')); setStok('') }
              else if (!key) { setJenis((j) => (j === 'sparepart' ? '' : 'sparepart')); setStok('') }
              else setStok((s) => (s === key ? '' : key))
            }}>
              <div><span>{label}</span><strong>{value}</strong><small className="neutral">{note}</small></div>
              <div className={`pap-stat-icon ${tone}`}><Icon /></div>
            </button>
          ))}
        </div>
      )}
      <div className="pap-table-card">
        <div className="pap-filters pap-filters-top">
          <label className="pap-filter-search"><Search /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari kode, nama, kategori, lokasi..." /></label>
          <select className="pap-select" value={jenis} onChange={(e) => setJenis(e.target.value)} aria-label="Filter jenis">
            <option value="">Semua jenis</option>
            {Object.entries(JENIS_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
          <select className="pap-select" value={stok} onChange={(e) => setStok(e.target.value)} aria-label="Filter stok">
            <option value="">Semua barang aktif</option>
            <option value="menipis">Stok menipis</option>
            <option value="rusak">Kondisi tidak baik</option>
            <option value="nonaktif">Nonaktif</option>
          </select>
          <select className="pap-select" value={machine} onChange={(e) => setMachine(e.target.value)} aria-label="Filter mesin">
            <option value="">Semua mesin</option>
            {machines.map((m) => <option key={m.id} value={m.id}>{m.nama}</option>)}
          </select>
        </div>
        {error && <div className="pap-card-notice"><Notice onClose={() => setError('')}>{error}</Notice></div>}
        <div className="pap-table-wrap">
          <table>
            <thead><tr><th>Barang</th><th>Jenis</th><th>Untuk mesin</th><th>Stok</th><th>Lokasi</th><th>Kondisi</th></tr></thead>
            <tbody>
              {paged.items.map((i) => (
                <tr key={i.id} className="pap-row-link" onClick={() => setDetailId(i.id)}>
                  <td><div className="pap-cell-title">{i.nama}</div><div className="pap-cell-sub">{i.kode}{i.kategori ? ` · ${i.kategori}` : ''}</div></td>
                  <td>{JENIS_LABEL[i.jenis]}</td>
                  <td>{i.machine_nama ?? <span className="pap-muted">Umum</span>}</td>
                  <td className="pap-nowrap">
                    <strong>{num(i.stok)}</strong> {i.satuan}
                    {low(i) ? <div><span className="pap-status danger">Menipis (min {num(i.stok_minimum)})</span></div> : i.stok_minimum > 0 && <div className="pap-cell-sub">min {num(i.stok_minimum)}</div>}
                  </td>
                  <td>{i.lokasi ?? '—'}</td>
                  <td><span className={`pap-status ${KONDISI_TONE[i.kondisi]}`}>{KONDISI_LABEL[i.kondisi]}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
          {!loading && !items.length && <div className="pap-empty">{q || jenis || stok || machine ? 'Tidak ada barang yang cocok dengan filter.' : 'Belum ada data sparepart / peralatan.'}</div>}
          {loading && !items.length && <div className="pap-empty">Memuat data...</div>}
        </div>
        <Pager {...paged.pager} noun="barang" />
      </div>
      {form && <ItemForm initial={form === 'new' ? null : form} machines={machines} onClose={() => setForm(null)} onSaved={(text) => { setForm(null); flash(text) }} />}
      {detailId && <ItemDetail id={detailId} can={can} repairs={repairs} onClose={() => setDetailId(null)} onEdit={(i) => { setDetailId(null); setForm(i) }} onChanged={load} />}
    </>
  )
}

function ItemForm({ initial, machines, onClose, onSaved }: { initial: Item | null; machines: Machine[]; onClose: () => void; onSaved: (text: string) => void }) {
  const [values, setValues] = useState({
    kode: initial?.kode ?? '', nama: initial?.nama ?? '', jenis: initial?.jenis ?? 'sparepart', kategori: initial?.kategori ?? '', machine_id: initial?.machine_id ? String(initial.machine_id) : '',
    satuan: initial?.satuan ?? 'pcs', stok_awal: '', stok_minimum: initial ? String(initial.stok_minimum) : '', lokasi: initial?.lokasi ?? '', kondisi: initial?.kondisi ?? 'baik', catatan: initial?.catatan ?? '',
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const set = (k: keyof typeof values) => (e: { target: { value: string } }) => setValues((v) => ({ ...v, [k]: e.target.value }))
  async function run(task: () => Promise<unknown>, text: string) {
    setBusy(true)
    setError('')
    try {
      await task()
      onSaved(text)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal
      title={initial ? `Ubah ${initial.nama}` : 'Tambah sparepart / peralatan'}
      onClose={onClose}
      footer={<>
        {initial && <button className="pap-btn" disabled={busy} onClick={() => run(() => api(`/api/tech-items/${initial.id}`, { method: 'PATCH', json: { aktif: !initial.aktif } }), initial.aktif ? 'Barang dinonaktifkan.' : 'Barang diaktifkan kembali.')}>{initial.aktif ? 'Nonaktifkan' : 'Aktifkan'}</button>}
        <span className="pap-spacer" />
        <button className="pap-btn" onClick={onClose}>Batal</button>
        <button className="pap-primary-button" form="item-form" disabled={busy}>{busy ? 'Menyimpan...' : 'Simpan'}</button>
      </>}
    >
      <form id="item-form" className="pap-form-grid" onSubmit={(e) => { e.preventDefault(); run(() => api(initial ? `/api/tech-items/${initial.id}` : '/api/tech-items', { method: initial ? 'PATCH' : 'POST', json: values }), initial ? 'Data barang diperbarui.' : 'Barang ditambahkan.') }}>
        {error && <div className="full"><Notice onClose={() => setError('')}>{error}</Notice></div>}
        <Field label="Kode"><input className="pap-input" required maxLength={40} value={values.kode} onChange={set('kode')} placeholder="Mis. BRG-6204" /></Field>
        <Field label="Jenis">
          <select className="pap-select" value={values.jenis} onChange={set('jenis')}>
            {Object.entries(JENIS_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </Field>
        <Field label="Nama barang" full><input className="pap-input" required maxLength={200} value={values.nama} onChange={set('nama')} placeholder="Mis. Bearing 6204, Kunci torsi, Oli gearbox SAE 90" /></Field>
        <Field label="Kategori (opsional)"><input className="pap-input" maxLength={100} value={values.kategori} onChange={set('kategori')} placeholder="Bearing, Elektrik, Pneumatik..." /></Field>
        <Field label="Untuk mesin (opsional)">
          <select className="pap-select" value={values.machine_id} onChange={set('machine_id')}>
            <option value="">Umum / banyak mesin</option>
            {machines.map((m) => <option key={m.id} value={m.id}>{m.nama}</option>)}
          </select>
        </Field>
        <Field label="Satuan"><input className="pap-input" required maxLength={40} list="pap-satuan-teknik" value={values.satuan} onChange={set('satuan')} /></Field>
        <datalist id="pap-satuan-teknik">{['pcs', 'set', 'unit', 'meter', 'liter', 'kg', 'roll', 'box'].map((s) => <option key={s} value={s} />)}</datalist>
        {!initial && <Field label="Stok awal"><input className="pap-input" type="number" min={0} step="any" value={values.stok_awal} onChange={set('stok_awal')} placeholder="0" /></Field>}
        <Field label="Stok minimum" hint="Peringatan dikirim bila stok sampai batas ini. 0 = tanpa peringatan."><input className="pap-input" type="number" min={0} step="any" value={values.stok_minimum} onChange={set('stok_minimum')} placeholder="0" /></Field>
        <Field label="Lokasi penyimpanan (opsional)"><input className="pap-input" maxLength={150} value={values.lokasi} onChange={set('lokasi')} placeholder="Rak A2, lemari Teknik" /></Field>
        <Field label="Kondisi">
          <select className="pap-select" value={values.kondisi} onChange={set('kondisi')}>
            {Object.entries(KONDISI_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </Field>
        <Field label="Catatan / spesifikasi (opsional)" full><textarea className="pap-input" rows={2} maxLength={5000} value={values.catatan} onChange={set('catatan')} /></Field>
      </form>
    </Modal>
  )
}

function ItemDetail({ id, can, repairs, onClose, onEdit, onChanged }: { id: number; can: { manage: boolean; receive: boolean }; repairs: Repair[]; onClose: () => void; onEdit: (i: Item) => void; onChanged: () => void }) {
  const [item, setItem] = useState<Item | null>(null)
  const [moves, setMoves] = useState<Move[]>([])
  const [move, setMove] = useState<{ jenis: MoveJenis; jumlah: string; tanggal: string; keterangan: string; repair_id: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const today = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10)
  const load = useCallback(async () => {
    try {
      const res = await api<{ item: Item; moves: Move[] }>(`/api/tech-items/${id}`)
      setItem(res.item)
      setMoves(res.moves)
    } catch (e) {
      setError((e as Error).message)
    }
  }, [id])
  useEffect(() => { load() }, [load])
  const start = (jenis: MoveJenis) => setMove({ jenis, jumlah: jenis === 'penyesuaian' && item ? String(item.stok) : '', tanggal: today, keterangan: '', repair_id: '' })
  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (!move) return
    setBusy(true)
    setError('')
    try {
      await api(`/api/tech-items/${id}/moves`, { method: 'POST', json: move })
      setMove(null)
      await load()
      onChanged()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }
  if (!item) return <Modal title="Barang" onClose={onClose}>{error ? <Notice>{error}</Notice> : <p className="pap-muted">Memuat...</p>}</Modal>
  return (
    <Modal
      title={item.nama}
      subtitle={`${item.kode} · ${JENIS_LABEL[item.jenis]}${item.machine_nama ? ` · ${item.machine_nama}` : ''}`}
      wide
      onClose={onClose}
      footer={<>{can.manage && <button className="pap-btn" onClick={() => onEdit(item)}><Pencil /> Ubah data</button>}<span className="pap-spacer" /><button className="pap-btn" onClick={onClose}>Tutup</button></>}
    >
      {error && <Notice onClose={() => setError('')}>{error}</Notice>}
      <div className="pap-detail-badges">
        <span className={`pap-status ${low(item) ? 'danger' : 'success'}`}>Stok {num(item.stok)} {item.satuan}{low(item) ? ' · menipis' : ''}</span>
        <span className={`pap-status ${KONDISI_TONE[item.kondisi]}`}>{KONDISI_LABEL[item.kondisi]}</span>
        {!item.aktif && <span className="pap-status neutral">Nonaktif</span>}
      </div>
      <dl className="pap-detail-grid">
        <div><dt>Stok minimum</dt><dd>{item.stok_minimum ? `${num(item.stok_minimum)} ${item.satuan}` : '—'}</dd></div>
        <div><dt>Lokasi</dt><dd>{item.lokasi ?? '—'}</dd></div>
        <div><dt>Kategori</dt><dd>{item.kategori ?? '—'}</dd></div>
        <div><dt>Mutasi terakhir</dt><dd>{item.gerak_terakhir ? formatDate(item.gerak_terakhir, true) : '—'}</dd></div>
      </dl>
      {item.catatan && <p className="pap-prewrap">{item.catatan}</p>}

      {item.aktif && (can.manage || can.receive) && (
        <div className="pap-inline-actions pap-wrap">
          <button className="pap-btn" onClick={() => start('masuk')}><ArrowDownToLine /> Barang masuk</button>
          {can.manage && <button className="pap-btn" onClick={() => start('keluar')}><ArrowUpFromLine /> Barang keluar / dipakai</button>}
          {can.manage && <button className="pap-btn" onClick={() => start('penyesuaian')}><ClipboardList /> Stok opname</button>}
        </div>
      )}
      {move && (
        <form className="pap-inline-panel" onSubmit={save}>
          <strong>{MOVE_LABEL[move.jenis]}</strong>
          <div className="pap-form-grid">
            <Field label={move.jenis === 'penyesuaian' ? `Stok hasil hitung fisik (${item.satuan})` : `Jumlah (${item.satuan})`}>
              <input className="pap-input" type="number" min={0} step="any" required autoFocus value={move.jumlah} onChange={(e) => setMove({ ...move, jumlah: e.target.value })} />
            </Field>
            <Field label="Tanggal"><input className="pap-input" type="date" max={today} value={move.tanggal} onChange={(e) => setMove({ ...move, tanggal: e.target.value })} /></Field>
            {move.jenis === 'keluar' && (
              <Field label="Dipakai untuk perbaikan (opsional)" full>
                <select className="pap-select" value={move.repair_id} onChange={(e) => setMove({ ...move, repair_id: e.target.value })}>
                  <option value="">— Tidak terkait laporan kerusakan —</option>
                  {repairs.map((r) => <option key={r.id} value={r.id}>{r.nomor} · {r.mesin} · {r.keluhan.slice(0, 60)}</option>)}
                </select>
              </Field>
            )}
            <Field label="Keterangan (opsional)" full><input className="pap-input" maxLength={500} value={move.keterangan} onChange={(e) => setMove({ ...move, keterangan: e.target.value })} placeholder={move.jenis === 'masuk' ? 'Mis. beli dari toko X, nota no.' : 'Mis. ganti bearing MC Blow'} /></Field>
          </div>
          <div className="pap-inline-actions"><span className="pap-spacer" /><button type="button" className="pap-btn" onClick={() => setMove(null)}>Batal</button><button className="pap-primary-button" disabled={busy}>{busy ? 'Menyimpan...' : 'Simpan'}</button></div>
        </form>
      )}

      <section className="pap-detail-section">
        <h3>Kartu stok ({moves.length})</h3>
        <div className="pap-table-wrap bordered">
          <table>
            <thead><tr><th>Tanggal</th><th>Mutasi</th><th>Jumlah</th><th>Sisa</th><th>Keterangan</th></tr></thead>
            <tbody>
              {moves.map((m) => (
                <tr key={m.id}>
                  <td className="pap-nowrap">{formatDate(m.tanggal)}</td>
                  <td><span className={`pap-status ${m.jenis === 'masuk' ? 'success' : m.jenis === 'keluar' ? 'warning' : 'neutral'}`}>{MOVE_LABEL[m.jenis]}</span></td>
                  <td className="pap-nowrap">{m.jenis === 'keluar' ? '−' : m.jumlah > 0 ? '+' : ''}{num(m.jumlah)}</td>
                  <td className="pap-nowrap">{num(m.stok_setelah)}</td>
                  <td>
                    {m.keterangan}
                    {m.repair_nomor && <div className="pap-cell-sub">Perbaikan {m.repair_nomor} · {m.repair_mesin}</div>}
                    {m.pr_nomor && <div className="pap-cell-sub">Pengajuan {m.pr_nomor}</div>}
                    <div className="pap-cell-sub">{m.created_name}</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!moves.length && <div className="pap-empty">Belum ada mutasi stok.</div>}
        </div>
      </section>
    </Modal>
  )
}
