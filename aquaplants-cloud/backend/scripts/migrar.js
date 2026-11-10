// Crea las tablas ejecutando db/schema.sql. Es seguro repetirlo (usa IF NOT EXISTS).
const fs = require('fs');
const path = require('path');
const { pool, cerrar } = require('../src/db');

(async () => {
  try {
    const sql = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');
    await pool.query(sql);
    console.log('Migración lista: tablas creadas o ya existentes.');
  } catch (e) {
    console.error('Error al migrar:', e.message);
    process.exitCode = 1;
  } finally {
    await cerrar();
  }
})();
