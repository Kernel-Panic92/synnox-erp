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
      window.location.href = '/logout';
    }
  });
}
