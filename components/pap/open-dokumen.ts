// Buka Surat Order / Proforma Invoice sebuah Quotation di menu Dokumen Order (diedit dulu, lalu dicetak dari sana).
// Halaman Quotation mengirim event; shell membuka menu Dokumen Order bila user punya aksesnya,
// bila tidak, dokumen langsung dicetak seperti dulu (fallback).
export type DokumenFromQuotation = { quotationId: number; jenis: 'order' | 'proforma'; fallbackUrl: string }
export const OPEN_DOKUMEN_EVENT = 'pap-open-dokumen'

export function openDokumenFromQuotation(detail: DokumenFromQuotation) {
  window.dispatchEvent(new CustomEvent<DokumenFromQuotation>(OPEN_DOKUMEN_EVENT, { detail }))
}
