import type { ResultSetHeader, RowDataPacket } from 'mysql2'
import { NextResponse } from 'next/server'
import { handle, readJson, requireUser } from '@/lib/api'
import { db } from '@/lib/db'
import { canProcessGa, GA_PR_SELECT, notifyGaPr, readGaPrInput, requireGaRequest, saveGaPrItems, serializeGaPr } from '@/lib/ga-requests'

// Daftar pengajuan: General Affair / GM melihat semua, selain itu pengajuan sendiri
export const GET = handle(async () => {
  const user = await requireUser()
  requireGaRequest(user)
  const all = canProcessGa(user)
  const [rows] = await db.query<(RowDataPacket & Record<string, unknown>)[]>(
    `${GA_PR_SELECT} ${all ? '' : 'WHERE r.requested_by = ?'}
     ORDER BY FIELD(r.status, 'diajukan', 'disetujui', 'dibeli', 'selesai', 'ditolak', 'batal'), FIELD(r.prioritas, 'darurat', 'tinggi', 'normal'), r.id DESC LIMIT 500`,
    all ? [] : [user.id],
  )
  return NextResponse.json({ items: rows.map(serializeGaPr), can: { process: all } })
})

// Ajukan pembelian ke General Affair -> notifikasi GA (darurat juga ke GM)
export const POST = handle(async (request: Request) => {
  const user = await requireUser()
  requireGaRequest(user)
  const input = readGaPrInput(await readJson(request))
  const [res] = await db.query<ResultSetHeader>(
    'INSERT INTO ga_purchase_requests (judul, kategori, prioritas, dibutuhkan, keperluan, requested_by) VALUES (?, ?, ?, ?, ?, ?)',
    [input.judul, input.kategori, input.prioritas, input.dibutuhkan, input.keperluan, user.id],
  )
  const id = res.insertId
  await db.query("UPDATE ga_purchase_requests SET nomor = CONCAT('GA-', DATE_FORMAT(created_at, '%Y%m'), '-', LPAD(id, 5, '0')) WHERE id = ?", [id])
  await saveGaPrItems(id, input.items)
  await notifyGaPr(id, user, true)
  return NextResponse.json({ id }, { status: 201 })
})
