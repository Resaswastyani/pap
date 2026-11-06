import type { ResultSetHeader, RowDataPacket } from 'mysql2'
import { NextResponse } from 'next/server'
import { fail, handle, readJson, requireUser } from '@/lib/api'
import { canManageAccounting, isPeriode, requireAccounting, requireOpen } from '@/lib/accounting'
import { db } from '@/lib/db'
import { nextDigunggungNumber, readDigunggung } from '@/lib/digunggung'

// Faktur PPN digunggung per masa: ?masa=YYYY-MM
export const GET = handle(async (request: Request) => {
  const user = await requireUser()
  requireAccounting(user, 'pajak')
  const masa = new URL(request.url).searchParams.get('masa')
  if (!isPeriode(masa)) fail(400, 'Masa pajak tidak valid.')
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT d.*, u.name AS updated_name FROM tax_digunggung d LEFT JOIN users u ON u.id = COALESCE(d.updated_by, d.created_by)
     WHERE d.masa = ? ORDER BY d.tanggal, d.nomor`, [masa!],
  )
  const num = (v: unknown) => Number(v ?? 0)
  return NextResponse.json({
    items: rows.map((r) => ({ ...r, dpp: num(r.dpp), dpp_nilai_lain: num(r.dpp_nilai_lain), ppn: num(r.ppn), total: num(r.total) })),
    nomor_berikutnya: await nextDigunggungNumber(masa!),
    can: { manage: canManageAccounting(user) },
  })
})

// Tambah faktur digunggung (nomor otomatis)
export const POST = handle(async (request: Request) => {
  const user = await requireUser()
  requireAccounting(user, 'pajak')
  if (!canManageAccounting(user)) fail(403, 'PPN digunggung dicatat oleh divisi Accounting.')
  const v = readDigunggung(await readJson(request))
  await requireOpen(v.masa, 'PPN digunggung')
  for (let attempt = 0; ; attempt++) {
    const nomor = await nextDigunggungNumber(v.masa)
    try {
      const [res] = await db.query<ResultSetHeader>(
        `INSERT INTO tax_digunggung (masa, nomor, tanggal, no_faktur_pajak, customer, jatuh_tempo, dpp, dpp_nilai_lain, ppn, total, catatan, created_by, updated_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [v.masa, nomor, v.tanggal, v.no_faktur_pajak, v.customer, v.jatuh_tempo, v.dpp, v.dpp_nilai_lain, v.ppn, v.total, v.catatan, user.id, user.id],
      )
      return NextResponse.json({ id: res.insertId, nomor }, { status: 201 })
    } catch (error) {
      // Dua orang menyimpan bersamaan: ambil nomor berikutnya
      if ((error as { code?: string }).code === 'ER_DUP_ENTRY' && attempt < 3) continue
      throw error
    }
  }
})
