# Horix ERP — Contexto del proyecto

> Propósito: Mantener contexto entre sesiones de opencode.

## ¿Qué es?
Plataforma de orquestación de módulos ERP con auth centralizada (JWT compartido). Monorepo con launcher + módulos internos.

**Repo**: `https://github.com/Kernel-Panic92/horix-erp` (branch `refactor/monorepo-auth`)
**PM2**: `horix-erp` (antes `horix-launcher`)

## Estructura

```
horix-erp/
├── installer/           ← Wizard web (GLPI-like) en puerto 3001
│   ├── server.js        ← Express temporal, child_process + SSE logs
│   └── public/
│       ├── index.html   ← 7 pasos wizard
│       └── app.js       ← Lógica frontend
├── framework/
│   ├── auth.js          ← verifyToken + requireModule(moduleId) — middleware compartido
│   ├── base.css / components.css / framework.js / theme.js
├── launcher/            ← Servidor Express + SQLite (auth, MCP gateway, admin, nginx gen)
│   ├── server.js        ← 1520 líneas
│   └── shell/           ← Frontend SPA
├── modules/
│   ├── logistics/       ← VRP, vehículos, pedidos, clientes, sedes (ESM, PostgreSQL)
│   ├── docflow/         ← Facturas, proveedores, flujo aprobación (CommonJS, PostgreSQL)
│   └── horix/           ← Horas Extra / Novedades (CommonJS, SQLite, ahora interno en monorepo)
└── install.sh           ← Legacy CLI (usar wizard web)
```

## Instalación

```bash
sudo node installer/server.js
# Abrir http://<VM_IP>:3001
```

El wizard guía 7 pasos: requisitos → DB → admin → módulos → review (con opción "Instalación limpia" + CONFIRMAR) → instalación con logs → pantalla final con credenciales.

Características del instalador:
- Auto-detecta IP, Node.js ≥20, PostgreSQL, Nginx, PM2
- Genera JWT_SECRET compartido para todos los módulos
- Seeds demo de negocio (clientes, vehículos, pedidos, proveedores, facturas)
- Registra módulos vía API del launcher (con retry y backoff)
- Configura Nginx con SSL autofirmado + path prefixes

## Módulos

| ID | Nombre | Puerto | Auth | DB | Estado |
|----|--------|--------|------|----|--------|
| `launcher` | Horix ERP | 3002 | propia | SQLite | ✅ |
| `logistics` | Logística | 3004 | JWT compartido | PostgreSQL | ⚠️ |
| `docflow` | DocFlow | 3100 | JWT compartido | PostgreSQL | ⚠️ |
| `horix` | Novedades | 3000 | JWT compartido | SQLite | ⚠️ |

## Auth centralizada
- Launcher tiene el login único
- JWT_SECRET compartido entre todos los módulos (`.env`)
- JWT incluye `modulos[]` (módulos permitidos para el usuario)
- Tabla `user_modulos` en launcher.db (asignación módulo ↔ usuario)
- Módulos internos leen cookie `launcher_jwt` y verifican con JWT_SECRET
- Horix: middleware `auth.js` verifica JWT compartido + auto-crea usuario en SQLite local si no existe

## Pendientes (próxima sesión)

### Bugs conocidos (después de instalación limpia)
1. **DocFlow**: loop de recarga infinito por `SameSite` cookie o `/auth/me` fallando
2. **Horix**: muestra login en vez de auto-autenticar con JWT
3. **Logistics**: verificar que funciona con el import path corregido

### Próximos pasos
- [ ] Diagnosticar y arreglar DocFlow (loop)
- [ ] Diagnosticar y arreglar Horix (login mostrado)
- [ ] Verificar que los 3 módulos cargan desde dashboard HTTPS
- [ ] Limpiar seeds duplicados (cada módulo crea su propio admin)
- [ ] Renombrar todo a **SynnoxERP** (marca registrada)
- [ ] Unificar usuarios/roles/config en el launcher
