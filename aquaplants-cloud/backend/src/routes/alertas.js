const express = require('express');
const { consulta } = require('../db');
const { requiereLogin, requiereRol, instalacionPermitida } = require('../middleware/auth');

const router = express.Router();

// GET /api/alertas?estado=pendiente|revisada&id_instalacion=1
router.get('/', requiereLogin, async (req, res, next) => {
  try {
    const estado = req.query.estado || null;
    if (estado && !['pendiente', 'revisada'].includes(estado)) return res.status(400).json({ error: 'estado inválido' });
    const idInst = req.usuario.rol === 'encargado' ? req.usuario.id_instalacion : req.query.id_instalacion;
    const { rows } = await consulta(
      `SELECT a.id_alerta, a.nivel_criticidad, a.fecha_generada, a.estado_revision,
              r.variable, m.valor, m.unidad, c.nombre AS cultivo, c.id_instalacion
         FROM alerta a
         JOIN regla_umbral r ON r.id_regla = a.id_regla
         JOIN medicion m ON m.id_medicion = a.id_medicion
         JOIN cultivo c ON c.id_cultivo = r.id_cultivo
        WHERE ($1::int IS NULL OR c.id_instalacion = $1)
          AND ($2::text IS NULL OR a.estado_revision = $2)
        ORDER BY a.fecha_generada DESC LIMIT 200`, [idInst || null, estado]);
    res.json(rows);
  } catch (e) { next(e); }
});

// PATCH /api/alertas/:id/revisar  -> el encargado (de su instalación) o el administrador marcan la alerta como revisada
router.patch('/:id/revisar', requiereLogin, requiereRol('encargado', 'administrador'), async (req, res, next) => {
  try {
    const { rows } = await consulta(
      `SELECT a.id_alerta, c.id_instalacion FROM alerta a
         JOIN regla_umbral r ON r.id_regla = a.id_regla JOIN cultivo c ON c.id_cultivo = r.id_cultivo
        WHERE a.id_alerta = $1`, [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Alerta no encontrada' });
    if (!instalacionPermitida(req.usuario, rows[0].id_instalacion)) return res.status(403).json({ error: 'No tienes acceso a esa instalación' });
    await consulta(`UPDATE alerta SET estado_revision = 'revisada' WHERE id_alerta = $1`, [req.params.id]);
    res.json({ id_alerta: Number(req.params.id), estado_revision: 'revisada' });
  } catch (e) { next(e); }
});

module.exports = router;
