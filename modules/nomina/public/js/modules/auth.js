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
      localStorage.removeItem('he_logged_in');
      localStorage.removeItem('platform_jwt');
      window.location.href = '/logout';
    }
  });
}
