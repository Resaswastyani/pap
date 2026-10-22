import type { RowDataPacket } from 'mysql2'
import { NextResponse } from 'next/server'
import { fail, handle, int, readJson, requireUser } from '@/lib/api'
import { db } from '@/lib/db'
import { hrSheetDelete, hrSheetUpdate, jenisOf, requireGradeEditor, type HrJenis, type HrRow } from '@/lib/hrd-sheet'
import { sheetStrict } from '@/lib/sheet-write'

type Ctx = { params: Promise<{ id: string }> }

// ?jenis=grade (employee_grades) | gaji (employee_salaries)
async function load(request: Request, ctx: Ctx) {
  const user = await requireUser()
  requireGradeEditor(user)
  const jenis: HrJenis = jenisOf(new URL(request.url).searchParams.get('jenis'))
  const id = int((await ctx.params).id) ?? fail(404, 'Data tidak ditemukan.')
  const [[row]] = await db.query<(RowDataPacket & HrRow)[]>(
    `SELECT id, nama, nama_key, sheet_row FROM ${jenis === 'grade' ? 'employee_grades' : 'employee_salaries'} WHERE id = ?`, [id],
  )
  return { jenis, old: row ?? fail(404, 'Data tidak ditemukan. Muat ulang halaman.') }
}

// Ubah baris asalnya di spreadsheet Grade, lalu sinkron ulang
export const PATCH = handle(async (request: Request, ctx: Ctx) => {
  const { jenis, old } = await load(request, ctx)
  const body = await readJson(request)
  const res = await sheetStrict(() => hrSheetUpdate(jenis, old, body))
  return NextResponse.json({ ok: true, ...res })
})

export const DELETE = handle(async (request: Request, ctx: Ctx) => {
  const { jenis, old } = await load(request, ctx)
  const res = await sheetStrict(() => hrSheetDelete(jenis, old))
  return NextResponse.json({ ok: true, ...res })
})
