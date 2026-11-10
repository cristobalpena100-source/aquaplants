const express = require('express');
const rateLimit = require('express-rate-limit');
const { pool, consulta } = require('../db');
const { requiereLogin, requiereRol, requiereDispositivo, instalacionPermitida } = require('../middleware/auth');
const { validarMedicion } = require('../lib/validacion');
const { evaluarMedicion } = require('../servicios/alertas');

const router = express.Router();

// Límite de solicitudes por dispositivo (mitigación de saturación del endpoint, 7.2).
const limiteIngesta = rateLimit({
  windowMs: 60 * 1000, limit: 300, standardHeaders: true, legacyHeaders: false,
  keyGenerator: (req) => String(req.headers['x-dispositivo-id'] || req.ip),
  message: { error: 'Demasiadas solicitudes del dispositivo' }
});

// POST /api/mediciones  (dispositivo o simulador)
// Cuerpo: una medición {tipo_variable, valor, timestamp?, sincronizada?} o un lote {mediciones:[...]}
// (el lote sirve para enviar de una vez lo medido sin conexión).
router.post('/', limiteIngesta, requiereDispositivo, async (req, res, next) => {
  const lote = Array.isArray(req.body.mediciones) ? req.body.mediciones : [req.body];
  if (lote.length === 0 || lote.length > 500) {
    return res.status(400).json({ error: 'Envía entre 1 y 500 mediciones por solicitud' });
  }
  const d = req.dispositivo;

  const validas = [];
  for (const [i, m] of lote.entries()) {
    const r = validarMedicion(m);
    if (r.error) return res.status(400).json({ error: `Medición ${i + 1}: ${r.error}` });
    if (!d.variables_habilitadas.includes(r.medicion.tipo_variable)) {
      return res.status(400).json({ error: `Medición ${i + 1}: el dispositivo no tiene habilitada la variable ${r.medicion.tipo_variable}` });
    }
    validas.push(r.medicion);
  }

  const cliente = await pool.connect();
  try {
    await cliente.query('BEGIN');
    const ids = [];
    const alertas = [];
    for (const m of validas) {
      const { rows } = await cliente.query(
        `INSERT INTO medicion (id_dispositivo, tipo_variable, valor, unidad, "timestamp", sincronizada)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING id_medicion`,
        [d.id_dispositivo, m.tipo_variable, m.valor, m.unidad, m.timestamp, m.sincronizada]);
      ids.push(rows[0].id_medicion);
      // Las mediciones sincronizadas tarde son datos históricos: se guardan, pero no disparan alertas.
      if (!m.sincronizada) {
        alertas.push(...await evaluarMedicion(cliente, {
          id_medicion: rows[0].id_medicion, id_instalacion: d.id_instalacion,
          tipo_variable: m.tipo_variable, valor: m.valor }));
      }
    }
    await cliente.query('UPDATE dispositivo SET ultima_comunicacion = now() WHERE id_dispositivo = $1', [d.id_dispositivo]);
    await cliente.query('COMMIT');
    // ACK al dispositivo con lo registrado.
    res.status(201).json({ recibidas: ids.length, ids, alertas_generadas: alertas });
  } catch (e) {
    await cliente.query('ROLLBACK').catch(() => {});
    next(e);
  } finally {
    cliente.release();
  }
});

// GET /api/mediciones/ultimas?id_instalacion=1  -> estado actual (última medición por dispositivo y variable)
router.get('/ultimas', requiereLogin, async (req, res, next) => {
  try {
    const idInst = req.usuario.rol === 'encargado' ? req.usuario.id_instalacion : req.query.id_instalacion;
    if (req.usuario.rol === 'encargado' && !idInst) return res.json([]);
    const { rows } = await consulta(
      `SELECT DISTINCT ON (m.id_dispositivo, m.tipo_variable)
              d.id_instalacion, d.identificador_hw, m.tipo_variable, m.valor, m.unidad,
              m."timestamp", m.sincronizada
         FROM medicion m JOIN dispositivo d ON d.id_dispositivo = m.id_dispositivo
        WHERE ($1::int IS NULL OR d.id_instalacion = $1)
        ORDER BY m.id_dispositivo, m.tipo_variable, m."timestamp" DESC`, [idInst || null]);
    res.json(rows);
  } catch (e) { next(e); }
});

// GET /api/mediciones?id_instalacion&variable&desde&hasta&limite  -> histórico
router.get('/', requiereLogin, async (req, res, next) => {
  try {
    const { id_instalacion, variable, desde, hasta } = req.query;
    const limite = Math.min(Number(req.query.limite) || 500, 5000);
    const idInst = req.usuario.rol === 'encargado' ? req.usuario.id_instalacion : id_instalacion;
    if (id_instalacion && !instalacionPermitida(req.usuario, id_instalacion)) {
      return res.status(403).json({ error: 'No tienes acceso a esa instalación' });
    }
    for (const f of [desde, hasta]) if (f && Number.isNaN(new Date(f).getTime())) return res.status(400).json({ error: 'Fecha inválida (usa ISO 8601)' });
    const { rows } = await consulta(
      `SELECT m.id_medicion, d.id_instalacion, d.identificador_hw, m.tipo_variable, m.valor, m.unidad,
              m."timestamp", m.sincronizada
         FROM medicion m JOIN dispositivo d ON d.id_dispositivo = m.id_dispositivo
        WHERE ($1::int IS NULL OR d.id_instalacion = $1)
          AND ($2::text IS NULL OR m.tipo_variable = $2)
          AND ($3::timestamptz IS NULL OR m."timestamp" >= $3)
          AND ($4::timestamptz IS NULL OR m."timestamp" <= $4)
        ORDER BY m."timestamp" DESC LIMIT $5`,
      [idInst || null, variable || null, desde || null, hasta || null, limite]);
    res.json(rows);
  } catch (e) { next(e); }
});

// GET /api/mediciones/exportar.csv  -> reporte para supervisor y administrador
router.get('/exportar.csv', requiereLogin, requiereRol('supervisor', 'administrador'), async (req, res, next) => {
  try {
    const { id_instalacion, variable, desde, hasta } = req.query;
    const { rows } = await consulta(
      `SELECT d.id_instalacion, d.identificador_hw, m.tipo_variable, m.valor, m.unidad, m."timestamp", m.sincronizada
         FROM medicion m JOIN dispositivo d ON d.id_dispositivo = m.id_dispositivo
        WHERE ($1::int IS NULL OR d.id_instalacion = $1)
          AND ($2::text IS NULL OR m.tipo_variable = $2)
          AND ($3::timestamptz IS NULL OR m."timestamp" >= $3)
          AND ($4::timestamptz IS NULL OR m."timestamp" <= $4)
        ORDER BY m."timestamp" DESC LIMIT 50000`,
      [id_instalacion || null, variable || null, desde || null, hasta || null]);
    const lineas = ['id_instalacion,dispositivo,variable,valor,unidad,timestamp,sincronizada'];
    for (const r of rows) {
      lineas.push([r.id_instalacion, r.identificador_hw, r.tipo_variable, r.valor, r.unidad,
        new Date(r.timestamp).toISOString(), r.sincronizada].join(','));
    }
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="mediciones.csv"');
    res.send(lineas.join('\n'));
  } catch (e) { next(e); }
});

module.exports = router;
