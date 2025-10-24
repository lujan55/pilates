const mysql = require('mysql2');

// === Pool de conexiones con reconexión automática ===
const pool = mysql.createPool({
  host: process.env.MYSQLHOST || 'tramway.proxy.rlwy.net',
  user: process.env.MYSQLUSER || 'root',
  password: process.env.MYSQLPASSWORD || 'KAAVtnBsHkOCvoDfIAMVzRHDqEqrrbhV',
  database: process.env.MYSQLDATABASE || 'railway',
  port: process.env.MYSQLPORT || 48958,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

// Verifica conexión inicial
pool.getConnection((err, connection) => {
  if (err) {
    console.error('❌ Error al conectar con MySQL en Railway:', err);
  } else {
    console.log('✅ Conectado correctamente a MySQL en Railway');
    connection.release();
  }
});

// === Keep Alive para evitar timeout de Railway ===
setInterval(() => {
  pool.query('SELECT 1').catch(() => {});
}, 60000); // cada 1 minuto

module.exports = pool.promise();
