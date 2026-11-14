import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { ApiError } from '@/lib/api'
import { loadSettings } from '@/lib/hpp'
import { PROSPECT_STATUS, prospectExport, requireMarketing } from '@/lib/marketing'
import { getCurrentUser } from '@/lib/users'
import { PrintButton } from '../quotation/[id]/print-button'

export const metadata: Metadata = { title: 'Daftar Prospek · SIMPAP' }

const num = (v: number | null) => (v === null ? '' : v.toLocaleString('id-ID', { maximumFractionDigits: 2 }))
const STATUS_FILTER: Record<string, string> = { aktif: 'Prospek aktif', semua: 'Semua status', ...PROSPECT_STATUS }

// Daftar prospek (A4 landscape) sesuai filter di menu Prospek; simpan sebagai PDF dari dialog cetak.
// Kolom mengikuti tabel Program Mkt Dev, satu baris per produk.
export default async function CetakProspekPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await getCurrentUser()
  if (!user) redirect('/')
  try {
    requireMarketing(user, 'prospek')
  } catch (error) {
    if (error instanceof ApiError) return <main className="pap-print-error">{error.message}</main>
    throw error
  }
  const query = await searchParams
  const params = new URLSearchParams(Object.entries(query).filter((e): e is [string, string] => typeof e[1] === 'string'))
  const rows = await prospectExport(user, params)
  const doc = await loadSettings('doc.')
  const filters = [STATUS_FILTER[params.get('status') ?? 'semua'] ?? null, params.get('q') && `Cari "${params.get('q')}"`, params.get('sumber') && `Sumber ${params.get('sumber')}`,
    params.get('followup') === 'overdue' ? 'Follow-up terlambat' : params.get('followup') === 'today' ? 'Follow-up hari ini' : null].filter(Boolean).join(' · ')
  const now = new Date(Date.now() + 7 * 3600e3).toISOString()
  const productCount = rows.reduce((n, r) => n + r.products.length, 0)

  return (
    <main className="pap-print">
      <PrintButton hint="(atur ke Lanskap bila belum)" />
      <article className="pap-sheet pap-sheet-landscape pap-prospect-sheet">
        <table className="pap-sheet-head">
          <tbody>
            <tr>
              <td className="logo"><img src="/logo-pap.png" alt="" width={110} /></td>
              <td>
                <h1>{doc.nama || 'PT. Pandawa Amerta Packindo'}</h1>
                <p>Flexible Plastic Packaging Manufacture</p>
                {doc.alamat && <p>{doc.alamat}</p>}
              </td>
            </tr>
          </tbody>
        </table>
        <h2 className="pap-sheet-title">DAFTAR PROSPEK CUSTOMER</h2>
        <p className="pap-damage-period">
          {filters ? `${filters} · ` : ''}{rows.length} prospek, {productCount} produk · Dicetak {now.slice(8, 10)}/{now.slice(5, 7)}/{now.slice(0, 4)} {now.slice(11, 16)} oleh {user.name}
        </p>
        <table className="pap-sheet-items pap-prospect-items">
          <thead>
            <tr>
              <th className="c">No</th><th>Nama Customer</th><th>Bidang Usaha</th><th>Alamat dll</th><th>Nama Kontak PIC</th><th>Nomor WhatsApp</th>
              <th>Jenis Product - Spec</th><th>Jenis Plastik</th><th className="r">Qty (Kg)</th><th className="r">Harga / satuan</th><th className="r">GPF/sat</th>
              <th>Payment</th><th>Status · Sales</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const products = r.products.length ? r.products : [null]
              const span = products.length
              return products.map((p, k) => (
                <tr key={`${r.id}-${k}`} className={k === 0 ? 'first' : ''}>
                  {k === 0 && (
                    <>
                      <td className="c" rowSpan={span}>{i + 1}</td>
                      <td rowSpan={span}><b>{r.nama_usaha}</b></td>
                      <td rowSpan={span}>{r.sektor}</td>
                      <td rowSpan={span}>{r.alamat || r.kota}</td>
                      <td rowSpan={span}>{[r.kontak_nama, r.kontak_jabatan].filter(Boolean).join(' - ')}</td>
                      <td rowSpan={span}>{r.telepon ? `0${r.telepon.replace(/^62/, '')}` : ''}</td>
                    </>
                  )}
                  <td>{p?.label}</td>
                  <td>{p?.jenis_plastik}</td>
                  <td className="r">{p ? num(p.qty_kg ?? 0) : ''}</td>
                  <td className="r">{p ? `${num(p.harga ?? 0)}${p.satuan_harga ? `/${p.satuan_harga.toLowerCase()}` : ''}` : ''}</td>
                  <td className="r">{p ? num(p.gpf ?? 0) : ''}</td>
                  {k === 0 && (
                    <>
                      <td rowSpan={span}>{r.payment}</td>
                      <td rowSpan={span}>{PROSPECT_STATUS[r.status as keyof typeof PROSPECT_STATUS] ?? r.status}{r.assigned_name ? <div className="spec">{r.assigned_name}</div> : null}</td>
                    </>
                  )}
                </tr>
              ))
            })}
            {!rows.length && <tr><td colSpan={13} className="c">Tidak ada prospek sesuai filter.</td></tr>}
          </tbody>
        </table>
      </article>
    </main>
  )
}
