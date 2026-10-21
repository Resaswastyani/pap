import type { RowDataPacket } from 'mysql2'
import { fail } from '@/lib/api'
import type { NoteOwner } from '@/lib/attachments'
import { db } from '@/lib/db'
import { loadProspect, requireMarketing } from '@/lib/marketing'
import { canManageProduction, canProgressProduction, canViewProduction } from '@/lib/production'
import { canHandleRepair, requireRepairs } from '@/lib/repairs'
import { loadRepeatCustomer, requireRepeatOrder } from '@/lib/repeat-order'
import { loadDesign, loadSample, requireRequestMenu } from '@/lib/requests'
import { canManageTeknik, canProcessPurchase, requireTeknikMenu } from '@/lib/teknik'
import type { UserProfile } from '@/lib/users'

// Hak akses lampiran catatan mengikuti data induknya. canAdd: penulis catatan / yang berwenang mengubah.
export async function noteAccess(owner: NoteOwner, id: number, user: UserProfile): Promise<{ canAdd: boolean }> {
  if (owner === 'activity') {
    const [[row]] = await db.query<RowDataPacket[]>('SELECT prospect_id, customer_id, user_id FROM marketing_activities WHERE id = ?', [id])
    if (!row) fail(404, 'Catatan tidak ditemukan.')
    if (row.prospect_id) {
      requireMarketing(user, 'prospek')
      await loadProspect(row.prospect_id, user)
    } else if (row.customer_id) {
      requireRepeatOrder(user)
      await loadRepeatCustomer(row.customer_id, user)
    } else fail(404, 'Catatan tidak ditemukan.')
    return { canAdd: row.user_id === user.id || user.role.isAdmin }
  }
  if (owner === 'request_log') {
    const [[row]] = await db.query<RowDataPacket[]>('SELECT sample_id, design_id, user_id FROM request_logs WHERE id = ?', [id])
    if (!row) fail(404, 'Catatan tidak ditemukan.')
    if (row.sample_id) {
      requireRequestMenu(user, 'sample')
      await loadSample(row.sample_id, user)
    } else {
      requireRequestMenu(user, 'desain')
      await loadDesign(row.design_id, user)
    }
    return { canAdd: row.user_id === user.id || user.role.isAdmin }
  }
  if (owner === 'repair') {
    // Foto kerusakan / hasil perbaikan: pelapor & Teknik
    requireRepairs(user)
    const [[row]] = await db.query<RowDataPacket[]>('SELECT reported_by FROM machine_repairs WHERE id = ?', [id])
    if (!row) fail(404, 'Laporan kerusakan tidak ditemukan.')
    return { canAdd: row.reported_by === user.id || canHandleRepair(user) }
  }
  if (owner === 'maintenance_log') {
    // Foto / dokumen checkup perawatan: yang mengerjakan & Teknik
    requireTeknikMenu(user, 'perawatan-mesin', 'Perawatan Mesin')
    const [[row]] = await db.query<RowDataPacket[]>('SELECT dikerjakan_oleh FROM maintenance_logs WHERE id = ?', [id])
    if (!row) fail(404, 'Catatan checkup tidak ditemukan.')
    return { canAdd: row.dikerjakan_oleh === user.id || canManageTeknik(user) }
  }
  if (owner === 'purchase_request') {
    // Foto barang, penawaran / nota vendor: pengaju, Teknik, & Purchasing
    requireTeknikMenu(user, 'pengajuan-pembelian', 'Pengajuan Pembelian')
    const [[row]] = await db.query<RowDataPacket[]>('SELECT requested_by FROM purchase_requests WHERE id = ?', [id])
    if (!row) fail(404, 'Pengajuan pembelian tidak ditemukan.')
    return { canAdd: row.requested_by === user.id || canManageTeknik(user) || canProcessPurchase(user) }
  }
  const table = owner === 'stage' ? 'production_stages' : 'production_jobs'
  const [[row]] = await db.query<RowDataPacket[]>(`SELECT id FROM ${table} WHERE id = ?`, [id])
  if (!row) fail(404, owner === 'stage' ? 'Tahap produksi tidak ditemukan.' : 'Job produksi tidak ditemukan.')
  if (!canViewProduction(user)) fail(403, 'Anda tidak punya akses ke Jadwal Produksi.')
  return { canAdd: owner === 'stage' ? canProgressProduction(user) : canManageProduction(user) }
}
