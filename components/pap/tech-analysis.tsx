'use client'

import { useCallback, useEffect, useState } from 'react'
import { CheckCircle2, ClipboardCheck, Eye, FileDown, FilePen, FileText, ImageIcon, Plus, Printer, Ruler, Save, Search, Send, Trash2, Undo2, Wrench, X } from 'lucide-react'
import type { UserProfile } from '@/lib/users'
import { api, confirmDialog, Field, formatDate, Modal, Notice, Pager, RowActions, usePaged } from './ui'
import { TaSignatures } from './tech-analysis-signature'
import { AttachmentInput, AttachmentPanel, emptyAttachments, pendingCount, uploadPendingAttachments, type PendingAttachments } from './attachments'
import { DesignPicker, DesignThumb, type Desain } from './order-custom-page'

// Analisa Aspek Teknik atas Rencana Order Baru / Spec Baru: Marketing -> Dept Teknik -> Direksi, cetak PDF & Word

type Status = 'draft' | 'diserahkan' | 'dianalisa' | 'selesai'
const STATUS: Record<Status, string> = { draft: 'Draft', diserahkan: 'Di Dept Teknik', dianalisa: 'Menunggu Direksi', selesai: 'Selesai' }
const TONE: Record<Status, string> = { draft: 'neutral', diserahkan: 'warning', dianalisa: 'info', selesai: 'success' }
const FLOW: Status[] = ['draft', 'diserahkan', 'dianalisa', 'selesai']
// Kartu ringkasan per tahap (seragam dengan kartu statistik menu lain)
const STAGE_ICON: Record<Status, typeof Wrench> = { draft: FilePen, diserahkan: Wrench, dianalisa: ClipboardCheck, selesai: CheckCircle2 }
const STAGE_NOTE: Record<Status, string> = { draft: 'Disusun Marketing / PPIC', diserahkan: 'Sedang dianalisa Teknik', dianalisa: 'Perlu rekomendasi Direksi', selesai: 'Analisa lengkap' }
const FLOW_LABEL: Record<Status, string> = { draft: 'Marketing isi spek', diserahkan: 'Teknik analisa', dianalisa: 'Direksi rekomendasi', selesai: 'Selesai' }
const BISA = { bisa: 'Bisa diproduksi (optimal)', bersyarat: 'Bisa dengan syarat', tidak: 'Tidak bisa diproduksi optimal' } as const
const KUALITAS = { mudah: 'Mudah', sedang: 'Sedang', sulit: 'Sulit' } as const

type Proses = { mesin: string; kec_label: string; dipakai: boolean; kecepatan: string; kec_roto_max: string; jalur: string; tumpuk: string; warna?: string; keterangan: string; produktivitas: number | null }
// Mesin Inline Blow-Roto (4 mesin): isian Jumlah Warna menggantikan Jalur & Tumpuk
const isRotoMesin = (m: string) => /^inline blow/i.test(m.trim())
type Analysis = {
  id: number; nomor: string; prospect_id: number | null; prospect_name: string | null; status: Status; tanggal_serah: string | null
  nama_produk: string; nama_customer: string; jenis_plastik: string | null; panjang_cm: number | null; lebar_cm: number | null; tebal_mm: number | null
  print_jenis: 'polos' | 'print' | null; jumlah_warna: number | null; kesulitan_print: string | null; spec_lainnya: string | null
  qty_order: number | null; qty_satuan: string | null; frekuensi: 'sekali' | 'rutin' | null; rutin_bulan: number | null; critical_to_quality: string | null
  proses: Proses[]; bisa_produksi: keyof typeof BISA | null; penjelasan_produksi: string | null; kesulitan_kualitas: keyof typeof KUALITAS | null; penjelasan_kualitas: string | null
  catatan_lain: string | null; teknik_name: string | null; teknik_at: string | null; rekomendasi_direksi: string | null; direksi_name: string | null; direksi_at: string | null
  created_by: number | null; created_name: string | null; created_at: string; updated_at: string
  sumber?: string | null; customer_id?: number | null; so_number?: string | null; jumlah_gambar?: number | null; desain?: Desain[]; roto?: 'dengan' | 'tanpa' | null
}
type Asal = '' | 'prospek' | 'so' | 'produk'
const ASAL: [Asal, string][] = [['', 'Semua'], ['prospek', 'Prospek'], ['so', 'Sales Order'], ['produk', 'Data Produk']]
type ListRes = { items: Analysis[]; counts: Partial<Record<Status, number>>; asalCounts?: Record<string, number>; can: { create: boolean; ppic?: boolean; teknik: boolean; direksi: boolean } }
type Can = { marketing: boolean; teknik: boolean; direksi: boolean; delete: boolean }
export type TaPrefill = { prospect_id: number; nama_customer: string; products: { label: string; jenis_plastik?: string | null; qty_kg?: number | string | null; catatan?: string | null }[] }

const fmt = (v: number | null | undefined) => (v === null || v === undefined ? '' : String(v).replace('.', ','))

