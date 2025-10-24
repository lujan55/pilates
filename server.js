// server.js (completo y actualizado)
const express = require('express');
const path = require('path');
const bodyParser = require('body-parser');
const cors = require('cors');
const { promisify } = require('util');
const db = require('./db');

const app = express();
const PORT = 3000;

app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// ===== Helpers =====
const DIAS = ['Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];
const HORAS = ["08:00","09:00","10:00","11:00","15:00","16:00","17:00","18:00","19:00","20:00"];

const q = promisify(db.query).bind(db);

const norm = (s) =>
  (s ?? "").toString().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();

const normalizeHour = (h) => {
  if (!h) return null;
  let s = h.toString().trim().toLowerCase();
  s = s.replace(/\s*hs?$/i, '');   // quita "hs" / "h"
  s = s.replace(/\./g, ':');       // 8.00 -> 8:00
  if (/^\d{1,2}:\d{2}:\d{2}$/.test(s)) s = s.slice(0, 5); // 08:00:00 -> 08:00
  const m = s.match(/^(\d{1,2})(?::?(\d{2}))?$/);
  if (!m) return null;
  const hh = m[1].padStart(2, '0');
  const mm = m[2] ? m[2] : '00';
  return `${hh}:${mm}`;
};

const parseDiasHorarios = (texto) => {
  if (!texto) return [];
  return texto
    .split(',')
    .map(c => c.trim())
    .map(c => {
      const partes = c.split(' ');
      const dia = partes[0];
      const hora = normalizeHour(partes.slice(1).join(' '));
      return { dia, hora };
    })
    .filter(({ dia, hora }) => DIAS.includes(dia) && HORAS.includes(hora));
};

// Inserta una clase respetando máximo 5 alumnas por casilla y evitando duplicados
async function addClase({ alumna_id, dia, hora }) {
  const countRow = await q('SELECT COUNT(*) AS total FROM clases WHERE dia = ? AND hora = ?', [dia, hora]);
  if (countRow[0].total >= 5) {
    return { ok: false, reason: 'cupos', message: 'Máximo de 5 alumnas por horario alcanzado' };
  }
  const dup = await q('SELECT id FROM clases WHERE dia = ? AND hora = ? AND alumna_id = ?', [dia, hora, alumna_id]);
  if (dup.length > 0) {
    return { ok: true, reason: 'duplicado' }; // ya estaba asignada; no es error fatal
  }
  await q('INSERT INTO clases (dia, hora, alumna_id) VALUES (?, ?, ?)', [dia, hora, alumna_id]);
  return { ok: true };
}

// ===== Alumnas =====
app.get('/api/alumnas', async (req, res) => {
  try {
    // ✅ Fecha formateada a YYYY-MM-DD para evitar problemas de timezone en el front
    const results = await q(`
      SELECT 
        id,
        nombre,
        dni,
        telefono,
        DATE_FORMAT(fecha_nacimiento, '%Y-%m-%d') AS fecha_nacimiento,
        patologias,
        dias_horarios
      FROM alumnas
    `);
    res.json(results);
  } catch (err) {
    console.error('GET /api/alumnas', err);
    res.status(500).json({ error: err });
  }
});

app.post('/api/alumnas', async (req, res) => {
  try {
    const { nombre, dni, telefono, fecha_nacimiento, patologias, dias_horarios } = req.body;

    if (!nombre || !dni) {
      return res.status(400).json({ ok: false, message: 'Nombre y DNI son obligatorios' });
    }

    // Normalizar fecha a YYYY-MM-DD o null
    const fechaSQL = fecha_nacimiento && String(fecha_nacimiento).trim() !== ''
      ? new Date(fecha_nacimiento).toISOString().slice(0, 10)
      : null;

    const insert = await q(
      'INSERT INTO alumnas (nombre, dni, telefono, fecha_nacimiento, patologias, dias_horarios) VALUES (?, ?, ?, ?, ?, ?)',
      [nombre, dni, telefono || null, fechaSQL, patologias || null, dias_horarios || null]
    );

    const alumna_id = insert.insertId;

    // Poblar tabla clases a partir de dias_horarios (si viene)
    if (dias_horarios) {
      const parsed = parseDiasHorarios(dias_horarios);
      for (const { dia, hora } of parsed) {
        try {
          await addClase({ alumna_id, dia, hora });
        } catch (e) {
          console.error('addClase on /api/alumnas', e);
        }
      }
    }

    res.json({ ok: true, message: 'Alumna registrada correctamente', id: alumna_id });
  } catch (err) {
    console.error('POST /api/alumnas', err);
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ ok: false, message: 'El DNI ya existe', error: err });
    }
    res.status(500).json({ ok: false, message: 'No se pudo registrar la alumna', error: err });
  }
});

