import { NextResponse } from 'next/server'
import { ApiError, fail, handle, readJson, requireUser, str } from '@/lib/api'
import { DriveError, driveAccount } from '@/lib/drive'
import { importMachines, loadMachineSheetUrl, readMachineSheet, saveMachineSheetUrl } from '@/lib/machine-sheet'
import { canManageMachines } from '@/lib/production'

export const maxDuration = 60

async function readSheet(url: string) {
  if (!(await driveAccount())) fail(400, 'Akun Google belum terhubung. Hubungkan dulu di Master Data > Logo & Desain.')
  try {
    return await readMachineSheet(url)
  } catch (error) {
    if (error instanceof DriveError) fail(400, error.message)
    if (error instanceof Error && /Google|Akses|XLSX/.test(error.message)) fail(400, error.message)
    throw error
  }
}
const canView = (menus: string[]) => menus.includes('data-mesin') || menus.includes('perbaikan-mesin')

// Pratinjau spreadsheet mapping teknis mesin: mesin, jumlah critical point & dokumen yang akan disinkron
export const GET = handle(async () => {
  const user = await requireUser()
  if (!canView(user.menus)) fail(403, 'Anda tidak punya akses ke Data Mesin.')
  const url = await loadMachineSheetUrl()
  const account = await driveAccount()
  const base = { url, account: account?.email ?? null, canSync: canManageMachines(user) }
  try {
    const { tabs, machines } = await readSheet(url)
    return NextResponse.json({
      ...base, tabs,
      machines: machines.map((m) => ({
        kode: m.kode, nama: m.nama, lini: m.lini, tahap: m.tahap, dokumen: m.docs.length,
        komponen: new Set(m.checkpoints.map((c) => c.komponen)).size,
        langkah: m.checkpoints.filter((c) => c.jenis === 'langkah').length,
      })),
    })
  } catch (error) {
    if (error instanceof ApiError) return NextResponse.json({ ...base, tabs: [], machines: [], error: error.message })
    throw error
  }
})

export const PUT = handle(async (request: Request) => {
  const user = await requireUser()
  if (!canManageMachines(user)) fail(403, 'Data mesin dikelola PPIC / Teknik.')
  await saveMachineSheetUrl(str((await readJson(request)).url, 1000), user.id)
  return NextResponse.json({ ok: true })
})

// Sinkron: buat / perbarui mesin dan ganti critical point & dokumen dengan isi sheet terbaru
export const POST = handle(async () => {
  const user = await requireUser()
  if (!canManageMachines(user)) fail(403, 'Data mesin dikelola PPIC / Teknik.')
  const { machines } = await readSheet(await loadMachineSheetUrl())
  if (!machines.length) fail(400, 'Tidak ada mesin yang dikenali. Pastikan sheet berisi judul mesin seperti "A. | MC BLOW".')
  return NextResponse.json(await importMachines(machines))
})