// Daftar analisa (menu Analisa Teknik Order, tab di Prospek, atau bagian di detail prospek bila prospectId diisi)
// sumber='produk': hanya analisa yang diajukan dari Data Produk (tab Analisa Teknik di menu Data Produk)
// sumber='marketing': pengajuan Marketing (menu Pengajuan Analisa Teknik); 'ppic': pengajuan PPIC dari Sales Order (tombol Ajukan dari SO)
export function TechAnalysisView({ user, prospectId, prefill, focusId, compact = false, allowCreate = true, sumber }: { user: UserProfile; prospectId?: number; prefill?: TaPrefill; focusId?: number | null; compact?: boolean; allowCreate?: boolean; sumber?: 'produk' | 'marketing' | 'ppic' }) {
  const [data, setData] = useState<ListRes | null>(null)
  const [status, setStatus] = useState<Status | ''>('')
  const [asal, setAsal] = useState<Asal>('')
  const [q, setQ] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [creating, setCreating] = useState(false)
  const [openId, setOpenId] = useState<number | null>(focusId ?? null)
  const load = useCallback(async () => {
    try {
      const p = new URLSearchParams()
      if (prospectId) p.set('prospect_id', String(prospectId))
      if (sumber) p.set('sumber', sumber)
      if (status) p.set('status', status)
      if (asal) p.set('asal', asal)
      if (q.trim()) p.set('q', q.trim())
      setData(await api<ListRes>(`/api/tech-analyses?${p}`))
      setError('')
    } catch (e) {
      setError((e as Error).message)
    }
  }, [prospectId, sumber, status, asal, q])
  useEffect(() => { const t = setTimeout(load, q ? 300 : 0); return () => clearTimeout(t) }, [load, q])
  useEffect(() => { if (focusId) setOpenId(focusId) }, [focusId])
  const paged = usePaged(data?.items ?? [], [status, asal, q, prospectId])
  const can = data?.can

  const list = (
    <>
      {error && <Notice onClose={() => setError('')}>{error}</Notice>}
      {notice && <Notice kind="success" onClose={() => setNotice('')}>{notice}</Notice>}
      {!compact && (
        <div className="pap-stat-grid four">
          {FLOW.map((s, i) => {
            const Icon = STAGE_ICON[s]
            return (
              <button key={s} type="button" className={`pap-stat-card pap-stat-button ${status === s ? 'active' : ''}`} onClick={() => setStatus(status === s ? '' : s)} aria-pressed={status === s}>
                <div><span>{i + 1}. {STATUS[s]}</span><strong className="pap-stat-text">{data?.counts[s] ?? 0}</strong><small className="neutral">{STAGE_NOTE[s]}</small></div>
                <div className={`pap-stat-icon stat-${i}`}><Icon /></div>
              </button>
            )
          })}
        </div>
      )}
      <div className={compact ? 'pap-ta-compact' : 'pap-table-card'}>
        {!compact && (
          <div className="pap-card-head">
            <div><h2>{sumber === 'ppic' ? 'Pengajuan analisa teknik PPIC' : 'Analisa teknik order baru / spec baru'}</h2><p>{sumber === 'ppic' ? 'Pengajuan dari Sales Order Accurate (customer & produk sudah terisi), dianalisa Dept Teknik lalu diberi rekomendasi Direksi.' : 'Spek order dari Marketing dianalisa Dept Teknik per urutan proses mesin, lalu diberi rekomendasi Direksi. Bisa dicetak PDF & Word.'}</p></div>
            {allowCreate && (sumber === 'ppic' ? can?.ppic : can?.create) && <button className="pap-primary-button" onClick={() => setCreating(true)}><Plus /> {sumber === 'ppic' ? 'Ajukan dari Sales Order' : 'Analisa baru'}</button>}
          </div>
        )}
        {!compact && !sumber && (
          <div className="pap-ta-asal" role="tablist" aria-label="Asal data analisa">
            {ASAL.filter(([k]) => k !== 'produk' || (data?.asalCounts?.produk ?? 0) > 0 || asal === 'produk').map(([k, label]) => (
              <button key={k || 'semua'} type="button" role="tab" aria-selected={asal === k} className={asal === k ? 'active' : ''} onClick={() => setAsal(k)}>
                {label}<b>{data?.asalCounts?.[k || 'semua'] ?? 0}</b>
              </button>
            ))}
          </div>
        )}
        {!compact && (
          <div className="pap-filters">
            <label className="pap-filter-search"><Search /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari nomor, produk, customer, jenis plastik..." /></label>
            <select className="pap-select" value={status} onChange={(e) => setStatus(e.target.value as Status | '')} aria-label="Status"><option value="">Semua status</option>{FLOW.map((s) => <option key={s} value={s}>{STATUS[s]}</option>)}</select>
          </div>
        )}
        <div className="pap-table-wrap">
          <table className="pap-ta-table">
            <thead><tr><th>No. pengajuan & produk</th><th>Customer</th><th>Spek</th><th>Kesimpulan Teknik</th><th>Status</th><th aria-label="Aksi" /></tr></thead>
            <tbody>
              {paged.items.map((a) => (
                <tr key={a.id} className="pap-clickable" tabIndex={0} onClick={() => setOpenId(a.id)} onKeyDown={(e) => e.key === 'Enter' && setOpenId(a.id)}>
                  <td><div className="pap-cc-nomor">{a.nomor} · {formatDate(a.created_at)}</div><div className="pap-cell-title">{a.nama_produk}</div></td>
                  <td><div>{a.nama_customer}</div><div className="pap-cell-sub">{[a.so_number, a.created_name && `oleh ${a.created_name}`, a.sumber === 'ppic' ? 'PPIC' : null].filter(Boolean).join(' · ')}</div></td>
                  <td className="pap-cell-sub">{[a.jenis_plastik, a.panjang_cm && a.lebar_cm ? `${fmt(a.panjang_cm)}×${fmt(a.lebar_cm)} cm` : null, a.tebal_mm ? `${fmt(a.tebal_mm)} mm` : null, a.print_jenis === 'print' ? `print ${a.jumlah_warna ?? ''} wrn` : a.print_jenis === 'polos' ? 'polos' : null].filter(Boolean).join(' · ') || '—'}</td>
                  <td>{a.bisa_produksi ? <span className={`pap-ta-verdict ${a.bisa_produksi}`}>{BISA[a.bisa_produksi]}</span> : <span className="pap-muted">—</span>}{a.kesulitan_kualitas && <div className="pap-cell-sub">Kualitas: {KUALITAS[a.kesulitan_kualitas]}</div>}</td>
                  <td><span className={`pap-status ${TONE[a.status]}`}>{STATUS[a.status]}</span></td>
                  <td onClick={(e) => e.stopPropagation()}><div className="pap-ta-row-actions"><RowActions label={a.nomor} onView={() => setOpenId(a.id)} /><DocActions id={a.id} nomor={a.nomor} compact /></div></td>
                </tr>
              ))}
            </tbody>
          </table>
          {data && !data.items.length && <div className="pap-empty">{compact ? 'Belum ada analisa teknik untuk produk prospek ini.' : q || status ? 'Tidak ada analisa yang cocok.' : 'Belum ada analisa teknik order.'}</div>}
          {!data && !error && <div className="pap-empty">Memuat...</div>}
          {!compact && <Pager {...paged.pager} noun="analisa" />}
        </div>
      </div>
    </>
  )

  return (
    <>
      {compact ? (
        <section className="pap-detail-section">
          <div className="pap-ta-compact-head">
            <h3><Ruler className="pap-inline-icon" /> Analisa teknik order ({data?.items.length ?? 0})</h3>
            <div className="pap-ta-row-actions">
              {prospectId && <ProspectDocActions prospectId={prospectId} />}
              {can?.create && allowCreate && <button type="button" className="pap-btn" onClick={() => setCreating(true)}><Plus /> Analisa teknik</button>}
            </div>
          </div>
          {!allowCreate && <p className="pap-muted pap-ta-hint">Analisa dibuat dari <b>Edit data</b> prospek: buka <b>Spek teknik</b> pada produk lalu centang <b>Minta analisa ke Dept Teknik</b>.</p>}
          {list}
        </section>
      ) : list}
      {creating && sumber === 'ppic' && <PpicAnalysisForm onClose={() => setCreating(false)} onSaved={(msg) => { setCreating(false); setNotice(msg); load() }} />}
      {creating && sumber !== 'ppic' && <TechAnalysisForm prefill={prefill} onClose={() => setCreating(false)} onSaved={(id, msg) => { setCreating(false); setNotice(msg); load(); setOpenId(id) }} />}
      {openId && <TechAnalysisDetail id={openId} user={user} onClose={() => setOpenId(null)} onChanged={(msg) => { if (msg) setNotice(msg); load() }} />}
    </>
  )
}

// ---------- Bagian Marketing (form buat / ubah) ----------
type MarketingValues = {
  nama_produk: string; nama_customer: string; jenis_plastik: string; panjang_cm: string; lebar_cm: string; tebal_mm: string; print_jenis: '' | 'polos' | 'print'
  jumlah_warna: string; kesulitan_print: string; spec_lainnya: string; qty_order: string; qty_satuan: string; frekuensi: '' | 'sekali' | 'rutin'; rutin_bulan: string; critical_to_quality: string
  jumlah_gambar: string; desain: Desain[]
}
const toValues = (a?: Partial<Analysis>): MarketingValues => ({
  nama_produk: a?.nama_produk ?? '', nama_customer: a?.nama_customer ?? '', jenis_plastik: a?.jenis_plastik ?? '', panjang_cm: fmt(a?.panjang_cm), lebar_cm: fmt(a?.lebar_cm), tebal_mm: fmt(a?.tebal_mm),
  print_jenis: a?.print_jenis ?? '', jumlah_warna: fmt(a?.jumlah_warna), kesulitan_print: a?.kesulitan_print ?? '', spec_lainnya: a?.spec_lainnya ?? '', qty_order: fmt(a?.qty_order),
  qty_satuan: a?.qty_satuan ?? 'kg', frekuensi: a?.frekuensi ?? '', rutin_bulan: fmt(a?.rutin_bulan), critical_to_quality: a?.critical_to_quality ?? '',
  jumlah_gambar: fmt(a?.jumlah_gambar), desain: a?.desain ?? [],
})

