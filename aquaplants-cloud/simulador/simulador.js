// Simulador del AquaBrain (ESP32): envía mediciones a la API como lo haría el dispositivo.
// Uso: API_URL=https://tu-api.onrender.com DISPOSITIVO_ID=AQUABRAIN-001 DISPOSITIVO_CLAVE=... node simulador.js [escenario]
// Escenarios: normal (por defecto) | vaciado (el nivel baja hasta 0 %) | offline (lote con sincronizada=true)
const API = process.env.API_URL || 'http://localhost:3000';
const ID = process.env.DISPOSITIVO_ID || 'AQUABRAIN-001';
const CLAVE = process.env.DISPOSITIVO_CLAVE || 'clave-demo-aquabrain-001-cambiar';
const INTERVALO = Number(process.env.INTERVALO_S || 5) * 1000;
const escenario = process.argv[2] || 'normal';

const enviar = async (cuerpo) => {
  const r = await fetch(`${API}/api/mediciones`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-dispositivo-id': ID, 'x-dispositivo-clave': CLAVE },
    body: JSON.stringify(cuerpo)
  });
  return { estado: r.status, cuerpo: await r.json() };
};
const ruido = (base, amp) => Math.round((base + (Math.random() - 0.5) * amp) * 10) / 10;

(async () => {
  if (escenario === 'offline') {
    const ahora = Date.now();
    const lote = Array.from({ length: 12 }, (_, i) => ({
      tipo_variable: 'temperatura', valor: ruido(22, 3),
      timestamp: new Date(ahora - (12 - i) * 60000).toISOString(), sincronizada: true
    }));
    console.log('Enviando lote acumulado sin conexión:', await enviar({ mediciones: lote }));
    return;
  }
  let nivel = escenario === 'vaciado' ? 40 : 80;
  setInterval(async () => {
    if (escenario === 'vaciado') nivel = Math.max(0, nivel - 4); else nivel = Math.max(50, nivel - Math.random());
    const r = await enviar({ mediciones: [
      { tipo_variable: 'temperatura', valor: ruido(23, 4) },
      { tipo_variable: 'humedad', valor: ruido(60, 10) },
      { tipo_variable: 'nivel_agua', valor: Math.round(nivel * 10) / 10 }
    ] }).catch((e) => ({ estado: 'sin conexión', cuerpo: e.message }));
    console.log(new Date().toLocaleTimeString(), `nivel=${nivel.toFixed(1)} %`, r.estado, JSON.stringify(r.cuerpo.alertas_generadas || r.cuerpo.error || ''));
  }, INTERVALO);
})();
