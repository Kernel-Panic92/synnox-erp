# 🚀 Guía de Inicio Rápido - Horix Logistics

## ¿Qué tienes?

He creado un **módulo completo de logística** para Vitamar que:

✅ Importa PDFs de SIESA (planillas de cuadre)  
✅ Importa Excel de Widetech (posiciones GPS)  
✅ Optimiza rutas automáticamente  
✅ Corre bajo PM2 (como Horix/DocFlow)  
✅ Usa PostgreSQL dedicado  
✅ API REST lista para usar  

## 📦 Archivos entregados

```
horix-logistics/
├── 📄 README.md                    (Documentación completa)
├── 📦 package.json                 (Dependencias npm)
├── ⚙️  .env.example                (Variables de entorno)
├── 🐳 docker-compose.yml           (OSRM + BD en Docker)
├── 🚀 ecosystem.config.cjs         (Configuración PM2)
│
├── backend/
│   ├── server.js                   (Servidor Express)
│   ├── config/db.js                (Conexión PostgreSQL)
│   ├── migrations/
│   │   ├── 001_create_tables.sql   (Schema de BD)
│   │   └── run.js                  (Ejecutor de migraciones)
│   ├── routes/
│   │   ├── vehiculos.js            (CRUD vehículos)
│   │   ├── pedidos.js              (CRUD pedidos)
│   │   ├── rutas.js                (Generar rutas optimizadas)
│   │   ├── importadores.js         (Importar SIESA + Widetech)
│   │   └── health.js               (Health check)
│   └── utils/
│       ├── vrp.js                  (Motor VRP + OSRM)
│       ├── siesaPdfParser.js       (Parsear PDFs)
│       └── widgetechExcelParser.js (Parsear Excels)
```

## ⚡ Instalación (5 minutos)

### 1. Copiar estructura al servidor

```bash
# En el servidor donde corre Horix/DocFlow
cd /ruta/a/proyectos
git clone <tu-repo> horix-logistics
cd horix-logistics
```

### 2. Instalar dependencias

```bash
npm install
```

### 3. Configurar variables de entorno

```bash
cp .env.example .env
# Editar .env:
nano .env
```

**Valores mínimos necesarios:**

```
DB_USER=postgres
DB_PASSWORD=tu_password_postgre
DB_HOST=localhost
DB_PORT=5433  # O el puerto donde corre tu PostgreSQL
DB_NAME=vitamar_logistics
PORT=3004
OSRM_URL=https://router.project-osrm.org
```

### 4. Crear BD y migraciones

```bash
npm run db:migrate
```

### 5. Iniciar con PM2

```bash
pm2 start ecosystem.config.cjs

# Verificar
pm2 status
pm2 logs logistics
```

## 🔗 Próximo paso: Integración con Horix

Para que aparezca en el Launcher de Horix, necesitas:

1. **Agregar ruta en Launcher:**
   ```javascript
   {
     name: 'Logistics',
     path: 'http://localhost:3004',
     icon: 'route',
     color: '#00a86b'
   }
   ```

2. **Crear MCP Tools (para usar desde Claude):**
   - `logistics:crear_ruta`
   - `logistics:listar_rutas`
   - `logistics:importar_pedidos`

## 📡 Primeros tests

### Verificar que corre

```bash
curl http://localhost:3004/api/health
# Respuesta: { "status": "ok", "database": "connected" }
```

### Crear un vehículo

```bash
curl -X POST http://localhost:3004/api/vehiculos \
  -H "Content-Type: application/json" \
  -d '{
    "placa": "TVD921",
    "capacidad_peso": 5000,
    "capacidad_volumen": 20
  }'
```

### Importar datos de SIESA

```bash
curl -X POST http://localhost:3004/api/importadores/siesa \
  -F "archivo=@planilla_cuadre.pdf"
```

### Importar datos de Widetech

```bash
curl -X POST http://localhost:3004/api/importadores/widetech \
  -F "archivo=@historico_widetech.xlsx"
```

### Generar rutas optimizadas

```bash
curl -X POST http://localhost:3004/api/rutas/generar \
  -H "Content-Type: application/json" \
  -d '{
    "fecha": "2024-06-16"
  }'
```

## 🗺️ Cómo funciona la optimización

1. **Importas PDF de SIESA** → Se extraen 34 pedidos
2. **Importas Excel de Widetech** → Se registran posiciones GPS
3. **Haces POST a `/rutas/generar`** → El sistema:
   - Obtiene pedidos sin asignar
   - Obtiene vehículos disponibles
   - Calcula matriz de distancias (OSRM)
   - Optimiza secuencia (Nearest Neighbor + 2-opt)
   - Crea rutas en BD

4. **Dashboard muestra las rutas** con:
   - Mapa de paradas
   - Distancia total estimada
   - Tiempo estimado
   - Tabla de entregas en orden

## 🔌 Motores de optimización

### OSRM (Open Source Routing Machine)

- **Gratis, sin cuotas**
- Calcula distancias/tiempos reales
- Usa mapas OpenStreetMap
- Disponible:
  - ✅ Público: `https://router.project-osrm.org`
  - ✅ Local en Docker: `http://localhost:5000`

### OR-Tools (Google)

- Para futuro: restricciones complejas (capacidad, ventanas, etc)
- Ya está en `package.json`, fácil de integrar

## 📊 Base de datos

**Tablas creadas automáticamente:**

- `logistics.vehiculos` - Catálogo de camiones
- `logistics.pedidos_logistica` - Pedidos desde SIESA
- `logistics.rutas` - Rutas optimizadas
- `logistics.paradas_ruta` - Entregas en cada ruta
- `logistics.posiciones_gps` - Histórico de Widetech
- `logistics.importaciones` - Log de importaciones

## ⚠️ Requisitos

- ✅ PostgreSQL (puedes compartir con DocFlow)
- ✅ Node.js 16+
- ✅ PM2 (ya tienes si corre DocFlow)
- ✅ Internet (para OSRM público, o Docker para OSRM local)

## 🚨 Troubleshooting

### Error: "no se puede conectar a BD"

```bash
# Verificar que PostgreSQL está corriendo
psql -U postgres -l

# Crear BD si no existe
createdb -U postgres vitamar_logistics
```

### Error: "OSRM no responde"

```bash
# Si usas OSRM local:
docker-compose up -d osrm

# O cambiar en .env a la URL pública:
OSRM_URL=https://router.project-osrm.org
```

### Ver logs

```bash
pm2 logs logistics
```

## 📈 Próximos pasos

### Corto plazo (Este mes)
- [ ] Frontend Dashboard (React)
- [ ] Mapa interactivo (Mapbox)
- [ ] Formulario de importación en UI

### Mediano plazo (Próx. 2 meses)
- [ ] App móvil para conductores
- [ ] Seguimiento en tiempo real
- [ ] Integración MCP con Horix

### Largo plazo
- [ ] Análisis de eficiencia/ML
- [ ] Predicción de tiempos reales
- [ ] Integración con APIs de SIESA y Widetech

## 💡 Tips

1. **Para desarrollo:** Usa `npm run dev` (nodemon reinicia automáticamente)
2. **Para tests:** Carga tus CSVs reales y verifica importaciones
3. **Para PM2:** Guarda configuración con `pm2 save` para que arranque con sistema
4. **Para escalar:** Cambiar a múltiples instancias en `ecosystem.config.cjs`

## 📞 Contacto

Cualquier duda, revisar:
- `README.md` - Documentación técnica completa
- `backend/routes/` - Ejemplos de API endpoints
- Logs: `pm2 logs logistics`

---

**¡Listo para empezar!** 🎉

