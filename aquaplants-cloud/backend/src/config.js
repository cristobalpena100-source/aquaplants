require('dotenv').config();

const esProduccion = process.env.NODE_ENV === 'production';

function requerida(nombre) {
  const valor = process.env[nombre];
  if (!valor) throw new Error(`Falta la variable de entorno ${nombre}`);
  return valor;
}

const jwtSecret = process.env.JWT_SECRET || (esProduccion ? requerida('JWT_SECRET') : 'clave-solo-para-desarrollo-local-no-usar-en-la-nube');
if (esProduccion && jwtSecret.length < 32) {
  throw new Error('JWT_SECRET debe tener al menos 32 caracteres en producción');
}

module.exports = {
  esProduccion,
  puerto: Number(process.env.PORT) || 3000,
  databaseUrl: process.env.DATABASE_URL || 'postgres://aquaplants:aquaplants@localhost:5432/aquaplants',
  databaseSsl: process.env.DATABASE_SSL === 'true',
  jwtSecret,
  jwtExpira: process.env.JWT_EXPIRA || '2h',
  corsOrigen: (process.env.CORS_ORIGEN || '').split(',').map((s) => s.trim()).filter(Boolean),
  // Un dispositivo sin comunicarse por más de este tiempo se considera sin conexión.
  minutosSinConexion: Number(process.env.MINUTOS_SIN_CONEXION) || 5
};