// 🔹 NUEVO ENDPOINT: actualizar horarios de una alumna
app.put('/api/alumnas/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { dias_horarios } = req.body;
    await q('UPDATE alumnas SET dias_horarios = ? WHERE id = ?', [dias_horarios, id]);
    res.json({ message: 'Horarios actualizados correctamente' });
  } catch (err) {
    console.error('PUT /api/alumnas/:id', err);
    res.status(500).json({ error: err });
  }
});

// 🔹 NUEVO ENDPOINT: cumpleañeras de HOY (opcional para el front)
app.get('/api/cumples/hoy', async (req, res) => {
  try {
    const rows = await q(`
      SELECT 
        id,
        nombre,
        DATE_FORMAT(fecha_nacimiento, '%Y-%m-%d') AS fecha_nacimiento
      FROM alumnas
      WHERE fecha_nacimiento IS NOT NULL
        AND DATE_FORMAT(fecha_nacimiento, '%m-%d') = DATE_FORMAT(CURDATE(), '%m-%d')
    `);
    res.json(rows);
  } catch (err) {
    console.error('GET /api/cumples/hoy', err);
    res.status(500).json({ error: 'No se pudo obtener cumpleañeras de hoy' });
  }
});

// ===== Pagos =====
app.post('/api/pagos', async (req, res) => {
  try {
    const { alumna_id, metodo_pago, monto } = req.body;

    if (!alumna_id || !metodo_pago || !monto) {
      return res.status(400).json({ error: 'alumna_id, metodo_pago y monto son obligatorios' });
    }

    // Guardar el pago
    const pagoInsert = await q(
      'INSERT INTO pagos (alumna_id, metodo_pago, monto) VALUES (?, ?, ?)',
      [alumna_id, metodo_pago, monto]
    );

    // Obtener nombre de la alumna
    const alumna = await q('SELECT nombre FROM alumnas WHERE id = ?', [alumna_id]);
    const nombre = alumna.length > 0 ? alumna[0].nombre : 'Desconocida';

    // Crear el registro de ingreso en caja
    const hoy = new Date();
    const yyyy = hoy.getFullYear();
    const mm = String(hoy.getMonth() + 1).padStart(2, '0');
    const dd = String(hoy.getDate()).padStart(2, '0');
    const fecha = `${yyyy}-${mm}-${dd}`;
    const detalle = `Pago de ${nombre} (${metodo_pago})`;

    await q('INSERT INTO caja (fecha, tipo, detalle, monto) VALUES (?, ?, ?, ?)', [
      fecha,
      'Ingreso',
      detalle,
      monto
    ]);

    // Respuesta al frontend
    res.json({
      ok: true,
      message: 'Pago registrado correctamente y reflejado en caja mensual',
      pago_id: pagoInsert.insertId
    });
  } catch (err) {
    console.error('POST /api/pagos', err);
    res.status(500).json({ error: err.message || err });
  }
});