// lockNames: nama produk & customer dari Sales Order (PPIC) tidak diubah; gambar: bagian lampiran gambar di bawah form
function MarketingFields({ v, set, disabled, products, onPickProduct, lockNames, gambar }: {
  v: MarketingValues; set: (patch: Partial<MarketingValues>) => void; disabled?: boolean
  products?: TaPrefill['products']; onPickProduct?: (i: number) => void; lockNames?: boolean; gambar?: React.ReactNode
}) {
  const on = (k: keyof MarketingValues) => (e: { target: { value: string } }) => set({ [k]: e.target.value } as Partial<MarketingValues>)
  const numOnly = (k: keyof MarketingValues) => (e: { target: { value: string } }) => set({ [k]: e.target.value.replace(/[^\d.,]/g, '') } as Partial<MarketingValues>)
  return (
    <div className="pap-ta-fields">
      {!!products?.length && onPickProduct && (
        <div className="pap-field full">
          <span>Ambil dari produk prospek</span>
          <div className="pap-chip-tabs">{products.map((p, i) => <button type="button" key={`${p.label}-${i}`} className={v.nama_produk === p.label ? 'active' : ''} onClick={() => onPickProduct(i)}>{p.label}</button>)}</div>
        </div>
      )}
      <div className="pap-form-grid">
        <Field label="Nama produk *"><input className="pap-input" required maxLength={255} disabled={disabled || lockNames} value={v.nama_produk} onChange={on('nama_produk')} placeholder="mis. HD Jinjing Gusset Uk 45 Print Logo" /></Field>
        <Field label="Nama customer *"><input className="pap-input" required maxLength={255} disabled={disabled || lockNames} value={v.nama_customer} onChange={on('nama_customer')} /></Field>
      </div>
      <h4 className="pap-ta-sub-h">Spec order</h4>
      <div className="pap-form-grid pap-ta-grid4">
        <Field label="Jenis plastik"><input className="pap-input" maxLength={80} list="pap-ta-plastik" disabled={disabled} value={v.jenis_plastik} onChange={on('jenis_plastik')} placeholder="HD / PP / PE" /><datalist id="pap-ta-plastik">{['HD', 'PP', 'PE', 'LDPE', 'LLDPE', 'Mika'].map((x) => <option key={x} value={x} />)}</datalist></Field>
        <Field label="Panjang (cm)"><input className="pap-input" inputMode="decimal" disabled={disabled} value={v.panjang_cm} onChange={numOnly('panjang_cm')} /></Field>
        <Field label="Lebar (cm)"><input className="pap-input" inputMode="decimal" disabled={disabled} value={v.lebar_cm} onChange={numOnly('lebar_cm')} /></Field>
        <Field label="Tebal (mm)"><input className="pap-input" inputMode="decimal" disabled={disabled} value={v.tebal_mm} onChange={numOnly('tebal_mm')} placeholder="mis. 0,03" /></Field>
      </div>
      <div className="pap-form-grid pap-ta-grid4">
        <div className="pap-field">
          <span>Polos / print</span>
          <div className="pap-segmented" role="radiogroup" aria-label="Polos atau print">
            {(['polos', 'print'] as const).map((k) => <button type="button" key={k} role="radio" aria-checked={v.print_jenis === k} disabled={disabled} className={v.print_jenis === k ? 'active' : ''} onClick={() => set({ print_jenis: v.print_jenis === k ? '' : k })}>{k === 'polos' ? 'Polos' : 'Print'}</button>)}
          </div>
        </div>
        {v.print_jenis === 'print' && <Field label="Jumlah warna print"><input className="pap-input" inputMode="numeric" disabled={disabled} value={v.jumlah_warna} onChange={numOnly('jumlah_warna')} /></Field>}
        {v.print_jenis === 'print' && <Field label="Tingkat kesulitan print"><input className="pap-input" maxLength={255} disabled={disabled} value={v.kesulitan_print} onChange={on('kesulitan_print')} placeholder="mis. gradasi, register ketat" /></Field>}
        <Field label="Jumlah gambar per kantong (diisi PPIC)"><input className="pap-input" inputMode="numeric" disabled={disabled} value={v.jumlah_gambar} onChange={numOnly('jumlah_gambar')} placeholder="mis. 2" /></Field>
      </div>
      <Field label="Spec lainnya (airhole, pillow case, dll.)" full><textarea className="pap-input" rows={2} maxLength={5000} disabled={disabled} value={v.spec_lainnya} onChange={on('spec_lainnya')} /></Field>
      <div className="pap-form-grid pap-ta-grid4">
        <div className="pap-field"><span>Qty order</span><div className="pap-proj-unit"><input className="pap-input" inputMode="decimal" disabled={disabled} value={v.qty_order} onChange={numOnly('qty_order')} /><select className="pap-select" disabled={disabled} value={v.qty_satuan} onChange={on('qty_satuan')} aria-label="Satuan">{['kg', 'pcs', 'lembar', 'roll', 'pack'].map((s) => <option key={s} value={s}>{s}</option>)}</select></div></div>
        <div className="pap-field">
          <span>Frekuensi order</span>
          <div className="pap-segmented" role="radiogroup" aria-label="Frekuensi order">
            {(['sekali', 'rutin'] as const).map((k) => <button type="button" key={k} role="radio" aria-checked={v.frekuensi === k} disabled={disabled} className={v.frekuensi === k ? 'active' : ''} onClick={() => set({ frekuensi: v.frekuensi === k ? '' : k })}>{k === 'sekali' ? 'Hanya 1x' : 'Rutin'}</button>)}
          </div>
        </div>
        {v.frekuensi === 'rutin' && <Field label="Rutin per ... bulan"><input className="pap-input" inputMode="numeric" disabled={disabled} value={v.rutin_bulan} onChange={numOnly('rutin_bulan')} placeholder="1" /></Field>}
      </div>
      <Field label="Critical to quality" full><textarea className="pap-input" rows={2} maxLength={5000} disabled={disabled} value={v.critical_to_quality} onChange={on('critical_to_quality')} placeholder="mis. kekuatan sealing, warna logo harus sesuai, tidak boleh bau" /></Field>
      {gambar}
    </div>
  )
}

// ---------- Gambar produk: lampiran file gambar + desain dari Master Data (Logo & Desain) ----------
// analysisId: lampiran langsung tersimpan (detail); pending: file disimpan setelah analisa dibuat (form baru)
export function GambarProduk({ desain, onDesain, customerId, disabled, analysisId, pending, onPending, canAdd = true }: {
  desain: Desain[]; onDesain: (d: Desain[]) => void; customerId?: number | null; disabled?: boolean
  analysisId?: number; pending?: PendingAttachments; onPending?: (p: PendingAttachments) => void; canAdd?: boolean
}) {
  const [picking, setPicking] = useState(false)
  return (
    <div className="pap-ta-gambar">
      <h4 className="pap-ta-sub-h"><ImageIcon className="pap-inline-icon" /> Gambar produk</h4>
      {analysisId
        ? <AttachmentPanel title="File gambar" basePath={`/api/notes/tech_analysis/${analysisId}/attachments`} fileBase="/api/notes/attachments" canAdd={canAdd && !disabled} currentUserId={0} isAdmin={false} pasteImages={canAdd && !disabled} preview />
        : pending && onPending && <AttachmentInput value={pending} onChange={onPending} pasteImages />}
      <div className="pap-ta-desain">
        <span className="pap-ta-desain-label">Desain dari Master Data <small className="pap-muted">(Logo &amp; Desain)</small></span>
        {desain.length > 0 && (
          <div className="pap-oc-designs">
            {desain.map((d) => (
              <figure key={d.id} className="pap-oc-design">
                <a href={d.web_link ?? `/api/order-custom/designs/${encodeURIComponent(d.id)}/thumb?s=1200`} target="_blank" rel="noreferrer" title={`Buka ${d.name}`}><DesignThumb d={d} /></a>
                <figcaption title={d.name}>{d.name}</figcaption>
                {!disabled && <button type="button" className="pap-oc-design-x" aria-label={`Lepas ${d.name}`} onClick={() => onDesain(desain.filter((x) => x.id !== d.id))}><X /></button>}
              </figure>
            ))}
          </div>
        )}
        {!disabled && <button type="button" className="pap-btn" onClick={() => setPicking(true)}><Search /> Cari gambar di Master Data</button>}
        {disabled && !desain.length && <p className="pap-muted pap-ta-hint">Tidak ada desain dari Master Data.</p>}
      </div>
      {picking && <DesignPicker selected={desain} customerId={customerId ?? null} onClose={() => setPicking(false)} onDone={(list) => { onDesain(list); setPicking(false) }} />}
    </div>
  )
}

// Unggah file gambar yang belum tersimpan ke analisa (setelah analisa dibuat dari form)
export async function uploadAnalysisImages(analysisId: number, pending: PendingAttachments) {
  return pendingCount(pending) ? uploadPendingAttachments(`/api/notes/tech_analysis/${analysisId}/attachments`, pending) : []
}

// Setelah prospek / produk disimpan: unggah gambar per produk ke analisanya (dicari ulang per nama produk).
// Mengembalikan teks peringatan bila ada yang gagal ('' bila semua beres / tidak ada file)
export async function uploadTeknikFiles(list: { label: string; teknik?: TeknikSpec | null }[], find: () => Promise<Map<string, TeknikSpec>>) {
  const todo = list.filter((p) => p.teknik?.minta && p.teknik.files && pendingCount(p.teknik.files))
  if (!todo.length) return ''
  try {
    const map = await find()
    const failed: string[] = []
    for (const p of todo) {
      const id = map.get(p.label.trim().toLowerCase())?.analysis?.id
      if (!id) { failed.push(`${p.label}: analisa belum dibuat.`); continue }
      failed.push(...(await uploadAnalysisImages(id, p.teknik!.files!)))
    }
    return failed.length ? ` ${failed.length} gambar analisa gagal diunggah: ${failed.join(' ')}` : ''
  } catch (err) {
    return ` Gambar analisa gagal diunggah: ${(err as Error).message}`
  }
}

const fromPrefill = (prefill: TaPrefill | undefined, base: MarketingValues): MarketingValues => {
  const p = prefill?.products[0]
  return { ...base, nama_customer: prefill?.nama_customer ?? base.nama_customer, nama_produk: p?.label ?? base.nama_produk, jenis_plastik: p?.jenis_plastik ?? base.jenis_plastik, qty_order: p?.qty_kg ? String(p.qty_kg) : base.qty_order, spec_lainnya: p?.catatan ?? base.spec_lainnya }
}

