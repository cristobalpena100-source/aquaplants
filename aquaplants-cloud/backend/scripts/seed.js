// Datos de prueba: una instalación, un cultivo de rúcula, reglas de nivel de agua del firmware,
// un dispositivo y tres usuarios (uno por rol). Es seguro repetirlo.
const bcrypt = require('bcryptjs');
const { pool, cerrar } = require('../src/db');
const { PRESETS, UMBRALES_AGUA } = require('../src/lib/presets');

(async () => {
  const password = process.env.SEED_PASSWORD || 'Cambiar123!';
  const claveDispositivo = process.env.SEED_DEVICE_KEY || 'clave-demo-aquabrain-001-cambiar';
  const db = await pool.connect();
  try {
    await db.query('BEGIN');

    let { rows } = await db.query(`SELECT id_instalacion FROM instalacion WHERE nombre = 'Invernadero demo'`);
    let idInst = rows[0]?.id_instalacion;
    if (!idInst) {
      ({ rows } = await db.query(
        `INSERT INTO instalacion (nombre, ubicacion) VALUES ('Invernadero demo', 'INACAP') RETURNING id_instalacion`));
      idInst = rows[0].id_instalacion;
    }

    ({ rows } = await db.query(`SELECT id_cultivo FROM cultivo WHERE id_instalacion = $1 AND nombre = 'Rúcula demo'`, [idInst]));
    let idCultivo = rows[0]?.id_cultivo;
    if (!idCultivo) {
      const p = PRESETS.RUCULA;
      ({ rows } = await db.query(
        `INSERT INTO cultivo (id_instalacion, nombre, preset, tr_dia_s, td_dia_s, tr_noche_s, td_noche_s)
         VALUES ($1,'Rúcula demo','RUCULA',$2,$3,$4,$5) RETURNING id_cultivo`,
        [idInst, p.tr_dia_s, p.td_dia_s, p.tr_noche_s, p.td_noche_s]));
      idCultivo = rows[0].id_cultivo;
      // Reglas de nivel de agua = las alarmas del firmware: <= 10 % bajo, <= 5 % vacío.
      await db.query(
        `INSERT INTO regla_umbral (id_cultivo, variable, valor_min, nivel_criticidad) VALUES
           ($1,'nivel_agua',$2,'advertencia'), ($1,'nivel_agua',$3,'critica')`,
        [idCultivo, UMBRALES_AGUA.bajo, UMBRALES_AGUA.vacio]);
    }

    const hashClave = await bcrypt.hash(claveDispositivo, 10);
    await db.query(
      `INSERT INTO dispositivo (id_instalacion, identificador_hw, clave_hash)
       VALUES ($1,'AQUABRAIN-001',$2) ON CONFLICT (identificador_hw) DO NOTHING`, [idInst, hashClave]);

    const hashPass = await bcrypt.hash(password, 10);
    const usuarios = [
      ['Administrador demo', 'admin@aquaplants.cl', 'administrador', null],
      ['Supervisor demo', 'supervisor@aquaplants.cl', 'supervisor', null],
      ['Encargado demo', 'encargado@aquaplants.cl', 'encargado', idInst]
    ];
    for (const [nombre, correo, rol, inst] of usuarios) {
      await db.query(
        `INSERT INTO usuario (nombre, correo, hash_password, id_rol, id_instalacion)
         VALUES ($1,$2,$3,(SELECT id_rol FROM rol WHERE nombre=$4),$5) ON CONFLICT (correo) DO NOTHING`,
        [nombre, correo, hashPass, rol, inst]);
    }

    await db.query('COMMIT');
    console.log('Datos de prueba listos.');
    console.log('Usuarios: admin@aquaplants.cl, supervisor@aquaplants.cl, encargado@aquaplants.cl');
    console.log('Dispositivo demo: AQUABRAIN-001');
    console.log('IMPORTANTE: cambia las contraseñas y la clave del dispositivo antes de usarlo fuera de pruebas.');
  } catch (e) {
    await db.query('ROLLBACK');
    console.error('Error en el seed:', e.message);
    process.exitCode = 1;
  } finally {
    db.release();
    await cerrar();
  }
})();