// ===== Clases =====
app.get('/api/clases', async (req, res) => {
  try {
    const rows = await q(`
      SELECT c.id, c.dia, c.hora, a.id AS alumna_id, a.nombre
      FROM clases c
      INNER JOIN alumnas a ON c.alumna_id = a.id
      ORDER BY FIELD(c.dia, 'Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'), c.hora, a.nombre
    `);
    const out = rows.map(r => ({ ...r, hora: r.hora.length === 8 ? r.hora.slice(0,5) : r.hora }));
    res.json(out);
  } catch (err) {
    console.error('GET /api/clases', err);
    res.status(500).json({ error: err });
  }
});

app.post('/api/clases', async (req, res) => {
  try {
    let { dia, hora, alumna_id } = req.body;
    if (!dia || !hora || !alumna_id) {
      return res.status(400).json({ error: 'dia, hora y alumna_id son obligatorios' });
    }
    if (!DIAS.includes(dia)) return res.status(400).json({ error: 'Día inválido' });
    hora = normalizeHour(hora);
    if (!HORAS.includes(hora)) return res.status(400).json({ error: 'Hora inválida' });

    const r = await addClase({ alumna_id, dia, hora });
    if (!r.ok && r.reason === 'cupos') {
      return res.status(400).json({ error: 'Máximo de 5 alumnas por horario alcanzado' });
    }
    res.json({ ok: true, message: 'Clase agregada', duplicado: r.reason === 'duplicado' });
  } catch (err) {
    console.error('POST /api/clases', err);
    res.status(500).json({ error: err });
  }
});

app.delete('/api/clases', async (req, res) => {
  try {
    const { dia, hora, alumna_id } = req.body;
    if (!dia || !hora || !alumna_id) {
      return res.status(400).json({ error: 'dia, hora y alumna_id son obligatorios' });
    }
    const H = normalizeHour(hora);
    await q('DELETE FROM clases WHERE dia = ? AND hora = ? AND alumna_id = ? LIMIT 1', [dia, H, alumna_id]);
    res.json({ ok: true, message: 'Clase eliminada correctamente' });
  } catch (err) {
    console.error('DELETE /api/clases', err);
    res.status(500).json({ error: err });
  }
});

// ===== EGRESOS =====
// Crear egreso (usa CURDATE() si no se envía fecha)
app.post('/api/egresos', async (req, res) => {
  try {
    const { monto, detalle, fecha } = req.body;
    if (!monto || !detalle) return res.status(400).json({ error: 'monto y detalle son obligatorios' });

    let r;
    if (fecha && String(fecha).trim() !== '') {
      r = await q('INSERT INTO egresos (fecha, detalle, monto) VALUES (?,?,?)', [fecha, detalle, monto]);
    } else {
      r = await q('INSERT INTO egresos (fecha, detalle, monto) VALUES (CURDATE(), ?, ?)', [detalle, monto]);
    }

    const row = await q(`
      SELECT id,
             DATE_FORMAT(fecha, "%Y-%m-%d") AS fecha,
             detalle, monto
      FROM egresos WHERE id = ?`, [r.insertId]);
    res.json(row[0]);
  } catch (err) {
    console.error('POST /api/egresos', err);
    res.status(500).json({ error: 'No se pudo registrar el egreso' });
  }
});

// Eliminar egreso
app.delete('/api/egresos/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await q('DELETE FROM egresos WHERE id = ?', [id]);
    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE /api/egresos/:id', err);
    res.status(500).json({ error: 'No se pudo eliminar el egreso' });
  }
});

