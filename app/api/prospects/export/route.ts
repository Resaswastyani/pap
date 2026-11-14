import { handle, requireUser } from '@/lib/api'
import { PROSPECT_EXPORT_HEAD, prospectExport, prospectExportTable, requireMarketing } from '@/lib/marketing'
import { writeXlsx, type XlsxCell } from '@/lib/xlsx-write'

// Unduh daftar prospek sesuai filter di menu Prospek: ?format=xlsx|csv (&q, status, sumber, owner, followup).
// Kolom sama dengan tabel Program Mkt Dev, satu baris per produk, sehingga file bisa diimpor ulang.
export const GET = handle(async (request: Request) => {
  const user = await requireUser()
  requireMarketing(user, 'prospek')
  const sp = new URL(request.url).searchParams
  const rows = await prospectExport(user, sp)
  const table = prospectExportTable(rows)
  const stamp = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10)
  if (sp.get('format') === 'csv') {
    const cell = (v: string | number | null) => {
      const t = v === null || v === undefined ? '' : String(v)
      return /[",\n\r;]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t
    }
    // BOM agar Excel membaca UTF-8 dengan benar
    const csv = '﻿' + [PROSPECT_EXPORT_HEAD, ...table].map((r) => r.map(cell).join(',')).join('\r\n')
    return new Response(csv, {
      headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="Prospek ${stamp}.csv"`, 'Cache-Control': 'no-store' },
    })
  }
  const NUM = new Set([8, 9, 11]) // qty, harga, GPF
  const head: XlsxCell[] = PROSPECT_EXPORT_HEAD.map((v) => ({ v, s: 'head' }))
  const body: XlsxCell[][] = table.map((r) => r.map((v, i) => (NUM.has(i) && typeof v === 'number' ? { v, s: 'num' } : { v, s: 'cell' })))
  const xlsx = writeXlsx([{
    title: 'Prospek', rows: [head, ...body], freeze: { row: 1, col: 2 },
    widths: [5, 30, 16, 26, 24, 16, 46, 11, 12, 13, 10, 10, 22, 22, 28, 13, 18, 18],
    autoFilter: `A1:R${body.length + 1}`,
  }])
  return new Response(new Uint8Array(xlsx), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="Prospek ${stamp}.xlsx"`,
      'Cache-Control': 'no-store',
    },
  })
})
