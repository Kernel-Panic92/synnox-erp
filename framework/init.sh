#!/bin/bash
# ── Horix Framework - init.sh ──
# Uso: bash init.sh /ruta/del/nuevo-modulo/public
# Copia los archivos del framework a un nuevo módulo y genera el HTML base

set -e

if [ -z "$1" ]; then
  echo "Uso: bash init.sh /ruta/del/nuevo-modulo/public"
  exit 1
fi

DEST="$1"
HERE="$(cd "$(dirname "$0")" && pwd)"

# Crear directorios
mkdir -p "$DEST/css" "$DEST/js"

# Copiar archivos
cp "$HERE/base.css" "$DEST/css/"
cp "$HERE/components.css" "$DEST/css/"
cp "$HERE/framework.js" "$DEST/js/"
cp "$HERE/theme.js" "$DEST/js/"

# Generar index.html base
if [ ! -f "$DEST/index.html" ]; then
  MODULE_NAME="$(basename "$(dirname "$DEST")")"
  cat > "$DEST/index.html" << EOF
<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>$MODULE_NAME</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,300;9..40,400;9..40,500;9..40,600;9..40,700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="css/base.css">
<link rel="stylesheet" href="css/components.css">
<script>window._LAUNCHER_URL = 'http://localhost:3002';</script>
<script src="js/theme.js"></script>
</head>
<body>
<div id="toast-container"></div>

<!-- Login -->
<div class="login-screen" id="login-screen">
  <div class="login-card">
    <div class="logo">📦</div>
    <h1>$MODULE_NAME</h1>
    <p>Inicia sesión para continuar</p>
    <div class="error" id="login-error"></div>
    <div class="form-group"><label>Correo electrónico</label><input type="email" id="login-email" placeholder="correo@empresa.com" autocomplete="email" onkeydown="if(event.key==='Enter')document.getElementById('login-btn').click()"></div>
    <div class="form-group"><label>Contraseña</label><input type="password" id="login-pass" placeholder="••••••••" autocomplete="current-password" onkeydown="if(event.key==='Enter')document.getElementById('login-btn').click()"></div>
    <button class="btn btn-primary" id="login-btn" onclick="doLogin()" style="width:100%;justify-content:center;">Ingresar</button>
    <div style="margin-top:16px;text-align:center;"><a href="#" onclick="abrirForgot('modal-forgot')" style="font-size:13px;color:var(--muted);text-decoration:none;" onmouseover="this.style.color='var(--text)'" onmouseout="this.style.color='var(--muted)'">¿Olvidaste tu contraseña?</a></div>
  </div>
</div>

<!-- App -->
<div class="app-screen" id="app-screen">
  <div class="sidebar" id="sidebar">
    <div class="logo">📦 <span>$MODULE_NAME</span></div>
    <div class="user-info">
      <div class="name" id="user-name"></div>
      <div class="role" id="user-role"></div>
      <div class="role" id="user-email" style="font-size:11px;color:var(--muted);"></div>
      <span class="badge" id="user-badge"></span>
    </div>
    <nav id="sidebar-nav"><!-- nav-items here --></nav>
    <div class="sidebar-footer">
      <div class="nav-item" onclick="toggleTheme()" style="cursor:pointer">🎨 Tema</div>
      <div class="nav-item" onclick="mostrarLogoutConfirm()" style="cursor:pointer">🚪 Cerrar sesión</div>
    </div>
  </div>
  <div class="sidebar-overlay" onclick="closeSidebar()"></div>

  <div class="main">
    <div class="main-header">
      <button class="hamburger" onclick="toggleSidebar()">☰</button>
      <h2 id="page-title">Dashboard</h2>
      <div class="header-actions"></div>
    </div>
    <div class="main-body" id="main-body">
      <!-- pages here -->
    </div>
  </div>
</div>

<!-- Modal -->
<div class="modal-overlay" id="modal-overlay">
  <div class="modal">
    <h3 id="modal-title">Título</h3>
    <p class="modal-desc" id="modal-desc"></p>
    <div id="modal-body"></div>
    <div class="modal-actions" id="modal-actions"></div>
  </div>
</div>

<!-- Logout confirmation -->
<div class="modal-overlay" id="modal-logout">
  <div class="modal" style="max-width:380px;text-align:center;">
    <div style="font-size:44px;margin-bottom:8px">👋</div>
    <h3>Cerrar sesión</h3>
    <p style="color:var(--muted);font-size:14px;margin-bottom:8px">¿Estás seguro?</p>
    <div style="display:flex;gap:10px;justify-content:center;margin-top:20px;padding-top:16px;border-top:1px solid var(--border);">
      <button class="btn btn-secondary" onclick="cerrarLogoutConfirm()">Cancelar</button>
      <button class="btn btn-danger" onclick="confirmarLogout()">Cerrar sesión</button>
    </div>
  </div>
</div>

<!-- Forgot password -->
<div class="modal-overlay" id="modal-forgot">
  <div class="modal" style="max-width:400px;">
    <h3>Recuperar contraseña</h3>
    <p style="color:var(--muted);font-size:14px;margin-bottom:20px;">Ingresa tu correo y te enviaremos un enlace.</p>
    <div class="error forgot-error" id="forgot-error"></div>
    <div class="success forgot-success" id="forgot-success"></div>
    <div class="forgot-form" id="forgot-form">
      <div class="form-group"><label>Correo Electrónico</label><input type="email" class="forgot-email" id="forgot-email" placeholder="correo@empresa.com"></div>
      <button class="btn btn-primary" id="btn-forgot" onclick="enviarReset(document.getElementById('forgot-email').value, { errorEl:'forgot-error', btnEl:'btn-forgot', successEl:'forgot-success', formEl:'forgot-form', btnText:'Enviar Enlace' })" style="width:100%;justify-content:center;">Enviar Enlace</button>
    </div>
    <div class="modal-actions"><button class="btn btn-secondary" onclick="cerrarForgot('modal-forgot')">Cancelar</button></div>
  </div>
</div>

<script src="js/framework.js"></script>
<script>
// Page-specific JS here
</script>
</body>
</html>
EOF
  echo "✓ index.html creado en $DEST/index.html"
else
  echo "⚠ index.html ya existe, saltando"
fi

echo "✓ Framework instalado en $DEST"
echo "Próximos pasos:"
echo "  1. Agrega los nav-items en <nav id='sidebar-nav'>"
echo "  2. Agrega las páginas en <div class='main-body'>"
echo "  3. Configura initHorixFramework({ apiPrefix, tokenKey, routes: { dashboard: cargarDashboard } })"
