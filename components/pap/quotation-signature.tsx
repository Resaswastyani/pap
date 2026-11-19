'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { BadgeCheck, ExternalLink, History, PenLine, RotateCcw, ShieldAlert, ShieldCheck, UserRoundCheck } from 'lucide-react'
import { SignaturePad, type SignaturePadHandle } from './signature-pad'
import { api, askReason, formatDate, Modal, Notice } from './ui'

// Tanda tangan digital penawaran: "Hormat kami" (perusahaan) & "Disetujui" (customer), dicetak di PDF / Word,
// dengan kode verifikasi publik; otomatis tidak berlaku bila isi penawaran berubah setelah ditandatangani.

type Role = 'perusahaan' | 'customer'
type Sig = {
  id: number; peran: Role; nama: string; jabatan: string | null; token: string; signed_at: string; signed_by_name: string | null
  revoked_at: string | null; revoked_by_name: string | null; revoke_reason: string | null; status: 'sah' | 'berubah' | 'dicabut'
}
type Res = { items: Sig[]; mine: { image: string; jabatan: string | null; updated_at: string } | null; can: { sign: boolean } }
type QuoteInfo = { id: number; nomor: string; kepada: string; kontak: string | null; total: number; status: string }

const ROLE: Record<Role, { title: string; sub: string }> = {
  perusahaan: { title: 'Hormat kami', sub: 'PT. Pandawa Amerta Packindo' },
  customer: { title: 'Disetujui customer', sub: 'Penerima penawaran' },
}
const rupiah = (v: number) => `Rp ${Math.round(v).toLocaleString('id-ID')}`
const code = (token: string) => token.slice(0, 12).toUpperCase().replace(/(.{4})/g, '$1-').replace(/-$/, '')

