// db.js — conexión estable y con reconexión automática para Railway
const mysql = require('mysql2');

const pool = mysql.createPool({
  host: process.env.MYSQLHOST || 'tramway.proxy.rlwy.net',
  user: process.env.MYSQLUSER || 'root',
  password: process.env.MYSQLPASSWORD || 'KAAVtnBsHkOCvoDfIAMVzRHDqEqrrbhV',
  database: process.env.MYSQLDATABASE || 'railway',
  port: process.env.MYSQLPORT || 48958,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

// 🔹 Log inicial
pool.getConnection((err, conn) => {
  if (err) console.error('❌ Error MySQL:', err.message);
  else {
    console.log('✅ Conectado a MySQL en Railway');
    conn.release();
  }
});

// 🔹 Keep-alive cada 60s
setInterval(() => {
  pool.query('SELECT 1').catch(() => {});
}, 60000);

// 🔹 Exporta versión con promesas
module.exports = pool.promise();
