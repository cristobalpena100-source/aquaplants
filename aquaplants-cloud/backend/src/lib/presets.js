// Presets de riego tomados del firmware AquaBrain (main.cpp). Tiempos en segundos.
// TR = tiempo de riego, TD = tiempo de descanso.
const PRESETS = {
  RUCULA:  { tr_dia_s: 100, td_dia_s: 210, tr_noche_s: 100, td_noche_s: 100 },
  LECHUGA: { tr_dia_s: 105, td_dia_s: 360, tr_noche_s: 105, td_noche_s: 360 },
  PAPA:    { tr_dia_s: 900, td_dia_s: 900, tr_noche_s: 900, td_noche_s: 3600 }
};

// Valores por defecto del modo manual (igual que el firmware).
const MANUAL_POR_DEFECTO = { tr_dia_s: 100, td_dia_s: 210, tr_noche_s: 100, td_noche_s: 100 };

// Umbrales de nivel de agua del firmware, en %: UMBRAL_BAJO = 10, UMBRAL_VACIO = 5.
const UMBRALES_AGUA = { bajo: 10, vacio: 5 };

const CAMPOS_TIEMPO = ['tr_dia_s', 'td_dia_s', 'tr_noche_s', 'td_noche_s'];

function tiemposDePreset(preset, manual) {
  if (preset === 'MANUAL') {
    const base = { ...MANUAL_POR_DEFECTO, ...(manual || {}) };
    for (const campo of CAMPOS_TIEMPO) {
      const v = Number(base[campo]);
      if (!Number.isInteger(v) || v <= 0 || v > 86400) {
        return { error: `${campo} debe ser un entero entre 1 y 86400 segundos` };
      }
      base[campo] = v;
    }
    return { tiempos: base };
  }
  if (!PRESETS[preset]) return { error: 'Preset no válido (RUCULA, LECHUGA, PAPA o MANUAL)' };
  return { tiempos: { ...PRESETS[preset] } };
}

module.exports = { PRESETS, MANUAL_POR_DEFECTO, UMBRALES_AGUA, CAMPOS_TIEMPO, tiemposDePreset };
