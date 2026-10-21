// Harga Pemasok Accurate (modul "Harga Pemasok", nomor VPA.xxxx): daftar harga beli barang per pemasok yang berlaku mulai tanggal tertentu.
// Data dibaca & ditulis langsung ke Accurate (tidak disalin ke database PAP-MS).
import { accurate, AccurateError, fromAccurateDate } from '@/lib/accurate'
import { fail, str } from '@/lib/api'

type Obj = Record<string, unknown>
const nameOf = (v: unknown) => (v && typeof v === 'object' ? String((v as Obj).name ?? '') : '')

async function send<T>(path: string, options: Parameters<typeof accurate>[1]) {
  try {
    return await accurate<T>(path, options)
  } catch (error) {
    if (error instanceof AccurateError) fail(400, error.message.replace(/^Accurate \(\d+\): /, 'Accurate: '))
    throw error
  }
}

export type VendorPriceLine = { id: number | null; item_no: string; item_name: string; unit: string; price: number }
export type VendorPrice = { id: number; number: string; tanggal: string | null; vendor_no: string; vendor_name: string; keterangan: string; lines: VendorPriceLine[] }

function mapDetail(d: Obj): VendorPrice {
  const vendor = (d.vendor ?? {}) as Obj
  return {
    id: Number(d.id), number: String(d.number ?? ''), tanggal: fromAccurateDate(d.transDate), vendor_no: String(vendor.vendorNo ?? ''), vendor_name: String(vendor.name ?? ''),
    keterangan: String(d.description ?? ''),
    lines: ((d.detailItem ?? []) as Obj[]).map((l) => {
      const item = (l.item ?? {}) as Obj
      return { id: Number(l.id) || null, item_no: String(item.no ?? ''), item_name: String(l.detailName ?? item.name ?? ''), unit: nameOf(l.itemUnit), price: Number(l.price ?? l.unitPrice ?? 0) }
    }),
  }
}

export async function vendorPriceDetail(id: number) {
  return mapDetail((await send<Obj>('/api/vendor-price/detail.do', { params: { id } })).d)
}

// Daftar dokumen Harga Pemasok (terbaru dulu) beserta baris barangnya; ?q= cari nomor / pemasok
export async function listVendorPrices(page: number, q: string) {
  const res = await send<Obj[]>('/api/vendor-price/list.do', {
    params: { fields: 'id,number,transDate,vendor', 'sp.page': page, 'sp.pageSize': 20, 'sp.sort': 'transDate|desc', ...(q ? { 'filter.keywords.op': 'CONTAIN', 'filter.keywords.val': q } : {}) },
  })
  const items: VendorPrice[] = []
  for (const row of res.d ?? []) items.push(await vendorPriceDetail(Number(row.id)))
  return { items, page: res.sp?.page ?? page, pageCount: res.sp?.pageCount ?? 1, total: res.sp?.rowCount ?? items.length }
}

export type VendorPriceInput = { vendor_no: string; tanggal: string; nomor: string | null; keterangan: string | null; lines: { id: number | null; item_no: string; unit: string | null; price: number }[] }
export function readVendorPriceInput(body: Obj): VendorPriceInput {
  const vendor_no = str(body.vendor_no, 50)
  if (!vendor_no) fail(400, 'Pilih pemasok.')
  const tanggal = str(body.tanggal, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tanggal)) fail(400, 'Tanggal berlaku tidak valid.')
  const raw = Array.isArray(body.lines) ? (body.lines as Obj[]) : []
  const lines = raw.filter((l) => str(l.item_no, 80)).map((l, i) => {
    const price = Number(String(l.price ?? '').replace(',', '.'))
    if (l.price === '' || !Number.isFinite(price) || price < 0 || price > 1e13) fail(400, `Harga baris ${i + 1} tidak valid.`)
    return { id: Number(l.id) || null, item_no: str(l.item_no, 80), unit: str(l.unit, 40) || null, price }
  })
  if (!lines.length) fail(400, 'Tambahkan minimal satu barang.')
  if (lines.length > 200) fail(400, 'Maksimal 200 barang per dokumen.')
  if (new Set(lines.map((l) => l.item_no)).size !== lines.length) fail(400, 'Barang yang sama tercantum lebih dari sekali.')
  return { vendor_no, tanggal, nomor: str(body.nomor, 50) || null, keterangan: str(body.keterangan, 1000) || null, lines }
}

// Simpan ke Accurate (save.do). Ubah: id + id baris lama; baris yang dibuang dikirim _status=delete.
export async function saveVendorPrice(v: VendorPriceInput, id?: number) {
  const form: Record<string, string | number | null> = {
    vendorNo: v.vendor_no, transDate: `${v.tanggal.slice(8, 10)}/${v.tanggal.slice(5, 7)}/${v.tanggal.slice(0, 4)}`, number: v.nomor, description: v.keterangan ?? (id ? '' : null),
  }
  let oldIds: number[] = []
  if (id) {
    form.id = id
    oldIds = (await vendorPriceDetail(id)).lines.map((l) => l.id).filter((x): x is number => !!x)
  }
  v.lines.forEach((l, i) => {
    const p = `detailItem[${i}].`
    if (id && l.id && oldIds.includes(l.id)) form[`${p}id`] = l.id
    form[`${p}itemNo`] = l.item_no
    form[`${p}price`] = l.price
    form[`${p}itemUnitName`] = l.unit
  })
  const kept = new Set(v.lines.map((l) => l.id))
  oldIds.filter((x) => !kept.has(x)).forEach((x, j) => {
    form[`detailItem[${v.lines.length + j}].id`] = x
    form[`detailItem[${v.lines.length + j}]._status`] = 'delete'
  })
  const res = await send<unknown>('/api/vendor-price/save.do', { form })
  const r = (res.r ?? {}) as { id?: number; number?: string }
  return { id: Number(r.id ?? id), number: String(r.number ?? '') }
}

export async function deleteVendorPrice(id: number) {
  const current = await vendorPriceDetail(id)
  await send('/api/vendor-price/delete.do', { method: 'DELETE', params: { id } })
  return { number: current.number }
}
