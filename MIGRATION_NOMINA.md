# Guia de Migracion: Nomina SQLite -> PostgreSQL

> Guia de ejecucion paso a paso para migrar el modulo de Nomina de SQLite a PostgreSQL.
> Para detalles tecnicos, ver `ARCHITECTURE.md` §7.

---

## Pre-requisitos

1. PostgreSQL 14+ corriendo con base de datos `horix_erp`
2. Variable `DATABASE_URL` configurada en `.env`
3. Variable `PG_POOL_MAX=5` configurada en `.env`
4. Acceso a PM2 para detener/iniciar modulos
5. Backup actual de SQLite (generado automaticamente)

---

## Fase 0: Preparacion (1 dia)

### 1. Backup SQLite

```bash
curl -X GET http://localhost:3005/api/backup -o backup_pre_migracion.zip
```

### 2. Verificar backup

```bash
unzip -l backup_pre_migracion.zip
```

Debe contener `backup.json` con las tablas:
- configuracion
- empleados
- nominas
- registros
- tipos
- usuario_empleados
- centros
- dashboard_layout
- adjuntos
- telemetria
- usuarios (no se migra, solo para referencia)

### 3. Guardar backup seguro

```bash
cp backup_pre_migracion.zip /opt/horix-platform/backups/
cp modules/nomina/horas_extra.db /opt/horix-platform/backups/horas_extra.db.pre-migration
```

### 4. Probar rollback

```bash
# Simular rollback (sin ejecutar en produccion)
cat > /tmp/test-rollback.sh << 'EOF'
#!/bin/bash
echo "Test de rollback - no ejecutar en produccion"
echo "Verificando que backup existe..."
ls -la /opt/horix-platform/backups/horas_extra.db.pre-migration
echo "OK - Backup encontrado"
EOF
chmod +x /tmp/test-rollback.sh
/tmp/test-rollback.sh
```

---

## Fase 1: Tablas PostgreSQL (1 dia)

### 1. Ejecutar DDL

```bash
psql -h localhost -U synnox_user -d horix_erp -f modules/nomina/src/db/migrations_pg.sql
```

### 2. Verificar tablas

```bash
psql -h localhost -U synnox_user -d horix_erp -c "\dt nomina_*"
```

Debe mostrar 13 tablas:
- nomina_configuracion
- nomina_empleados
- nomina_nominas
- nomina_registros
- nomina_tipos
- nomina_roles
- nomina_permisos_roles
- nomina_centros
- nomina_telemetria
- nomina_adjuntos
- nomina_usuario_empleados
- nomina_dashboard_layout

### 3. Verificar indices

```bash
psql -h localhost -U synnox_user -d horix_erp -c "\di nomina_*"
```

---

## Fase 2: Refactorizacion DB (2-3 dias)

### 1. Cambiar conexion

Reemplazar `modules/nomina/src/db/index.js`:

```javascript
const { Pool } = require('pg');
const crypto = require('crypto');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: parseInt(process.env.PG_POOL_MAX || '5', 10),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000
});

const uid = () => crypto.randomUUID();

module.exports = {
  query: (text, params) => pool.query(text, params),
  getClient: () => pool.connect(),
  pool,
  uid
};
```

### 2. Actualizar imports

Cambiar `require('./db')` por `require('../../framework/db')` en todos los archivos que usen la base de datos.

### 3. Verificar

```bash
# Iniciar nomina y verificar que no hay errores
pm2 start horix-nomina
pm2 logs horix-nomina --lines 20
```

---

## Fase 3: Rutas Async/Await (3-4 dias)

### Patron de migracion

Para cada archivo en `modules/nomina/src/routes/`:

```javascript
// ANTES (SQLite)
router.get('/', (req, res) => {
  const rows = db.prepare('SELECT * FROM registros').all();
  res.json(rows);
});

// DESPUES (PostgreSQL)
router.get('/', async (req, res) => {
  try {
    const { rows } = await db.query('SELECT * FROM nomina_registros');
    res.json(rows);
  } catch (err) {
    console.error('[registros]', err.message);
    res.status(500).json({ error: err.message });
  }
});
```

### Cambios especificos

| SQLite | PostgreSQL |
|--------|------------|
| `.all()` | `result.rows` |
| `.get()` | `result.rows[0]` |
| `.run()` | `result.rowCount` |
| `db.transaction()` | `BEGIN/COMMIT/ROLLBACK` |
| `INSERT OR REPLACE` | `ON CONFLICT DO UPDATE` |
| `INSERT OR IGNORE` | `ON CONFLICT DO NOTHING` |

### Batch approve con FOR UPDATE

```javascript
router.post('/batch-aprobar', podeAprobar, async (req, res) => {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    
    for (const id of ids) {
      const { rows } = await client.query(
        `SELECT r.id, r.estado, r.creado_por, e.sede 
         FROM nomina_registros r 
         LEFT JOIN nomina_empleados e ON r.empleado_id = e.id 
         WHERE r.id = $1 FOR UPDATE`,
        [id]
      );
      // ... logica de aprobacion
    }
    
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});
```

---

## Fase 3.5: ETL (1 dia)

### 1. Generar backup

```bash
curl -X GET http://localhost:3005/api/backup -o /tmp/nomina_backup.zip
cd /tmp && unzip -o nomina_backup.zip backup.json
```

### 2. Ejecutar migracion

```bash
cd /opt/horix-platform
node modules/nomina/src/scripts/migrate-nomina.js /tmp/backup.json
```

### 3. Verificar salida

El script debe mostrar:

