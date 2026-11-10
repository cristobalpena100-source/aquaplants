const { incumpleRegla, reglaMasGrave } = require('../lib/validacion');

// Motor de reglas: evalúa una medición recién guardada contra las reglas activas de los
// cultivos activos de la instalación del dispositivo. Devuelve las alertas generadas.
//
// Supuesto de diseño: la instalación tiene un cultivo activo a la vez (o varios, y entonces
// se evalúan las reglas de todos).
// Regla de no duplicar (RN-12): si ya hay una alerta pendiente de la misma regla, no se crea otra
// mientras la condición continúe sin que alguien la haya revisado.
async function evaluarMedicion(db, { id_medicion, id_instalacion, tipo_variable, valor }) {
  const { rows: reglas } = await db.query(
    `SELECT r.id_regla, r.variable, r.valor_min, r.valor_max, r.nivel_criticidad, r.id_cultivo
       FROM regla_umbral r
       JOIN cultivo c ON c.id_cultivo = r.id_cultivo
      WHERE c.id_instalacion = $1 AND c.estado = 'activo' AND r.activa AND r.variable = $2`,
    [id_instalacion, tipo_variable]
  );

  // Una sola regla (la más grave) por cultivo.
  const porCultivo = new Map();
  for (const r of reglas.filter((x) => incumpleRegla(valor, x))) {
    if (!porCultivo.has(r.id_cultivo)) porCultivo.set(r.id_cultivo, []);
    porCultivo.get(r.id_cultivo).push(r);
  }

  const generadas = [];
  for (const incumplidas of porCultivo.values()) {
    const regla = reglaMasGrave(incumplidas);
    const { rows: pendientes } = await db.query(
      `SELECT 1 FROM alerta WHERE id_regla = $1 AND estado_revision = 'pendiente' LIMIT 1`,
      [regla.id_regla]
    );
    if (pendientes.length) continue;
    const { rows } = await db.query(
      `INSERT INTO alerta (id_regla, id_medicion, nivel_criticidad)
       VALUES ($1, $2, $3) RETURNING id_alerta, nivel_criticidad, fecha_generada`,
      [regla.id_regla, id_medicion, regla.nivel_criticidad]
    );
    generadas.push({ ...rows[0], id_regla: regla.id_regla, variable: tipo_variable, valor });
  }
  return generadas;
}

module.exports = { evaluarMedicion };
