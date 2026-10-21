import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import type { RowDataPacket } from 'mysql2'
import { db } from '@/lib/db'
import { loadSettings } from '@/lib/hpp'
import { SETTING_SELECT } from '@/lib/machine-settings'
import { getCurrentUser } from '@/lib/users'
import { PrintButton } from '../quotation/[id]/print-button'

export const metadata: Metadata = { title: 'Standar Setting Mesin · PAP-MS' }

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des']
const tgl = (v: unknown) => {
  const s = typeof v === 'string' ? v.slice(0, 10) : ''
  return s ? `${Number(s.slice(8, 10))} ${MONTHS[Number(s.slice(5, 7)) - 1]} ${s.slice(0, 4)}` : ''
}

// Guidance Tehnik: "Dokumen standar settingan mesin". ?mesin=ID (satu mesin) atau tanpa parameter (semua mesin yang punya setting).
export default async function CetakStandarSettingPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await getCurrentUser()
  if (!user) redirect('/')
  if (!user.menus.includes('standar-setting' as never)) return <main className="pap-print-error">Anda tidak punya akses ke menu Standar Setting.</main>

  const mesin = Number((await searchParams).mesin) || null
  const [machines] = await db.query<RowDataPacket[]>(
    `SELECT m.id, m.kode, m.nama, m.tahap, m.lini FROM machines m WHERE ${mesin ? 'm.id = ?' : 'EXISTS (SELECT 1 FROM machine_settings s WHERE s.machine_id = m.id)'} ORDER BY m.nama`,
    mesin ? [mesin] : [],
  )
  const [rows] = machines.length
    ? await db.query<RowDataPacket[]>(`${SETTING_SELECT} WHERE s.machine_id IN (?) ORDER BY s.produk IS NOT NULL, s.produk, s.urut, s.id`, [machines.map((m) => m.id)])
    : [[] as RowDataPacket[]]
  const doc = await loadSettings('doc.')
  const updated = rows.reduce<string>((max, r) => (String(r.updated_at) > max ? String(r.updated_at) : max), '')

  return (
    <main className="pap-print">
      <PrintButton />
      {machines.map((m, idx) => {
        const own = rows.filter((r) => r.machine_id === m.id)
        const groups = [...new Set(own.map((r) => r.produk ?? ''))]
        return (
          <article key={m.id} className="pap-sheet pap-damage-sheet" style={idx ? { breakBefore: 'page' } : undefined}>
            <table className="pap-sheet-head">
              <tbody>
                <tr>
                  <td className="logo"><img src="/logo-pap.png" alt="" width={120} /></td>
                  <td>
                    <h1>{doc.nama || 'PT. Pandawa Amerta Packindo'}</h1>
                    <p>Flexible Plastic Packaging Manufacture</p>
                    {doc.alamat && <p>{doc.alamat}</p>}
                  </td>
                </tr>
              </tbody>
            </table>
            <h2 className="pap-sheet-title">STANDAR SETTING MESIN</h2>
            <p className="pap-damage-period">{m.nama} ({m.kode}){m.tahap ? ` · ${m.tahap}` : ''}{m.lini ? ` · ${m.lini}` : ''}{updated ? ` · diperbarui ${tgl(updated)}` : ''}</p>
            {!own.length && <p>Belum ada parameter setting untuk mesin ini.</p>}
            {groups.map((g) => (
              <section key={g || 'umum'}>
                <h3>{g ? `Setting khusus: ${g}` : 'Setting umum'}</h3>
                <table className="pap-sheet-items">
                  <thead><tr><th className="c" style={{ width: 34 }}>No</th><th>Parameter</th><th className="r">Nilai standar</th><th>Satuan</th><th>Toleransi</th><th>Catatan</th></tr></thead>
                  <tbody>
                    {own.filter((r) => (r.produk ?? '') === g).map((r, i) => (
                      <tr key={r.id}><td className="c">{i + 1}</td><td>{r.parameter}</td><td className="r"><b>{r.nilai}</b></td><td>{r.satuan}</td><td>{r.toleransi}</td><td className="pre">{r.catatan}</td></tr>
                    ))}
                  </tbody>
                </table>
              </section>
            ))}
            <table className="pap-sheet-sign">
              <tbody>
                <tr>
                  <td><p>Dibuat oleh Teknik,</p><div className="space" /><p>(.........................)</p></td>
                  <td><p>Mengetahui Kepala Produksi,</p><div className="space" /><p>(.........................)</p></td>
                </tr>
              </tbody>
            </table>
          </article>
        )
      })}
      {!machines.length && <article className="pap-sheet"><p>Belum ada standar setting mesin.</p></article>}
    </main>
  )
}