// ===== CAJA MENSUAL =====
app.get('/api/caja', async (req, res) => {
  try {
    const year = Number(req.query.year);
    const month = Number(req.query.month);
    if (!year || !month) {
      return res.status(400).json({ error: 'Parámetros year y month requeridos' });
    }

    // 🔹 INGRESOS: ahora incluye método de pago
    const ingresos = await q(
      `SELECT 
         p.id,
         DATE_FORMAT(p.fecha, '%Y-%m-%d') AS fecha,
         CONCAT('Pago de ', a.nombre) AS detalle,
         p.metodo_pago,
         p.monto
       FROM pagos p
       INNER JOIN alumnas a ON a.id = p.alumna_id
       WHERE YEAR(p.fecha) = ? AND MONTH(p.fecha) = ?
       ORDER BY p.fecha DESC`,
      [year, month]
    );

    // 🔹 EGRESOS
    const egresos = await q(
      `SELECT id,
              DATE_FORMAT(COALESCE(fecha, DATE(creado_en)), '%Y-%m-%d') AS fecha,
              detalle,
              monto
       FROM egresos
       WHERE YEAR(COALESCE(fecha, DATE(creado_en))) = ?
         AND MONTH(COALESCE(fecha, DATE(creado_en))) = ?
       ORDER BY COALESCE(fecha, DATE(creado_en)) DESC, id DESC`,
      [year, month]
    );

    res.json({ ingresos, egresos });
  } catch (err) {
    console.error('GET /api/caja', err);
    res.status(500).json({ error: 'No se pudo obtener la caja mensual' });
  }
});

// ===== Pagos realizados del mes actual =====
app.get('/api/pagos/listado', async (req, res) => {
  try {
    const hoy = new Date();
    const mes = hoy.getMonth() + 1;
    const anio = hoy.getFullYear();

    const rows = await q(`
      SELECT 
        a.nombre, 
        p.fecha, 
        p.monto,
        p.metodo_pago
      FROM pagos p
      INNER JOIN alumnas a ON a.id = p.alumna_id
      WHERE MONTH(p.fecha) = ? AND YEAR(p.fecha) = ?
      ORDER BY a.nombre ASC
    `, [mes, anio]);

    res.json(rows);
  } catch (err) {
    console.error('GET /api/pagos/listado', err);
    res.status(500).json({ error: 'No se pudieron obtener los pagos del mes actual' });
  }
});

// ===== GENERAR PDF DE CIERRE DE CAJA =====
const PDFDocument = require('pdfkit');
const fs = require('fs');