export function QuotationSignatures({ quote, userName, onChanged }: { quote: QuoteInfo; userName: string; onChanged?: (msg: string) => void }) {
  const [data, setData] = useState<Res | null>(null)
  const [error, setError] = useState('')
  const [signing, setSigning] = useState<Role | null>(null)
  const [history, setHistory] = useState(false)

  const load = useCallback(async () => {
    try {
      setData(await api<Res>(`/api/quotations/${quote.id}/signatures`))
      setError('')
    } catch (e) {
      setError((e as Error).message)
    }
  }, [quote.id])
  useEffect(() => { load() }, [load])

  async function revoke(s: Sig) {
    const alasan = await askReason({ title: `Cabut tanda tangan ${s.nama}?`, label: 'Alasan dicabut', placeholder: 'mis. salah penandatangan, revisi harga', confirmLabel: 'Cabut tanda tangan' })
    if (alasan === null) return
    try {
      await api(`/api/quotations/${quote.id}/signatures/${s.id}`, { method: 'DELETE', json: { alasan } })
      await load()
      onChanged?.('Tanda tangan dicabut.')
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const active = (role: Role) => data?.items.find((s) => s.peran === role && s.status !== 'dicabut') ?? null
  const old = data?.items.filter((s) => s.status === 'dicabut') ?? []
  const canSign = !!data?.can.sign && quote.status !== 'batal'

  return (
    <section className="pap-sig-panel" aria-label="Tanda tangan digital">
      <header className="pap-sig-head">
        <div>
          <strong><PenLine /> Tanda tangan digital</strong>
          <p className="pap-muted">Tanda tangan tercetak otomatis di PDF & Word beserta kode verifikasi. Bila isi penawaran diubah, tanda tangan otomatis tidak berlaku.</p>
        </div>
      </header>
      {error && <Notice onClose={() => setError('')}>{error}</Notice>}
      <div className="pap-sig-slots">
        {(['perusahaan', 'customer'] as Role[]).map((role) => {
          const s = active(role)
          return (
            <div key={role} className={`pap-sig-slot ${s ? s.status : 'kosong'}`}>
              <div className="pap-sig-slot-head">
                <div><b>{ROLE[role].title}</b><small>{ROLE[role].sub}</small></div>
                {s?.status === 'sah' && <span className="pap-sig-chip sah"><ShieldCheck /> Sah</span>}
                {s?.status === 'berubah' && <span className="pap-sig-chip berubah"><ShieldAlert /> Tidak berlaku</span>}
              </div>
              {s ? (
                <>
                  <div className="pap-sig-image"><img src={`/api/ttd/${s.token}`} alt={`Tanda tangan ${s.nama}`} /></div>
                  <div className="pap-sig-meta">
                    <b>{s.nama}</b>{s.jabatan && <span>{s.jabatan}</span>}
                    <small>{formatDate(s.signed_at, true)}{s.signed_by_name && s.signed_by_name !== s.nama ? ` · disimpan ${s.signed_by_name}` : ''}</small>
                    <small className="pap-sig-code">Kode {code(s.token)}</small>
                  </div>
                  {s.status === 'berubah' && <p className="pap-sig-warn">Isi penawaran berubah setelah ditandatangani, jadi tanda tangan ini tidak dicetak. Tandatangani ulang.</p>}
                  <div className="pap-sig-actions">
                    <a className="pap-btn" href={`/verifikasi/ttd/${s.token}`} target="_blank" rel="noreferrer"><ExternalLink /> Verifikasi</a>
                    {canSign && <button type="button" className="pap-btn" onClick={() => revoke(s)}>Cabut</button>}
                    {canSign && <button type="button" className={s.status === 'berubah' ? 'pap-primary-button' : 'pap-btn'} onClick={() => setSigning(role)}><RotateCcw /> Ulang</button>}
                  </div>
                </>
              ) : (
                <div className="pap-sig-empty">
                  {role === 'perusahaan' ? <BadgeCheck /> : <UserRoundCheck />}
                  <p>{role === 'perusahaan' ? 'Belum ditandatangani. Tanda tangan perusahaan membuat penawaran lebih resmi.' : 'Opsional: minta customer tanda tangan langsung di HP / tablet saat kunjungan sebagai tanda setuju.'}</p>
                  {canSign && <button type="button" className={role === 'perusahaan' ? 'pap-primary-button' : 'pap-btn'} onClick={() => setSigning(role)}><PenLine /> {role === 'perusahaan' ? 'Tandatangani' : 'Minta TTD customer'}</button>}
                </div>
              )}
            </div>
          )
        })}
      </div>
      {!!old.length && (
        <div className="pap-sig-history">
          <button type="button" className="pap-link-button pap-shift-edit" onClick={() => setHistory(!history)}><History /> Riwayat tanda tangan dicabut ({old.length})</button>
          {history && (
            <ul>
              {old.map((s) => <li key={s.id}><b>{s.nama}</b> · {ROLE[s.peran].title} · {formatDate(s.signed_at, true)} — dicabut {formatDate(s.revoked_at, true)}{s.revoked_by_name ? ` oleh ${s.revoked_by_name}` : ''}{s.revoke_reason ? ` (${s.revoke_reason})` : ''}</li>)}
            </ul>
          )}
        </div>
      )}
      {signing && data && (
        <SignDialog quote={quote} role={signing} userName={userName} mine={data.mine} onClose={() => setSigning(null)}
          onSigned={async () => { setSigning(null); await load(); onChanged?.(signing === 'perusahaan' ? 'Penawaran ditandatangani. Tanda tangan tercetak di PDF & Word.' : 'Tanda tangan customer tersimpan.') }} />
      )}
    </section>
  )
}

function SignDialog({ quote, role, userName, mine, onClose, onSigned }: {
  quote: QuoteInfo; role: Role; userName: string; mine: Res['mine']; onClose: () => void; onSigned: () => void
}) {
  const pad = useRef<SignaturePadHandle | null>(null)
  const [nama, setNama] = useState(role === 'perusahaan' ? userName : quote.kontak ?? '')
  const [jabatan, setJabatan] = useState(role === 'perusahaan' ? mine?.jabatan ?? '' : '')
  const [empty, setEmpty] = useState(true)
  const [simpan, setSimpan] = useState(role === 'perusahaan' && !mine)
  const [setuju, setSetuju] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    const image = pad.current?.toDataUrl()
    if (!image) return setError('Gambar tanda tangan dulu di kotak yang tersedia.')
    if (!nama.trim()) return setError('Isi nama penandatangan.')
    if (!setuju) return setError('Centang pernyataan persetujuan.')
    setBusy(true)
    try {
      await api(`/api/quotations/${quote.id}/signatures`, { method: 'POST', json: { peran: role, nama, jabatan, image, setuju: true, simpan } })
      onSigned()
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
    }
  }

  const statement = role === 'perusahaan'
    ? `Saya menyatakan tanda tangan ini sah dan mewakili PT. Pandawa Amerta Packindo atas penawaran ${quote.nomor} kepada ${quote.kepada} senilai ${rupiah(quote.total)}.`
    : `Saya${nama ? `, ${nama},` : ''} mewakili ${quote.kepada} menyetujui penawaran ${quote.nomor} senilai ${rupiah(quote.total)}.`

  return (
    <Modal title={role === 'perusahaan' ? 'Tandatangani penawaran' : 'Tanda tangan customer'} subtitle={`${quote.nomor} · ${quote.kepada}`} wide onClose={onClose}
      footer={<><span className="pap-spacer" /><button type="button" className="pap-btn" onClick={onClose}>Batal</button><button className="pap-primary-button" form="pap-sig-form" disabled={busy || empty || !setuju}><PenLine /> {busy ? 'Menyimpan...' : 'Simpan tanda tangan'}</button></>}>
      <form id="pap-sig-form" className="pap-sig-form" onSubmit={submit}>
        {error && <Notice onClose={() => setError('')}>{error}</Notice>}
        {role === 'customer' && <p className="pap-sig-handover">Serahkan perangkat ke customer. Customer menulis nama, membaca pernyataan, lalu tanda tangan di kotak di bawah.</p>}
        <div className="pap-form-grid">
          <label className="pap-field"><span>Nama penandatangan *</span><input className="pap-input" maxLength={150} required value={nama} onChange={(e) => setNama(e.target.value)} placeholder={role === 'customer' ? 'Nama lengkap customer' : 'Nama Anda'} /></label>
          <label className="pap-field"><span>Jabatan</span><input className="pap-input" maxLength={150} value={jabatan} onChange={(e) => setJabatan(e.target.value)} placeholder={role === 'customer' ? 'mis. Owner / Purchasing' : 'mis. Marketing Manager'} /></label>
        </div>
        <div className="pap-field">
          <div className="pap-sig-pad-head">
            <span>Tanda tangan *</span>
            {role === 'perusahaan' && mine && <button type="button" className="pap-link-button pap-shift-edit" onClick={() => pad.current?.load(mine.image)}>Pakai tanda tangan tersimpan</button>}
          </div>
          <SignaturePad ref={pad} onChange={setEmpty} />
        </div>
        {role === 'perusahaan' && <label className="pap-ma-check"><input type="checkbox" checked={simpan} onChange={(e) => setSimpan(e.target.checked)} /> Simpan sebagai tanda tangan saya (dipakai lagi tanpa menggambar ulang)</label>}
        <label className="pap-sig-consent"><input type="checkbox" checked={setuju} onChange={(e) => setSetuju(e.target.checked)} /><span>{statement}</span></label>
        <small className="pap-muted">Tercatat: waktu, perangkat, dan sidik isi dokumen. Tanda tangan bisa dicabut, dan otomatis tidak berlaku bila penawaran diubah.</small>
      </form>
    </Modal>
  )
}
