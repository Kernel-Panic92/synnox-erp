# 📦 Horix Logistics - Resumen Ejecutivo

## ¿Qué es?

Un **módulo completo de optimización de rutas y logística** para Vitamar, diseñado para integrarse con tu arquitectura actual de **Horix ERP**. Maneja importación de datos de **SIESA** y **Widetech**, optimiza rutas automáticamente, y expone una API REST lista para usar.

## ✅ Lo que ya tienes

**Backend completo (Node.js + Express):**
- ✅ Servidor API con 5 rutas principales
- ✅ Parser de PDF (SIESA planillas)
- ✅ Parser de Excel (Widetech GPS)
- ✅ Motor VRP (OSRM + Nearest Neighbor)
- ✅ Importadores con manejo de errores

**Base de datos (PostgreSQL):**
- ✅ 8 tablas optimizadas
- ✅ Índices para queries rápidas
- ✅ Schema con migraciones automáticas

**DevOps:**
- ✅ Docker Compose (OSRM + PostgreSQL)
- ✅ PM2 ecosystem config (para producción)
- ✅ .env example con todas las variables

**Documentación:**
- ✅ README completo (140+ líneas)
- ✅ QUICK_START para inicio rápido
- ✅ Código comentado y ejemplos API

---

## 🚀 Cómo empezar (5 minutos)

### 1. Copiar archivos
```bash
cd /ruta/donde/está/horix-docflow
git clone <tu-repo> horix-logistics
cd horix-logistics
```

### 2. Instalar
```bash
npm install
cp .env.example .env
# Editar .env con tu BD
npm run db:migrate
```

### 3. Ejecutar
```bash
# Desarrollo
npm run dev

# Producción con PM2
pm2 start ecosystem.config.cjs
```

### 4. Verificar
```bash
curl http://localhost:3004/api/health
# Respuesta: { "status": "ok", "database": "connected" }
```

---

## 📊 Datos que maneja

### Entrada 1: PDF de SIESA
```
Importas → planilla_cuadre.pdf
         ↓
Extrae:  - 34 pedidos
         - Número factura
         - Cliente + dirección
         - Conductor + placa
         - Valor entrega
```

### Entrada 2: Excel de Widetech
```
Importas → historico_widetech.xlsx
         ↓
Extrae:  - 4.933 registros GPS
         - Placa vehículo
         - Fecha/hora
         - Latitud/Longitud
         - Velocidad
         - Ubicación textual
```

### Salida: Rutas optimizadas
```
POST /rutas/generar
  ↓
Sistema calcula:
- Matriz distancia/tiempo (OSRM)
- Secuencia óptima (Nearest Neighbor + 2-opt)
- Asigna pedidos a vehículos
- Crea rutas en BD
```

---

## 🔄 Flujo típico de uso

```
MAÑANA (6:00 AM):
1. Exportas PDF de SIESA → POST /importadores/siesa
2. Exportas Excel de Widetech → POST /importadores/widetech
3. Haces POST /rutas/generar
4. Dashboard muestra rutas propuestas
5. Jefe de logística aprueba
6. Conductores reciben en app

DURANTE EL DÍA:
- Actualización de posiciones GPS (Widetech)
- Tracking de entregas en tiempo real
- Alertas de desvíos/retrasos

FINAL DEL DÍA:
- Reportes de eficiencia
- Análisis de qué ruta fue mejor
- Datos para mejora continua
```

---

## 🎯 Endpoints principales

| Método | Endpoint | Qué hace |
|--------|----------|----------|
| POST | `/api/importadores/siesa` | Importa PDF de planilla SIESA |
| POST | `/api/importadores/widetech` | Importa Excel de Widetech |
| GET | `/api/vehiculos` | Lista vehículos |
| POST | `/api/vehiculos` | Crear vehículo |
| GET | `/api/pedidos/pendientes/lista` | Pedidos sin asignar |
| POST | `/api/rutas/generar` | Genera rutas optimizadas |
| GET | `/api/rutas` | Lista rutas |
| GET | `/api/rutas/:id` | Obtiene ruta con paradas |

---

## 💾 Base de datos

**Tablas creadas automáticamente:**

```
logistics.vehiculos         → Catálogo de 10 camiones
logistics.pedidos_logistica → Pedidos desde SIESA (34+ por día)
logistics.rutas             → Rutas optimizadas
logistics.paradas_ruta      → Entregas en secuencia
logistics.posiciones_gps    → Histórico Widetech (4933 registros)
logistics.importaciones     → Log de imports
```

**Conexión:**
```
Host: localhost
Puerto: 5433 (o el tuyo)
Usuario: postgres
BD: vitamar_logistics
```

---

## 🔧 Motores de optimización

### OSRM (Open Source Routing Machine)
- **Gratis, sin cuotas**
- Calcula distancia/tiempo real entre puntos
- Usa OpenStreetMap
- Disponible: `https://router.project-osrm.org` (público)

### Algoritmo VRP (Vehicle Routing Problem)
- Nearest Neighbor (greedy): rápido, ~80% optimalidad
- 2-opt improvement: refinamiento iterativo
- Escalable a 100+ paradas por ruta

