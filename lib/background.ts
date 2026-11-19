// Tugas latar belakang (mis. sinkron Google Drive / Accurate saat data sudah lama): halaman langsung menampilkan data
// tersimpan, sinkron berjalan di belakang dan hasilnya tampil saat halaman dibuka berikutnya.
// Satu tugas per kunci: bila sinkron yang sama masih berjalan, permintaan berikutnya tidak memulai sinkron baru.
const running = globalThis as unknown as { papBackground?: Set<string> }

export function runInBackground(key: string, job: () => Promise<unknown>) {
  const set = (running.papBackground ??= new Set())
  if (set.has(key)) return false
  set.add(key)
  job()
    .catch((error) => console.error(`[latar] ${key}:`, (error as Error).message))
    .finally(() => set.delete(key))
  return true
}
