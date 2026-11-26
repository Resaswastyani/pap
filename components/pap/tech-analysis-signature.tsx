'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { History, PenLine, RotateCcw, ShieldCheck } from 'lucide-react'
import { SignaturePad, type SignaturePadHandle } from './signature-pad'
import { api, askReason, formatDate, Modal, Notice } from './ui'

// Tanda tangan digital Analisa Teknik / Rekomendasi Proses Produksi: Pengaju (PPIC / Marketing), Dept Tehnik, Direksi.
// Tercetak di PDF & Word menggantikan cap "Diparaf digital".
type Role = 'pengaju' | 'teknik' | 'direksi'
type Sig = { id: number; peran: Role; nama: string; jabatan: string | null; token: string; signed_at: string; signed_by_name: string | null; revoked_at: string | null; revoked_by_name: string | null; revoke_reason: string | null }
type Res = { items: Sig[]; mine: { image: string; jabatan: string | null } | null; can: Record<Role, boolean> }
type Info = { id: number; nomor: string; nama_produk: string; sumber?: string | null }

const ROLES: Role[] = ['pengaju', 'teknik', 'direksi']

export function TaSignatures({ analysis, userName, onChanged }: { analysis: Info; userName: string; onChanged?: () => void }) {
  const [data, setData] = useState<Res | null>(null)
  const [error, setError] = useState('')
  const [signing, setSigning] = useState<Role | null>(null)
  const [history, setHistory] = useState(false)
  const pengaju = analysis.sumber === 'ppic' ? 'PPIC' : 'Marketing'
  const ROLE: Record<Role, { title: string; sub: string }> = {
    pengaju: { title: 'Diajukan oleh', sub: `Dept ${pengaju}` },
    teknik: { title: analysis.sumber === 'ppic' ? 'Dibuat oleh' : 'Dianalisa oleh', sub: 'Dept Tehnik' },
    direksi: { title: analysis.sumber === 'ppic' ? 'Disetujui' : 'Rekomendasi', sub: 'Direksi / Opr Mgr' },
  }

  const load = useCallback(async () => {
    try {
      setData(await api<Res>(`/api/tech-analyses/${analysis.id}/signatures`))
      setError('')
    } catch (e) {
      setError((e as Error).message)
    }
  }, [analysis.id])
  // aislop-ignore-next-line react/set-state-in-effect -- memuat tanda tangan dari server saat detail dibuka
  useEffect(() => { load() }, [load])

  async function revoke(s: Sig) {
    const alasan = await askReason({ title: `Cabut tanda tangan ${s.nama}?`, label: 'Alasan dicabut', placeholder: 'mis. salah penandatangan, revisi analisa', confirmLabel: 'Cabut tanda tangan' })
    if (alasan === null) return
    try {
      await api(`/api/tech-analyses/${analysis.id}/signatures/${s.id}`, { method: 'DELETE', json: { alasan } })
      await load()
      onChanged?.()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const active = (role: Role) => data?.items.find((s) => s.peran === role && !s.revoked_at) ?? null
  const old = data?.items.filter((s) => s.revoked_at) ?? []

  return (
    <section className="pap-sig-panel" aria-label="Tanda tangan digital">
      <header className="pap-sig-head">
        <div>
          <strong><PenLine /> Tanda tangan digital</strong>
          <p className="pap-muted">Tanda tangan {pengaju}, Dept Tehnik, dan Direksi tercetak otomatis di PDF & Word.</p>
        </div>
      </header>
      {error && <Notice onClose={() => setError('')}>{error}</Notice>}
      <div className="pap-sig-slots pap-sig-slots-3">
        {ROLES.map((role) => {
          const s = active(role)
          const can = !!data?.can[role]
          return (
            <div key={role} className={`pap-sig-slot ${s ? 'sah' : 'kosong'}`}>
              <div className="pap-sig-slot-head">
                <div><b>{ROLE[role].title}</b><small>{ROLE[role].sub}</small></div>
                {s && <span className="pap-sig-chip sah"><ShieldCheck /> Ditandatangani</span>}
              </div>
              {s ? (
                <>
                  {/* aislop-ignore-next-line next/no-img-element -- gambar tanda tangan privat lewat API (bukan aset statis) */}
                  <div className="pap-sig-image"><img src={`/api/ttd/${s.token}`} alt={`Tanda tangan ${s.nama}`} /></div>
                  <div className="pap-sig-meta">
                    <b>{s.nama}</b>{s.jabatan && <span>{s.jabatan}</span>}
                    <small>{formatDate(s.signed_at, true)}{s.signed_by_name && s.signed_by_name !== s.nama ? ` · disimpan ${s.signed_by_name}` : ''}</small>
                  </div>
                  {can && (
                    <div className="pap-sig-actions">
                      <button type="button" className="pap-btn" onClick={() => revoke(s)}>Cabut</button>
                      <button type="button" className="pap-btn" onClick={() => setSigning(role)}><RotateCcw /> Ulang</button>
                    </div>
                  )}
                </>
              ) : (
                <div className="pap-sig-empty">
                  <PenLine />
                  <p>{can ? 'Belum ditandatangani.' : role === 'pengaju' ? `Ditandatangani Dept ${pengaju}.` : role === 'teknik' ? 'Ditandatangani Dept Tehnik setelah analisa diserahkan.' : 'Ditandatangani Direksi setelah dianalisa Teknik.'}</p>
                  {can && <button type="button" className="pap-primary-button" onClick={() => setSigning(role)}><PenLine /> Tandatangani</button>}
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
        <SignDialog analysis={analysis} title={`${ROLE[signing].title} · ${ROLE[signing].sub}`} role={signing} userName={userName} mine={data.mine}
          onClose={() => setSigning(null)} onSigned={async () => { setSigning(null); await load(); onChanged?.() }} />
      )}
    </section>
  )
}

function SignDialog({ analysis, title, role, userName, mine, onClose, onSigned }: {
  analysis: Info; title: string; role: Role; userName: string; mine: Res['mine']; onClose: () => void; onSigned: () => void
}) {
  const pad = useRef<SignaturePadHandle | null>(null)
  const [nama, setNama] = useState(userName)
  const [jabatan, setJabatan] = useState(mine?.jabatan ?? '')
  const [empty, setEmpty] = useState(true)
  const [simpan, setSimpan] = useState(!mine)
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
      await api(`/api/tech-analyses/${analysis.id}/signatures`, { method: 'POST', json: { peran: role, nama, jabatan, image, setuju: true, simpan } })
      onSigned()
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
    }
  }

  return (
    <Modal title="Tandatangani analisa" subtitle={`${analysis.nomor} · ${analysis.nama_produk} · ${title}`} wide onClose={onClose}
      footer={<><span className="pap-spacer" /><button type="button" className="pap-btn" onClick={onClose}>Batal</button><button className="pap-primary-button" form="pap-ta-sig-form" disabled={busy || empty || !setuju}><PenLine /> {busy ? 'Menyimpan...' : 'Simpan tanda tangan'}</button></>}>
      <form id="pap-ta-sig-form" className="pap-sig-form" onSubmit={submit}>
        {error && <Notice onClose={() => setError('')}>{error}</Notice>}
        <div className="pap-form-grid">
          <label className="pap-field"><span>Nama penandatangan *</span><input className="pap-input" maxLength={150} required value={nama} onChange={(e) => setNama(e.target.value)} /></label>
          <label className="pap-field"><span>Jabatan</span><input className="pap-input" maxLength={150} value={jabatan} onChange={(e) => setJabatan(e.target.value)} placeholder="mis. Kepala Teknik" /></label>
        </div>
        <div className="pap-field">
          <div className="pap-sig-pad-head">
            <span>Tanda tangan *</span>
            {mine && <button type="button" className="pap-link-button pap-shift-edit" onClick={() => pad.current?.load(mine.image)}>Pakai tanda tangan tersimpan</button>}
          </div>
          <SignaturePad ref={pad} onChange={setEmpty} />
        </div>
        <label className="pap-ma-check"><input type="checkbox" checked={simpan} onChange={(e) => setSimpan(e.target.checked)} /> Simpan sebagai tanda tangan saya (dipakai lagi tanpa menggambar ulang)</label>
        <label className="pap-sig-consent"><input type="checkbox" checked={setuju} onChange={(e) => setSetuju(e.target.checked)} /><span>Saya menyatakan tanda tangan ini sah sebagai {title} pada {analysis.nomor} ({analysis.nama_produk}).</span></label>
        <small className="pap-muted">Tercatat: waktu dan perangkat. Tanda tangan bisa dicabut atau diulang.</small>
      </form>
    </Modal>
  )
}