```
==========================================================
  MIGRACION NOMINA: SQLite -> PostgreSQL
==========================================================

[1/4] Cargando backup: /tmp/backup.json
   Fecha: ...
   Empleados: N
   Registros: M

[2/4] Ejecutando migracion...
   Limpiando tablas existentes...
   Migrando configuracion...
   Migrando centros...
   Migrando empleados...
   Migrando nominas...
   Migrando tipos...
   Pre-cargando IDs validos...
   Migrando registros...
   Migrando adjuntos...
   Migrando usuario_empleados...
   Migrando dashboard_layout...
   Migrando telemetria...

   Conteos de insercion:
   configuracion: N
   centros: N
   empleados: N
   nominas: N
   tipos: N
   registros: N
   adjuntos: N
   usuario_empleados: N
   dashboard_layout: N
   telemetria: N

[3/4] Verificando integridad...
   Verificacion exitosa:
   Empleados: N
   Registros: N
   ...

[4/4] Limpiando...

==========================================================
  MIGRACION COMPLETADA EXITOSAMENTE
==========================================================
```

### 4. Si falla

El script mostrara errores y ejecutara `process.exit(1)`. Revisar:
- Tablas faltantes en PostgreSQL
- FK violations
- Datos corruptos en backup.json

---

## Fase 4: Reconciliacion de Usuarios (1 dia)

### 1. Dry run

```bash
node modules/nomina/src/scripts/reconcile-usuarios.js /tmp/backup.json
```

### 2. Revisar reporte

El script mostrara:
- **USUARIOS NUEVOS A CREAR**: Usuarios en backup que no existen en launcher
- **USUARIOS QUE YA EXISTEN**: Usuarios que ya estan en el launcher
- **ACCESO A NOMINA ASIGNADO**: Usuarios existentes que necesitan modulo nomina
- **USUARIOS SIN PERFIL VALIDO**: Usuarios con rol no mapeable
- **USUARIOS OMITIDOS**: Usuarios sin email

### 3. Aplicar

```bash
node modules/nomina/src/scripts/reconcile-usuarios.js /tmp/backup.json --apply
```

### 4. Verificar

```bash
psql -h localhost -U synnox_user -d horix_erp -c "
  SELECT u.email, u.nombre, u.rol, um.modulo_id
  FROM usuarios u
  JOIN user_modulos um ON um.usuario_id = u.id
  WHERE um.modulo_id = 'nomina'
  ORDER BY u.email;
"
```

---

## Fase 5: Validacion Pre-Cutover (1 dia)

### Ejecutar checklist

```bash
psql -h localhost -U synnox_user -d horix_erp << 'EOF'
-- 1. Roles orphanos
SELECT DISTINCT pr.rol 
FROM nomina_permisos_roles pr 
WHERE pr.rol NOT IN (SELECT nombre FROM perfiles);

-- 2. UUIDs invalidos - Empleados
SELECT id FROM nomina_empleados 
WHERE id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

-- 3. UUIDs invalidos - Registros
SELECT id FROM nomina_registros 
WHERE id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

-- 4. usuario_empleados orphanos
SELECT ue.usuario_id 
FROM nomina_usuario_empleados ue 
WHERE ue.usuario_id NOT IN (SELECT id FROM usuarios);

-- 5. adjuntos orphanos
SELECT a.id 
FROM nomina_adjuntos a 
WHERE a.registro_id NOT IN (SELECT id FROM nomina_registros);
EOF
```

**Si hay resultados:** Corregir ANTES del cutover.

---

## Fase 6: Cutover

### 1. Avisar a usuarios (1 hora antes)

```
AVISO: Migracion de Nomina programada para las 6:00pm.
No cargar horas entre 6:00pm y 6:30pm.
```

### 2. Ejecutar cutover

```bash
cd /opt/horix-platform
./migrate-cutover.sh
```

### 3. Verificar

```bash
# Verificar salud
curl -s http://localhost:3005/api/health

# Verificar logs
pm2 logs horix-nomina --lines 20
```

### 4. Notificar

```
MIGRACION COMPLETADA. Pueden continuar con sus actividades.
```

---

## Rollback

Si algo falla durante el cutover:

```bash
cd /opt/horix-platform
./rollback-nomina.sh
```

---

## Troubleshooting

### Error: "relation nomina_registros does not exist"

Las tablas no se crearon. Ejecutar Fase 1.

### Error: "foreign key constraint fails"

Orden de DELETE incorrecto. Verificar que `restoreDataPG` borra en orden inverso.

### Error: "invalid input syntax for type uuid"

IDs en formato incorrecto. Verificar Fase 5 (checklist de UUIDs).

### Error: "duplicate key value violates unique constraint"

Email duplicado en reconciliacion. Verificar que `reconcile-usuarios.js` usa `ON CONFLICT`.

### Migracion falla verificacion

Los counts no coinciden. Verificar:
1. Backup.json tiene todos los datos
2. No hay FK violations durante INSERT
3. El script muestra los errores especificos

---

## Archivos Relacionados

| Archivo | Proposito |
|---------|-----------|
| `ARCHITECTURE.md` §7 | Documentacion tecnica completa |
| `modules/nomina/src/db/migrations_pg.sql` | DDL de tablas |
| `modules/nomina/src/scripts/migrate-nomina.js` | ETL principal |
| `modules/nomina/src/scripts/reconcile-usuarios.js` | Reconciliacion de usuarios |
| `migrate-cutover.sh` | Script de cutover |
| `rollback-nomina.sh` | Script de rollback |

---

*Ultima actualizacion: 08 Jul 2026*
