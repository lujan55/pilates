// ===========================================================
// =============== SERVIDOR PRINCIPAL (Pilates App) ===========
// ===========================================================
const express = require('express');
const path = require('path');
const bodyParser = require('body-parser');
const cors = require('cors');
const db = require('./db');
const PDFDocument = require('pdfkit');
const { promisify } = require('util');

const app = express();
const PORT = process.env.PORT || 3000;

// ===========================================================
// ===================== CONFIGURACIONES =====================
// ===========================================================
app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

const q = promisify(db.query).bind(db);
const DIAS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
const HORAS = ["08:00","09:00","10:00","11:00","15:00","16:00","17:00","18:00","19:00","20:00"];

// ===========================================================
// ======================== HELPERS ==========================
// ===========================================================
const norm = (s) =>
  (s ?? '').toString().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();

const normalizeHour = (h) => {
  if (!h) return null;
  let s = h.toString().trim().toLowerCase();
  s = s.replace(/\s*hs?$/i, '');
  s = s.replace(/\./g, ':');
  if (/^\d{1,2}:\d{2}:\d{2}$/.test(s)) s = s.slice(0, 5);
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

// ===========================================================
// ======================= FUNCIONES =========================
// ===========================================================
async function addClase({ alumna_id, dia, hora }) {
  const countRow = await q('SELECT COUNT(*) AS total FROM clases WHERE dia = ? AND hora = ?', [dia, hora]);
  if (countRow[0].total >= 5) {
    return { ok: false, reason: 'cupos' };
  }
  const dup = await q('SELECT id FROM clases WHERE dia = ? AND hora = ? AND alumna_id = ?', [dia, hora, alumna_id]);
  if (dup.length > 0) return { ok: true, reason: 'duplicado' };

  await q('INSERT INTO clases (dia, hora, alumna_id) VALUES (?, ?, ?)', [dia, hora, alumna_id]);
  return { ok: true };
}

// ===========================================================
// ======================== ALUMNAS ==========================
// ===========================================================
app.get('/api/alumnas', async (req, res) => {
  try {
    const rows = await q(`
      SELECT id, nombre, dni, telefono,
      DATE_FORMAT(fecha_nacimiento, '%Y-%m-%d') AS fecha_nacimiento,
      patologias, dias_horarios
      FROM alumnas
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err });
  }
});

app.post('/api/alumnas', async (req, res) => {
  try {
    const { nombre, dni, telefono, fecha_nacimiento, patologias, dias_horarios } = req.body;
    if (!nombre || !dni)
      return res.status(400).json({ ok: false, message: 'Nombre y DNI son obligatorios' });

    const fechaSQL = fecha_nacimiento && String(fecha_nacimiento).trim() !== ''
      ? new Date(fecha_nacimiento).toISOString().slice(0, 10)
      : null;

    const insert = await q(
      'INSERT INTO alumnas (nombre, dni, telefono, fecha_nacimiento, patologias, dias_horarios) VALUES (?, ?, ?, ?, ?, ?)',
      [nombre, dni, telefono || null, fechaSQL, patologias || null, dias_horarios || null]
    );

    const alumna_id = insert.insertId;

    // Cargar clases si vienen días/horarios
    if (dias_horarios) {
      const parsed = parseDiasHorarios(dias_horarios);
      for (const { dia, hora } of parsed) {
        await addClase({ alumna_id, dia, hora }).catch(() => {});
      }
    }

    res.json({ ok: true, message: 'Alumna registrada correctamente', id: alumna_id });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ ok: false, message: 'El DNI ya existe' });
    }
    res.status(500).json({ ok: false, error: err });
  }
});

app.put('/api/alumnas/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { dias_horarios } = req.body;
    await q('UPDATE alumnas SET dias_horarios = ? WHERE id = ?', [dias_horarios, id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err });
  }
});

// ===========================================================
// ========================== CLASES =========================
// ===========================================================
app.get('/api/clases', async (req, res) => {
  try {
    const rows = await q(`
      SELECT c.id, c.dia, c.hora, a.id AS alumna_id, a.nombre
      FROM clases c
      INNER JOIN alumnas a ON c.alumna_id = a.id
      ORDER BY FIELD(c.dia, 'Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'), c.hora, a.nombre
    `);
    const out = rows.map(r => ({ ...r, hora: r.hora.slice(0,5) }));
    res.json(out);
  } catch (err) {
    res.status(500).json({ error: err });
  }
});

app.post('/api/clases', async (req, res) => {
  try {
    let { dia, hora, alumna_id } = req.body;
    if (!dia || !hora || !alumna_id)
      return res.status(400).json({ error: 'Datos incompletos' });

    hora = normalizeHour(hora);
    if (!DIAS.includes(dia) || !HORAS.includes(hora))
      return res.status(400).json({ error: 'Día u hora inválidos' });

    const r = await addClase({ alumna_id, dia, hora });
    if (!r.ok && r.reason === 'cupos') {
      return res.status(400).json({ error: 'Máximo de 5 alumnas por horario' });
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err });
  }
});

app.delete('/api/clases', async (req, res) => {
  try {
    const { dia, hora, alumna_id } = req.body;
    const H = normalizeHour(hora);
    await q('DELETE FROM clases WHERE dia = ? AND hora = ? AND alumna_id = ? LIMIT 1', [dia, H, alumna_id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err });
  }
});

// ===========================================================
// =========================== PAGOS =========================
// ===========================================================
app.post('/api/pagos', async (req, res) => {
  try {
    const { alumna_id, metodo_pago, monto } = req.body;
    if (!alumna_id || !metodo_pago || !monto)
      return res.status(400).json({ error: 'Datos incompletos' });

    await q('INSERT INTO pagos (alumna_id, metodo_pago, monto) VALUES (?, ?, ?)', [alumna_id, metodo_pago, monto]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err });
  }
});

app.get('/api/pagos/listado', async (req, res) => {
  try {
    const hoy = new Date();
    const mes = hoy.getMonth() + 1;
    const anio = hoy.getFullYear();
    const rows = await q(`
      SELECT a.nombre, p.fecha, p.monto, p.metodo_pago
      FROM pagos p
      INNER JOIN alumnas a ON a.id = p.alumna_id
      WHERE MONTH(p.fecha) = ? AND YEAR(p.fecha) = ?
      ORDER BY a.nombre ASC
    `, [mes, anio]);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err });
  }
});

// ===========================================================
// =========================== EGRESOS =======================
// ===========================================================
app.post('/api/egresos', async (req, res) => {
  try {
    const { monto, detalle, fecha } = req.body;
    if (!monto || !detalle) return res.status(400).json({ error: 'Datos incompletos' });
    const f = fecha && fecha.trim() !== '' ? fecha : new Date().toISOString().slice(0, 10);
    const r = await q('INSERT INTO egresos (fecha, detalle, monto) VALUES (?,?,?)', [f, detalle, monto]);
    res.json({ ok: true, id: r.insertId });
  } catch (err) {
    res.status(500).json({ error: err });
  }
});

app.delete('/api/egresos/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await q('DELETE FROM egresos WHERE id = ?', [id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err });
  }
});

// ===========================================================
// ============================ CAJA =========================
// ===========================================================
app.get('/api/caja', async (req, res) => {
  try {
    const year = Number(req.query.year);
    const month = Number(req.query.month);
    if (!year || !month) return res.status(400).json({ error: 'Parámetros faltantes' });

    const ingresos = await q(`
      SELECT p.id, DATE_FORMAT(p.fecha, '%Y-%m-%d') AS fecha,
             CONCAT('Pago de ', a.nombre) AS detalle, p.metodo_pago, p.monto
      FROM pagos p
      INNER JOIN alumnas a ON a.id = p.alumna_id
      WHERE YEAR(p.fecha)=? AND MONTH(p.fecha)=?
    `, [year, month]);

    const egresos = await q(`
      SELECT id, DATE_FORMAT(fecha, '%Y-%m-%d') AS fecha, detalle, monto
      FROM egresos
      WHERE YEAR(fecha)=? AND MONTH(fecha)=?
    `, [year, month]);

    res.json({ ingresos, egresos });
  } catch (err) {
    res.status(500).json({ error: err });
  }
});

// ===========================================================
// ============================ PDF ==========================
// ===========================================================
app.get('/api/caja/pdf', async (req, res) => {
  try {
    const year = Number(req.query.year);
    const month = Number(req.query.month);
    if (!year || !month)
      return res.status(400).json({ error: 'Parámetros year y month requeridos' });

    const ingresos = await q(`
      SELECT DATE_FORMAT(p.fecha, '%d/%m/%Y') AS fecha, CONCAT('Pago de ', a.nombre) AS detalle, p.monto
      FROM pagos p
      INNER JOIN alumnas a ON a.id = p.alumna_id
      WHERE YEAR(p.fecha)=? AND MONTH(p.fecha)=?
      ORDER BY p.fecha ASC
    `, [year, month]);

    const egresos = await q(`
      SELECT DATE_FORMAT(fecha, '%d/%m/%Y') AS fecha, detalle, monto
      FROM egresos
      WHERE YEAR(fecha)=? AND MONTH(fecha)=?
      ORDER BY fecha ASC
    `, [year, month]);

    const doc = new PDFDocument();
    res.setHeader('Content-Type', 'application/pdf');
    doc.pipe(res);

    doc.fontSize(18).text('Cierre de Caja', { align: 'center' });
    doc.moveDown();

    doc.fontSize(14).text('Ingresos:', { underline: true });
    ingresos.forEach(i => doc.text(`${i.fecha} - ${i.detalle} - $${i.monto}`));

    doc.moveDown();
    doc.fontSize(14).text('Egresos:', { underline: true });
    egresos.forEach(e => doc.text(`${e.fecha} - ${e.detalle} - $${e.monto}`));

    const totalIng = ingresos.reduce((acc, i) => acc + Number(i.monto), 0);
    const totalEgr = egresos.reduce((acc, e) => acc + Number(e.monto), 0);
    const saldo = totalIng - totalEgr;

    doc.moveDown();
    doc.fontSize(14).text('Resumen:', { underline: true });
    doc.text(`Total Ingresos: $${totalIng}`);
    doc.text(`Total Egresos: $${totalEgr}`);
    doc.text(`Saldo Final: $${saldo}`);

    doc.end();
  } catch (err) {
    res.status(500).json({ error: err });
  }
});

// ===========================================================
// ===================== PWA MANIFEST ========================
// ===========================================================
app.get('/manifest.json', (req, res) => res.sendFile(path.join(__dirname, 'public', 'manifest.json')));
app.get('/service-worker.js', (req, res) => res.sendFile(path.join(__dirname, 'public', 'service-worker.js')));

// ===========================================================
// ======================= SERVIDOR ==========================
// ===========================================================
app.listen(PORT, () => console.log(`🚀 Servidor corriendo en puerto ${PORT}`));
