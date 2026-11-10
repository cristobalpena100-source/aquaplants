const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { consulta } = require('../db');
const config = require('../config');
const { requiereLogin, requiereRol, instalacionPermitida } = require('../middleware/auth');
const { tiemposDePreset } = require('../lib/presets');
const { validarRegla, VARIABLES } = require('../lib/validacion');

const router = express.Router();
router.use(requiereLogin);

const texto = (v) => (typeof v === 'string' ? v.trim() : '');
const auditar = (idUsuario, accion, detalle) =>
  consulta('INSERT INTO auditoria (id_usuario, accion, detalle) VALUES ($1,$2,$3)', [idUsuario, accion, detalle]);

/* ---------- Instalaciones ---------- */
router.get('/instalaciones', async (req, res, next) => {
  try {
    const idInst = req.usuario.rol === 'encargado' ? req.usuario.id_instalacion : null;
    const { rows } = await consulta(
      'SELECT * FROM instalacion WHERE ($1::int IS NULL OR id_instalacion = $1) ORDER BY id_instalacion', [idInst]);
    res.json(rows);
  } catch (e) { next(e); }
});

router.post('/instalaciones', requiereRol('administrador'), async (req, res, next) => {
  try {
    const nombre = texto(req.body.nombre);
    if (!nombre) return res.status(400).json({ error: 'El nombre es obligatorio' });
    const { rows } = await consulta(
      'INSERT INTO instalacion (nombre, ubicacion) VALUES ($1,$2) RETURNING *', [nombre, texto(req.body.ubicacion) || null]);
    res.status(201).json(rows[0]);
  } catch (e) { next(e); }
});

router.put('/instalaciones/:id', requiereRol('administrador'), async (req, res, next) => {
  try {
    const nombre = texto(req.body.nombre);
    const estado = req.body.estado;
    if (!nombre) return res.status(400).json({ error: 'El nombre es obligatorio' });
    if (estado && !['activa', 'inactiva'].includes(estado)) return res.status(400).json({ error: 'estado inválido' });
    const { rows } = await consulta(
      `UPDATE instalacion SET nombre=$2, ubicacion=$3, estado=COALESCE($4, estado) WHERE id_instalacion=$1 RETURNING *`,
      [req.params.id, nombre, texto(req.body.ubicacion) || null, estado || null]);
    if (!rows[0]) return res.status(404).json({ error: 'Instalación no encontrada' });
    res.json(rows[0]);
  } catch (e) { next(e); }
});

/* ---------- Cultivos ---------- */
router.get('/cultivos', async (req, res, next) => {
  try {
    const idInst = req.usuario.rol === 'encargado' ? req.usuario.id_instalacion : req.query.id_instalacion || null;
    const { rows } = await consulta(
      'SELECT * FROM cultivo WHERE ($1::int IS NULL OR id_instalacion = $1) ORDER BY id_cultivo', [idInst]);
    res.json(rows);
  } catch (e) { next(e); }
});

