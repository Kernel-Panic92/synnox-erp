# Disaster Recovery — SynnoxERP

## Resumen

Guía paso a paso para restaurar SynnoxERP en una VM nueva a partir de un backup.

**Tiempo estimado de restore**: 5-15 minutos (dependiendo del tamaño de la DB)  
**Requisitos previos**: Ubuntu 24.04, PostgreSQL 16, Node 20, nginx, pnpm

---

## Antes de necesitar DR

1. Verificar que los backups se ejecutan: `ls -la backups/synnoxerp_backup_*.tar.gz`
2. Verificar status: `cat backups/status.json`
3. Ejecutar drill de prueba: `sudo scripts/backup_drill.sh`
4. Mantener al menos 1 backup offsite (NAS o nube)

---

## VM nueva — Restore completo

### 1. Instalar dependencias del sistema

```bash
# Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# PostgreSQL 16
sudo apt install -y postgresql postgresql-client

# nginx + certificados SSL
sudo apt install -y nginx certbot python3-certbot-nginx

# pnpm
corepack enable
corepack prepare pnpm@latest --activate

# Herramientas de backup
sudo apt install -y pv
```

### 2. Clonar el repo

```bash
cd /opt
git clone https://github.com/Kernel-Panic92/synnox-erp.git
cd synnox-erp
pnpm install
```

### 3. Configurar .env

```bash
# Copiar .env del backup o crear uno nuevo
cp backups/.nas.conf.example backups/.nas.conf  # si se usa NAS
```

Editar `.env` con las credenciales de la nueva VM:

```env
DB_HOST=127.0.0.1
DB_PORT=5432
DB_NAME=synnox_erp
DB_USER=synnox
DB_PASSWORD=nueva_password_segura
JWT_SECRET=secreto_jwt_aqui
SMTP_HOST=...
SMTP_PORT=...
```

### 4. Crear usuario de PostgreSQL

```bash
sudo -u postgres psql -c "CREATE USER synnox WITH PASSWORD 'nueva_password_segura' CREATEDB;"
sudo -u postgres psql -c "CREATE DATABASE synnox_erp OWNER synnox;"
sudo -u postgres psql -d synnox_erp -c "CREATE EXTENSION IF NOT EXISTS pg_trgm;"
sudo -u postgres psql -d synnox_erp -c "CREATE EXTENSION IF NOT EXISTS \"uuid-ossp\";"
```

### 5. Ejecutar restore

```bash
# Opción A: Restore completo (automático)
sudo scripts/restore_synnox.sh backups/synnoxerp_backup_YYYY-MM-DD_HH-MM-SS.tar.gz

# Opción B: Dry run primero (verificar sin restaurar)
sudo scripts/restore_synnox.sh --dry-run backups/synnoxerp_backup_YYYY-MM-DD_HH-MM-SS.tar.gz
```

El script de restore:
1. ✅ Verifica integridad del backup (pg_restore --list, SQLite integrity)
2. ✅ Detiene PM2 automáticamente
3. ✅ Restaura roles (globals.sql) si hay acceso a superuser
4. ✅ Restaura schemas (logistics, projects) + objetos
5. ✅ Restaura SQLite (launcher.db + horas_extra.db) vía hot-copy
6. ✅ Restaura uploads/media
7. ✅ Restaura config bundle (nginx, PM2 dump, crontab)

### 6. Verificar restore

```bash
# Verificar tablas restauradas
psql -h 127.0.0.1 -U synnox -d synnox_erp -c \
  "SELECT schemaname, count(*) FROM pg_tables WHERE schemaname IN ('logistics','projects','public') GROUP BY schemaname;"

# Ejecutar drill para verificar conteos
sudo scripts/backup_drill.sh
```

### 7. Instalar systemd timer

```bash
sudo bash systemd/install-backup.sh
```

### 8. Iniciar servicios

```bash
# PM2
pm2 resurrect
# o
pm2 start ecosystem.config.js

# Verificar
pm2 list
curl -s http://localhost:3002/health
```

### 9. Configurar nginx

```bash
# El restore restaura /etc/nginx/sites-available/synnoxerp
sudo nginx -t && sudo systemctl reload nginx
```

---

## Restore selectivo (solo un schema)

Si solo necesitas restaurar un schema específico (ej: `logistics`):

```bash
# Extraer el backup
mkdir /tmp/restore && tar xzf backups/synnoxerp_backup_*.tar.gz -C /tmp/restore

# Restaurar solo el schema
pg_restore -h 127.0.0.1 -U synnox -d synnox_erp \
  --schema=logistics --no-owner --no-privileges \
  /tmp/restore/postgres/synnox_erp.dump

# Limpiar
rm -rf /tmp/restore
```

---

## Restore de SQLite (solo launcher/nómina)

```bash
# Extraer
tar xzf backups/synnoxerp_backup_*.tar.gz -C /tmp/restore

# Copiar launcher.db
cp /tmp/restore/sqlite/launcher.db launcher/launcher.db

# Copiar horas_extra.db
cp /tmp/restore/sqlite/horas_extra.db horas_extra.db

# Verificar integridad
node -e "const D=require('better-sqlite3');const d=new D('launcher/launcher.db',{readonly:true});console.log(d.pragma('integrity_check')[0].integrity_check);d.close()"
```

---

## Verificar que el backup funciona

### Drill manual

```bash
# Ejecuta restore en DB scratch + compara conteos
sudo scripts/backup_drill.sh
```

### Drill automático (mensual)

```bash
# Ya instalado por systemd/install-backup.sh
sudo systemctl list-timers synnox-drill.timer
```

---

## Troubleshooting

### "permission denied for table pg_authid"

El usuario `synnox` no es superuser. Opciones:
1. Usar `su postgres -c "pg_dumpall --globals-only"` como root
2. Omitir roles: el .env (incluido en el backup) contiene las credenciales para recrear el usuario

### "role synnox does not exist" después del restore

```bash
sudo -u postgres psql -c "CREATE USER synnox WITH PASSWORD 'tu_password' CREATEDB;"
sudo -u postgres psql -d synnox_erp -c "ALTER DATABASE synnox_erp OWNER TO synnox;"
```

### PM2 no inicia después del restore

```bash
# Verificar dump
cat ~/.pm2/dump.pm2

# Si está corrupto, reinstalar desde ecosystem
pm2 start ecosystem.config.js
pm2 save
```

### Backup en NAS no se copia

```bash
# Verificar configuración
cat backups/.nas.conf

# Probar mount manual
sudo mount -t cifs //host/share /mnt/synnox-nas \
  -o username=user,password=pass,iocharset=utf8,vers=3.0,noperm
```

---

## Archivos importantes

| Archivo | Descripción |
|---------|-------------|
| `backups/synnoxerp_backup_*.tar.gz` | Backups completos |
| `backups/status.json` | Último resultado |
| `backups/history.jsonl` | Historial |
| `backups/.nas.conf` | Config copia NAS |
| `backups/last-run.log` | Log del último backup |
| `scripts/backup_synnox.sh` | Script de backup |
| `scripts/restore_synnox.sh` | Script de restore |
| `scripts/backup_drill.sh` | Drill automático |
| `systemd/synnox-backup.timer` | Timer diario |
| `systemd/synnox-drill.timer` | Timer mensual |