function TechAnalysisForm({ prefill, onClose, onSaved }: { prefill?: TaPrefill; onClose: () => void; onSaved: (id: number, msg: string) => void }) {
  // Dari detail prospek: prospek sudah tertentu; dari tab / menu: pilih prospek dulu (atau isi manual)
  const [source, setSource] = useState<(TaPrefill & { nama?: string }) | undefined>(prefill)
  const [v, setV] = useState<MarketingValues>(() => fromPrefill(prefill, toValues()))
  const [files, setFiles] = useState<PendingAttachments>(emptyAttachments)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  function pick(i: number) {
    const p = source!.products[i]
    setV({ ...v, nama_produk: p.label, jenis_plastik: p.jenis_plastik ?? v.jenis_plastik, qty_order: p.qty_kg ? String(p.qty_kg) : v.qty_order, spec_lainnya: p.catatan ?? v.spec_lainnya })
  }
  async function save(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const res = await api<{ id: number; nomor: string }>('/api/tech-analyses', { method: 'POST', json: { ...v, prospect_id: source?.prospect_id ?? null } })
      const failed = await uploadAnalysisImages(res.id, files)
      onSaved(res.id, `Analisa teknik ${res.nomor} dibuat.${failed.length ? ` ${failed.length} gambar gagal diunggah: ${failed.join(' ')}` : ''} Lengkapi lalu klik "Serahkan ke Teknik".`)
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
    }
  }
  return (
    <Modal title="Analisa teknik order baru" subtitle="Bagian Marketing: isi spek order, lalu serahkan ke Dept Teknik" wide onClose={onClose}
      footer={<><span className="pap-spacer" /><button type="button" className="pap-btn" onClick={onClose}>Batal</button><button className="pap-primary-button" form="pap-ta-form" disabled={busy}>{busy ? 'Menyimpan...' : 'Simpan'}</button></>}>
      <form id="pap-ta-form" onSubmit={save}>
        {error && <Notice onClose={() => setError('')}>{error}</Notice>}
        {!prefill && (
          <ProspectPicker value={source} onPick={(s) => { setSource(s); setV(s ? fromPrefill(s, { ...v, nama_produk: '', jenis_plastik: '', qty_order: '', spec_lainnya: '' }) : v) }} onError={setError} />
        )}
        <MarketingFields v={v} set={(p) => setV({ ...v, ...p })} products={source?.products} onPickProduct={pick}
          gambar={<GambarProduk desain={v.desain} onDesain={(d) => setV({ ...v, desain: d })} pending={files} onPending={setFiles} />} />
      </form>
    </Modal>
  )
}

