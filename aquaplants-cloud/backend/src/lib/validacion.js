// Funciones puras de validación y de evaluación de umbrales (fáciles de probar con Jest).

const VARIABLES = {
  temperatura: { unidad: '°C', min: -40, max: 85 },
  humedad: { unidad: '%', min: 0, max: 100 },
  nivel_agua: { unidad: '%', min: 0, max: 100 }
};

const CRITICIDAD = { advertencia: 1, critica: 2 };

// Valida una medición enviada por un dispositivo. Devuelve { medicion } o { error }.
function validarMedicion(entrada, ahora = new Date()) {
  if (!entrada || typeof entrada !== 'object') return { error: 'La medición debe ser un objeto JSON' };

  const { tipo_variable: tipo, valor, timestamp, sincronizada } = entrada;
  const def = VARIABLES[tipo];
  if (!def) return { error: `tipo_variable no reconocido: ${tipo}` };

  const numero = typeof valor === 'string' && valor.trim() !== '' ? Number(valor) : valor;
  if (typeof numero !== 'number' || !Number.isFinite(numero)) return { error: 'valor debe ser numérico' };
  if (numero < def.min || numero > def.max) {
    return { error: `valor fuera del rango físico de ${tipo} (${def.min} a ${def.max})` };
  }

  let marca = ahora;
  if (timestamp !== undefined && timestamp !== null) {
    marca = new Date(timestamp);
    if (Number.isNaN(marca.getTime())) return { error: 'timestamp no es una fecha válida (usa ISO 8601)' };
    // Se aceptan mediciones pasadas (sincronización tardía), pero no del futuro lejano.
    if (marca.getTime() - ahora.getTime() > 5 * 60 * 1000) return { error: 'timestamp está en el futuro' };
  }
  if (sincronizada !== undefined && typeof sincronizada !== 'boolean') return { error: 'sincronizada debe ser booleano' };

  return {
    medicion: {
      tipo_variable: tipo,
      valor: Math.round(numero * 100) / 100,
      unidad: def.unidad,
      timestamp: marca.toISOString(),
      sincronizada: sincronizada === true
    }
  };
}

// ¿El valor activa la regla? Los límites son umbrales de alerta e inclusivos:
// alerta si valor <= valor_min o valor >= valor_max. Así el nivel de agua replica al firmware
// (alarma con <= 10 % y <= 5 %), definiendo esas reglas con valor_min = 10 y valor_min = 5.
function incumpleRegla(valor, regla) {
  const v = Number(valor);
  const min = regla.valor_min === null || regla.valor_min === undefined ? null : Number(regla.valor_min);
  const max = regla.valor_max === null || regla.valor_max === undefined ? null : Number(regla.valor_max);
  if (min !== null && v <= min) return true;
  if (max !== null && v >= max) return true;
  return false;
}

// De todas las reglas incumplidas, deja solo la más grave (así un 4 % de agua genera
// una alerta crítica y no dos: crítica + advertencia).
function reglaMasGrave(reglasIncumplidas) {
  if (!reglasIncumplidas.length) return null;
  return [...reglasIncumplidas].sort(
    (a, b) => CRITICIDAD[b.nivel_criticidad] - CRITICIDAD[a.nivel_criticidad]
  )[0];
}

// Valida los datos de una regla antes de guardarla.
function validarRegla(r) {
  if (!VARIABLES[r.variable]) return 'variable no reconocida';
  if (!CRITICIDAD[r.nivel_criticidad]) return 'nivel_criticidad debe ser advertencia o critica';
  const min = r.valor_min === undefined || r.valor_min === null || r.valor_min === '' ? null : Number(r.valor_min);
  const max = r.valor_max === undefined || r.valor_max === null || r.valor_max === '' ? null : Number(r.valor_max);
  if (min === null && max === null) return 'Debes definir valor_min, valor_max o ambos';
  if ((min !== null && !Number.isFinite(min)) || (max !== null && !Number.isFinite(max))) return 'Los valores deben ser numéricos';
  if (min !== null && max !== null && min >= max) return 'valor_min debe ser menor que valor_max';
  return null;
}

module.exports = { VARIABLES, validarMedicion, incumpleRegla, reglaMasGrave, validarRegla };
