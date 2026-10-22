import type { RowDataPacket } from 'mysql2'
import { NextResponse } from 'next/server'
import { fail, handle, readJson, requireUser } from '@/lib/api'
import { canManageAccounting, isPeriode, requireAccounting, shiftMonth, TAX_TYPES, taxDeadline, todayWib, vatSummary } from '@/lib/accounting'
import { readFiling } from '@/lib/accounting-input'
import { db } from '@/lib/db'

export const maxDuration = 60

// Pajak per masa (?masa=YYYY-MM, default bulan lalu): PPN keluaran vs masukan dari Accurate + status setor / lapor
export const GET = handle(async (request: Request) => {
  const user = await requireUser()
  requireAccounting(user, 'pajak')
  const p = new URL(request.url).searchParams
  const today = todayWib()
  const masa = isPeriode(p.get('masa')) ? p.get('masa')! : shiftMonth(today.slice(0, 7), -1)
  const vat = await vatSummary(masa, p.get('refresh') === '1')
  const [filings] = await db.query<RowDataPacket[]>(
    `SELECT f.*, u.name AS updated_name FROM tax_filings f LEFT JOIN users u ON u.id = f.updated_by WHERE f.masa = ? ORDER BY f.jenis`, [masa],
  )
  // Kewajiban bawaan per masa + jenis lain yang dicatat
  const jenis = [...new Set([...Object.keys(TAX_TYPES), ...filings.map((f) => String(f.jenis))])]
  const kewajiban = jenis.map((j) => {
    const f = filings.find((x) => x.jenis === j)
    const t = TAX_TYPES[j]
    const batasSetor = t ? taxDeadline(masa, t.setor) : null
    const batasLapor = t ? taxDeadline(masa, t.lapor) : null
    const status = f?.tgl_lapor ? 'selesai' : f?.tgl_setor ? 'sudah_setor' : batasLapor && today > batasLapor ? 'terlambat' : 'belum'
    return {
      id: f?.id ?? null, jenis: j, label: t?.label ?? j.replace(/^lainnya[-_]?/, 'Lainnya ').trim(), batas_setor: batasSetor, batas_lapor: batasLapor, status,
      nominal: f?.nominal == null ? (j === 'ppn' ? Math.max(0, vat.total.kurang_bayar) : null) : Number(f.nominal), nominal_tercatat: f?.nominal != null,
      tgl_setor: f?.tgl_setor ?? null, ntpn: f?.ntpn ?? null, tgl_lapor: f?.tgl_lapor ?? null, no_bukti: f?.no_bukti ?? null, catatan: f?.catatan ?? null, updated_name: f?.updated_name ?? null,
    }
  })
  // Rekap 6 masa terakhir (status lapor)
  const [recent] = await db.query<RowDataPacket[]>(
    'SELECT masa, COUNT(*) AS dicatat, SUM(tgl_lapor IS NOT NULL) AS dilaporkan FROM tax_filings WHERE masa >= ? GROUP BY masa ORDER BY masa DESC',
    [shiftMonth(masa, -5)],
  )
  return NextResponse.json({
    masa, vat, kewajiban, rekap: recent.map((r) => ({ masa: r.masa, dicatat: Number(r.dicatat), dilaporkan: Number(r.dilaporkan) })),
    tanpa_faktur_pajak: vat.keluaran.filter((r) => !r.faktur_pajak).length,
    can: { manage: canManageAccounting(user) },
  })
})

// Catat setor / lapor: { masa, jenis, nominal, tgl_setor, ntpn, tgl_lapor, no_bukti, catatan }
export const PUT = handle(async (request: Request) => {
  const user = await requireUser()
  requireAccounting(user, 'pajak')
  if (!canManageAccounting(user)) fail(403, 'Pelaporan pajak dicatat oleh divisi Accounting.')
  const v = readFiling(await readJson(request))
  await db.query(
    `INSERT INTO tax_filings (masa, jenis, nominal, tgl_setor, ntpn, tgl_lapor, no_bukti, catatan, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE nominal = VALUES(nominal), tgl_setor = VALUES(tgl_setor), ntpn = VALUES(ntpn), tgl_lapor = VALUES(tgl_lapor),
       no_bukti = VALUES(no_bukti), catatan = VALUES(catatan), updated_by = VALUES(updated_by)`,
    [v.masa, v.jenis, v.nominal, v.tgl_setor, v.ntpn, v.tgl_lapor, v.no_bukti, v.catatan, user.id],
  )
  return NextResponse.json({ ok: true })
})
