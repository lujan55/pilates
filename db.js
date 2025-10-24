const mysql = require('mysql2');

// Pool de conexiones con reconexión automática
const pool = mysql.createPool({
  host: process.env.MYSQLHOST || 'tramway.proxy.rlwy.net',
  user: process.env.MYSQLUSER || 'root',
  password: process.env.MYSQLPASSWORD || 'KAAVtnBsHkOCvoDfIAMVzRHDqEqrrbhV',
  database: process.env.MYSQLDATABASE || 'railway',
  port: process.env.MYSQLPORT || 48958,
  waitForConnections: true,   // espera si todas las conexiones están ocupadas
  connectionLimit: 10,        // máximo de conexiones simultáneas
  queueLimit: 0               // sin límite de cola
});

// Verifica la conexión inicial (solo para logs)
pool.getConnection((err, connection) => {
  if (err) {
    console.error('❌ Error al conectar con MySQL en Railway:', err);
  } else {
    console.log('✅ Conectado correctamente a MySQL en Railway');
    connection.release();
  }
});

// Exporta versión con promesas para usar async/await
module.exports = pool.promise();
