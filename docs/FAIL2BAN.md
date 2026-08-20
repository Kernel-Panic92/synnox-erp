# Fail2ban SynnoxERP

La configuración protege únicamente `POST /api/auth/login` cuando Nginx registra
un `401`. No bloquea respuestas `429` ni otros endpoints, reduciendo falsos
positivos por uso normal de la aplicación.

## Instalación

```bash
sudo systemd/install-fail2ban.sh
```

La jail usa 5 intentos fallidos en 10 minutos, bloquea durante 30 minutos y
duplica progresivamente el tiempo hasta un máximo de un día.

## Whitelist

La configuración incluye localhost. Agrega redes corporativas o VPN confiables
en `ignoreip` dentro de `/etc/fail2ban/jail.d/synnox-login.conf` y reinicia:

```bash
sudo systemctl restart fail2ban
```

## Operación

```bash
sudo fail2ban-client status synnox-login
sudo fail2ban-client set synnox-login unbanip <IP>
```
