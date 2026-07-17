# SynnoxERP Logística — Contexto del proyecto

## ¿Qué es?
Módulo de optimización de rutas y logística con geocodificación, VRP, mapa Leaflet y MCP server.

- **Repo**: `https://github.com/synnoxerp/synnox-erp.git`
- **Puerto interno**: 3004
- **PM2 name**: `synnoxerp-logistica`
- **DB**: PostgreSQL, schema `logistics`

## Acceso HTTPS (producción)

| Ruta | Puerto | Proxy |
|------|--------|-------|
| `https://tudominio.com/logistica/` | 443 | Nginx → localhost:3004 |
| `https://tudominio.com:9443/logistica/` | 9443 | Nginx launcher → localhost:3004 |
| `http://localhost:3004` | — | Directo (sin SSL) |

## MCP

Endpoint interno: `POST /mcp` (sin auth, confianza local).

9 tools expuestas: `dashboard`, `listar_vehiculos`, `listar_sedes`, `listar_pedidos`, `buscar_clientes`, `crear_pedido`, `generar_rutas`, `listar_rutas`, `obtener_ruta`.

El gateway de SynnoxERP las expone con prefijo `logistics_*`.

## Dependencias

- **PostgreSQL**: schema `logistics`
- **OSRM**: `https://router.project-osrm.org` (configurable vía env `OSRM_URL`)
- **Google Maps API**: key configurable en Configuración → Mapas
- **SynnoxERP launcher**: para MCP gateway, health checks, dashboard