router.post('/cultivos', requiereRol('administrador'), async (req, res, next) => {
  try {
    const { id_instalacion, nombre, preset = 'RUCULA' } = req.body;
    if (!id_instalacion || !texto(nombre)) return res.status(400).json({ error: 'id_instalacion y nombre son obligatorios' });
    const r = tiemposDePreset(preset, req.body);
    if (r.error) return res.status(400).json({ error: r.error });
    const t = r.tiempos;
    const inst = await consulta(`SELECT estado FROM instalacion WHERE id_instalacion = $1`, [id_instalacion]);
    if (!inst.rows[0] || inst.rows[0].estado !== 'activa') return res.status(400).json({ error: 'La instalación no existe o está inactiva' });
    const { rows } = await consulta(
      `INSERT INTO cultivo (id_instalacion, nombre, preset, tr_dia_s, td_dia_s, tr_noche_s, td_noche_s)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [id_instalacion, texto(nombre), preset, t.tr_dia_s, t.td_dia_s, t.tr_noche_s, t.td_noche_s]);
    res.status(201).json(rows[0]);
  } catch (e) { next(e); }
});

// Cambiar preset o activar modo manual: encargado (de su instalación) y administrador.
router.patch('/cultivos/:id/preset', requiereRol('encargado', 'administrador'), async (req, res, next) => {
  try {
    const { rows: actual } = await consulta('SELECT id_instalacion FROM cultivo WHERE id_cultivo = $1', [req.params.id]);
    if (!actual[0]) return res.status(404).json({ error: 'Cultivo no encontrado' });
    if (!instalacionPermitida(req.usuario, actual[0].id_instalacion)) return res.status(403).json({ error: 'No tienes acceso a esa instalación' });
    const preset = req.body.preset;
    const r = tiemposDePreset(preset, req.body);
    if (r.error) return res.status(400).json({ error: r.error });
    const t = r.tiempos;
    const { rows } = await consulta(
      `UPDATE cultivo SET preset=$2, tr_dia_s=$3, td_dia_s=$4, tr_noche_s=$5, td_noche_s=$6, actualizado_en=now()
        WHERE id_cultivo=$1 RETURNING *`,
      [req.params.id, preset, t.tr_dia_s, t.td_dia_s, t.tr_noche_s, t.td_noche_s]);
    res.json(rows[0]);
  } catch (e) { next(e); }
});

router.patch('/cultivos/:id/estado', requiereRol('administrador'), async (req, res, next) => {
  try {
    if (!['activo', 'finalizado'].includes(req.body.estado)) return res.status(400).json({ error: 'estado inválido' });
    const { rows } = await consulta('UPDATE cultivo SET estado=$2 WHERE id_cultivo=$1 RETURNING *', [req.params.id, req.body.estado]);
    if (!rows[0]) return res.status(404).json({ error: 'Cultivo no encontrado' });
    res.json(rows[0]);
  } catch (e) { next(e); }
});

/* ---------- Dispositivos ---------- */
const claveNueva = () => crypto.randomBytes(24).toString('base64url');

router.get('/dispositivos', requiereRol('administrador', 'supervisor'), async (req, res, next) => {
  try {
    const { rows } = await consulta(
      `SELECT id_dispositivo, id_instalacion, identificador_hw, variables_habilitadas, estado, ultima_comunicacion,
              (ultima_comunicacion IS NULL OR ultima_comunicacion < now() - make_interval(mins => $1)) AS sin_conexion
         FROM dispositivo ORDER BY id_dispositivo`, [config.minutosSinConexion]);
    res.json(rows);
  } catch (e) { next(e); }
});

// La clave se muestra UNA sola vez; en la base queda solo su hash.
router.post('/dispositivos', requiereRol('administrador'), async (req, res, next) => {
  try {
    const { id_instalacion, identificador_hw } = req.body;
    const variables = req.body.variables_habilitadas || Object.keys(VARIABLES);
    if (!id_instalacion || !texto(identificador_hw)) return res.status(400).json({ error: 'id_instalacion e identificador_hw son obligatorios' });
    if (!Array.isArray(variables) || variables.some((v) => !VARIABLES[v])) return res.status(400).json({ error: 'variables_habilitadas inválidas' });
    const inst = await consulta(`SELECT estado FROM instalacion WHERE id_instalacion = $1`, [id_instalacion]);
    if (!inst.rows[0] || inst.rows[0].estado !== 'activa') return res.status(400).json({ error: 'La instalación no existe o está inactiva' });
    const clave = claveNueva();
    const { rows } = await consulta(
      `INSERT INTO dispositivo (id_instalacion, identificador_hw, variables_habilitadas, clave_hash)
       VALUES ($1,$2,$3,$4) RETURNING id_dispositivo, id_instalacion, identificador_hw, variables_habilitadas, estado`,
      [id_instalacion, texto(identificador_hw), variables, await bcrypt.hash(clave, 10)]);
    res.status(201).json({ ...rows[0], clave_dispositivo: clave, aviso: 'Guarda esta clave ahora: no se vuelve a mostrar' });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Ya existe un dispositivo con ese identificador' });
    next(e);
  }
});

router.post('/dispositivos/:id/rotar-clave', requiereRol('administrador'), async (req, res, next) => {
  try {
    const clave = claveNueva();
    const { rowCount } = await consulta('UPDATE dispositivo SET clave_hash=$2 WHERE id_dispositivo=$1', [req.params.id, await bcrypt.hash(clave, 10)]);
    if (!rowCount) return res.status(404).json({ error: 'Dispositivo no encontrado' });
    res.json({ clave_dispositivo: clave, aviso: 'Guarda esta clave ahora: no se vuelve a mostrar' });
  } catch (e) { next(e); }
});

router.patch('/dispositivos/:id/estado', requiereRol('administrador'), async (req, res, next) => {
  try {
    if (!['activo', 'inactivo'].includes(req.body.estado)) return res.status(400).json({ error: 'estado inválido' });
    const { rows } = await consulta(
      'UPDATE dispositivo SET estado=$2 WHERE id_dispositivo=$1 RETURNING id_dispositivo, identificador_hw, estado', [req.params.id, req.body.estado]);
    if (!rows[0]) return res.status(404).json({ error: 'Dispositivo no encontrado' });
    res.json(rows[0]);
  } catch (e) { next(e); }
});

/* ---------- Reglas de umbral ---------- */
router.get('/reglas', requiereRol('administrador', 'supervisor'), async (req, res, next) => {
  try {
    const { rows } = await consulta(
      `SELECT r.*, c.nombre AS cultivo FROM regla_umbral r JOIN cultivo c ON c.id_cultivo = r.id_cultivo
        WHERE ($1::int IS NULL OR r.id_cultivo = $1) ORDER BY r.id_regla`, [req.query.id_cultivo || null]);
    res.json(rows);
  } catch (e) { next(e); }
});

router.post('/reglas', requiereRol('administrador'), async (req, res, next) => {
  try {
    const err = validarRegla(req.body);
    if (err) return res.status(400).json({ error: err });
    const cult = await consulta('SELECT 1 FROM cultivo WHERE id_cultivo = $1', [req.body.id_cultivo]);
    if (!cult.rows[0]) return res.status(400).json({ error: 'El cultivo no existe' });
    const { rows } = await consulta(
      `INSERT INTO regla_umbral (id_cultivo, variable, valor_min, valor_max, nivel_criticidad)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [req.body.id_cultivo, req.body.variable, req.body.valor_min ?? null, req.body.valor_max ?? null, req.body.nivel_criticidad]);
    res.status(201).json(rows[0]);
  } catch (e) { next(e); }
});

