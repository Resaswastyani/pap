import type { RowDataPacket } from 'mysql2'
import { NextResponse } from 'next/server'
import { handle, requireUser } from '@/lib/api'
import { db } from '@/lib/db'
import { canSyncMaintenanceSheet, requireMaintenanceSheet } from '@/lib/maintenance-sheet'

type Row = RowDataPacket & Record<string, unknown>

// Lembar perawatan dari Google Drive: daftar mesin (tab) dan langkah maintenance mesin terpilih (?tab=)
export const GET = handle(async (request: Request) => {
  const user = await requireUser()
  requireMaintenanceSheet(user)
  const [machines] = await db.query<Row[]>(
    `SELECT s.sheet_tab AS tab, s.mesin, MIN(s.mesin_urut) AS urut, s.machine_id, m.nama AS machine_nama, m.kode AS machine_kode,
       COUNT(DISTINCT s.part) AS parts, COUNT(*) AS langkah
     FROM maintenance_sheet_items s LEFT JOIN machines m ON m.id = s.machine_id
     GROUP BY s.sheet_tab, s.mesin, s.machine_id, m.nama, m.kode ORDER BY urut`,
  )
  const wanted = new URL(request.url).searchParams.get('tab')
  const tab = machines.find((m) => m.tab === wanted)?.tab ?? machines[0]?.tab ?? null
  const [items] = tab
    ? await db.query<Row[]>(
      'SELECT id, part_no, part, kelompok, langkah_urut, langkah, keterangan FROM maintenance_sheet_items WHERE sheet_tab = ? ORDER BY sheet_row, id',
      [tab],
    )
    : [[] as Row[]]
  // Gambar part (id saja; file diambil lewat /api/maintenance/sheet-image/<id>)
  const [images] = tab
    ? await db.query<Row[]>('SELECT id, part_no, part, urut FROM maintenance_sheet_images WHERE sheet_tab = ? ORDER BY sheet_row, urut', [tab])
    : [[] as Row[]]
  const [[synced]] = await db.query<Row[]>("SELECT value FROM app_settings WHERE `key` = 'perawatan.synced_at'")
  return NextResponse.json({
    tab,
    machines: machines.map((m) => ({ ...m, urut: Number(m.urut), parts: Number(m.parts), langkah: Number(m.langkah) })),
    items,
    images,
    synced_at: synced?.value ?? null,
    can: { sync: canSyncMaintenanceSheet(user) },
  })
})