// ---------- Detail: spek (Marketing), analisa proses (Teknik), rekomendasi (Direksi) ----------
function TechAnalysisDetail({ id, user, onClose, onChanged }: { id: number; user: UserProfile; onClose: () => void; onChanged: (msg?: string) => void }) {
  const [a, setA] = useState<Analysis | null>(null)
  const [can, setCan] = useState<Can | null>(null)
  const [tab, setTab] = useState<'spek' | 'teknik' | 'direksi'>('spek')
  const [mv, setMv] = useState<MarketingValues>(toValues())
  const [proses, setProses] = useState<Proses[]>([])
  const [tv, setTv] = useState({ kesulitan_print: '', bisa_produksi: '', penjelasan_produksi: '', kesulitan_kualitas: '', penjelasan_kualitas: '', catatan_lain: '' })
  const [rek, setRek] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [needBisa, setNeedBisa] = useState(false)

  const load = useCallback(async () => {
    try {
      const r = await api<{ item: Analysis; can: Can }>(`/api/tech-analyses/${id}`)
      const x = r.item
      setA(x)
      setCan(r.can)
      setMv(toValues(x))
      setProses(x.proses)
      setTv({ kesulitan_print: x.kesulitan_print ?? '', bisa_produksi: x.bisa_produksi ?? '', penjelasan_produksi: x.penjelasan_produksi ?? '', kesulitan_kualitas: x.kesulitan_kualitas ?? '', penjelasan_kualitas: x.penjelasan_kualitas ?? '', catatan_lain: x.catatan_lain ?? '' })
      setRek(x.rekomendasi_direksi ?? '')
      setTab((t) => (t === 'spek' && x.status === 'diserahkan' && r.can.teknik ? 'teknik' : t === 'spek' && x.status === 'dianalisa' && r.can.direksi ? 'direksi' : t))
      setError('')
    } catch (e) {
      setError((e as Error).message)
    }
  }, [id])
  useEffect(() => { load() }, [load])

  async function run(task: () => Promise<unknown>, msg: string) {
    setBusy(true)
    setError('')
    try {
      await task()
      setNotice(msg)
      await load()
      onChanged()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const saveMarketing = () => run(() => api(`/api/tech-analyses/${id}`, { method: 'PUT', json: { bagian: 'marketing', ...mv, prospect_id: a?.prospect_id } }), 'Spek order disimpan.')
  const saveTeknik = (selesai: boolean) => run(() => api(`/api/tech-analyses/${id}`, { method: 'PUT', json: { bagian: 'teknik', proses, ...tv, selesai } }), selesai ? 'Analisa teknik selesai dan diparaf. Marketing & Direksi diberi tahu.' : 'Analisa disimpan (belum diparaf).')
  const saveDireksi = () => run(() => api(`/api/tech-analyses/${id}`, { method: 'PUT', json: { bagian: 'direksi', rekomendasi_direksi: rek } }), 'Rekomendasi Direksi disimpan. Analisa selesai.')
  const flow = (action: 'serahkan' | 'tarik' | 'buka', msg: string) => run(() => api(`/api/tech-analyses/${id}`, { method: 'PATCH', json: { action } }), msg)
  async function remove() {
    if (!a || !(await confirmDialog({ title: 'Hapus analisa teknik?', message: `${a.nomor} · ${a.nama_produk}\n\nDipindah ke Data Terhapus dan bisa dipulihkan.`, confirmLabel: 'Hapus', tone: 'danger' }))) return
    try {
      await api(`/api/tech-analyses/${id}`, { method: 'DELETE' })
      onChanged(`Analisa ${a.nomor} dihapus.`)
      onClose()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  if (!a || !can) return <Modal title="Analisa teknik" onClose={onClose}>{error ? <Notice>{error}</Notice> : <p className="pap-muted">Memuat...</p>}</Modal>
  const step = FLOW.indexOf(a.status)
  const setRow = (i: number, patch: Partial<Proses>) => setProses(proses.map((p, j) => (j === i ? { ...p, ...patch } : p)))
  const used = proses.filter((p) => p.dipakai)

  return (
    <Modal title={`No. Pengajuan ${a.nomor} · ${a.nama_produk}`} subtitle={`${a.nama_customer}${a.prospect_name && a.prospect_name !== a.nama_customer ? ` · prospek ${a.prospect_name}` : ''} · dibuat ${a.created_name ?? ''} ${formatDate(a.created_at)}`} wide onClose={onClose}
      footer={<>
        {can.delete && <button type="button" className="pap-btn danger" onClick={remove}><Trash2 /> Hapus</button>}
        <span className="pap-spacer" />
        <DocActions id={a.id} nomor={a.nomor} />
      </>}>
      {error && <Notice onClose={() => setError('')}>{error}</Notice>}
      {notice && <Notice kind="success" onClose={() => setNotice('')}>{notice}</Notice>}
      <ol className="pap-cc-stepper pap-ta-stepper" aria-label="Tahap analisa">
        {FLOW.map((s, i) => (
          <li key={s} className={i < step ? 'done' : i === step ? 'current' : ''}>
            <span className="pap-cc-dot">{i < step || (i === step && s === 'selesai') ? <CheckCircle2 /> : i + 1}</span>
            <b>{FLOW_LABEL[s]}</b>
            <small>{s === 'diserahkan' && a.tanggal_serah ? formatDate(a.tanggal_serah) : s === 'dianalisa' && a.teknik_at ? `${a.teknik_name ?? ''} ${formatDate(a.teknik_at)}` : s === 'selesai' && a.direksi_at ? `${a.direksi_name ?? ''} ${formatDate(a.direksi_at)}` : ''}</small>
          </li>
        ))}
      </ol>

      <div className="pap-ta-docbar">
        <span><Printer className="pap-inline-icon" /> Dokumen analisa {a.nomor}: pratinjau PDF, cetak, atau unduh Word</span>
        <DocActions id={a.id} nomor={a.nomor} compact />
      </div>

      <div className="pap-segmented pap-page-tabs" role="tablist" aria-label="Bagian analisa">
        <button role="tab" aria-selected={tab === 'spek'} className={tab === 'spek' ? 'active' : ''} onClick={() => setTab('spek')}>1. Spek order (Marketing)</button>
        <button role="tab" aria-selected={tab === 'teknik'} className={tab === 'teknik' ? 'active' : ''} onClick={() => setTab('teknik')}>2. Analisa proses (Teknik)</button>
        <button role="tab" aria-selected={tab === 'direksi'} className={tab === 'direksi' ? 'active' : ''} onClick={() => setTab('direksi')}>3. Rekomendasi Direksi</button>
      </div>

      {tab === 'spek' && (
        <div className="pap-ta-section">
          <MarketingFields v={mv} set={(p) => setMv({ ...mv, ...p })} disabled={!can.marketing} lockNames={a.sumber === 'ppic'}
            gambar={<GambarProduk desain={mv.desain} onDesain={(d) => setMv({ ...mv, desain: d })} customerId={a.customer_id} disabled={!can.marketing} analysisId={a.id} canAdd={a.status !== 'selesai'} />} />
          {a.so_number && <p className="pap-muted pap-ta-hint">Dari Sales Order {a.so_number} (PPIC): nama produk & customer mengikuti SO Accurate.</p>}
          {can.marketing && (
            <div className="pap-inline-actions pap-wrap pap-ta-actions">
              {a.status === 'diserahkan' && <button type="button" className="pap-btn" disabled={busy} onClick={() => flow('tarik', 'Analisa ditarik kembali ke draft Marketing.')}><Undo2 /> Tarik dari Teknik</button>}
              <span className="pap-spacer" />
              <button type="button" className="pap-btn" disabled={busy} onClick={saveMarketing}><Save /> Simpan spek</button>
              {a.status === 'draft' && <button type="button" className="pap-primary-button" disabled={busy} onClick={async () => { await saveMarketing(); await flow('serahkan', 'Diserahkan ke Dept Teknik. Tim Teknik diberi tahu.') }}><Send /> Serahkan ke Teknik</button>}
            </div>
          )}
        </div>
      )}

      {tab === 'teknik' && (
        <div className="pap-ta-section">
          {a.status === 'draft' && <Notice>Belum diserahkan Marketing ke Dept Teknik.</Notice>}
          <div className="pap-field pap-ta-print-diff">
            <span>Tingkat kesulitan print {a.print_jenis === 'print' ? <small className="pap-muted">· print {a.jumlah_warna ?? '…'} warna</small> : a.print_jenis === 'polos' ? <small className="pap-muted">· order polos</small> : null}</span>
            <div className="pap-ta-print-diff-row">
              <div className="pap-segmented" role="radiogroup" aria-label="Tingkat kesulitan print">
                {['Mudah', 'Sedang', 'Sulit'].map((k) => {
                  const on = tv.kesulitan_print.toLowerCase().startsWith(k.toLowerCase())
                  return <button type="button" key={k} role="radio" aria-checked={on} disabled={!can.teknik} className={on ? 'active' : ''} onClick={() => setTv({ ...tv, kesulitan_print: on ? '' : `${k}${tv.kesulitan_print.replace(/^(mudah|sedang|sulit)s*[-·,:]?s*/i, '') ? ` · ${tv.kesulitan_print.replace(/^(mudah|sedang|sulit)s*[-·,:]?s*/i, '')}` : ''}` })}>{k}</button>
                })}
              </div>
              <input className="pap-input" maxLength={255} disabled={!can.teknik} value={tv.kesulitan_print} onChange={(e) => setTv({ ...tv, kesulitan_print: e.target.value })} placeholder="mis. Sedang · register ketat, gradasi warna" aria-label="Keterangan tingkat kesulitan print" />
            </div>
          </div>
          <p className="pap-muted pap-ta-hint">Centang mesin / proses yang dipakai sesuai urutan, lalu isi kecepatan mesin, kecepatan roto maksimum, jalur & tumpuk (mesin Inline Blow-Roto: jumlah warna), keterangan, dan hasil produktivitas per jam (kg).</p>
          <div className="pap-ta-proses-list">
            {proses.map((p, i) => (
              <div key={i} className={`pap-ta-proc ${p.dipakai ? 'on' : ''}`}>
                <label className="pap-ta-proc-name">
                  <input type="checkbox" checked={p.dipakai} disabled={!can.teknik} onChange={(e) => setRow(i, { dipakai: e.target.checked })} />
                  {p.mesin}
                </label>
                {/* Isian baru muncul setelah mesin dicentang */}
                {p.dipakai && <>
                <label className="pap-ta-proc-f"><span>{p.kec_label || 'Kecepatan'}</span><input className="pap-input" maxLength={120} disabled={!can.teknik} value={p.kecepatan} onChange={(e) => setRow(i, { kecepatan: e.target.value, dipakai: p.dipakai || !!e.target.value })} placeholder="—" /></label>
                <label className="pap-ta-proc-f"><span title="Kecepatan Roto Maksimum">Kec Roto Max</span><input className="pap-input" maxLength={120} disabled={!can.teknik} value={p.kec_roto_max ?? ''} onChange={(e) => setRow(i, { kec_roto_max: e.target.value, dipakai: p.dipakai || !!e.target.value })} placeholder="—" /></label>
                {isRotoMesin(p.mesin)
                  ? <label className="pap-ta-proc-f span2"><span>Jumlah Warna</span><input className="pap-input" maxLength={120} disabled={!can.teknik} value={p.warna ?? ''} onChange={(e) => setRow(i, { warna: e.target.value })} placeholder="mis. 4" /></label>
                  : <>
                    <label className="pap-ta-proc-f small"><span>Jalur</span><input className="pap-input" maxLength={120} disabled={!can.teknik} value={p.jalur ?? ''} onChange={(e) => setRow(i, { jalur: e.target.value })} placeholder="mis. 2" /></label>
                    <label className="pap-ta-proc-f small"><span>Tumpuk</span><input className="pap-input" maxLength={120} disabled={!can.teknik} value={p.tumpuk ?? ''} onChange={(e) => setRow(i, { tumpuk: e.target.value })} placeholder="mis. 3" /></label>
                  </>}
                <label className="pap-ta-proc-f"><span>Keterangan</span><input className="pap-input" maxLength={500} disabled={!can.teknik} value={p.keterangan} onChange={(e) => setRow(i, { keterangan: e.target.value })} placeholder="—" /></label>
                <label className="pap-ta-proc-f small"><span>Hasil Produktivitas (kg/jam)</span><input className="pap-input" inputMode="decimal" disabled={!can.teknik} value={p.produktivitas ?? ''} onChange={(e) => { const t = e.target.value.replace(/[^\d.,]/g, ''); setRow(i, { produktivitas: t ? Number(t.replace(',', '.')) : null, dipakai: p.dipakai || !!t }) }} placeholder="0" /></label>
                </>}
              </div>
            ))}
          </div>
          {can.teknik && <button type="button" className="pap-link-button pap-shift-edit" onClick={() => setProses([...proses, { mesin: 'Proses lain', kec_label: '', dipakai: true, kecepatan: '', kec_roto_max: '', jalur: '', tumpuk: '', warna: '', keterangan: '', produktivitas: null }])}><Plus /> Tambah proses lain</button>}
          <p className="pap-muted pap-ta-hint">{used.length} proses dipakai{used.length ? `: ${used.map((p) => p.mesin).join(' → ')}` : ''}</p>

          <h4 className="pap-ta-sub-h"><Wrench className="pap-inline-icon" /> Kesimpulan analisa teknis produksi</h4>
          <div className={`pap-field ${needBisa && !tv.bisa_produksi ? 'pap-field-error' : ''}`} id={`pap-ta-bisa-${id}`}>
            <span>1. Bisa / tidak bisa diproduksi dengan produktivitas yang optimal *</span>
            <div className="pap-ta-choice">{(Object.keys(BISA) as (keyof typeof BISA)[]).map((k) => <button type="button" key={k} disabled={!can.teknik} className={`pap-ta-choice-btn ${k} ${tv.bisa_produksi === k ? 'active' : ''}`} onClick={() => setTv({ ...tv, bisa_produksi: k })}>{BISA[k]}</button>)}</div>
            <textarea className="pap-input" rows={2} maxLength={5000} disabled={!can.teknik} value={tv.penjelasan_produksi} onChange={(e) => setTv({ ...tv, penjelasan_produksi: e.target.value })} placeholder="Penjelasan" />
          </div>
          <div className="pap-field">
            <span>2. Tingkat kesulitan untuk memenuhi kualitas</span>
            <div className="pap-ta-choice">{(Object.keys(KUALITAS) as (keyof typeof KUALITAS)[]).map((k) => <button type="button" key={k} disabled={!can.teknik} className={`pap-ta-choice-btn q-${k} ${tv.kesulitan_kualitas === k ? 'active' : ''}`} onClick={() => setTv({ ...tv, kesulitan_kualitas: k })}>{KUALITAS[k]}</button>)}</div>
            <textarea className="pap-input" rows={2} maxLength={5000} disabled={!can.teknik} value={tv.penjelasan_kualitas} onChange={(e) => setTv({ ...tv, penjelasan_kualitas: e.target.value })} placeholder="Penjelasan" />
          </div>
          <Field label="3. Catatan penting lainnya" full><textarea className="pap-input" rows={2} maxLength={5000} disabled={!can.teknik} value={tv.catatan_lain} onChange={(e) => setTv({ ...tv, catatan_lain: e.target.value })} /></Field>
          {a.teknik_name && <p className="pap-muted pap-ta-hint">Diparaf {a.teknik_name}, {formatDate(a.teknik_at, true)}</p>}
          <div className="pap-ta-docbar subtle"><span>Hasil analisa proses langsung tercetak di lembar analisa.</span><DocActions id={a.id} nomor={a.nomor} compact /></div>
          <div className="pap-inline-actions pap-wrap pap-ta-actions">
            {(a.status === 'dianalisa' || a.status === 'selesai') && (can.direksi || user.division.code === 'teknik' || user.role.isAdmin) && <button type="button" className="pap-btn" disabled={busy} onClick={() => flow('buka', 'Analisa dibuka lagi untuk Dept Teknik.')}><Undo2 /> Buka lagi untuk Teknik</button>}
            <span className="pap-spacer" />
            {can.teknik && <button type="button" className="pap-btn" disabled={busy} onClick={() => saveTeknik(false)}><Save /> Simpan</button>}
            {can.teknik && !tv.bisa_produksi && <small className="pap-muted pap-ta-need">Pilih poin 1 (bisa / tidak bisa diproduksi) dulu</small>}
            {can.teknik && <button type="button" className="pap-primary-button" disabled={busy} onClick={() => {
              // Poin 1 wajib: tunjukkan bagian yang belum diisi (bisa tertutup di atas layar)
              if (!tv.bisa_produksi) { setNeedBisa(true); document.getElementById(`pap-ta-bisa-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }); return }
              saveTeknik(true)
            }}><ClipboardCheck /> Selesai & paraf</button>}
          </div>
        </div>
      )}

      {tab === 'direksi' && (
        <div className="pap-ta-section">
          {a.status !== 'dianalisa' && a.status !== 'selesai' && <Notice>Rekomendasi Direksi diisi setelah Dept Teknik selesai menganalisa.</Notice>}
          {a.bisa_produksi && <div className={`pap-ta-summary ${a.bisa_produksi}`}><b>Kesimpulan Teknik:</b> {BISA[a.bisa_produksi]}{a.kesulitan_kualitas ? ` · kesulitan kualitas ${KUALITAS[a.kesulitan_kualitas].toLowerCase()}` : ''}{a.penjelasan_produksi ? <p>{a.penjelasan_produksi}</p> : null}</div>}
          <Field label="Rekomendasi dari Direksi" full><textarea className="pap-input" rows={4} maxLength={5000} disabled={!can.direksi} value={rek} onChange={(e) => setRek(e.target.value)} placeholder="mis. Lanjutkan dengan MOQ 500 kg, harga minimal Rp ..." /></Field>
          {a.direksi_name && <p className="pap-muted pap-ta-hint">Diparaf {a.direksi_name}, {formatDate(a.direksi_at, true)}</p>}
          {can.direksi && <div className="pap-inline-actions pap-ta-actions"><span className="pap-spacer" /><button type="button" className="pap-primary-button" disabled={busy || !rek.trim()} onClick={saveDireksi}><ClipboardCheck /> Simpan & paraf</button></div>}
        </div>
      )}

      {/* Tanda tangan digital Pengaju (PPIC / Marketing), Dept Tehnik, Direksi: tercetak di PDF & Word */}
      <TaSignatures analysis={a} userName={user.name} onChanged={() => onChanged()} />
    </Modal>
  )
}

// Menu "Analisa Teknik Order" (grup Teknik)
export function TechAnalysisPage({ user, focusId }: { user: UserProfile; focusId?: number | null }) {
  return (
    <>
      <div className="pap-page-heading">
        <div>
          <p className="pap-eyebrow">TEKNIK</p>
          <h1>Analisa Teknik Order</h1>
          <span>Analisa aspek teknik atas rencana order baru / spec baru dari Marketing: urutan proses mesin, kecepatan & produktivitas, kesimpulan bisa / tidak diproduksi, dan rekomendasi Direksi.</span>
        </div>
      </div>
      <TechAnalysisView user={user} focusId={focusId} />
    </>
  )
}

// Cari & pilih prospek: nama customer & produk prospek terisi otomatis
type ProspectHit = { id: number; nama_usaha: string; kota: string | null; kontak_nama: string | null; kebutuhan: string | null; status: string }
export function ProspectPicker({ value, onPick, onError }: { value: (TaPrefill & { nama?: string }) | undefined; onPick: (v: (TaPrefill & { nama?: string }) | undefined) => void; onError: (msg: string) => void }) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [hits, setHits] = useState<ProspectHit[]>([])
  const [loading, setLoading] = useState(false)
  useEffect(() => {
    if (!open) return
    const t = setTimeout(() => {
      api<{ items: ProspectHit[] }>(`/api/prospects?status=semua&pageSize=25${q.trim() ? `&q=${encodeURIComponent(q.trim())}` : ''}`)
        .then((r) => setHits(r.items)).catch(() => setHits([]))
    }, 250)
    return () => clearTimeout(t)
  }, [q, open])
  async function choose(h: ProspectHit) {
    setLoading(true)
    setOpen(false)
    try {
      const r = await api<{ item: { id: number; nama_usaha: string; products?: TaPrefill['products'] } }>(`/api/prospects/${h.id}`)
      onPick({ prospect_id: r.item.id, nama: r.item.nama_usaha, nama_customer: r.item.nama_usaha, products: (r.item.products ?? []).map((p) => ({ label: p.label, jenis_plastik: p.jenis_plastik, qty_kg: p.qty_kg, catatan: p.catatan })) })
    } catch (e) {
      onError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }
  return (
    <div className="pap-field pap-ta-prospect">
      <span>Ambil dari prospek <small className="pap-muted">(opsional; nama customer & produk terisi otomatis)</small></span>
      {value ? (
        <div className="pap-plan-picked">
          <div><b>{value.nama ?? value.nama_customer}</b><small>{value.products.length ? `${value.products.length} produk: ${value.products.map((p) => p.label).join(', ')}` : 'Prospek tanpa daftar produk'}</small></div>
          <button type="button" className="pap-btn" onClick={() => onPick(undefined)}>Ganti</button>
        </div>
      ) : (
        <div className="pap-proj-picker">
          <input className="pap-input" value={q} placeholder={loading ? 'Mengambil data prospek...' : 'Cari nama usaha, kontak, kota...'} disabled={loading}
            onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 180)} onChange={(e) => { setQ(e.target.value); setOpen(true) }} />
          {open && (
            <div className="pap-proj-drop" role="listbox">
              {hits.map((h) => (
                <button type="button" role="option" aria-selected={false} key={h.id} onMouseDown={(e) => e.preventDefault()} onClick={() => choose(h)}>
                  <b>{h.nama_usaha}</b><small>{[h.kontak_nama, h.kota, h.kebutuhan].filter(Boolean).join(' · ') || h.status}</small>
                </button>
              ))}
              {!hits.length && <p className="pap-muted">{q ? 'Prospek tidak ditemukan.' : 'Memuat prospek...'}</p>}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ---------- Spek teknik per produk di form Prospek (gabung dengan prospek) ----------
export type TeknikSpec = {
  minta: boolean; panjang_cm: string; lebar_cm: string; tebal_mm: string; print_jenis: '' | 'polos' | 'print'; jumlah_warna: string; kesulitan_print: string
  spec_lainnya: string; frekuensi: '' | 'sekali' | 'rutin'; rutin_bulan: string; critical_to_quality: string
  jumlah_gambar?: string; desain?: Desain[]
  // File gambar yang belum diunggah (diunggah ke analisanya setelah prospek / produk disimpan; tidak ikut JSON)
  files?: PendingAttachments
  analysis?: { id: number; nomor: string; status: Status } | null
  mintaManual?: boolean
}
export const emptyTeknik = (): TeknikSpec => ({ minta: false, panjang_cm: '', lebar_cm: '', tebal_mm: '', print_jenis: '', jumlah_warna: '', kesulitan_print: '', spec_lainnya: '', frekuensi: '', rutin_bulan: '', critical_to_quality: '', jumlah_gambar: '', desain: [] })
// Isian teknik untuk dikirim ke server (tanpa file yang belum diunggah)
export const teknikForSave = (t: TeknikSpec | null | undefined) => (t ? (({ files: _files, ...rest }) => rest)(t) : t)

// Analisa yang sudah ada untuk prospek: dipetakan per nama produk (untuk form Edit prospek)
// Spek teknik analisa terakhir untuk satu produk Data Produk (isian awal form produk)
export async function loadProductTeknik(productId: number): Promise<TeknikSpec | null> {
  const r = await api<ListRes>(`/api/tech-analyses?product_id=${productId}`)
  const a = [...r.items].sort((x, y) => y.id - x.id)[0]
  if (!a) return null
  return {
    minta: true, panjang_cm: fmt(a.panjang_cm), lebar_cm: fmt(a.lebar_cm), tebal_mm: fmt(a.tebal_mm), print_jenis: a.print_jenis ?? '', jumlah_warna: fmt(a.jumlah_warna),
    kesulitan_print: a.kesulitan_print ?? '', spec_lainnya: a.spec_lainnya ?? '', frekuensi: a.frekuensi ?? '', rutin_bulan: fmt(a.rutin_bulan), critical_to_quality: a.critical_to_quality ?? '',
    jumlah_gambar: fmt(a.jumlah_gambar), desain: a.desain ?? [],
    analysis: { id: a.id, nomor: a.nomor, status: a.status },
  }
}

export async function loadProspectTeknik(prospectId: number) {
  const r = await api<ListRes>(`/api/tech-analyses?prospect_id=${prospectId}`)
  const map = new Map<string, TeknikSpec>()
  for (const a of r.items) {
    map.set(a.nama_produk.trim().toLowerCase(), {
      minta: true, panjang_cm: fmt(a.panjang_cm), lebar_cm: fmt(a.lebar_cm), tebal_mm: fmt(a.tebal_mm), print_jenis: a.print_jenis ?? '', jumlah_warna: fmt(a.jumlah_warna),
      kesulitan_print: a.kesulitan_print ?? '', spec_lainnya: a.spec_lainnya ?? '', frekuensi: a.frekuensi ?? '', rutin_bulan: fmt(a.rutin_bulan), critical_to_quality: a.critical_to_quality ?? '',
      jumlah_gambar: fmt(a.jumlah_gambar), desain: a.desain ?? [],
      analysis: { id: a.id, nomor: a.nomor, status: a.status },
    })
  }
  return map
}

// Centang "Minta analisa ke Dept Teknik" di atas Jenis Product - Spec (teks di samping centang).
// Disembunyikan bila produk sudah dianalisa / selesai.
// compact: hanya kotak centang (di samping nomor produk), keterangan lewat tooltip & label kolom
export function TeknikMintaCheck({ value, onChange, compact = false, saat = 'prospek' }: { value: TeknikSpec | null | undefined; onChange: (v: TeknikSpec | null) => void; compact?: boolean; saat?: 'prospek' | 'produk' }) {
  const t = value ?? null
  const locked = !!t?.analysis && (t.analysis.status === 'dianalisa' || t.analysis.status === 'selesai')
  const title = locked ? `Sudah dianalisa Dept Teknik (${t!.analysis!.nomor})` : `Minta analisa ke Dept Teknik saat ${saat} disimpan (otomatis tercentang bila spek teknik diisi)`
  if (locked && !compact) return <span className="pap-muted pap-ta-minta-done">Sudah dianalisa Dept Teknik ({t!.analysis!.nomor})</span>
  return (
    <label className={compact ? 'pap-ta-minta-box' : 'pap-ta-minta'} title={title}>
      <input type="checkbox" disabled={locked} checked={locked || !!t?.minta} onChange={(e) => onChange({ ...(t ?? emptyTeknik()), minta: e.target.checked, mintaManual: true })} aria-label="Minta analisa ke Dept Teknik" />
      {!compact && <span>Minta analisa ke Dept Teknik saat {saat} disimpan <small className="pap-muted">(otomatis tercentang bila spek teknik diisi)</small></span>}
      {!compact && t?.analysis && <span className={`pap-status ${TONE[t.analysis.status]}`}>{t.analysis.nomor} · {STATUS[t.analysis.status]}</span>}
    </label>
  )
}

export function TeknikSpecPanel({ value, onChange }: { value: TeknikSpec | null | undefined; onChange: (v: TeknikSpec | null) => void }) {
  const [open, setOpen] = useState(!!value?.minta)
  const t = value ?? null
  const locked = !!t?.analysis && (t.analysis.status === 'dianalisa' || t.analysis.status === 'selesai')
  // Opsional: analisa otomatis diminta begitu ada isian spek (kecuali centangnya dilepas manual); kosong = tidak ada analisa
  const set = (patch: Partial<TeknikSpec>) => {
    const next = { ...(t ?? emptyTeknik()), ...patch }
    if (!('minta' in patch) && !next.mintaManual) {
      next.minta = [next.panjang_cm, next.lebar_cm, next.tebal_mm, next.print_jenis, next.jumlah_warna, next.kesulitan_print, next.spec_lainnya, next.frekuensi, next.critical_to_quality, next.jumlah_gambar].some((x) => String(x ?? '').trim())
        || !!next.desain?.length || !!(next.files && pendingCount(next.files))
    }
    onChange(next)
  }
  const num = (k: keyof TeknikSpec) => (e: { target: { value: string } }) => set({ [k]: e.target.value.replace(/[^\d.,]/g, '') } as Partial<TeknikSpec>)
  const txt = (k: keyof TeknikSpec) => (e: { target: { value: string } }) => set({ [k]: e.target.value } as Partial<TeknikSpec>)
  return (
    <div className={`pap-ta-inline ${t?.minta ? 'on' : ''}`}>
      <div className="pap-ta-inline-head">
        <button type="button" className="pap-link-button pap-shift-edit" onClick={() => setOpen(!open)} aria-expanded={open}>
          <Ruler /> {t?.analysis ? 'Analisa teknik' : t?.minta ? 'Analisa teknik · akan diserahkan ke Teknik' : 'Isi analisa teknik (opsional)'}
        </button>
        {t?.analysis && <span className="pap-ta-inline-doc"><span className={`pap-status ${TONE[t.analysis.status]}`}>{t.analysis.nomor} · {STATUS[t.analysis.status]}</span><DocActions id={t.analysis.id} nomor={t.analysis.nomor} compact /></span>}
      </div>
      {open && (
        <div className="pap-ta-inline-body">
          {locked ? <p className="pap-muted pap-ta-hint">Produk ini sudah dianalisa Dept Teknik ({t!.analysis!.nomor}); spek tidak bisa diubah dari sini. Lihat hasilnya di detail prospek.</p> : (
            <>
              <div className="pap-ta-inline-grid">
                <label><span>Panjang (cm)</span><input className="pap-input" inputMode="decimal" value={t?.panjang_cm ?? ''} onChange={num('panjang_cm')} /></label>
                <label><span>Lebar (cm)</span><input className="pap-input" inputMode="decimal" value={t?.lebar_cm ?? ''} onChange={num('lebar_cm')} /></label>
                <label><span>Tebal (mm)</span><input className="pap-input" inputMode="decimal" value={t?.tebal_mm ?? ''} onChange={num('tebal_mm')} placeholder="0,03" /></label>
                <label><span>Polos / print</span>
                  <select className="pap-select" value={t?.print_jenis ?? ''} onChange={(e) => set({ print_jenis: e.target.value as TeknikSpec['print_jenis'] })}><option value="">—</option><option value="polos">Polos</option><option value="print">Print</option></select>
                </label>
                {t?.print_jenis === 'print' && <label><span>Jumlah warna</span><input className="pap-input" inputMode="numeric" value={t.jumlah_warna} onChange={num('jumlah_warna')} /></label>}
                {t?.print_jenis === 'print' && <label className="wide"><span>Tingkat kesulitan print</span><input className="pap-input" maxLength={255} value={t.kesulitan_print} onChange={txt('kesulitan_print')} placeholder="mis. register ketat" /></label>}
                <label><span>Frekuensi order</span>
                  <select className="pap-select" value={t?.frekuensi ?? ''} onChange={(e) => set({ frekuensi: e.target.value as TeknikSpec['frekuensi'] })}><option value="">Ikut cycle</option><option value="sekali">Hanya 1x</option><option value="rutin">Rutin</option></select>
                </label>
                {t?.frekuensi === 'rutin' && <label><span>Rutin per … bulan</span><input className="pap-input" inputMode="numeric" value={t.rutin_bulan} onChange={num('rutin_bulan')} /></label>}
                <label className="full"><span>Spec lainnya (airhole, pillow case, dll.)</span><input className="pap-input" maxLength={1000} value={t?.spec_lainnya ?? ''} onChange={txt('spec_lainnya')} placeholder="Kosong = pakai Spek khusus / catatan produk" /></label>
                <label><span>Jumlah gambar / kantong (diisi PPIC)</span><input className="pap-input" inputMode="numeric" value={t?.jumlah_gambar ?? ''} onChange={num('jumlah_gambar')} placeholder="mis. 2" /></label>
                <label className="full"><span>Critical to quality</span><input className="pap-input" maxLength={1000} value={t?.critical_to_quality ?? ''} onChange={txt('critical_to_quality')} placeholder="mis. sealing kuat, warna logo sesuai" /></label>
              </div>
              {/* Gambar per produk: file baru diunggah setelah disimpan; yang sudah tersimpan tampil di analisanya */}
              <GambarProduk desain={t?.desain ?? []} onDesain={(d) => set({ desain: d })} analysisId={t?.analysis?.id}
                pending={t?.analysis ? undefined : t?.files ?? emptyAttachments()} onPending={(p) => set({ files: p })} />
            </>
          )}
        </div>
      )}
    </div>
  )
}

// Aksi dokumen analisa: Pratinjau PDF (tab baru), Cetak (dialog cetak langsung terbuka), Word
export function DocActions({ id, nomor, compact = false }: { id: number; nomor: string; compact?: boolean }) {
  const base = `/cetak/analisa-teknik/${id}`
  return compact ? (
    <span className="pap-ta-doc-icons">
      <a className="pap-row-action" href={base} target="_blank" rel="noreferrer" title="Pratinjau PDF" aria-label={`Pratinjau PDF ${nomor}`}><FileText /><span>PDF</span></a>
      <a className="pap-row-action" href={`${base}?print=1`} target="_blank" rel="noreferrer" title="Cetak" aria-label={`Cetak ${nomor}`}><Printer /><span>Cetak</span></a>
      <a className="pap-row-action" href={`/api/tech-analyses/${id}/word`} title="Unduh Word" aria-label={`Unduh Word ${nomor}`}><FileDown /><span>Word</span></a>
    </span>
  ) : (
    <>
      <a className="pap-btn" href={`/api/tech-analyses/${id}/word`}><FileDown /> Word</a>
      <a className="pap-btn" href={`${base}?print=1`} target="_blank" rel="noreferrer"><Printer /> Cetak</a>
      <a className="pap-primary-button" href={base} target="_blank" rel="noreferrer"><Eye /> Pratinjau PDF</a>
    </>
  )
}

// Cetak formulir semua produk prospek (yang belum dianalisa ikut tercetak dengan bagian Teknik kosong)
function ProspectDocActions({ prospectId }: { prospectId: number }) {
  const base = `/cetak/analisa-teknik/prospek/${prospectId}`
  return (
    <span className="pap-ta-doc-icons" aria-label="Cetak formulir analisa teknik prospek">
      <a className="pap-row-action" href={base} target="_blank" rel="noreferrer" title="Pratinjau PDF formulir semua produk"><Eye /><span>PDF</span></a>
      <a className="pap-row-action" href={`${base}?print=1`} target="_blank" rel="noreferrer" title="Cetak formulir semua produk"><Printer /><span>Cetak</span></a>
      <a className="pap-row-action" href={`/api/tech-analyses/prospek/${prospectId}/word`} title="Unduh Word formulir semua produk"><FileDown /><span>Word</span></a>
    </span>
  )
}

// ---------- Menu Pengajuan Analisa Teknik (Marketing) & Analisa Teknik PPIC ----------
export function TechAnalysisMarketingPage({ user, focusId }: { user: UserProfile; focusId?: number | null }) {
  return (
    <>
      <div className="pap-page-heading">
        <div>
          <p className="pap-eyebrow">MARKETING</p>
          <h1>Pengajuan Analisa Teknik</h1>
          <span>Ajukan analisa teknik order baru / spec baru ke Dept Teknik, lengkapi spek & gambar produk, dan pantau statusnya sampai ada rekomendasi Direksi.</span>
        </div>
      </div>
      <TechAnalysisView user={user} focusId={focusId} sumber="marketing" />
    </>
  )
}

export function TechAnalysisPpicPage({ user, focusId }: { user: UserProfile; focusId?: number | null }) {
  return (
    <>
      <div className="pap-page-heading">
        <div>
          <p className="pap-eyebrow">PPIC</p>
          <h1>Analisa Teknik PPIC</h1>
          <span>Ajukan analisa teknik untuk produk yang sudah ada di Sales Order Accurate: customer & produk terisi dari SO, tinggal lengkapi spek, jumlah gambar per kantong, dan gambar produk.</span>
        </div>
      </div>
      <TechAnalysisView user={user} focusId={focusId} sumber="ppic" />
    </>
  )
}

type SoHit = { id: number; number: string; tanggal: string | null; status: string | null; customer_name: string | null; baris: number; barang: string | null }
type SoLine = { line_id: number; item_accurate_id: number | null; item_no: string | null; item_name: string; quantity: number | null; unit: string | null; notes: string | null; product_id: number | null; jenis: string | null; spesifikasi: string | null; sudah_diajukan: string | null }
type SoDetail = { id: number; number: string; tanggal: string | null; customer_id: number | null; customer_name: string | null; lines: SoLine[] }
type PpicRow = { on: boolean; v: MarketingValues; files: PendingAttachments }

// Form PPIC: pilih Sales Order -> centang produk -> isi spek, jumlah gambar & gambar per produk -> ajukan ke Teknik
function PpicAnalysisForm({ onClose, onSaved }: { onClose: () => void; onSaved: (msg: string) => void }) {
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<SoHit[] | null>(null)
  const [so, setSo] = useState<SoDetail | null>(null)
  const [rows, setRows] = useState<Record<number, PpicRow>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    if (so) return
    setHits(null)
    const t = setTimeout(() => {
      api<{ items: SoHit[] }>(`/api/tech-analyses/so?q=${encodeURIComponent(q.trim())}`).then((r) => { setHits(r.items); setError('') }).catch((e) => setError((e as Error).message))
    }, q ? 300 : 0)
    return () => clearTimeout(t)
  }, [q, so])
  async function pickSo(id: number) {
    try {
      const r = await api<{ item: SoDetail }>(`/api/tech-analyses/so?id=${id}`)
      setSo(r.item)
      const next: Record<number, PpicRow> = {}
      for (const l of r.item.lines) {
        const unit = (l.unit ?? 'kg').toLowerCase()
        next[l.line_id] = {
          on: !l.sudah_diajukan,
          v: { ...toValues(), nama_produk: l.item_name, nama_customer: r.item.customer_name ?? '', jenis_plastik: l.jenis ?? '', qty_order: l.quantity !== null ? fmt(l.quantity) : '',
            qty_satuan: ['kg', 'pcs', 'lembar', 'roll', 'pack'].includes(unit) ? unit : 'kg', spec_lainnya: l.spesifikasi ?? l.notes ?? '' },
          files: emptyAttachments(),
        }
      }
      setRows(next)
    } catch (e) {
      setError((e as Error).message)
    }
  }
  const chosen = so ? so.lines.filter((l) => rows[l.line_id]?.on) : []
  const setRow = (lineId: number, patch: Partial<PpicRow>) => setRows((r) => ({ ...r, [lineId]: { ...r[lineId], ...patch } }))
  async function submit() {
    if (!so || !chosen.length) return setError('Centang minimal satu produk dari Sales Order.')
    setBusy(true)
    setError('')
    const done: string[] = []
    const failed: string[] = []
    try {
      for (const l of chosen) {
        const row = rows[l.line_id]
        const res = await api<{ id: number; nomor: string }>('/api/tech-analyses', {
          method: 'POST',
          json: { ...row.v, sumber: 'ppic', serahkan: true, customer_id: so.customer_id, so_accurate_id: so.id, so_number: so.number },
        })
        done.push(res.nomor)
        failed.push(...(await uploadAnalysisImages(res.id, row.files)))
      }
      onSaved(`${done.length} analisa teknik diajukan ke Dept Teknik (${done.join(', ')}).${failed.length ? ` Sebagian gambar gagal diunggah: ${failed.join(' ')}` : ''}`)
    } catch (e) {
      setError(`${(e as Error).message}${done.length ? ` (${done.join(', ')} sudah terkirim)` : ''}`)
      setBusy(false)
    }
  }
  return (
    <Modal title="Ajukan analisa teknik dari Sales Order" subtitle="Customer & produk diambil dari Sales Order Accurate" wide onClose={onClose}
      footer={<>{so && <button type="button" className="pap-btn" disabled={busy} onClick={() => { setSo(null); setRows({}) }}>Ganti Sales Order</button>}<span className="pap-spacer" /><button type="button" className="pap-btn" onClick={onClose}>Batal</button>
        {so && <button type="button" className="pap-primary-button" disabled={busy || !chosen.length} onClick={submit}><Send /> {busy ? 'Mengajukan...' : `Ajukan ${chosen.length} produk ke Teknik`}</button>}</>}>
      {error && <Notice onClose={() => setError('')}>{error}</Notice>}
      {!so ? (
        <>
          <label className="pap-filter-search"><Search /><input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari nomor SO, customer, atau nama barang (180 hari terakhir)..." /></label>
          <div className="pap-ta-so-list">
            {(hits ?? []).map((h) => (
              <button type="button" key={h.id} className="pap-ta-so-hit" onClick={() => pickSo(h.id)}>
                <b>{h.number}</b><span>{h.customer_name ?? '—'} · {h.tanggal ? formatDate(h.tanggal) : ''} · {h.baris} barang</span>
                {h.barang && <small className="pap-muted">{h.barang}</small>}
              </button>
            ))}
            {hits && !hits.length && <div className="pap-empty">Sales Order tidak ditemukan. Pastikan Sales Order sudah tersinkron dari Accurate.</div>}
            {!hits && !error && <div className="pap-empty">Memuat Sales Order...</div>}
          </div>
        </>
      ) : (
        <>
          <div className="pap-ta-so-head"><b>{so.number}</b><span>{so.customer_name ?? '—'}{so.tanggal ? ` · ${formatDate(so.tanggal)}` : ''}</span></div>
          {so.lines.map((l) => {
            const row = rows[l.line_id]
            if (!row) return null
            return (
              <div key={l.line_id} className={`pap-ta-so-line ${row.on ? 'on' : ''}`}>
                <label className="pap-ta-minta">
                  <input type="checkbox" checked={row.on} onChange={(e) => setRow(l.line_id, { on: e.target.checked })} />
                  <span><b>{l.item_name}</b> <small className="pap-muted">{[l.item_no, l.quantity !== null ? `${fmt(l.quantity)} ${l.unit ?? ''}` : null].filter(Boolean).join(' · ')}</small></span>
                  {l.sudah_diajukan && <span className="pap-status info">Sudah diajukan {l.sudah_diajukan}</span>}
                </label>
                {row.on && (
                  <MarketingFields v={row.v} set={(p) => setRow(l.line_id, { v: { ...row.v, ...p } })} lockNames
                    gambar={<GambarProduk desain={row.v.desain} onDesain={(d) => setRow(l.line_id, { v: { ...row.v, desain: d } })} customerId={so.customer_id} pending={row.files} onPending={(p) => setRow(l.line_id, { files: p })} />} />
                )}
              </div>
            )
          })}
          {!so.lines.length && <div className="pap-empty">Sales Order ini belum punya baris barang (belum tersinkron).</div>}
        </>
      )}
    </Modal>
  )
}
