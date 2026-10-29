import type { RowDataPacket } from 'mysql2'
import { NextResponse } from 'next/server'
import { fail, handle, readJson, requireUser } from '@/lib/api'
import { db } from '@/lib/db'

// Susunan kartu per user (urutan & yang disembunyikan) untuk Dashboard / Monitoring, disimpan di app_settings
const PAGES = ['dashboard', 'monitoring']
const keyOf = (page: string, userId: number) => `layout.${page}.${userId}`
const readPage = (v: unknown) => (typeof v === 'string' && PAGES.includes(v) ? v : fail(400, 'Halaman tidak dikenal.'))
const readKeys = (v: unknown) => (Array.isArray(v) ? v : []).filter((k): k is string => typeof k === 'string' && /^[a-z0-9-]{1,40}$/.test(k)).slice(0, 60)

export const GET = handle(async (request: Request) => {
  const user = await requireUser()
  const page = readPage(new URL(request.url).searchParams.get('page'))
  const [[row]] = await db.query<(RowDataPacket & { value: string })[]>('SELECT value FROM app_settings WHERE `key` = ?', [keyOf(page, user.id)])
  let layout: { order: string[]; hidden: string[] } = { order: [], hidden: [] }
  try {
    const v = row ? JSON.parse(row.value) : null
    if (v) layout = { order: readKeys(v.order), hidden: readKeys(v.hidden) }
  } catch {}
  return NextResponse.json(layout)
})

// { page, order: string[], hidden: string[] }; order kosong = kembali ke susunan bawaan
export const PUT = handle(async (request: Request) => {
  const user = await requireUser()
  const body = await readJson(request)
  const page = readPage(body.page)
  const order = readKeys(body.order)
  const hidden = readKeys(body.hidden)
  if (!order.length && !hidden.length) await db.query('DELETE FROM app_settings WHERE `key` = ?', [keyOf(page, user.id)])
  else {
    await db.query(
      'INSERT INTO app_settings (`key`, value, updated_by) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value), updated_by = VALUES(updated_by)',
      [keyOf(page, user.id), JSON.stringify({ order, hidden }), user.id],
    )
  }
  return NextResponse.json({ ok: true })
})
