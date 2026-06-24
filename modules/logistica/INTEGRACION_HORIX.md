# 🔗 Integración Horix Logistics con Launcher

## ¿Cómo se ve desde el Launcher?

Cuando todo esté listo, Logistics aparecerá como un módulo más en el menú de Horix, igual a DocFlow, WordPress, etc.

```
┌─ HORIX LAUNCHER ─────────────────┐
│                                  │
│ 📊 Horix (HR/Overtime)           │
│ 📄 DocFlow (Invoicing)           │
│ 🌐 WordPress (Shop)              │
│ 🚚 Logistics (Routes) ← NUEVO    │
│                                  │
└──────────────────────────────────┘
```

---

## Pasos de integración

### 1. Asegurar que Logistics corre en el mismo servidor

```bash
# En tu servidor (donde corre Horix/DocFlow):
cd /var/www/apps/
git clone <url-repo> horix-logistics
cd horix-logistics
npm install
npm run db:migrate
pm2 start ecosystem.config.cjs
```

### 2. Verificar que corre

```bash
# Debe responder:
curl http://localhost:3004/api/health
# { "status": "ok", "database": "connected" }
```

### 3. Agregar al Launcher

En tu archivo de configuración del Launcher (donde defines DocFlow, WordPress, etc):

**Antes (sin Logistics):**
```javascript
const modules = [
  {
    id: 'horix',
    name: 'Horix',
    url: 'http://localhost:3001',
    icon: 'briefcase',
    color: '#FF6B35'
  },
  {
    id: 'docflow',
    name: 'DocFlow',
    url: 'http://localhost:3002',
    icon: 'file-text',
    color: '#004E89'
  },
  // ... otros módulos
];
```

**Después (con Logistics):**
```javascript
const modules = [
  {
    id: 'horix',
    name: 'Horix',
    url: 'http://localhost:3001',
    icon: 'briefcase',
    color: '#FF6B35'
  },
  {
    id: 'docflow',
    name: 'DocFlow',
    url: 'http://localhost:3002',
    icon: 'file-text',
    color: '#004E89'
  },
  {
    id: 'logistics',
    name: 'Logistics',
    url: 'http://localhost:3004',
    icon: 'route',        // o 'truck', 'map', 'navigation'
    color: '#00A86B'      // verde de entregas
  },
  // ... otros módulos
];
```

---

## Integración MCP (para usar desde Claude)

Cuando tengas el Frontend listo, puedes crear **herramientas MCP** para que Claude pueda optimizar rutas directamente desde chat.

### Paso 1: Agregar MCP Gateway a Logistics

En `backend/routes/mcp.js`:

```javascript
import express from 'express';
import pool from '../config/db.js';
import { generarRutasOptimizadas } from '../utils/vrp.js';

const router = express.Router();

/**
 * MCP Tool: Crear ruta optimizada desde Claude
 * 
 * Ejemplo de uso en Claude:
 * "Optimiza las rutas para mañana, primero el eje cafetero"
 */
router.post('/logistics/crear_ruta', async (req, res) => {
  try {
    const { fecha, sede } = req.body;

    // Obtener pedidos sin asignar
    const resultadoPedidos = await pool.query(`
      SELECT id, latitud, longitud
      FROM logistics.pedidos_logistica
      WHERE estado = 'pendiente' AND ruta_id IS NULL
    `);

    // Obtener vehículos
    const resultadoVehiculos = await pool.query(`
      SELECT * FROM logistics.vehiculos
      WHERE estado = 'disponible'
    `);

    // Generar rutas
    const resultado = await generarRutasOptimizadas(
      resultadoPedidos.rows,
      resultadoVehiculos.rows
    );

    res.json({
      exitosa: true,
      rutasCreadas: resultado.rutas.length,
      mensaje: `Se crearon ${resultado.rutas.length} rutas optimizadas`
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * MCP Tool: Listar rutas de hoy
 */
router.get('/logistics/listar_rutas', async (req, res) => {
  try {
    const { fecha = new Date().toISOString().split('T')[0] } = req.query;

    const resultado = await pool.query(`
      SELECT
        r.id,
        r.nombre,
        v.placa,
        r.cantidad_paradas,
        r.distancia_total_estimada,
        r.estado
      FROM logistics.rutas r
      JOIN logistics.vehiculos v ON r.vehiculo_id = v.id
      WHERE r.fecha = $1
      ORDER BY r.id
    `, [fecha]);

    res.json({
      exitosa: true,
      rutas: resultado.rows
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * MCP Tool: Obtener estadísticas de rutas
 */
router.get('/logistics/estadisticas', async (req, res) => {
  try {
    const resultado = await pool.query(`
      SELECT
        COUNT(*) as total_rutas,
        AVG(distancia_total_estimada) as distancia_promedio,
        AVG(tiempo_estimado) as tiempo_promedio,
        SUM(cantidad_paradas) as total_paradas
      FROM logistics.rutas
      WHERE DATE(fecha) = CURRENT_DATE
    `);

    res.json({
      exitosa: true,
      estadisticas: resultado.rows[0]
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
```