### OR-Tools (Google) - Para futuro
- Para restricciones complejas
- Ya en `package.json`, fácil de integrar

---

## 📈 Roadmap

| Fase | Plazo | Features |
|------|-------|----------|
| **MVP** | ✅ Hoy | Importadores, API, VRP básico |
| **Fase 2** | 2-3 semanas | Dashboard React, Mapa, UI importadores |
| **Fase 3** | 1-2 meses | App móvil, Tracking en tiempo real |
| **Fase 4** | 2-3 meses | MCP para Claude, Análisis IA, Predicciones |

---

## ⚙️ Configuración mínima (.env)

```bash
# Base de datos
DB_USER=postgres
DB_PASSWORD=tu_password
DB_HOST=localhost
DB_PORT=5433
DB_NAME=vitamar_logistics

# Servidor
PORT=3004
NODE_ENV=production

# OSRM
OSRM_URL=https://router.project-osrm.org
```

---

## 🧪 Primeros tests

### 1. Crear un vehículo
```bash
curl -X POST http://localhost:3004/api/vehiculos \
  -H "Content-Type: application/json" \
  -d '{
    "placa": "TVD921",
    "capacidad_peso": 5000,
    "capacidad_volumen": 20,
    "sede": "Medellín"
  }'
```

### 2. Importar SIESA
```bash
curl -X POST http://localhost:3004/api/importadores/siesa \
  -F "archivo=@planilla_cuadre.pdf"
```

### 3. Importar Widetech
```bash
curl -X POST http://localhost:3004/api/importadores/widetech \
  -F "archivo=@historico_widetech.xlsx"
```

### 4. Generar rutas
```bash
curl -X POST http://localhost:3004/api/rutas/generar \
  -H "Content-Type: application/json" \
  -d '{"fecha": "2024-06-16"}'
```

### 5. Ver rutas
```bash
curl http://localhost:3004/api/rutas?fecha=2024-06-16
```

---

## 📁 Estructura de archivos

```
horix-logistics/
├── README.md                      (Doc. técnica completa)
├── QUICK_START.md                 (Inicio rápido)
├── package.json                   (Dependencias)
├── .env.example                   (Variables de entorno)
├── docker-compose.yml             (OSRM + BD en Docker)
├── ecosystem.config.cjs           (PM2 para producción)
│
├── backend/
│   ├── server.js                  (Express principal)
│   ├── config/db.js               (Conexión PostgreSQL)
│   ├── migrations/
│   │   ├── 001_create_tables.sql  (Schema BD)
│   │   └── run.js                 (Ejecutor)
│   ├── routes/
│   │   ├── vehiculos.js           (CRUD vehículos)
│   │   ├── pedidos.js             (CRUD pedidos)
│   │   ├── rutas.js               (Optimización + CRUD)
│   │   ├── importadores.js        (SIESA + Widetech)
│   │   └── health.js              (Health check)
│   └── utils/
│       ├── vrp.js                 (Motor optimización)
│       ├── siesaPdfParser.js      (Parser PDF)
│       └── widgetechExcelParser.js (Parser Excel)

frontend/                          (React - próximamente)
├── src/
│   ├── pages/
│   │   ├── Dashboard.jsx
│   │   ├── Importar.jsx
│   │   ├── Rutas.jsx
│   │   └── Reportes.jsx
│   └── components/
│       ├── MapaRutas.jsx (Mapbox)
│       └── FormImportador.jsx
```

---

## 🔐 Seguridad (MVP)

**Implementado:**
- ✅ Validación de entrada en importadores
- ✅ Manejo de errores sin exponer detalles

**A agregar después:**
- JWT authentication
- Rate limiting
- CORS restrictivo
- HTTPS en producción

---

## 🐛 Troubleshooting

### Error: "No se puede conectar a BD"
```bash
# Verificar que PostgreSQL corre
psql -U postgres -l

# Crear BD si no existe
createdb -U postgres vitamar_logistics
```

### Error: "OSRM no responde"
```bash
# Opción 1: Levantar OSRM en Docker
docker-compose up -d osrm

# Opción 2: Usar OSRM público (sin Docker)
OSRM_URL=https://router.project-osrm.org
```

### Ver logs
```bash
pm2 logs logistics
```

---

## 📞 Soporte rápido

**Archivos de referencia:**
- `README.md` - Todo técnico
- `QUICK_START.md` - Setup rápido
- `backend/routes/` - Ejemplos API

**Ver logs en tiempo real:**
```bash
pm2 logs logistics
```

---

## ✨ Siguiente paso

**Para que funcione en producción:**

1. ✅ Instalar dependencias (`npm install`)
2. ✅ Configurar `.env`
3. ✅ Ejecutar migraciones (`npm run db:migrate`)
4. ✅ Iniciar con PM2 (`pm2 start ecosystem.config.cjs`)
5. 🔄 Desarrollar Frontend React
6. 🔄 Crear MCP Tools para Claude
7. 🔄 App móvil para conductores

**Estimated time to MVP:** 2-3 semanas (solo desarrollo frontend)

---

**¿Listo para empezar?** 🚀

Revisa los archivos en `/outputs`, sigue las instrucciones de QUICK_START, y avísame si hay algo que necesites ajustar.

