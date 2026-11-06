import type { ResultSetHeader } from 'mysql2'
import { NextResponse } from 'next/server'
import { fail, handle, readJson, requireUser } from '@/lib/api'
import { canManageAccounting, isPeriode, requireAccounting } from '@/lib/accounting'
import { db } from '@/lib/db'
import { DG_COLUMNS, dgValues, loadDigunggungMasa, loadNpwp, nextDigunggungNumber, readDigunggung } from '@/lib/digunggung'

// Faktur PPN digunggung per masa: ?masa=YYYY-MM
export const GET = handle(async (request: Request) => {
  const user = await requireUser()
  requireAccounting(user, 'pajak')
  const masa = new URL(request.url).searchParams.get('masa')
  if (!isPeriode(masa)) fail(400, 'Masa pajak tidak valid.')
  return NextResponse.json({
    items: await loadDigunggungMasa(masa!),
    nomor_berikutnya: await nextDigunggungNumber(masa!),
    npwp: await loadNpwp(),
    can: { manage: canManageAccounting(user) },
  })
})

// Tambah faktur digunggung (nomor otomatis)
export const POST = handle(async (request: Request) => {
  const user = await requireUser()
  requireAccounting(user, 'pajak')
  if (!canManageAccounting(user)) fail(403, 'PPN digunggung dicatat oleh divisi Accounting.')
  const v = readDigunggung(await readJson(request))
  for (let attempt = 0; ; attempt++) {
    const nomor = await nextDigunggungNumber(v.masa)
    try {
      const [res] = await db.query<ResultSetHeader>(
        `INSERT INTO tax_digunggung (${DG_COLUMNS}, created_by, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [...dgValues(v, nomor), user.id, user.id],
      )
      return NextResponse.json({ id: res.insertId, nomor }, { status: 201 })
    } catch (error) {
      // Dua orang menyimpan bersamaan: ambil nomor berikutnya
      if ((error as { code?: string }).code === 'ER_DUP_ENTRY' && attempt < 3) continue
      throw error
    }
  }
})
