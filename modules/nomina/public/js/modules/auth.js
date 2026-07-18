async function mostrarLogoutConfirm() {
  confirmar({
    titulo: 'Cerrar sesión',
    mensaje: '¿Seguro que deseas cerrar sesión?',
    icono: '👋',
    btnTxt: 'Cerrar sesión',
    onConfirm: async () => {
      document.cookie = 'launcher_jwt=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax';
      localStorage.removeItem('he_logged_in');
      localStorage.removeItem('platform_jwt');
      sesion = null;
      empleados = [];
      nominas = [];
      registros = [];
      usuarios = [];
      centros = [];
      window.location.href = '/';
    }
  });
}
