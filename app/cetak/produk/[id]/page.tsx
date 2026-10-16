import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { ApiError } from '@/lib/api'
import { canViewProducts, requireMenu } from '@/lib/customers'
import { loadSettings } from '@/lib/hpp'
import { loadProduct, loadProductFiles } from '@/lib/products'
import { getCurrentUser } from '@/lib/users'
import { PrintButton } from '../../quotation/[id]/print-button'

export const metadata: Metadata = { title: 'Dokumen Spek Produk · PAP-MS' }

// Dokumen spesifikasi produk + desain cetakan (untuk customer, PPIC, Produksi)
export default async function CetakProdukPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser()
  if (!user) redirect('/')
  const { id } = await params
  let p
  try {
    requireMenu(user, canViewProducts(user))
    p = await loadProduct(Number(id))
  } catch (error) {
    if (error instanceof ApiError) return <main className="pap-print-error">{error.message}</main>
    throw error
  }
  const [rows, doc] = await Promise.all([loadProductFiles(p.id), loadSettings('doc.')])
  const files = rows as unknown as { id: number; name: string; mime: string }[]
  const images = files.filter((f) => f.mime.startsWith('image/'))
  const others = files.filter((f) => !f.mime.startsWith('image/'))
  const now = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10)

  return (
    <main className="pap-print">
      <PrintButton />
      <article className="pap-sheet">
        <header className="pap-sheet-head">
          <img src="/logo-pap.png" alt="" />
          <div>
            <h1>{doc.nama || 'PT. Pandawa Amerta Packindo'}</h1>
            <p>Flexible Plastic Packaging Manufacture</p>
            {doc.alamat && <p>{doc.alamat}</p>}
          </div>
        </header>
        <h2 className="pap-sheet-title">DOKUMEN SPESIFIKASI PRODUK</h2>
        <table className="pap-sheet-items pap-spec-table">
          <tbody>
            <tr><th>Nama produk</th><td><b>{p.nama}</b></td></tr>
            <tr><th>Kode</th><td>{p.kode ?? '—'}</td></tr>
            <tr><th>Customer</th><td>{p.customer_name ?? '—'}{p.customer_no ? ` (${p.customer_no})` : ''}</td></tr>
            <tr><th>Jenis</th><td>{p.jenis ?? '—'}</td></tr>
            <tr><th>Bahan</th><td className="pre">{p.bahan ?? '—'}</td></tr>
            <tr><th>Spesifikasi</th><td className="pre">{p.spesifikasi ?? '—'}</td></tr>
            {p.keterangan && <tr><th>Keterangan</th><td className="pre">{p.keterangan}</td></tr>}
            <tr><th>Status</th><td>{p.status === 'aktif' ? 'Aktif' : 'Nonaktif'}</td></tr>
          </tbody>
        </table>
        {images.length > 0 && (
          <section>
            <h3>Desain cetakan</h3>
            <div className="pap-spec-images">
              {images.map((f) => <figure key={f.id}><img src={`/api/products/files/${f.id}`} alt={f.name} /><figcaption>{f.name}</figcaption></figure>)}
            </div>
          </section>
        )}
        {others.length > 0 && <section><h3>Lampiran lain</h3><ul>{others.map((f) => <li key={f.id}>{f.name}</li>)}</ul></section>}
        <table className="pap-sheet-items pap-spec-approval">
          <thead><tr><th>Disiapkan (Marketing)</th><th>Diperiksa (PPIC)</th><th>Disetujui customer</th></tr></thead>
          <tbody><tr><td><div className="space" />{user.name}</td><td><div className="space" /></td><td><div className="space" /></td></tr></tbody>
        </table>
        <p className="pap-sheet-note">Dicetak {now} dari PAP-MS.</p>
      </article>
    </main>
  )
}
