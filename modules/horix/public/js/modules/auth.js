async function doLogout() {
  confirmar({
    titulo: 'Cerrar sesión',
    mensaje: '¿Seguro que deseas cerrar sesión?',
    icono: '👋',
    btnTxt: 'Cerrar sesión',
    onConfirm: async () => {
      localStorage.removeItem('he_logged_in');
      sesion = null;
      empleados = [];
      nominas = [];
      registros = [];
      usuarios = [];
      centros = [];
      window.location.href = (window.BASE || '') + '/';
    }
  });
}