### Paso 2: Registrar en servidor

En `backend/server.js`, agregar:

```javascript
import mcpRoutes from './routes/mcp.js';

app.use('/api/mcp', mcpRoutes);
```

### Paso 3: Agregar a Launcher MCP

En tu configuración del MCP Gateway del Launcher:

```javascript
{
  name: 'horix:logistics_crear_ruta',
  description: 'Crea rutas optimizadas para entregas',
  input: {
    type: 'object',
    properties: {
      fecha: { type: 'string', description: 'Fecha YYYY-MM-DD' },
      sede: { type: 'string', description: 'Medellín, Bogotá, Cartagena' }
    }
  }
},
{
  name: 'horix:logistics_listar_rutas',
  description: 'Lista rutas de un día',
  input: {
    type: 'object',
    properties: {
      fecha: { type: 'string' }
    }
  }
},
{
  name: 'horix:logistics_estadisticas',
  description: 'Obtiene estadísticas de rutas',
  input: { type: 'object', properties: {} }
}
```

---

## Verificación final

### 1. ¿Corre Logistics?
```bash
curl http://localhost:3004/api/health
# Debe devolver: { "status": "ok", "database": "connected" }
```

### 2. ¿Está en el Launcher?
- Abre el Launcher → debe aparecer "Logistics" en el menú

### 3. ¿Puedes acceder?
- Click en Logistics → debe cargar `http://localhost:3004`

### 4. ¿Funciona la API?
```bash
curl http://localhost:3004/api/vehiculos
# Debe devolver: { "exitosa": true, "total": 0, "vehiculos": [] }
```

---

## Próximos pasos (Frontend)

Una vez que todo corre, necesitas un **Dashboard React** que:

1. **Importe datos:**
   - Formulario drag-drop para PDF de SIESA
   - Formulario drag-drop para Excel de Widetech

2. **Muestre rutas:**
   - Tabla de rutas diarias
   - Mapa Mapbox con paradas
   - Estado de cada entrega

3. **Permita optimizar:**
   - Botón "Generar rutas para hoy"
   - Selector de fecha
   - Preview de rutas antes de guardar

4. **Reportes:**
   - Eficiencia por conductor
   - Distancia real vs estimada
   - Entregas completadas vs fallidas

---

## Comandos útiles

```bash
# Ver si está corriendo
pm2 status

# Ver logs en vivo
pm2 logs logistics

# Reiniciar
pm2 restart logistics

# Detener
pm2 stop logistics

# Ver monitoreo
pm2 monit
```

---

## Notas de arquitectura

- **Puerto 3004:** Logistics API (no conflictúa con Horix 3001 ni DocFlow 3002)
- **BD compartida:** PostgreSQL en 5432 (o el puerto que uses)
- **Auth:** Por ahora nada (agregar JWT después)
- **CORS:** Habilitado para Launcher

---

## Solución de problemas

### "No puedo acceder a Logistics desde el Launcher"

1. Verificar que corre: `pm2 status`
2. Verificar puerto: `curl http://localhost:3004`
3. Verificar CORS en Launcher
4. Revisar logs: `pm2 logs logistics`

### "Los datos no se guardan"

1. Verificar conexión a BD: `curl http://localhost:3004/api/health`
2. Revisar logs: `pm2 logs logistics`
3. Verificar migraciones: `npm run db:migrate`

### "OSRM no calcula distancias"

1. Verificar OSRM: `curl https://router.project-osrm.org/route/v1/driving/...`
2. Si usas local Docker: `docker-compose up -d osrm`
3. Cambiar URL en `.env`: `OSRM_URL=http://localhost:5000`

---

**¡Integración lista!** 🎉

Una vez que termines el Frontend, Logistics será un módulo completo dentro de Horix.

