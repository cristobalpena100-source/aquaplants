-- Esquema de AquaPlants / AquaBrain (DER corregido de ES2)
-- Sin tabla Sensor: las variables que mide cada placa viven en dispositivo.variables_habilitadas.
-- Sin tabla intermedia usuario-instalacion: usuario.id_instalacion (nulo = acceso a todas).

CREATE TABLE IF NOT EXISTS rol (
  id_rol   SERIAL PRIMARY KEY,
  nombre   TEXT NOT NULL UNIQUE CHECK (nombre IN ('encargado', 'supervisor', 'administrador'))
);

CREATE TABLE IF NOT EXISTS instalacion (
  id_instalacion  SERIAL PRIMARY KEY,
  nombre          TEXT NOT NULL,
  ubicacion       TEXT,
  estado          TEXT NOT NULL DEFAULT 'activa' CHECK (estado IN ('activa', 'inactiva')),
  fecha_registro  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS usuario (
  id_usuario      SERIAL PRIMARY KEY,
  nombre          TEXT NOT NULL,
  correo          TEXT NOT NULL UNIQUE,
  hash_password   TEXT NOT NULL,
  id_rol          INTEGER NOT NULL REFERENCES rol(id_rol),
  id_instalacion  INTEGER REFERENCES instalacion(id_instalacion),
  activo          BOOLEAN NOT NULL DEFAULT TRUE,
  creado_en       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Tiempos en segundos, igual que el firmware: TR = tiempo de riego, TD = tiempo de descanso.
CREATE TABLE IF NOT EXISTS cultivo (
  id_cultivo      SERIAL PRIMARY KEY,
  id_instalacion  INTEGER NOT NULL REFERENCES instalacion(id_instalacion),
  nombre          TEXT NOT NULL,
  preset          TEXT NOT NULL DEFAULT 'RUCULA' CHECK (preset IN ('RUCULA', 'LECHUGA', 'PAPA', 'MANUAL')),
  tr_dia_s        INTEGER NOT NULL CHECK (tr_dia_s > 0),
  td_dia_s        INTEGER NOT NULL CHECK (td_dia_s > 0),
  tr_noche_s      INTEGER NOT NULL CHECK (tr_noche_s > 0),
  td_noche_s      INTEGER NOT NULL CHECK (td_noche_s > 0),
  fecha_inicio    DATE NOT NULL DEFAULT CURRENT_DATE,
  estado          TEXT NOT NULL DEFAULT 'activo' CHECK (estado IN ('activo', 'finalizado')),
  actualizado_en  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS dispositivo (
  id_dispositivo        SERIAL PRIMARY KEY,
  id_instalacion        INTEGER NOT NULL REFERENCES instalacion(id_instalacion),
  identificador_hw      TEXT NOT NULL UNIQUE,
  variables_habilitadas TEXT[] NOT NULL DEFAULT ARRAY['temperatura', 'humedad', 'nivel_agua'],
  clave_hash            TEXT NOT NULL,
  estado                TEXT NOT NULL DEFAULT 'activo' CHECK (estado IN ('activo', 'inactivo')),
  ultima_comunicacion   TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS medicion (
  id_medicion     BIGSERIAL PRIMARY KEY,
  id_dispositivo  INTEGER NOT NULL REFERENCES dispositivo(id_dispositivo),
  tipo_variable   TEXT NOT NULL CHECK (tipo_variable IN ('temperatura', 'humedad', 'nivel_agua')),
  valor           NUMERIC(8,2) NOT NULL,
  unidad          TEXT NOT NULL,
  "timestamp"     TIMESTAMPTZ NOT NULL,           -- hora de origen, medida por el dispositivo
  sincronizada    BOOLEAN NOT NULL DEFAULT FALSE, -- TRUE si se midió sin conexión y se envió después
  recibido_en     TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Índice para las consultas más frecuentes: histórico por dispositivo, variable y rango de fechas.
CREATE INDEX IF NOT EXISTS idx_medicion_hist ON medicion (id_dispositivo, tipo_variable, "timestamp" DESC);

CREATE TABLE IF NOT EXISTS regla_umbral (
  id_regla          SERIAL PRIMARY KEY,
  id_cultivo        INTEGER NOT NULL REFERENCES cultivo(id_cultivo),
  variable          TEXT NOT NULL CHECK (variable IN ('temperatura', 'humedad', 'nivel_agua')),
  valor_min         NUMERIC(8,2),
  valor_max         NUMERIC(8,2),
  nivel_criticidad  TEXT NOT NULL CHECK (nivel_criticidad IN ('advertencia', 'critica')),
  activa            BOOLEAN NOT NULL DEFAULT TRUE,
  CHECK (valor_min IS NOT NULL OR valor_max IS NOT NULL),
  CHECK (valor_min IS NULL OR valor_max IS NULL OR valor_min < valor_max)
);
CREATE INDEX IF NOT EXISTS idx_regla_cultivo ON regla_umbral (id_cultivo, variable) WHERE activa;

CREATE TABLE IF NOT EXISTS alerta (
  id_alerta         BIGSERIAL PRIMARY KEY,
  id_regla          INTEGER NOT NULL REFERENCES regla_umbral(id_regla),
  id_medicion       BIGINT NOT NULL REFERENCES medicion(id_medicion),
  nivel_criticidad  TEXT NOT NULL CHECK (nivel_criticidad IN ('advertencia', 'critica')),
  fecha_generada    TIMESTAMPTZ NOT NULL DEFAULT now(),
  estado_revision   TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado_revision IN ('pendiente', 'revisada'))
);
CREATE INDEX IF NOT EXISTS idx_alerta_pendiente ON alerta (id_regla) WHERE estado_revision = 'pendiente';

CREATE TABLE IF NOT EXISTS evento (
  id_evento       BIGSERIAL PRIMARY KEY,
  id_dispositivo  INTEGER NOT NULL REFERENCES dispositivo(id_dispositivo),
  tipo            TEXT NOT NULL,
  detalle         TEXT,
  "timestamp"     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Registro de auditoría de cambios de usuarios y roles (mitigación de escalamiento de privilegios).
CREATE TABLE IF NOT EXISTS auditoria (
  id_auditoria  BIGSERIAL PRIMARY KEY,
  id_usuario    INTEGER REFERENCES usuario(id_usuario),
  accion        TEXT NOT NULL,
  detalle       JSONB,
  fecha         TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO rol (nombre) VALUES ('encargado'), ('supervisor'), ('administrador')
ON CONFLICT (nombre) DO NOTHING;
