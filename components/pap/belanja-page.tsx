'use client'

import { useCallback, useEffect, useState } from 'react'
import { FileSpreadsheet, Pencil, Plus, ReceiptText, Search, ShoppingBag, Trash2, Wallet, X } from 'lucide-react'
import type { UserProfile } from '@/lib/users'
import { formatRupiah } from './accurate'
import { api, confirmDialog, Field, formatDate, Modal, Notice, Pager, RowActions, usePaged } from './ui'

type Item = { id?: number; nama: string; qty: number | null; satuan: string | null; harga_satuan: number | null; total: number | null }
type Nota = {
  id: number; tanggal: string; kategori: string; toko: string | null; catatan: string | null; total: number; sumber: string | null
  created_name: string; jumlah_item: number; ringkasan: string | null; items?: Item[]
}
type Rekap = { kategori?: string; bulan?: string; nota: number; total: number }

const BULAN = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember']
const monthLabel = (ym: string) => `${BULAN[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`
const today = () => new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10)
const qtyText = (n: number | null) => (n === null ? '' : n.toLocaleString('id-ID', { maximumFractionDigits: 2 }))

export function BelanjaPage(_: { user: UserProfile }) {
  const [items, setItems] = useState<Nota[]>([])
  const [perKategori, setPerKategori] = useState<Rekap[]>([])
  const [perBulan, setPerBulan] = useState<Rekap[]>([])
  const [categories, setCategories] = useState<string[]>([])
  const [can, setCan] = useState({ manage: false })
  const [bulan, setBulan] = useState('')
  const [kategori, setKategori] = useState('')
  const [q, setQ] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [form, setForm] = useState<Nota | 'new' | null>(null)
  const [importing, setImporting] = useState(false)
  const [detailId, setDetailId] = useState<number | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (bulan) params.set('bulan', bulan)
      if (kategori) params.set('kategori', kategori)
      if (q.trim()) params.set('q', q.trim())
      const res = await api<{ items: Nota[]; perKategori: Rekap[]; perBulan: Rekap[]; categories: string[]; can: typeof can }>(`/api/ga/belanja?${params}`)
      setItems(res.items)
      setPerKategori(res.perKategori)
      setPerBulan(res.perBulan)
      setCategories(res.categories)
      setCan(res.can)
      setError('')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [bulan, kategori, q])
  useEffect(() => {
    const timer = setTimeout(load, q ? 300 : 0)
    return () => clearTimeout(timer)
  }, [load, q])
  const flash = (text: string) => {
    setMessage(text)
    setTimeout(() => setMessage(''), 6000)
    load()
  }

  const paged = usePaged(items, `${bulan}-${kategori}-${q}`)
  const total = perKategori.reduce((s, r) => s + r.total, 0)
  const nota = perKategori.reduce((s, r) => s + r.nota, 0)
  const thisMonth = today().slice(0, 7)
  const bulanIni = perBulan.find((b) => b.bulan === thisMonth)

  return (
    <>
      <div className="pap-page-heading">
        <div>
          <p className="pap-eyebrow">GENERAL AFFAIR</p>
          <h1>Belanja ATK &amp; RTK</h1>
          <span>Catatan belanja alat tulis kantor, rumah tangga kantor, obat, konsumsi, dan kebutuhan operasional lain beserta rincian itemnya.</span>
        </div>
        {can.manage && <div className="pap-inline-actions"><button className="pap-btn" onClick={() => setImporting(true)}><FileSpreadsheet /> Impor dari Excel</button><button className="pap-primary-button" onClick={() => setForm('new')}><Plus /> Catat belanja</button></div>}
      </div>
      {message && <Notice kind="success" onClose={() => setMessage('')}>{message}</Notice>}
      <div className="pap-stat-grid four">
        <div className="pap-stat-card"><div><span>{bulan ? monthLabel(bulan) : kategori || q ? 'Hasil filter' : 'Semua belanja'}</span><strong>{formatRupiah(total)}</strong><small className="neutral">{nota} nota</small></div><div className="pap-stat-icon stat-0"><Wallet /></div></div>
        <div className="pap-stat-card"><div><span>Bulan ini</span><strong>{formatRupiah(bulanIni?.total ?? 0)}</strong><small className="neutral">{bulanIni?.nota ?? 0} nota · {monthLabel(thisMonth)}</small></div><div className="pap-stat-icon stat-1"><ShoppingBag /></div></div>
        {perKategori.slice(0, 2).map((r) => (
          <button key={r.kategori} className={`pap-stat-card pap-stat-button ${kategori === r.kategori ? 'active' : ''}`} onClick={() => setKategori((k) => (k === r.kategori ? '' : r.kategori!))}>
            <div><span>{r.kategori}</span><strong>{formatRupiah(r.total)}</strong><small className="neutral">{r.nota} nota{total ? ` · ${Math.round((r.total / total) * 100)}%` : ''}</small></div>
            <div className="pap-stat-icon stat-3"><ReceiptText /></div>
          </button>
        ))}
      </div>
      {perBulan.length > 0 && (
        <div className="pap-chip-tabs pap-belanja-months" role="group" aria-label="Pilih bulan">
          <button className={!bulan ? 'active' : ''} onClick={() => setBulan('')}>Semua bulan</button>
          {perBulan.map((b) => <button key={b.bulan} className={bulan === b.bulan ? 'active' : ''} onClick={() => setBulan((x) => (x === b.bulan ? '' : b.bulan!))}>{monthLabel(b.bulan!)} <b>{formatRupiah(b.total)}</b></button>)}
        </div>
      )}
      <div className="pap-table-card">
        <div className="pap-filters pap-filters-top">
          <label className="pap-filter-search"><Search /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari nama barang, toko, catatan..." /></label>
          <select className="pap-select" value={kategori} onChange={(e) => setKategori(e.target.value)} aria-label="Filter kategori">
            <option value="">Semua kategori</option>
            {categories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        {perKategori.length > 2 && <div className="pap-cell-sub pap-belanja-rekap">{perKategori.map((r) => `${r.kategori} ${formatRupiah(r.total)}`).join(' · ')}</div>}
        {error && <div className="pap-card-notice"><Notice onClose={() => setError('')}>{error}</Notice></div>}
        <div className="pap-table-wrap">
          <table>
            <thead><tr><th>Tanggal</th><th>Kategori</th><th>Barang</th><th>Toko</th><th className="pap-num">Total</th><th className="pap-actions-col">Aksi</th></tr></thead>
            <tbody>
              {paged.items.map((n) => (
                <tr key={n.id} className="pap-row-link" onClick={() => setDetailId(n.id)}>
                  <td className="pap-nowrap">{formatDate(n.tanggal)}</td>
                  <td><span className="pap-status neutral">{n.kategori}</span></td>
                  <td><div className="pap-belanja-ringkas">{n.ringkasan ?? '—'}</div><div className="pap-cell-sub">{n.jumlah_item} item</div></td>
                  <td>{n.toko ?? '—'}</td>
                  <td className="pap-num pap-nowrap"><strong>{formatRupiah(n.total)}</strong></td>
                  <td className="pap-actions-cell"><RowActions label={`belanja ${formatDate(n.tanggal)}`} onView={() => setDetailId(n.id)} onEdit={can.manage ? async () => setForm((await api<{ item: Nota }>(`/api/ga/belanja/${n.id}`)).item) : undefined} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          {!loading && !items.length && <div className="pap-empty">{bulan || kategori || q ? 'Tidak ada catatan belanja yang cocok dengan filter.' : 'Belum ada catatan belanja. Klik "Catat belanja" atau "Impor dari Excel".'}</div>}
          {loading && !items.length && <div className="pap-empty">Memuat data...</div>}
        </div>
        <Pager {...paged.pager} noun="nota" />
      </div>
      {form && <NotaForm initial={form === 'new' ? null : form} categories={categories} onClose={() => setForm(null)} onSaved={(text) => { setForm(null); flash(text) }} />}
      {importing && <ImportDialog onClose={() => setImporting(false)} onDone={(text) => { setImporting(false); flash(text) }} />}
      {detailId && <NotaDetail id={detailId} canManage={can.manage} onClose={() => setDetailId(null)} onEdit={(n) => { setDetailId(null); setForm(n) }} onChanged={(text) => { setDetailId(null); flash(text) }} />}
    </>
  )
}

type Row = { nama: string; qty: string; satuan: string; harga_satuan: string; total: string }
const emptyRow = (): Row => ({ nama: '', qty: '', satuan: '', harga_satuan: '', total: '' })
const rowTotal = (r: Row) => (r.total !== '' ? Number(r.total) : r.qty !== '' && r.harga_satuan !== '' ? Math.round(Number(r.qty) * Number(r.harga_satuan)) : 0)

function NotaForm({ initial, categories, onClose, onSaved }: { initial: Nota | null; categories: string[]; onClose: () => void; onSaved: (text: string) => void }) {
  const [values, setValues] = useState({ tanggal: initial?.tanggal?.slice(0, 10) ?? today(), kategori: initial?.kategori ?? 'ATK', toko: initial?.toko ?? '', catatan: initial?.catatan ?? '', total: initial && !initial.items?.length ? String(initial.total) : '' })
  const [rows, setRows] = useState<Row[]>(initial?.items?.length
    ? initial.items.map((i) => ({ nama: i.nama, qty: i.qty === null ? '' : String(i.qty), satuan: i.satuan ?? '', harga_satuan: i.harga_satuan === null ? '' : String(i.harga_satuan), total: i.total === null ? '' : String(i.total) }))
    : [emptyRow(), emptyRow(), emptyRow()])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const set = (k: keyof typeof values) => (e: { target: { value: string } }) => setValues((v) => ({ ...v, [k]: e.target.value }))
  // Ubah qty / harga -> total baris dihitung ulang (total yang diketik manual tetap dipakai sampai qty/harga diubah)
  const setRow = (i: number, k: keyof Row, v: string) => setRows((rs) => rs.map((r, j) => (j !== i ? r : { ...r, [k]: v, ...(k === 'qty' || k === 'harga_satuan' ? { total: '' } : {}) })))
  const filled = rows.filter((r) => r.nama.trim())
  const sum = filled.reduce((s, r) => s + rowTotal(r), 0)
  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const json = { ...values, items: filled.map((r) => ({ nama: r.nama, qty: r.qty, satuan: r.satuan, harga_satuan: r.harga_satuan, total: r.total || (rowTotal(r) || '') })) }
      await api(initial ? `/api/ga/belanja/${initial.id}` : '/api/ga/belanja', { method: initial ? 'PATCH' : 'POST', json })
      onSaved(initial ? 'Catatan belanja diperbarui.' : 'Catatan belanja disimpan.')
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal
      title={initial ? `Ubah belanja ${formatDate(initial.tanggal)}` : 'Catat belanja'}
      wide
      onClose={onClose}
      footer={<><strong className="pap-belanja-sum">Total {formatRupiah(sum || Number(values.total || 0))}</strong><span className="pap-spacer" /><button className="pap-btn" onClick={onClose}>Batal</button><button className="pap-primary-button" form="belanja-form" disabled={busy}>{busy ? 'Menyimpan...' : 'Simpan'}</button></>}
    >
      <form id="belanja-form" className="pap-form-grid" onSubmit={submit}>
        {error && <div className="full"><Notice onClose={() => setError('')}>{error}</Notice></div>}
        <Field label="Tanggal belanja"><input className="pap-input" type="date" required max={today()} value={values.tanggal} onChange={set('tanggal')} /></Field>
        <Field label="Kategori"><input className="pap-input" required maxLength={50} list="pap-belanja-kategori" value={values.kategori} onChange={set('kategori')} /></Field>
        <datalist id="pap-belanja-kategori">{categories.map((c) => <option key={c} value={c} />)}</datalist>
        <Field label="Toko (opsional)"><input className="pap-input" maxLength={150} value={values.toko} onChange={set('toko')} placeholder="Mis. Toko SL, Luwes, Apotek Kartasura, Shopee" /></Field>
        {!filled.some((r) => rowTotal(r) > 0) && <Field label="Total (bila item tanpa harga)"><input className="pap-input" type="number" min={0} step={1} value={values.total} onChange={set('total')} /></Field>}
        <div className="full">
          <div className="pap-table-wrap bordered">
            <table className="pap-belanja-items">
              <thead><tr><th>Nama barang</th><th className="pap-num">Qty</th><th>Satuan</th><th className="pap-num">Harga satuan</th><th className="pap-num">Total</th><th /></tr></thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i}>
                    <td><input className="pap-input" maxLength={255} value={r.nama} onChange={(e) => setRow(i, 'nama', e.target.value)} placeholder={i === 0 ? 'Mis. Lakban OPP Nachi' : ''} aria-label={`Nama barang ${i + 1}`} /></td>
                    <td><input className="pap-input pap-num" type="number" min={0} step="any" value={r.qty} onChange={(e) => setRow(i, 'qty', e.target.value)} aria-label={`Qty ${i + 1}`} /></td>
                    <td><input className="pap-input" maxLength={40} list="pap-belanja-satuan" value={r.satuan} onChange={(e) => setRow(i, 'satuan', e.target.value)} aria-label={`Satuan ${i + 1}`} /></td>
                    <td><input className="pap-input pap-num" type="number" min={0} step="any" value={r.harga_satuan} onChange={(e) => setRow(i, 'harga_satuan', e.target.value)} aria-label={`Harga satuan ${i + 1}`} /></td>
                    <td><input className="pap-input pap-num" type="number" min={0} step="any" value={r.total !== '' ? r.total : rowTotal(r) ? String(rowTotal(r)) : ''} onChange={(e) => setRows((rs) => rs.map((x, j) => (j === i ? { ...x, total: e.target.value } : x)))} aria-label={`Total ${i + 1}`} /></td>
                    <td><button type="button" className="pap-icon-button" aria-label={`Hapus baris ${i + 1}`} onClick={() => setRows((rs) => (rs.length > 1 ? rs.filter((_, j) => j !== i) : [emptyRow()]))}><X /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <datalist id="pap-belanja-satuan">{['pcs', 'pack', 'roll', 'rim', 'box', 'lusin', 'botol', 'strip', 'kotak', 'kg', 'liter'].map((s) => <option key={s} value={s} />)}</datalist>
          <button type="button" className="pap-btn pap-belanja-add" onClick={() => setRows((rs) => [...rs, emptyRow()])}><Plus /> Tambah baris</button>
        </div>
        <Field label="Catatan (opsional)" full><textarea className="pap-input" rows={2} maxLength={5000} value={values.catatan} onChange={set('catatan')} placeholder="Mis. uang diberikan Rp400.000, kembalian Rp28.000" /></Field>
      </form>
    </Modal>
  )
}

function NotaDetail({ id, canManage, onClose, onEdit, onChanged }: { id: number; canManage: boolean; onClose: () => void; onEdit: (n: Nota) => void; onChanged: (text: string) => void }) {
  const [item, setItem] = useState<Nota | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    api<{ item: Nota }>(`/api/ga/belanja/${id}`).then((r) => setItem(r.item)).catch((e: Error) => setError(e.message))
  }, [id])
  if (!item) return <Modal title="Catatan belanja" onClose={onClose}>{error ? <Notice>{error}</Notice> : <p className="pap-muted">Memuat...</p>}</Modal>
  return (
    <Modal
      title={`Belanja ${formatDate(item.tanggal)}`}
      subtitle={[item.kategori, item.toko].filter(Boolean).join(' · ')}
      wide
      onClose={onClose}
      footer={<>
        {canManage && <button className="pap-btn danger" disabled={busy} onClick={async () => {
          if (!(await confirmDialog(`Hapus catatan belanja ${formatDate(item.tanggal)} (${formatRupiah(item.total)})? Data masuk ke Data Terhapus dan masih bisa dipulihkan.`))) return
          setBusy(true)
          try { await api(`/api/ga/belanja/${id}`, { method: 'DELETE' }); onChanged('Catatan belanja dihapus.') } catch (e) { setError((e as Error).message); setBusy(false) }
        }}><Trash2 /> Hapus</button>}
        <span className="pap-spacer" />
        {canManage && <button className="pap-btn" onClick={() => onEdit(item)}><Pencil /> Ubah</button>}
        <button className="pap-btn" onClick={onClose}>Tutup</button>
      </>}
    >
      {error && <Notice onClose={() => setError('')}>{error}</Notice>}
      <div className="pap-table-wrap bordered">
        <table>
          <thead><tr><th>Nama barang</th><th className="pap-num">Qty</th><th>Satuan</th><th className="pap-num">Harga satuan</th><th className="pap-num">Total</th></tr></thead>
          <tbody>
            {item.items?.map((i) => (
              <tr key={i.id}>
                <td>{i.nama}</td>
                <td className="pap-num">{qtyText(i.qty)}</td>
                <td>{i.satuan ?? ''}</td>
                <td className="pap-num pap-nowrap">{i.harga_satuan !== null ? formatRupiah(i.harga_satuan) : '—'}</td>
                <td className="pap-num pap-nowrap">{i.total !== null ? formatRupiah(i.total) : '—'}</td>
              </tr>
            ))}
          </tbody>
          <tfoot><tr><th colSpan={4}>Total</th><th className="pap-num pap-nowrap">{formatRupiah(item.total)}</th></tr></tfoot>
        </table>
        {!item.items?.length && <div className="pap-empty">Tanpa rincian item.</div>}
      </div>
      {item.catatan && <p className="pap-prewrap pap-muted">{item.catatan}</p>}
      <p className="pap-cell-sub">Dicatat oleh {item.created_name}</p>
    </Modal>
  )
}

