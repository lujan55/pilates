const mysql = require('mysql2');

const db = mysql.createConnection({
  host: 'tramway.proxy.rlwy.net',
  user: 'root',
  password: 'KAAVtnBsHkOCvoDfIAMVzRHDqEqrrbhV',
  database: 'railway',
  port: 48958
});

db.connect((err) => {
  if (err) {
    console.error('Error al conectar con MySQL Railway:', err);
    return;
  }
  console.log('Conectado correctamente a MySQL en Railway');
});

module.exports = db;
