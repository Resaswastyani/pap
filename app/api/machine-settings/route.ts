import type { ResultSetHeader, RowDataPacket } from 'mysql2'
import { NextResponse } from 'next/server'
import { fail, handle, int, readJson, requireUser } from '@/lib/api'
import { db } from '@/lib/db'
import { readSettingInput, SETTING_SELECT } from '@/lib/machine-settings'
import { canManageTeknik, requireTeknikMenu } from '@/lib/teknik'

// Standar setting mesin. ?machine=ID -> parameter mesin itu (umum + per produk); tanpa machine -> daftar mesin + jumlah parameter
export const GET = handle(async (request: Request) => {
  const user = await requireUser()
  requireTeknikMenu(user, 'standar-setting', 'Standar Setting')
  const machine = int(new URL(request.url).searchParams.get('machine'))
  const [machines] = await db.query<RowDataPacket[]>(
    `SELECT m.id, m.kode, m.nama, m.tahap, m.lini, m.status, COUNT(s.id) AS parameter, COUNT(DISTINCT COALESCE(s.produk, '')) AS kelompok, MAX(s.updated_at) AS diubah
     FROM machines m LEFT JOIN machine_settings s ON s.machine_id = m.id GROUP BY m.id ORDER BY m.nama`,
  )
  const [items] = machine ? await db.query<RowDataPacket[]>(`${SETTING_SELECT} WHERE s.machine_id = ? ORDER BY s.produk IS NOT NULL, s.produk, s.urut, s.id`, [machine]) : [[]]
  return NextResponse.json({
    machines: machines.map((m) => ({ ...m, parameter: Number(m.parameter), kelompok: Number(m.parameter) ? Number(m.kelompok) : 0 })),
    items,
    can: { manage: canManageTeknik(user) },
  })
})

// Tambah parameter: { machine_id, produk, parameter, nilai, satuan, toleransi, catatan }
export const POST = handle(async (request: Request) => {
  const user = await requireUser()
  requireTeknikMenu(user, 'standar-setting', 'Standar Setting')
  if (!canManageTeknik(user)) fail(403, 'Standar setting mesin dibuat oleh divisi Teknik.')
  const input = await readSettingInput(await readJson(request))
  const [[next]] = await db.query<(RowDataPacket & { urut: number })[]>(
    'SELECT COALESCE(MAX(urut), 0) + 1 AS urut FROM machine_settings WHERE machine_id = ? AND produk <=> ?',
    [input.machineId, input.produk],
  )
  const [res] = await db.query<ResultSetHeader>(
    'INSERT INTO machine_settings (machine_id, produk, parameter, nilai, satuan, toleransi, catatan, urut, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [input.machineId, input.produk, input.parameter, input.nilai, input.satuan, input.toleransi, input.catatan, next.urut, user.id],
  )
  const [[item]] = await db.query<RowDataPacket[]>(`${SETTING_SELECT} WHERE s.id = ?`, [res.insertId])
  return NextResponse.json({ item }, { status: 201 })
})
