const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const { consulta } = require('../db');
const { requiereLogin, firmarToken } = require('../middleware/auth');

const router = express.Router();

// Bloqueo temporal por correo tras varios intentos fallidos (mitigación de fuerza bruta, 7.2).
const MAX_INTENTOS = 5;
const BLOQUEO_MS = 15 * 60 * 1000;
const intentos = new Map(); // correo -> { cuenta, hasta }

const limiteLogin = rateLimit({ windowMs: 15 * 60 * 1000, limit: 50, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Demasiados intentos, espera unos minutos' } });

function bloqueado(correo) {
  const r = intentos.get(correo);
  return r && r.hasta && r.hasta > Date.now();
}
function falla(correo) {
  const r = intentos.get(correo) || { cuenta: 0, hasta: 0 };
  r.cuenta += 1;
  if (r.cuenta >= MAX_INTENTOS) { r.hasta = Date.now() + BLOQUEO_MS; r.cuenta = 0; }
  intentos.set(correo, r);
}

router.post('/login', limiteLogin, async (req, res, next) => {
  try {
    const correo = String(req.body.correo || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    if (!correo || !password) return res.status(400).json({ error: 'Ingresa correo y contraseña' });
    if (bloqueado(correo)) return res.status(429).json({ error: 'Cuenta bloqueada temporalmente por intentos fallidos' });

    const { rows } = await consulta(
      `SELECT u.id_usuario, u.nombre, u.hash_password, u.activo, u.id_instalacion, r.nombre AS rol
         FROM usuario u JOIN rol r ON r.id_rol = u.id_rol WHERE u.correo = $1`, [correo]);
    const u = rows[0];
    // Mensaje genérico: no se revela si falló el correo o la contraseña.
    const ok = u && u.activo && (await bcrypt.compare(password, u.hash_password));
    if (!ok) { falla(correo); return res.status(401).json({ error: 'Correo o contraseña incorrectos' }); }

    intentos.delete(correo);
    res.json({
      token: firmarToken(u),
      usuario: { id: u.id_usuario, nombre: u.nombre, rol: u.rol, id_instalacion: u.id_instalacion }
    });
  } catch (e) { next(e); }
});

router.get('/yo', requiereLogin, (req, res) => res.json({ usuario: req.usuario }));

// Renovación periódica del token (7.2): se pide un token nuevo mientras el actual sea válido.
router.post('/renovar', requiereLogin, async (req, res, next) => {
  try {
    const { rows } = await consulta(
      `SELECT u.id_usuario, u.nombre, u.activo, u.id_instalacion, r.nombre AS rol
         FROM usuario u JOIN rol r ON r.id_rol = u.id_rol WHERE u.id_usuario = $1`, [req.usuario.id]);
    if (!rows[0] || !rows[0].activo) return res.status(401).json({ error: 'Usuario inactivo' });
    res.json({ token: firmarToken(rows[0]) });
  } catch (e) { next(e); }
});

module.exports = router;
