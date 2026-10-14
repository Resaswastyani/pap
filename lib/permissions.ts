// Kode permission di tabel permissions (db/004_divisions_permissions_planning.sql)
export const PERMISSIONS = {
  planningView: 'planning.view',
  planningViewAll: 'planning.view_all',
  planningCreate: 'planning.create',
  planningUpdateProgress: 'planning.update_progress',
  planningManage: 'planning.manage',
  usersManage: 'users.manage',
  rolesManage: 'roles.manage',
} as const

export type PermissionCode = (typeof PERMISSIONS)[keyof typeof PERMISSIONS]

export const ALL_PERMISSIONS = Object.values(PERMISSIONS) as PermissionCode[]

export const PLANNING_STATUS = {
  belum_mulai: 'Belum mulai',
  berjalan: 'Berjalan',
  selesai: 'Selesai',
  ditunda: 'Ditunda',
  dibatalkan: 'Dibatalkan',
} as const

export type PlanningStatus = keyof typeof PLANNING_STATUS

// Lampiran planning: gambar, PDF, dan Word (maks 5 MB per file)
export const FILE_MAX_BYTES = 5 * 1024 * 1024
export const FILE_ACCEPT = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'application/pdf': '.pdf',
  'application/msword': '.doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
} as const
