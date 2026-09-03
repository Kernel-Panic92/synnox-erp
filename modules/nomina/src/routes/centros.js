const express = require('express');
const { getCentrosAsync } = require('../utils/launcherDb');

module.exports = function createCentrosRouter({ middlewares }) {
  const router = express.Router();
  const { todosRoles, soloAdmin } = middlewares;

  router.get('/', todosRoles, async (req, res) => {
    try {
      const rows = await getCentrosAsync();
      res.json(rows);
    } catch (e) {
      res.status(500).json({ error: 'Error cargando centros de operación' });
    }
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
