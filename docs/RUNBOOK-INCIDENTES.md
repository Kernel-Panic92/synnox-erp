# Runbook — Atención de incidentes (auxiliar + opencode)

> Flujo vigente: Opción A (gratis, sin GitHub Pro). `main` protegido por `CODEOWNERS` + Actions guard.

## Roles
- **Owner:** @Kernel-Panic92 — único que puede mergear a `main` y hacer deploy a prod.
- **Auxiliar:** @dmichell055-oss (`write`) — trabaja en PC Linux dedicado, branch `incidentes`.

## Branchs
- `main` — producción. Nunca push directo.
- `incidentes` — espejo de `main` para hotfix (hoy `0/0` con `main`). Base para `fix/inc-XXX`.
- `fix/inc-YYYYMMDD-descripcion` — rama de cada incidente.

## Protección de `main` (Free private)
GitHub Free no permite `Branch protection` nativo en privados (`403`). Soft-enforcement:
- `.github/CODEOWNERS` → `* @Kernel-Panic92`
- `.github/workflows/guard-main.yml` → bloquea `push` a `main` si `actor != Kernel-Panic92`
- `.github/workflows/require-review.yml` → exige `APPROVED` de `Kernel-Panic92` en PRs a `main`
- `.github/workflows/ci.yml` → syntax check

Un push directo de la auxiliar a `main` falla con: `Direct push to main blocked. Use a PR...`

## Setup PC auxiliar (una vez)
```bash
# Ubuntu 24.04, Node >=20, pnpm 9.15.4
git clone https://github.com/Kernel-Panic92/synnox-erp.git
cd synnox-erp
git checkout incidentes
git pull origin incidentes
# opencode (hereda opencode.json -> AGENTS.md, docs/WORKFLOW.md, docs/SPRINT.md)
npm i -g opencode  # o pnpm dlx
opencode --version
# configurar provider LLM en ~/.config/opencode (no usar .env de prod)
gh auth login  # con cuenta dmichell055-oss
```

## Flujo incidente
```bash
git fetch origin
git checkout incidentes
git pull origin incidentes
git checkout -b fix/inc-20250902-ejemplo
# resolver con opencode
opencode
# o manual: editar, probar
pnpm install --frozen-lockfile
# no hay tests globales, verificar con:
find . -name '*.js' -not -path './node_modules/*' -exec node --check {} +

git add <archivos>
git commit -m "fix: descripcion corta del incidente"
git push origin fix/inc-20250902-ejemplo
# abrir PR en GitHub: fix/inc-... -> main, pedir review a @Kernel-Panic92
```
Owner revisa, aprueba, hace `Squash and merge` a `main`.

## Sincronización incidentes
Tras cada release a `main`, owner ejecuta:
```bash
git checkout incidentes
git merge main
git push origin incidentes
```
Auxiliar luego hace `git pull` en su PC.

## Qué NO hacer
- `git push origin main` (bloqueado)
- `git push origin incidentes` directo sin PR previo a `main` (el fix debe entrar por `main` primero)
- Desarrollar en la VM de prod (`pm2 :3002`) — el PC auxiliar es el entorno de fix.

## Evolución a protección nativa
Cuando se migre a GitHub Team: `Settings -> Branches -> Add rule -> main` con `Require pull request reviews`, `Require review from Code Owners`, `Require status checks (CI, require-owner-approval, guard)`. No requiere cambio de flujo.
