import { NextResponse } from 'next/server'
import { handle, requireUser, str } from '@/lib/api'
import { complaintOptions, requireComplaints } from '@/lib/complaints'

// Pilihan form Kendala Customer: customer (?q=), PIC, divisi
export const GET = handle(async (request: Request) => {
  const user = await requireUser()
  requireComplaints(user)
  return NextResponse.json(await complaintOptions(str(new URL(request.url).searchParams.get('q'), 100)))
})
