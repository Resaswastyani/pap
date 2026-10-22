import type { ResultSetHeader, RowDataPacket } from 'mysql2'
import { NextResponse } from 'next/server'
import { fail, handle, readJson, requireUser, str } from '@/lib/api'
import { canManageAccounting, cashAccounts, cashBalanceAt, cashTransactions, isDate, requireAccounting, todayWib } from '@/lib/accounting'
import { db } from '@/lib/db'

export const maxDuration = 60

// Kas & bank: saldo per akun, transaksi harian (?dari=&sampai=, maks 62 hari), riwayat pencocokan saldo real
export const GET = handle(async (request: Request) => {
  const user = await requireUser()
  requireAccounting(user, 'kas-bank')
  const p = new URL(request.url).searchParams
  const today = todayWib()
  const sampai = isDate(p.get('sampai')) ? p.get('sampai')! : today
  const dari = isDate(p.get('dari')) && p.get('dari')! <= sampai ? p.get('dari')! : sampai
  if ((Date.parse(sampai) - Date.parse(dari)) / 86400e3 > 62) fail(400, 'Rentang tanggal maksimal 2 bulan.')
  const force = p.get('refresh') === '1'
  const [accounts, transaksi] = await Promise.all([cashAccounts(force), cashTransactions(dari, sampai, force)])
  const [recons] = await db.query<RowDataPacket[]>(
    `SELECT r.id, r.account_no, r.account_name, r.tanggal, r.saldo_real, r.saldo_accurate, r.catatan, r.created_at, u.name AS created_name
     FROM cash_reconciliations r LEFT JOIN users u ON u.id = r.created_by ORDER BY r.tanggal DESC, r.id DESC LIMIT 100`,
  )
  return NextResponse.json({
    dari, sampai, accounts, transaksi,
    total: { masuk: Math.round(transaksi.filter((t) => t.jenis === 'masuk').reduce((s, t) => s + t.nominal, 0)), keluar: Math.round(transaksi.filter((t) => t.jenis === 'keluar').reduce((s, t) => s + t.nominal, 0)) },
    recons: recons.map((r) => ({ ...r, saldo_real: Number(r.saldo_real), saldo_accurate: Number(r.saldo_accurate), selisih: Number(r.saldo_real) - Number(r.saldo_accurate) })),
    can: { manage: canManageAccounting(user) },
  })
})

// Catat pencocokan: { account_no, tanggal, saldo_real, catatan } — saldo Accurate per tanggal diambil dari neraca
export const POST = handle(async (request: Request) => {
  const user = await requireUser()
  requireAccounting(user, 'kas-bank')
  if (!canManageAccounting(user)) fail(403, 'Pencocokan saldo dicatat oleh divisi Accounting.')
  const body = await readJson(request)
  const accountNo = str(body.account_no, 50)
  const tanggal = str(body.tanggal, 10)
  if (!isDate(tanggal) || tanggal > todayWib()) fail(400, 'Tanggal tidak valid.')
  const real = Number(String(body.saldo_real ?? '').replace(',', '.'))
  if (body.saldo_real === '' || !Number.isFinite(real)) fail(400, 'Saldo real tidak valid.')
  const account = (await cashAccounts()).find((a) => a.no === accountNo) ?? fail(404, 'Akun kas/bank tidak ditemukan.')
  const saldoAccurate = await cashBalanceAt(accountNo, tanggal)
  const [res] = await db.query<ResultSetHeader>(
    'INSERT INTO cash_reconciliations (account_no, account_name, tanggal, saldo_real, saldo_accurate, catatan, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [accountNo, account.name, tanggal, real, saldoAccurate, str(body.catatan, 1000) || null, user.id],
  )
  return NextResponse.json({ id: res.insertId, saldo_accurate: saldoAccurate, selisih: real - saldoAccurate })
})