router.patch('/reglas/:id/activa', requiereRol('administrador'), async (req, res, next) => {
  try {
    if (typeof req.body.activa !== 'boolean') return res.status(400).json({ error: 'activa debe ser booleano' });
    const { rows } = await consulta('UPDATE regla_umbral SET activa=$2 WHERE id_regla=$1 RETURNING *', [req.params.id, req.body.activa]);
    if (!rows[0]) return res.status(404).json({ error: 'Regla no encontrada' });
    res.json(rows[0]);
  } catch (e) { next(e); }
});

/* ---------- Usuarios y roles (solo administrador, con auditoría) ---------- */
router.get('/roles', requiereRol('administrador'), async (req, res, next) => {
  try { res.json((await consulta('SELECT * FROM rol ORDER BY id_rol')).rows); } catch (e) { next(e); }
});

router.get('/usuarios', requiereRol('administrador'), async (req, res, next) => {
  try {
    const { rows } = await consulta(
      `SELECT u.id_usuario, u.nombre, u.correo, r.nombre AS rol, u.id_instalacion, u.activo
         FROM usuario u JOIN rol r ON r.id_rol = u.id_rol ORDER BY u.id_usuario`);
    res.json(rows);
  } catch (e) { next(e); }
});

function passwordValida(p) { return typeof p === 'string' && p.length >= 8; }

