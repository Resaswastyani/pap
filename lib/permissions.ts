// Kode permission di tabel permissions (db/004_divisions_permissions_planning.sql)
export const PERMISSIONS = {
  planningView: 'planning.view',
  planningViewAll: 'planning.view_all',
  planningCreate: 'planning.create',
  planningUpdateProgress: 'planning.update_progress',
  planningManage: 'planning.manage',
  usersManage: 'users.manage',
  rolesManage: 'roles.manage',
  meetingView: 'meeting.view',
  meetingViewAll: 'meeting.view_all',
  meetingCreate: 'meeting.create',
  meetingManage: 'meeting.manage',
  customerManage: 'customer.manage',
  productManage: 'product.manage',
  productionManage: 'production.manage',
  productionProgress: 'production.progress',
  productionQc: 'production.qc',
  purchasingSupplier: 'purchasing.supplier.manage',
  purchasingPoCreate: 'purchasing.po.create',
  purchasingPoUpdate: 'purchasing.po.update',
  purchasingPoDelete: 'purchasing.po.delete',
  purchasingPrice: 'purchasing.price.update',
} as const

// Lampiran produk (desain): PDF & gambar, maks 4 MB per file (batas request Vercel 4,5 MB; diunggah satu per satu)
export const PRODUCT_FILE_MAX_BYTES = 4 * 1024 * 1024
// Lampiran Prospek & Request Sample: semua format, maks 2 MB per file
export const ATTACHMENT_MAX_BYTES = 2 * 1024 * 1024
export const PRODUCT_FILE_ACCEPT = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'] as const

export type PermissionCode = (typeof PERMISSIONS)[keyof typeof PERMISSIONS]

export const ALL_PERMISSIONS = Object.values(PERMISSIONS) as PermissionCode[]

export const PLANNING_STATUS = {
  belum_mulai: 'Belum mulai',
  berjalan: 'Berjalan',
  selesai: 'Selesai',
  ditunda: 'Ditunda',
  dibatalkan: 'Dibatalkan',
} as const

export const MEETING_STATUS = {
  terjadwal: 'Terjadwal',
  berlangsung: 'Berlangsung',
  selesai: 'Selesai',
  dibatalkan: 'Dibatalkan',
} as const

export type MeetingStatus = keyof typeof MEETING_STATUS
export type PlanningStatus = keyof typeof PLANNING_STATUS

// Lampiran planning, catatan progress, & hasil meeting: semua format file, maks 2 MB per file
export const FILE_MAX_BYTES = ATTACHMENT_MAX_BYTES
