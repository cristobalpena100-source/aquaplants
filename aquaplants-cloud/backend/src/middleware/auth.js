const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const config = require('../config');
const { consulta } = require('../db');

// Verifica el JWT del encabezado Authorization: Bearer <token> y deja el usuario en req.usuario.
function requiereLogin(req, res, next) {
  const cabecera = req.headers.authorization || '';
  const [tipo, token] = cabecera.split(' ');
  if (tipo !== 'Bearer' || !token) return res.status(401).json({ error: 'Falta el token de sesión' });
  try {
    const datos = jwt.verify(token, config.jwtSecret);
    req.usuario = { id: datos.sub, rol: datos.rol, id_instalacion: datos.id_instalacion, nombre: datos.nombre };
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Sesión inválida o expirada' });
  }
}

// Restringe una ruta a ciertos roles (matriz de permisos, Tabla 7 del informe).
function requiereRol(...roles) {
  return (req, res, next) => {
    if (!req.usuario || !roles.includes(req.usuario.rol)) {
      return res.status(403).json({ error: 'No tienes permiso para esta acción' });
    }
    next();
  };
}

// El encargado solo ve su instalación; supervisor y administrador ven todas.
function instalacionPermitida(usuario, idInstalacion) {
  if (usuario.rol !== 'encargado') return true;
  return Number(idInstalacion) === Number(usuario.id_instalacion);
}

// Autenticación de dispositivo: cabeceras x-dispositivo-id y x-dispositivo-clave
// (clave propia del dispositivo, distinta de las credenciales de las personas).
async function requiereDispositivo(req, res, next) {
  const id = req.headers['x-dispositivo-id'];
  const clave = req.headers['x-dispositivo-clave'];
  if (!id || !clave) return res.status(401).json({ error: 'Faltan las credenciales del dispositivo' });
  try {
    const { rows } = await consulta(
      `SELECT id_dispositivo, id_instalacion, identificador_hw, variables_habilitadas, clave_hash, estado
         FROM dispositivo WHERE identificador_hw = $1`, [String(id)]);
    const d = rows[0];
    // Mismo mensaje si no existe o la clave falla, para no revelar qué dispositivos existen.
    if (!d || !(await bcrypt.compare(String(clave), d.clave_hash))) {
      return res.status(401).json({ error: 'Credenciales de dispositivo inválidas' });
    }
    if (d.estado !== 'activo') return res.status(403).json({ error: 'El dispositivo está inactivo' });
    req.dispositivo = d;
    next();
  } catch (e) {
    next(e);
  }
}

function firmarToken(u) {
  return jwt.sign(
    { sub: u.id_usuario, rol: u.rol, id_instalacion: u.id_instalacion, nombre: u.nombre },
    config.jwtSecret,
    { expiresIn: config.jwtExpira }
  );
}

module.exports = { requiereLogin, requiereRol, instalacionPermitida, requiereDispositivo, firmarToken };
