import { NextResponse } from 'next/server'
import { handle, requireUser } from '@/lib/api'
import { requireMenu } from '@/lib/customers'
import { canViewProduction } from '@/lib/production'
import { canPlanProduction, loadForwardPlan, todayWib } from '@/lib/production-forward-plan'

// Rencana Produksi ke depan: pesanan yang harus diproduksi + jadwal tanggal/shift-nya
export const GET = handle(async () => {
  const user = await requireUser()
  requireMenu(user, canViewProduction(user))
  return NextResponse.json({ today: todayWib(), jobs: await loadForwardPlan(), can: { plan: canPlanProduction(user) } })
})
