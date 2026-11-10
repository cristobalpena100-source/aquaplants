const app = require('./app');
const config = require('./config');
const { cerrar } = require('./db');

const servidor = app.listen(config.puerto, () => {
  console.log(`API AquaPlants escuchando en el puerto ${config.puerto}`);
});

function apagar() { servidor.close(() => cerrar().then(() => process.exit(0))); }
process.on('SIGTERM', apagar);
process.on('SIGINT', apagar);
