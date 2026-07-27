async function mostrarLogoutConfirm() {
  confirmar({
    titulo: 'Cerrar sesión',
    mensaje: '¿Seguro que deseas cerrar sesión?',
    icono: '👋',
    btnTxt: 'Cerrar sesión',
    onConfirm: async () => {
      sesion = null;
      empleados = [];
      nominas = [];
      registros = [];
      usuarios = [];
      centros = [];
      await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
      window.location.href = '/';
    }
  });
}
