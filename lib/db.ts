import mysql from 'mysql2/promise'

const globalForDb = globalThis as unknown as { papPool?: mysql.Pool }

// Satu pool dipakai ulang agar hot reload di dev tidak membuka koneksi baru terus
export const db =
  globalForDb.papPool ??
  mysql.createPool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 5,
    connectTimeout: 8000,
  })

if (process.env.NODE_ENV !== 'production') globalForDb.papPool = db
