const { Pool } = require('pg');
const config = require('./config');

const pool = new Pool({
  connectionString: config.databaseUrl,
  ssl: config.databaseSsl ? { rejectUnauthorized: false } : undefined,
  max: 10
});

pool.on('error', (err) => console.error('Error inesperado en el pool de PostgreSQL:', err.message));

module.exports = {
  pool,
  consulta: (texto, params) => pool.query(texto, params),
  cerrar: () => pool.end()
};