router.post('/usuarios', requiereRol('administrador'), async (req, res, next) => {
  try {
    const { nombre, correo, password, rol, id_instalacion } = req.body;
    if (!texto(nombre) || !texto(correo) || !rol) return res.status(400).json({ error: 'nombre, correo y rol son obligatorios' });
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(correo)) return res.status(400).json({ error: 'Correo no válido' });
    if (!passwordValida(password)) return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres' });
    const r = await consulta('SELECT id_rol FROM rol WHERE nombre = $1', [rol]);
    if (!r.rows[0]) return res.status(400).json({ error: 'Rol no válido' });
    if (rol === 'encargado' && !id_instalacion) return res.status(400).json({ error: 'El encargado debe tener una instalación asignada' });
    const { rows } = await consulta(
      `INSERT INTO usuario (nombre, correo, hash_password, id_rol, id_instalacion)
       VALUES ($1,$2,$3,$4,$5) RETURNING id_usuario, nombre, correo, id_instalacion, activo`,
      [texto(nombre), correo.trim().toLowerCase(), await bcrypt.hash(password, 10), r.rows[0].id_rol, id_instalacion || null]);
    await auditar(req.usuario.id, 'usuario_creado', { id_usuario: rows[0].id_usuario, rol });
    res.status(201).json({ ...rows[0], rol });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Ya existe un usuario con ese correo' });
    next(e);
  }
});

router.patch('/usuarios/:id', requiereRol('administrador'), async (req, res, next) => {
  try {
    const cambios = [];
    const valores = [req.params.id];
    if (req.body.rol !== undefined) {
      const r = await consulta('SELECT id_rol FROM rol WHERE nombre = $1', [req.body.rol]);
      if (!r.rows[0]) return res.status(400).json({ error: 'Rol no válido' });
      valores.push(r.rows[0].id_rol); cambios.push(`id_rol = $${valores.length}`);
    }
    if (req.body.activo !== undefined) {
      if (typeof req.body.activo !== 'boolean') return res.status(400).json({ error: 'activo debe ser booleano' });
      if (Number(req.params.id) === req.usuario.id && !req.body.activo) return res.status(400).json({ error: 'No puedes desactivar tu propia cuenta' });
      valores.push(req.body.activo); cambios.push(`activo = $${valores.length}`);
    }
    if (req.body.id_instalacion !== undefined) { valores.push(req.body.id_instalacion); cambios.push(`id_instalacion = $${valores.length}`); }
    if (req.body.password !== undefined) {
      if (!passwordValida(req.body.password)) return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres' });
      valores.push(await bcrypt.hash(req.body.password, 10)); cambios.push(`hash_password = $${valores.length}`);
    }
    if (!cambios.length) return res.status(400).json({ error: 'No hay cambios que aplicar' });
    const { rows } = await consulta(
      `UPDATE usuario SET ${cambios.join(', ')} WHERE id_usuario = $1 RETURNING id_usuario, nombre, correo, id_instalacion, activo`, valores);
    if (!rows[0]) return res.status(404).json({ error: 'Usuario no encontrado' });
    await auditar(req.usuario.id, 'usuario_modificado', { id_usuario: rows[0].id_usuario, campos: Object.keys(req.body).filter((k) => k !== 'password') });
    res.json(rows[0]);
  } catch (e) { next(e); }
});

/* ---------- Resumen para el supervisor / administrador ---------- */
router.get('/resumen', requiereRol('supervisor', 'administrador'), async (req, res, next) => {
  try {
    const { rows } = await consulta(
      `SELECT
         (SELECT count(*) FROM instalacion WHERE estado = 'activa')::int AS instalaciones_activas,
         (SELECT count(*) FROM alerta WHERE estado_revision = 'pendiente')::int AS alertas_pendientes,
         (SELECT count(*) FROM dispositivo WHERE estado = 'activo' AND
            (ultima_comunicacion IS NULL OR ultima_comunicacion < now() - make_interval(mins => $1)))::int AS dispositivos_sin_conexion`,
      [config.minutosSinConexion]);
    res.json(rows[0]);
  } catch (e) { next(e); }
});

module.exports = router;
