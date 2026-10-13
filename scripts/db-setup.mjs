// Menjalankan migrasi db/*.sql yang belum pernah dijalankan, berurutan sesuai nama file.
// Pakai: pnpm db:setup
import { readdirSync, readFileSync } from 'node:fs'
import mysql from 'mysql2/promise'

process.loadEnvFile?.('.env.local')

const dir = new URL('../db/', import.meta.url)
const conn = await mysql.createConnection({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  multipleStatements: true,
})

try {
  await conn.query('CREATE TABLE IF NOT EXISTS schema_migrations (name VARCHAR(255) NOT NULL PRIMARY KEY, applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)')
  const [done] = await conn.query('SELECT name FROM schema_migrations')
  const applied = new Set(done.map((row) => row.name))
  const files = readdirSync(dir).filter((file) => file.endsWith('.sql')).sort()
  for (const file of files) {
    if (applied.has(file)) continue
    console.log('Menjalankan', file)
    await conn.query(readFileSync(new URL(file, dir), 'utf8'))
    await conn.query('INSERT INTO schema_migrations (name) VALUES (?)', [file])
  }
  const [users] = await conn.query('SELECT u.email, r.name AS role FROM users u JOIN roles r ON r.id = u.role_id ORDER BY u.id')
  console.table(users)
} finally {
  await conn.end()
}
