// Pruebas de integración: API de ingesta -> base de datos -> motor de reglas -> alerta.
// Necesitan una base PostgreSQL de pruebas: TEST_DATABASE_URL (si no está, se omiten).
const URL_PRUEBAS = process.env.TEST_DATABASE_URL;
const describeDb = URL_PRUEBAS ? describe : describe.skip;

describeDb('API (integración)', () => {
  let app, request, db, tokens = {}, clave = 'clave-de-pruebas-123', idInst, idCultivo;

  const cab = (extra = {}) => ({ 'x-dispositivo-id': 'TEST-001', 'x-dispositivo-clave': clave, ...extra });
  const bearer = (rol) => ({ Authorization: `Bearer ${tokens[rol]}` });

  beforeAll(async () => {
    process.env.DATABASE_URL = URL_PRUEBAS;
    process.env.JWT_SECRET = 'clave-de-pruebas-clave-de-pruebas-1234';
    process.env.SEED_PASSWORD = 'Prueba1234!';
    process.env.SEED_DEVICE_KEY = clave;
    db = require('../src/db');
    request = require('supertest');
    await db.pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    const fs = require('fs'); const path = require('path');
    await db.pool.query(fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8'));

    const bcrypt = require('bcryptjs');
    const hp = await bcrypt.hash('Prueba1234!', 4);
    idInst = (await db.pool.query(`INSERT INTO instalacion (nombre) VALUES ('Inst A') RETURNING id_instalacion`)).rows[0].id_instalacion;
    const otra = (await db.pool.query(`INSERT INTO instalacion (nombre) VALUES ('Inst B') RETURNING id_instalacion`)).rows[0].id_instalacion;
    idCultivo = (await db.pool.query(
      `INSERT INTO cultivo (id_instalacion, nombre, preset, tr_dia_s, td_dia_s, tr_noche_s, td_noche_s)
       VALUES ($1,'Rúcula','RUCULA',100,210,100,100) RETURNING id_cultivo`, [idInst])).rows[0].id_cultivo;
    await db.pool.query(`INSERT INTO regla_umbral (id_cultivo, variable, valor_min, nivel_criticidad) VALUES ($1,'nivel_agua',10,'advertencia'),($1,'nivel_agua',5,'critica')`, [idCultivo]);
    await db.pool.query(`INSERT INTO dispositivo (id_instalacion, identificador_hw, clave_hash) VALUES ($1,'TEST-001',$2)`, [idInst, await bcrypt.hash(clave, 4)]);
    for (const [correo, rol, inst] of [['a@t.cl', 'administrador', null], ['s@t.cl', 'supervisor', null], ['e@t.cl', 'encargado', idInst], ['e2@t.cl', 'encargado', otra]]) {
      await db.pool.query(`INSERT INTO usuario (nombre, correo, hash_password, id_rol, id_instalacion) VALUES ($1,$1,$2,(SELECT id_rol FROM rol WHERE nombre=$3),$4)`, [correo, hp, rol, inst]);
    }
    app = require('../src/app');
    for (const [k, correo] of [['administrador', 'a@t.cl'], ['supervisor', 's@t.cl'], ['encargado', 'e@t.cl'], ['encargado2', 'e2@t.cl']]) {
      tokens[k] = (await request(app).post('/api/auth/login').send({ correo, password: 'Prueba1234!' })).body.token;
    }
  });
  afterAll(async () => { await db.cerrar(); });

  test('salud', async () => { expect((await request(app).get('/salud')).body.estado).toBe('ok'); });

  describe('login', () => {
    test('credenciales correctas devuelven token', () => expect(tokens.administrador).toBeTruthy());
    test('contraseña incorrecta: 401 con mensaje genérico', async () => {
      const r = await request(app).post('/api/auth/login').send({ correo: 'a@t.cl', password: 'mala' });
      expect(r.status).toBe(401); expect(r.body.error).toMatch(/Correo o contraseña/);
    });
    test('bloquea la cuenta tras 5 intentos fallidos', async () => {
      for (let i = 0; i < 5; i++) await request(app).post('/api/auth/login').send({ correo: 'bloq@t.cl', password: 'x' });
      expect((await request(app).post('/api/auth/login').send({ correo: 'bloq@t.cl', password: 'x' })).status).toBe(429);
    });
    test('sin token: 401', async () => expect((await request(app).get('/api/instalaciones')).status).toBe(401));
  });

  describe('ingesta de mediciones', () => {
    test('sin credenciales de dispositivo: 401', async () => {
      expect((await request(app).post('/api/mediciones').send({ tipo_variable: 'humedad', valor: 50 })).status).toBe(401);
    });
    test('clave de dispositivo incorrecta: 401', async () => {
      expect((await request(app).post('/api/mediciones').set(cab({ 'x-dispositivo-clave': 'mala' })).send({ tipo_variable: 'humedad', valor: 50 })).status).toBe(401);
    });
    test('un usuario (JWT) no puede usar el endpoint de dispositivos', async () => {
      expect((await request(app).post('/api/mediciones').set(bearer('administrador')).send({ tipo_variable: 'humedad', valor: 50 })).status).toBe(401);
    });
    test('medición válida: 201 y queda guardada', async () => {
      const r = await request(app).post('/api/mediciones').set(cab()).send({ tipo_variable: 'temperatura', valor: 22.5 });
      expect(r.status).toBe(201); expect(r.body.recibidas).toBe(1);
      const h = await request(app).get('/api/mediciones?variable=temperatura').set(bearer('encargado'));
      expect(h.body[0]).toMatchObject({ tipo_variable: 'temperatura', valor: '22.50' });
    });
    test('payload inválido: 400 y no guarda nada', async () => {
      const antes = (await db.pool.query('SELECT count(*)::int n FROM medicion')).rows[0].n;
      const r = await request(app).post('/api/mediciones').set(cab()).send({ tipo_variable: 'humedad', valor: 500 });
      expect(r.status).toBe(400);
      expect((await db.pool.query('SELECT count(*)::int n FROM medicion')).rows[0].n).toBe(antes);
    });
    test('un lote con una medición mala se rechaza completo', async () => {
      const antes = (await db.pool.query('SELECT count(*)::int n FROM medicion')).rows[0].n;
      const r = await request(app).post('/api/mediciones').set(cab()).send({ mediciones: [{ tipo_variable: 'humedad', valor: 50 }, { tipo_variable: 'humedad', valor: 'x' }] });
      expect(r.status).toBe(400);
      expect((await db.pool.query('SELECT count(*)::int n FROM medicion')).rows[0].n).toBe(antes);
    });
    test('sincronización tardía conserva el timestamp de origen y no dispara alertas', async () => {
      const r = await request(app).post('/api/mediciones').set(cab()).send({ mediciones: [
        { tipo_variable: 'nivel_agua', valor: 3, timestamp: '2026-01-01T10:00:00Z', sincronizada: true }] });
      expect(r.status).toBe(201); expect(r.body.alertas_generadas).toHaveLength(0);
      const { rows } = await db.pool.query(`SELECT "timestamp", sincronizada FROM medicion WHERE id_medicion = $1`, [r.body.ids[0]]);
      expect(rows[0].timestamp.toISOString()).toBe('2026-01-01T10:00:00.000Z'); expect(rows[0].sincronizada).toBe(true);
    });
  });

  describe('motor de reglas y alertas', () => {
    test('nivel de agua 60 %: sin alerta', async () => {
      const r = await request(app).post('/api/mediciones').set(cab()).send({ tipo_variable: 'nivel_agua', valor: 60 });
      expect(r.body.alertas_generadas).toHaveLength(0);
    });
    test('nivel de agua 8 %: alerta de advertencia, en menos de 2 s', async () => {
      const t0 = Date.now();
      const r = await request(app).post('/api/mediciones').set(cab()).send({ tipo_variable: 'nivel_agua', valor: 8 });
      expect(Date.now() - t0).toBeLessThan(2000);
      expect(r.body.alertas_generadas).toHaveLength(1);
      expect(r.body.alertas_generadas[0].nivel_criticidad).toBe('advertencia');
    });
    test('una condición sostenida no duplica la alerta pendiente', async () => {
      const r = await request(app).post('/api/mediciones').set(cab()).send({ tipo_variable: 'nivel_agua', valor: 7 });
      expect(r.body.alertas_generadas).toHaveLength(0);
    });
    test('nivel 4 %: una sola alerta, la crítica', async () => {
      const r = await request(app).post('/api/mediciones').set(cab()).send({ tipo_variable: 'nivel_agua', valor: 4 });
      expect(r.body.alertas_generadas).toHaveLength(1);
      expect(r.body.alertas_generadas[0].nivel_criticidad).toBe('critica');
    });
    test('el encargado ve las alertas de su instalación y las marca como revisadas', async () => {
      const l = await request(app).get('/api/alertas?estado=pendiente').set(bearer('encargado'));
      expect(l.body.length).toBeGreaterThanOrEqual(2);
      const rev = await request(app).patch(`/api/alertas/${l.body[0].id_alerta}/revisar`).set(bearer('encargado'));
      expect(rev.status).toBe(200);
    });
    test('otro encargado no ve ni revisa alertas ajenas', async () => {
      expect((await request(app).get('/api/alertas').set(bearer('encargado2'))).body).toHaveLength(0);
      const l = await request(app).get('/api/alertas').set(bearer('administrador'));
      expect((await request(app).patch(`/api/alertas/${l.body[0].id_alerta}/revisar`).set(bearer('encargado2'))).status).toBe(403);
    });
    test('el supervisor no puede revisar alertas', async () => {
      const l = await request(app).get('/api/alertas').set(bearer('administrador'));
      expect((await request(app).patch(`/api/alertas/${l.body[0].id_alerta}/revisar`).set(bearer('supervisor'))).status).toBe(403);
    });
  });

  describe('matriz de permisos (Tabla 7)', () => {
    test('encargado: puede cambiar el preset de su cultivo', async () => {
      const r = await request(app).patch(`/api/cultivos/${idCultivo}/preset`).set(bearer('encargado')).send({ preset: 'LECHUGA' });
      expect(r.status).toBe(200); expect(r.body).toMatchObject({ preset: 'LECHUGA', tr_dia_s: 105, td_dia_s: 360 });
    });
    test('encargado: modo manual con tiempos propios', async () => {
      const r = await request(app).patch(`/api/cultivos/${idCultivo}/preset`).set(bearer('encargado')).send({ preset: 'MANUAL', tr_dia_s: 120, td_dia_s: 200, tr_noche_s: 90, td_noche_s: 150 });
      expect(r.body).toMatchObject({ preset: 'MANUAL', tr_dia_s: 120 });
    });
    test('encargado: tiempos manuales inválidos -> 400', async () => {
      expect((await request(app).patch(`/api/cultivos/${idCultivo}/preset`).set(bearer('encargado')).send({ preset: 'MANUAL', tr_dia_s: -1 })).status).toBe(400);
    });
    test('encargado de otra instalación no puede cambiar el preset', async () => {
      expect((await request(app).patch(`/api/cultivos/${idCultivo}/preset`).set(bearer('encargado2')).send({ preset: 'PAPA' })).status).toBe(403);
    });
    test('supervisor no puede cambiar el preset', async () => {
      expect((await request(app).patch(`/api/cultivos/${idCultivo}/preset`).set(bearer('supervisor')).send({ preset: 'PAPA' })).status).toBe(403);
    });
    test('solo el administrador crea instalaciones, cultivos, dispositivos y usuarios', async () => {
      for (const rol of ['encargado', 'supervisor']) {
        expect((await request(app).post('/api/instalaciones').set(bearer(rol)).send({ nombre: 'X' })).status).toBe(403);
        expect((await request(app).post('/api/usuarios').set(bearer(rol)).send({})).status).toBe(403);
        expect((await request(app).post('/api/dispositivos').set(bearer(rol)).send({})).status).toBe(403);
      }
      expect((await request(app).post('/api/instalaciones').set(bearer('administrador')).send({ nombre: 'Nueva' })).status).toBe(201);
    });
    test('reglas de umbral: admin escribe, supervisor solo lee, encargado no accede', async () => {
      const nueva = { id_cultivo: idCultivo, variable: 'temperatura', valor_max: 30, nivel_criticidad: 'advertencia' };
      expect((await request(app).post('/api/reglas').set(bearer('administrador')).send(nueva)).status).toBe(201);
      expect((await request(app).post('/api/reglas').set(bearer('supervisor')).send(nueva)).status).toBe(403);
      expect((await request(app).get('/api/reglas').set(bearer('supervisor'))).status).toBe(200);
      expect((await request(app).get('/api/reglas').set(bearer('encargado'))).status).toBe(403);
    });
    test('regla con valor_min >= valor_max se rechaza', async () => {
      expect((await request(app).post('/api/reglas').set(bearer('administrador')).send({ id_cultivo: idCultivo, variable: 'temperatura', valor_min: 30, valor_max: 10, nivel_criticidad: 'critica' })).status).toBe(400);
    });
    test('exportar reporte: supervisor sí, encargado no', async () => {
      const ok = await request(app).get('/api/mediciones/exportar.csv').set(bearer('supervisor'));
      expect(ok.status).toBe(200); expect(ok.text).toContain('id_instalacion,dispositivo,variable');
      expect((await request(app).get('/api/mediciones/exportar.csv').set(bearer('encargado'))).status).toBe(403);
    });
    test('crear usuario deja registro de auditoría y la contraseña queda con hash', async () => {
      const r = await request(app).post('/api/usuarios').set(bearer('administrador')).send({ nombre: 'Nuevo', correo: 'nuevo@t.cl', password: 'ClaveSegura1', rol: 'encargado', id_instalacion: idInst });
      expect(r.status).toBe(201);
      expect((await db.pool.query(`SELECT count(*)::int n FROM auditoria WHERE accion='usuario_creado'`)).rows[0].n).toBe(1);
      const u = (await db.pool.query(`SELECT hash_password FROM usuario WHERE correo='nuevo@t.cl'`)).rows[0];
      expect(u.hash_password).not.toContain('ClaveSegura1');
    });
    test('crear dispositivo devuelve la clave una sola vez y en la base solo hay hash', async () => {
      const r = await request(app).post('/api/dispositivos').set(bearer('administrador')).send({ id_instalacion: idInst, identificador_hw: 'TEST-002' });
      expect(r.status).toBe(201); expect(r.body.clave_dispositivo).toBeTruthy();
      const { rows } = await db.pool.query(`SELECT clave_hash FROM dispositivo WHERE identificador_hw='TEST-002'`);
      expect(rows[0].clave_hash).not.toBe(r.body.clave_dispositivo);
      expect((await request(app).get('/api/dispositivos').set(bearer('administrador'))).body[0].clave_hash).toBeUndefined();
    });
  });

  describe('rendimiento básico', () => {
    test('50 solicitudes concurrentes al endpoint de ingesta: todas responden bien y < 500 ms de mediana', async () => {
      const tiempos = []; const estados = [];
      await Promise.all(Array.from({ length: 50 }, async () => {
        const t0 = Date.now();
        const r = await request(app).post('/api/mediciones').set(cab()).send({ tipo_variable: 'temperatura', valor: 21 });
        tiempos.push(Date.now() - t0); estados.push(r.status);
      }));
      tiempos.sort((a, b) => a - b);
      expect(estados.every((s) => s === 201)).toBe(true);
      expect(tiempos[25]).toBeLessThan(500);
    });
  });
});
