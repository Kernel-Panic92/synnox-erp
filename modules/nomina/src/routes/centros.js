const express = require('express');
const { getCentros, validarSede } = require('../utils/launcherDb');

module.exports = function createCentrosRouter({ middlewares }) {
  const router = express.Router();
  const { todosRoles, soloAdmin } = middlewares;

  router.get('/', todosRoles, (req, res) => {
    const rows = getCentros();
    res.json(rows);
  });

  router.post('/', (req, res) => {
    res.status(400).json({ error: 'Los centros se gestionan desde el panel de administración del Launcher' });
  });

  router.put('/:id', (req, res) => {
    res.status(400).json({ error: 'Los centros se gestionan desde el panel de administración del Launcher' });
  });

  router.delete('/:id', soloAdmin, (req, res) => {
    res.status(400).json({ error: 'Los centros se gestionan desde el panel de administración del Launcher' });
  });

  return router;
};
