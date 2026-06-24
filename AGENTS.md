# SynnoxERP — Contexto del proyecto

> Propósito: Mantener contexto entre sesiones de opencode.

## ¿Qué es?
Plataforma de orquestación de módulos ERP con servidor unificado. Monorepo con un solo punto de entrada.

**Repo**: `https://github.com/Kernel-Panic92/horix-erp` (branch `refactor/monorepo-auth`)

## Arquitectura actual

```
server.js (raíz, puerto 3002)
├── Launcher (login, dashboard, admin) → /
├── Proveedores (facturas) → /proveedores/
├── Logística (rutas) → /logistica/
└── Nómina (novedades) → /nomina/
```

- **1 solo proceso PM2** (`synnoxerp`)
- **1 solo .env** en raíz
- **1 solo package.json** con todas las dependencias
- **Módulos estáticos** — no requieren registro vía API
- **Instalador** genera único .env, único npm install, único PM2

## Estructura

```
horix-erp/
├── server.js              ← Entry point único
├── package.json           ← Todas las dependencias
├── .env                   ← Configuración única
├── src/
│   ├── auth.js            ← Middleware JWT compartido
│   └── db.js              ← Conexiones PostgreSQL + SQLite
├── launcher/              ← Login, dashboard, admin usuarios
│   └── shell/             ← Frontend SPA
├── modules/
│   ├── proveedores/       ← Facturas (CommonJS, PostgreSQL)
│   ├── logistica/         ← Rutas (ESM, PostgreSQL)
│   └── nomina/            ← Novedades (CommonJS, SQLite)
├── framework/
│   └── auth.js            ← verifyToken + requireModule (shared ESM)
└── installer/
    └── server.js          ← Instalador web
```

## Auth centralizada
- Launcher tiene el login único (`POST /api/auth/login`)
- JWT_SECRET compartido via .env único
- JWT incluye `modulos[]` (módulos permitidos para el usuario)
- Módulos leen cookie `launcher_jwt` y verifican con JWT_SECRET
- Cada módulo auto-crea usuario local si no existe (desde payload JWT)

## Pendientes (próxima sesión)

### Bugs conocidos
1. **Módulos redirigen al login** — Al hacer clic en una tarjeta del dashboard, el módulo abre pero `GET /api/auth/me` falla (posible JWT_SECRET mismatch o cookie no enviada). Diagnosticar por qué el JWT no se verifica en los submódulos.
2. **Nómina carga en negro** — Verificar que el fix de `API = BASE` en `api.js` resolvió el path de las llamadas API.

### Próximos pasos
- [ ] Diagnosticar por qué los módulos redirigen al login (JWT no verificado)
- [ ] Simplificar admin del launcher (remover gestión de módulos vía API)
- [ ] Limpiar tablas `modulos_plataforma` del launcher (obsoletas)
- [ ] Renombrar proyecto a SynnoxERP (marca)
- [ ] Limpiar seeds duplicados (cada módulo ya no crea admin propio)

### Para probar instalación limpia
```bash
cd /opt/horix-platform
sudo git pull origin refactor/monorepo-auth
sudo node installer/server.js
# En wizard: marcar "Instalación limpia" + escribir CONFIRMAR
```
