// Pesan error Google / spreadsheet GA dibuat jelas untuk pengguna (400 dengan alasannya; tidak ada yang berubah)
import { fail } from '@/lib/api'
import { DriveError, driveAccount } from '@/lib/drive'
import { SheetWriteError } from '@/lib/sheet-write'

export async function gaGuard<T>(fn: () => Promise<T>) {
  if (!(await driveAccount())) fail(400, 'Akun Google belum terhubung. Hubungkan dulu di Master Data > Logo & Desain.')
  try {
    return await fn()
  } catch (error) {
    if (error instanceof SheetWriteError || error instanceof DriveError) fail(400, error.message)
    if (error instanceof Error && /unable to authenticate data/i.test(error.message)) fail(400, 'Token akun Google tidak bisa dibaca di server ini. Hubungkan ulang akun Google di Master Data > Logo & Desain.')
    if (error instanceof Error && /Google|Akses|XLSX/.test(error.message)) fail(400, error.message)
    throw error
  }
}
