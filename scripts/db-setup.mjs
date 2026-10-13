// Menjalankan db/schema.sql ke database MySQL dari .env.local
// Pakai: pnpm db:setup
import { readFileSync } from 'node:fs'
import mysql from 'mysql2/promise'

process.loadEnvFile?.('.env.local')

const conn = await mysql.createConnection({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  multipleStatements: true,
})

try {
  await conn.query(readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8'))
  const [rows] = await conn.query('SELECT id, name, email, role FROM users')
  console.log('Skema siap. Users:', rows)
} finally {
  await conn.end()
}
