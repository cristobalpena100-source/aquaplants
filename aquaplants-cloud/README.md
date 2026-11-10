# AquaPlants · Plataforma en la nube (ES3)

API REST + panel web + base de datos PostgreSQL para el sistema AquaBrain (ESP32 de riego). Recibe las mediciones del dispositivo, evalúa los umbrales (los del firmware: nivel de agua ≤ 10 % advertencia, ≤ 5 % crítica), genera alertas y permite cambiar el programa de riego (Rúcula, Lechuga, Papa, Manual) desde cualquier lugar.

## Arquitectura
```
ESP32 / Android / simulador --HTTPS + clave de dispositivo--> API Express (Render) --> PostgreSQL (Neon)
Navegador (panel /) ---------HTTPS + JWT (3 roles)---------->
```
- `backend/` API (Node 22, Express), `db/schema.sql` modelo de datos (DER corregido: sin tabla Sensor; variables dentro de `dispositivo`; sin tabla usuario-instalación).
- `backend/public/` panel web (login, estado actual, alertas, programa de riego, histórico).
- `simulador/` simula el AquaBrain para probar sin hardware.
- Seguridad: bcrypt, JWT con expiración, matriz de permisos por rol (Tabla 7), clave por dispositivo (solo se guarda el hash), bloqueo tras 5 intentos fallidos, rate limiting, helmet/CSP, HTTPS forzado en producción, consultas parametrizadas, auditoría de cambios de administración.

## Ejecutar en local (opción A: Docker)
```bash
docker compose up --build        # API en http://localhost:3000
```
## Ejecutar en local (opción B: Node + PostgreSQL propio)
```bash
cd backend && cp .env.example .env     # editar DATABASE_URL y JWT_SECRET
npm install && npm run migrar && npm run seed && npm start
```
Usuarios de prueba (clave `SEED_PASSWORD`, por defecto `Cambiar123!`): `admin@`, `supervisor@`, `encargado@aquaplants.cl`. Dispositivo: `AQUABRAIN-001` con `SEED_DEVICE_KEY`. **Cambiarlas fuera de pruebas.**

## Publicar en la nube (gratis): Neon + Render
1. **Subir a GitHub**: crear un repositorio y subir esta carpeta (el `.gitignore` ya excluye `.env`).
2. **Base de datos (Neon)**: crear cuenta en neon.tech → New project → copiar la *connection string* (`postgres://...?sslmode=require`).
3. **API (Render)**: New → Blueprint → elegir el repositorio (usa `render.yaml`) → pegar `DATABASE_URL` de Neon. Render genera `JWT_SECRET`. Al arrancar, el contenedor crea las tablas solo (`migrar.js` es idempotente).
4. **Datos iniciales**: una vez, desde tu PC: `cd backend && DATABASE_URL="<cadena de Neon>" DATABASE_SSL=true SEED_PASSWORD="<clave fuerte>" SEED_DEVICE_KEY="<clave larga>" npm run seed`.
5. Abrir `https://<tu-servicio>.onrender.com/` (panel) y `/salud` (debe responder `{"estado":"ok"}`).
6. **Probar con el simulador**:
   `API_URL=https://<tu-servicio>.onrender.com DISPOSITIVO_CLAVE=<clave> node simulador/simulador.js vaciado`
   y ver aparecer la alerta en el panel.

Notas del plan gratuito: Render duerme el servicio tras 15 min sin tráfico (la primera petición tarda ~1 min); Neon no caduca. Para presentar, abrir `/salud` unos minutos antes.

## API principal
| Método y ruta | Quién | Para qué |
|---|---|---|
| `POST /api/auth/login` | todos | obtener JWT |
| `POST /api/mediciones` (cabeceras `x-dispositivo-id`, `x-dispositivo-clave`) | dispositivo | enviar una medición o un lote `{mediciones:[…]}` (≤500; `sincronizada:true` + `timestamp` de origen para datos acumulados sin conexión) |
| `GET /api/mediciones/ultimas`, `GET /api/mediciones?variable=` | usuarios | estado e histórico |
| `GET /api/mediciones/exportar.csv` | supervisor, admin | reporte |
| `GET /api/alertas`, `PATCH /api/alertas/:id/revisar` | encargado (su instalación), admin | alertas |
| `PATCH /api/cultivos/:id/preset` | encargado, admin | cambiar programa de riego |
| `/api/instalaciones`, `/cultivos`, `/dispositivos`, `/reglas`, `/usuarios` | admin (supervisor lectura en dispositivos/reglas) | administración |

## Pruebas
```bash
cd backend && TEST_DATABASE_URL=postgres://usuario:clave@localhost:5432/aquaplants_test npm test
```
(¡usa una base **exclusiva** de pruebas: el test la reinicia!). Resultado registrado: 2 suites, 54 pruebas, todas aprobadas (validación, umbrales, presets, hash, login/bloqueo, ingesta, alertas, permisos por rol, auditoría, 50 solicitudes concurrentes con mediana < 500 ms).

### Esperado vs. obtenido (extracto para el informe)
| Caso | Esperado | Obtenido |
|---|---|---|
| Nivel de agua 60 % | sin alerta | sin alerta |
| Nivel 8 % | alerta advertencia < 2 s | alerta advertencia, < 2 s |
| Nivel 4 % | una alerta crítica | una alerta crítica |
| Condición sostenida | no duplicar alerta pendiente | no duplica |
| Medición 500 % | 400, nada guardado | 400, nada guardado |
| Dispositivo con clave errónea | 401 | 401 |
| Encargado de otra instalación revisa alerta | 403 | 403 |
| Supervisor cambia preset | 403 | 403 |
| Datos acumulados offline | se guardan con hora de origen, sin alertas retroactivas | cumple |

## Decisiones y diferencias con el diseño (ES2)
- Las columnas de tiempos de riego usan los nombres del firmware (`tr_dia_s`, `td_dia_s`, …) en vez de `tiempo_riego`.
- Se añadió `nivel_criticidad` en `regla_umbral` y una tabla `auditoria` (no estaban en el DER).
- La alerta se evalúa de forma síncrona antes de responder el ACK; recomendación futura: desacoplar con una cola si crece el volumen.
- Las mediciones sincronizadas tardíamente no generan alertas (ya son historia).

## Qué falta (siguientes pasos)
- **Conexión real del ESP32/Android**: hoy el firmware solo habla BLE. Opciones: (a) que la app Android reciba por BLE y haga `POST /api/mediciones` (el teléfono actúa de pasarela; encaja con la característica WIFI_OK del firmware), o (b) agregar WiFi + HTTPS al firmware.
- Frontend React (el panel actual es mínimo y sin dependencias).
- Notificaciones push/correo de alertas; comando remoto de riego hacia el dispositivo.
