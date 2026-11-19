import type { Metadata } from 'next'
import { verifySignature } from '@/lib/quotation-signature'

export const metadata: Metadata = { title: 'Verifikasi Tanda Tangan · PT. Pandawa Amerta Packindo', robots: { index: false, follow: false } }
export const dynamic = 'force-dynamic'

const MONTHS = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember']
const tgl = (v: string, time = false) => {
  const [d, t] = v.split(' ')
  const [y, m, day] = d.split('-').map(Number)
  return `${day} ${MONTHS[m - 1]} ${y}${time && t ? ` pukul ${t.slice(0, 5)} WIB` : ''}`
}

// Halaman publik verifikasi tanda tangan digital dokumen penawaran (tanpa login; tidak menampilkan harga)
export default async function VerifikasiTtdPage({ params }: { params: Promise<{ token: string }> }) {
  const s = await verifySignature((await params).token)
  const state = (!s ? 'invalid' : s.status) as 'sah' | 'berubah' | 'dicabut' | 'invalid'
  const head = ({
    sah: { title: 'Tanda tangan sah', text: 'Dokumen ini ditandatangani secara digital dan isinya tidak berubah sejak ditandatangani.' },
    berubah: { title: 'Dokumen telah berubah', text: 'Isi penawaran diubah setelah ditandatangani. Tanda tangan ini tidak berlaku untuk versi dokumen sekarang.' },
    dicabut: { title: 'Tanda tangan dicabut', text: 'Tanda tangan ini sudah dicabut oleh PT. Pandawa Amerta Packindo.' },
    invalid: { title: 'Kode tidak dikenal', text: 'Kode verifikasi tidak ditemukan. Pastikan alamat yang dibuka sesuai dengan yang tercetak di dokumen.' },
  } as const)[state]
  return (
    <main className="pap-verify">
      <div className={`pap-verify-card ${state}`}>
        <img src="/logo-pap.png" alt="PT. Pandawa Amerta Packindo" className="pap-verify-logo" />
        <div className={`pap-verify-badge ${state}`} aria-hidden>{state === 'sah' ? '✓' : state === 'invalid' ? '?' : '!'}</div>
        <h1>{head.title}</h1>
        <p className="pap-verify-text">{head.text}</p>
        {s && (
          <dl className="pap-verify-dl">
            <div><dt>Dokumen</dt><dd>Surat Penawaran {s.nomor}</dd></div>
            <div><dt>Tanggal dokumen</dt><dd>{tgl(s.tanggal)}</dd></div>
            <div><dt>Kepada</dt><dd>{s.kepada}</dd></div>
            <div><dt>Ditandatangani oleh</dt><dd>{s.nama}{s.jabatan ? ` · ${s.jabatan}` : ''}{s.peran === 'customer' ? ' (customer)' : ' (PT. Pandawa Amerta Packindo)'}</dd></div>
            <div><dt>Waktu tanda tangan</dt><dd>{tgl(s.signed_at, true)}</dd></div>
            {s.status === 'dicabut' && s.revoke_reason && <div><dt>Alasan dicabut</dt><dd>{s.revoke_reason}</dd></div>}
          </dl>
        )}
        <p className="pap-verify-foot">PT. Pandawa Amerta Packindo · Flexible Plastic Packaging Manufacture</p>
      </div>
    </main>
  )
}
