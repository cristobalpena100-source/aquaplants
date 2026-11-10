const { validarMedicion, incumpleRegla, reglaMasGrave, validarRegla } = require('../src/lib/validacion');
const { tiemposDePreset, PRESETS } = require('../src/lib/presets');
const bcrypt = require('bcryptjs');

const AHORA = new Date('2026-11-10T12:00:00Z');

describe('validarMedicion (unitaria)', () => {
  test('acepta una medición válida y asigna la unidad', () => {
    const r = validarMedicion({ tipo_variable: 'temperatura', valor: 22.456 }, AHORA);
    expect(r.error).toBeUndefined();
    expect(r.medicion).toMatchObject({ tipo_variable: 'temperatura', valor: 22.46, unidad: '°C', sincronizada: false });
  });
  test('usa la hora recibida cuando no llega timestamp', () => {
    expect(validarMedicion({ tipo_variable: 'humedad', valor: 50 }, AHORA).medicion.timestamp).toBe(AHORA.toISOString());
  });
  test('conserva el timestamp de origen (sincronización tardía)', () => {
    const r = validarMedicion({ tipo_variable: 'nivel_agua', valor: 40, timestamp: '2026-11-10T08:00:00Z', sincronizada: true }, AHORA);
    expect(r.medicion.timestamp).toBe('2026-11-10T08:00:00.000Z');
    expect(r.medicion.sincronizada).toBe(true);
  });
  test.each([
    [{ tipo_variable: 'presion', valor: 1 }, 'no reconocido'],
    [{ tipo_variable: 'humedad', valor: 'abc' }, 'numérico'],
    [{ tipo_variable: 'humedad', valor: 101 }, 'fuera del rango'],
    [{ tipo_variable: 'nivel_agua', valor: -1 }, 'fuera del rango'],
    [{ tipo_variable: 'temperatura', valor: 20, timestamp: 'ayer' }, 'fecha válida'],
    [{ tipo_variable: 'temperatura', valor: 20, timestamp: '2027-01-01T00:00:00Z' }, 'futuro'],
    [{ tipo_variable: 'temperatura', valor: 20, sincronizada: 'si' }, 'booleano'],
    [null, 'objeto']
  ])('rechaza %j', (entrada, texto) => {
    expect(validarMedicion(entrada, AHORA).error).toContain(texto);
  });
});

describe('umbrales de nivel de agua (los del firmware: <= 10 % bajo, <= 5 % vacío)', () => {
  const bajo = { variable: 'nivel_agua', valor_min: 10, valor_max: null, nivel_criticidad: 'advertencia' };
  const vacio = { variable: 'nivel_agua', valor_min: 5, valor_max: null, nivel_criticidad: 'critica' };
  test('en el límite exacto dispara (igual que el firmware)', () => {
    expect(incumpleRegla(10, bajo)).toBe(true);
    expect(incumpleRegla(5, vacio)).toBe(true);
  });
  test('sobre el límite no dispara', () => {
    expect(incumpleRegla(10.01, bajo)).toBe(false);
    expect(incumpleRegla(60, vacio)).toBe(false);
  });
  test('con 4 % se queda solo la más grave', () => {
    const incumplidas = [bajo, vacio].filter((r) => incumpleRegla(4, r));
    expect(incumplidas).toHaveLength(2);
    expect(reglaMasGrave(incumplidas).nivel_criticidad).toBe('critica');
  });
  test('con 8 % solo advertencia', () => {
    const incumplidas = [bajo, vacio].filter((r) => incumpleRegla(8, r));
    expect(reglaMasGrave(incumplidas).nivel_criticidad).toBe('advertencia');
  });
  test('sin reglas incumplidas no hay alerta', () => expect(reglaMasGrave([])).toBeNull());
  test('regla con máximo (temperatura alta)', () => {
    expect(incumpleRegla(31, { valor_max: 30 })).toBe(true);
    expect(incumpleRegla(25, { valor_max: 30 })).toBe(false);
  });
});

describe('validarRegla', () => {
  test('valor_min debe ser menor que valor_max', () => {
    expect(validarRegla({ variable: 'temperatura', nivel_criticidad: 'critica', valor_min: 30, valor_max: 10 })).toContain('menor');
  });
  test('exige al menos un límite', () => {
    expect(validarRegla({ variable: 'temperatura', nivel_criticidad: 'critica' })).toContain('valor_min, valor_max');
  });
  test('regla válida', () => {
    expect(validarRegla({ variable: 'nivel_agua', nivel_criticidad: 'advertencia', valor_min: 10 })).toBeNull();
  });
});

describe('presets del firmware', () => {
  test('los valores coinciden con main.cpp', () => {
    expect(PRESETS.RUCULA).toEqual({ tr_dia_s: 100, td_dia_s: 210, tr_noche_s: 100, td_noche_s: 100 });
    expect(PRESETS.PAPA.td_noche_s).toBe(3600);
  });
  test('modo manual valida los tiempos', () => {
    expect(tiemposDePreset('MANUAL', { tr_dia_s: -5 }).error).toContain('tr_dia_s');
    expect(tiemposDePreset('MANUAL', { tr_dia_s: 120 }).tiempos.tr_dia_s).toBe(120);
    expect(tiemposDePreset('TOMATE').error).toBeDefined();
  });
});

describe('hash de contraseñas', () => {
  test('bcrypt no guarda texto plano y verifica bien', async () => {
    const h = await bcrypt.hash('Cambiar123!', 10);
    expect(h).not.toContain('Cambiar123!');
    expect(await bcrypt.compare('Cambiar123!', h)).toBe(true);
    expect(await bcrypt.compare('otra', h)).toBe(false);
  });
});
