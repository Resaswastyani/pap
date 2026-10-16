import type { RowDataPacket } from 'mysql2'
import { NextResponse } from 'next/server'
import { fail, handle, int, requireUser } from '@/lib/api'
import { db } from '@/lib/db'
import { canSupervise } from '@/lib/marketing'
import { canRequest, isDesigner, loadDesign, loadLogs, requireRequestMenu } from '@/lib/requests'

type Ctx = { params: Promise<{ id: string }> }

export const GET = handle(async (_request: Request, ctx: Ctx) => {
  const user = await requireUser()
  requireRequestMenu(user, 'desain')
  const item = await loadDesign(int((await ctx.params).id) ?? fail(404, 'Request desain tidak ditemukan.'), user)
  const [files] = await db.query<RowDataPacket[]>(
    `SELECT f.id, f.kind, f.versi, f.name, f.mime, f.size, f.created_at, u.name AS uploaded_by_name FROM design_request_files f
     JOIN users u ON u.id = f.uploaded_by WHERE f.design_id = ? ORDER BY f.kind, f.versi DESC, f.id DESC`,
    [item.id],
  )
  return NextResponse.json({
    item,
    files,
    logs: await loadLogs('design_id', item.id),
    roles: {
      canRequest: canRequest(user),
      designer: isDesigner(user),
      isRequester: item.requested_by === user.id || user.role.isAdmin || canSupervise(user),
      isDesignerOf: item.designer_id === user.id || user.role.isAdmin,
    },
  })
})
