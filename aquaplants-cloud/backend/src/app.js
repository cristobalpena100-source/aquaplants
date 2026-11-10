const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const config = require('./config');
const { consulta } = require('./db');

const app = express();
// Render y otros proveedores ponen un proxy delante: necesario para leer bien la IP y usar HTTPS.
app.set('trust proxy', 1);

app.use(helmet({ contentSecurityPolicy: { directives: {
  defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'"], imgSrc: ["'self'", 'data:'], connectSrc: ["'self'"],
  // En desarrollo local (http) no se fuerza la mejora a https.
  upgradeInsecureRequests: config.esProduccion ? [] : null
} } }));
app.use(cors({ origin: config.corsOrigen.length ? config.corsOrigen : false }));
app.use(express.json({ limit: '1mb' }));
app.use(rateLimit({ windowMs: 60 * 1000, limit: 600, standardHeaders: true, legacyHeaders: false }));

// En producción, exige HTTPS (Render lo entrega; este control rechaza HTTP plano).
if (config.esProduccion) {
  app.use((req, res, next) => (req.secure ? next() : res.status(426).json({ error: 'Usa HTTPS' })));
}

// Salud: Render la usa para saber que el servicio está vivo.
app.get('/salud', async (req, res) => {
  try { await consulta('SELECT 1'); res.json({ estado: 'ok' }); }
  catch (e) { res.status(503).json({ estado: 'sin_base_de_datos' }); }
});

app.use('/api/auth', require('./routes/auth'));
app.use('/api/mediciones', require('./routes/mediciones'));
app.use('/api/alertas', require('./routes/alertas'));
app.use('/api', require('./routes/admin'));

// Dashboard web mínimo (estático)
app.use(express.static(path.join(__dirname, '..', 'public')));

app.use('/api', (req, res) => res.status(404).json({ error: 'Ruta no encontrada' }));

// Manejo central de errores: nunca se filtra el detalle interno al cliente.
app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'JSON mal formado' });
  console.error(err);
  res.status(500).json({ error: 'Error interno del servidor' });
});

module.exports = app;