app.get('/api/caja/pdf', async (req, res) => {
  try {
    const year = Number(req.query.year);
    const month = Number(req.query.month);
    if (!year || !month) {
      return res.status(400).json({ error: 'Parámetros year y month requeridos' });
    }

    // Obtener datos de caja
    const ingresos = await q(
      `SELECT 
         p.id,
         DATE_FORMAT(p.fecha, '%d/%m/%Y') AS fecha,
         CONCAT('Pago de ', a.nombre) AS detalle,
         p.monto
       FROM pagos p
       INNER JOIN alumnas a ON a.id = p.alumna_id
       WHERE YEAR(p.fecha) = ? AND MONTH(p.fecha) = ?
       ORDER BY p.fecha ASC`,
      [year, month]
    );

    const egresos = await q(
      `SELECT 
         e.id,
         DATE_FORMAT(COALESCE(e.fecha, NOW()), '%d/%m/%Y') AS fecha,
         e.detalle,
         e.monto
       FROM egresos e
       WHERE YEAR(COALESCE(e.fecha, NOW())) = ? 
         AND MONTH(COALESCE(e.fecha, NOW())) = ?
       ORDER BY e.fecha ASC`,
      [year, month]
    );

    // Calcular totales
    const totalIngresos = ingresos.reduce((acc, i) => acc + Number(i.monto), 0);
    const totalEgresos = egresos.reduce((acc, e) => acc + Number(e.monto), 0);
    const totalNeto = totalIngresos - totalEgresos;


    // === INGRESOS ===
    doc.fontSize(14).fillColor('#006400').text('Ingresos:', { underline: true });
    doc.moveDown(0.5);
    if (ingresos.length === 0) {
      doc.text('No se registraron ingresos este mes.');
    } else {
      ingresos.forEach(i => {
        doc.fontSize(11).fillColor('black').text(`${i.fecha} - ${i.detalle} - $${Number(i.monto).toFixed(2)}`);
      });
    }

    doc.moveDown(1.5);

// ===== EGRESOS =====
// Crear egreso (usa CURDATE() si no se envía fecha)
app.post('/api/egresos', async (req, res) => {
  try {
    const { monto, detalle, fecha } = req.body;
    if (!monto || !detalle) return res.status(400).json({ error: 'monto y detalle son obligatorios' });

    // Registrar el egreso en la tabla egresos
    let r;
    if (fecha && String(fecha).trim() !== '') {
      r = await q('INSERT INTO egresos (fecha, detalle, monto) VALUES (?,?,?)', [fecha, detalle, monto]);
    } else {
      r = await q('INSERT INTO egresos (fecha, detalle, monto) VALUES (CURDATE(), ?, ?)', [detalle, monto]);
    }

    // Obtener fecha formateada
    const row = await q(
      `SELECT id, DATE_FORMAT(fecha, "%Y-%m-%d") AS fecha, detalle, monto FROM egresos WHERE id = ?`,
      [r.insertId]
    );

    const egreso = row[0];

    // Registrar también en la tabla caja (para reflejarlo en el cierre mensual)
    await q(
      'INSERT INTO caja (fecha, tipo, detalle, monto) VALUES (?, ?, ?, ?)',
      [egreso.fecha, 'Egreso', egreso.detalle, egreso.monto]
    );

    // Enviar respuesta correcta al frontend
    res.status(200).json({ ok: true, message: 'Egreso registrado correctamente', egreso });
  } catch (err) {
    console.error('POST /api/egresos', err);
    res.status(500).json({ error: 'No se pudo registrar el egreso' });
  }
});


    // === TOTALES ===
    doc.fontSize(13).fillColor('#000080').text('Resumen del Mes:', { underline: true });
    doc.moveDown(0.5);
    doc.text(`Total Ingresos: $${totalIngresos.toFixed(2)}`);
    doc.text(`Total Egresos: $${totalEgresos.toFixed(2)}`);
    doc.text(`Saldo Final: $${totalNeto.toFixed(2)}`);

    doc.end();
    doc.pipe(res);
  } catch (err) {
    console.error('GET /api/caja/pdf', err);
    res.status(500).json({ error: 'No se pudo generar el PDF' });
  }
});
// === EDITAR / ELIMINAR PAGOS (INGRESOS) ===
app.put('/api/pagos/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { detalle, monto } = req.body;
    const pago = await q('SELECT * FROM pagos WHERE id = ?', [id]);
    if (!pago.length) return res.status(404).json({ error: 'Pago no encontrado' });

    await q('UPDATE pagos SET monto = ? WHERE id = ?', [monto, id]);
    await q('UPDATE caja SET detalle = ?, monto = ? WHERE tipo = "Ingreso" AND detalle LIKE ?', [
      detalle,
      monto,
      `%${pago[0].alumna_id || ''}%`
    ]);

    res.json({ ok: true });
  } catch (err) {
    console.error('PUT /api/pagos/:id', err);
    res.status(500).json({ error: 'Error al actualizar el pago' });
  }
});

app.delete('/api/pagos/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await q('DELETE FROM pagos WHERE id = ?', [id]);
    await q('DELETE FROM caja WHERE tipo = "Ingreso" AND detalle LIKE ?', [`%${id}%`]);
    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE /api/pagos/:id', err);
    res.status(500).json({ error: 'Error al eliminar el pago' });
  }
});

// === EDITAR / ELIMINAR EGRESOS ===
app.put('/api/egresos/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { detalle, monto } = req.body;
    await q('UPDATE egresos SET detalle = ?, monto = ? WHERE id = ?', [detalle, monto, id]);
    res.json({ ok: true });
  } catch (err) {
    console.error('PUT /api/egresos/:id', err);
    res.status(500).json({ error: 'Error al actualizar el egreso' });
  }
});

app.delete('/api/egresos/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await q('DELETE FROM egresos WHERE id = ?', [id]);
    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE /api/egresos/:id', err);
    res.status(500).json({ error: 'Error al eliminar el egreso' });
  }
});

// ===== Start =====
app.listen(PORT, () => {
  console.log(`Servidor corriendo en http://localhost:${PORT}`);
});
