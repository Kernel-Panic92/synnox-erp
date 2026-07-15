# Contribuyendo a SynnoxERP

## Primeros pasos

1. Clona el repo: `git clone https://github.com/Kernel-Panic92/synnox-erp.git`
2. Instala [pnpm](https://pnpm.io/installation): `npm install -g pnpm@9.15.4`
3. Instala dependencias: `pnpm install`
4. Copia `config.env.example` a `.env` y configura las variables
5. Inicia el servidor: `node server.js`

## Flujo de trabajo

1. Crea una rama desde `main`: `git checkout -b feature/mi-cambio`
2. Haz tus commits con mensajes descriptivos
3. Mantén la rama actualizada: `git pull --rebase origin main`
4. Abre un Pull Request a `main`
5. Espera la revisión y approval

## Convenciones de código

- **ESM**: Usa `import`/`export`, no CommonJS
- **Sin comentarios inline**: El código debe ser auto-documentado
- **Nombres**: `camelCase` para variables/funciones, `kebab-case` para archivos
- **Errores**: Usa `AppError` o `createError` del framework

## CI

Cada PR ejecuta automáticamente:
- `pnpm install --frozen-lockfile` — lockfile válido
- `pnpm audit --prod` — cero vulnerabilidades
- `node --check` — sintaxis JS válida

## OpenCode

Este proyecto se desarrolla con [OpenCode](https://opencode.ai).