type PreviewNota = { key: string; sheet: string; tanggal: string | null; kategori: string; toko: string | null; total: number; jumlahItem: number; contoh: string; rekap: boolean; sudahDiimpor: boolean; catatanImpor: string[] }

// Impor dari Excel: tiap sheet / tabel jadi satu nota. Sheet rekap (keperluan bulanan, daftar harga) tidak dicentang agar tidak dobel.
function ImportDialog({ onClose, onDone }: { onClose: () => void; onDone: (text: string) => void }) {
  const [file, setFile] = useState<File | null>(null)
  const [notas, setNotas] = useState<PreviewNota[] | null>(null)
  const [chosen, setChosen] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function send(mode: 'preview' | 'import') {
    if (!file) return
    setBusy(true)
    setError('')
    try {
      const body = new FormData()
      body.set('file', file)
      body.set('mode', mode)
      if (mode === 'preview') {
        const res = await api<{ notas: PreviewNota[] }>('/api/ga/belanja/import', { method: 'POST', body })
        setNotas(res.notas)
        setChosen(new Set(res.notas.filter((n) => !n.rekap && !n.sudahDiimpor && n.tanggal).map((n) => n.key)))
      } else {
        body.set('keys', JSON.stringify([...chosen]))
        const res = await api<{ added: number; total: number }>('/api/ga/belanja/import', { method: 'POST', body })
        onDone(`Impor selesai: ${res.added} nota belanja (${formatRupiah(res.total)}) dari ${file.name}.`)
      }
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const toggle = (k: string) => setChosen((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n })
  const chosenTotal = (notas ?? []).filter((n) => chosen.has(n.key)).reduce((s, n) => s + n.total, 0)
  return (
    <Modal
      title="Impor belanja dari Excel"
      subtitle="Tiap sheet / tabel di Excel menjadi satu nota belanja; tanggal diambil dari nama sheet"
      wide
      onClose={onClose}
      footer={<>{notas && <strong className="pap-belanja-sum">{chosen.size} nota · {formatRupiah(chosenTotal)}</strong>}<span className="pap-spacer" /><button className="pap-btn" onClick={onClose}>Batal</button>
        {notas
          ? <button className="pap-primary-button" disabled={busy || !chosen.size} onClick={() => send('import')}>{busy ? 'Mengimpor...' : `Impor ${chosen.size} nota`}</button>
          : <button className="pap-primary-button" disabled={busy || !file} onClick={() => send('preview')}>{busy ? 'Membaca...' : 'Lihat pratinjau'}</button>}
      </>}
    >
      {error && <Notice onClose={() => setError('')}>{error}</Notice>}
      <Field label="File Excel (.xlsx)" full hint='Mis. "PEMBELIAN ATK GENERAL AFFAIR 2026.xlsx". File yang sama aman diunggah lagi: nota yang sudah diimpor dilewati.'>
        <input className="pap-input" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setNotas(null); setError('') }} />
      </Field>
      {notas && (
        <div className="pap-table-wrap bordered">
          <table>
            <thead><tr><th /><th>Sheet</th><th>Tanggal</th><th>Kategori</th><th>Isi</th><th className="pap-num">Total</th></tr></thead>
            <tbody>
              {notas.map((n) => (
                <tr key={n.key} className={n.sudahDiimpor ? 'pap-muted' : ''}>
                  <td><input type="checkbox" aria-label={`Impor ${n.sheet}`} disabled={n.sudahDiimpor || !n.tanggal} checked={chosen.has(n.key)} onChange={() => toggle(n.key)} /></td>
                  <td>{n.sheet}{n.rekap && <div><span className="pap-status warning">Rekap / daftar, tidak dicentang agar tidak dobel</span></div>}{n.sudahDiimpor && <div><span className="pap-status neutral">Sudah diimpor</span></div>}</td>
                  <td className="pap-nowrap">{n.tanggal ? formatDate(n.tanggal) : <span className="pap-status danger">Tidak dikenali</span>}</td>
                  <td>{n.kategori}</td>
                  <td><div className="pap-belanja-ringkas">{n.contoh}{n.jumlahItem > 4 ? ', ...' : ''}</div><div className="pap-cell-sub">{n.jumlahItem} item{n.toko ? ` · ${n.toko}` : ''}</div>{n.catatanImpor.map((c) => <div key={c} className="pap-cell-sub pap-belanja-warn">{c}</div>)}</td>
                  <td className="pap-num pap-nowrap">{formatRupiah(n.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  )
}
