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
    // DATE/DATETIME dikembalikan sebagai string agar tidak bergeser zona waktu
    dateStrings: true,
  })

if (!globalForDb.papPool) {
  // Server MySQL Hostinger memakai UTC; NOW()/CURRENT_TIMESTAMP disamakan ke WIB
  db.pool.on('connection', (connection) => {
    connection.query(`SET time_zone = '${process.env.DB_TIMEZONE || '+07:00'}'`)
  })
}

if (process.env.NODE_ENV !== 'production') globalForDb.papPool = db
