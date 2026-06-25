const express = require('express');

module.exports = function({ middlewares: { soloAdmin } }) {
  const router = express.Router();

  router.get('/auditoria', soloAdmin, (req, res) => {
    const stats = { totalExitosHoy: 0, totalFallidosHoy: 0 };
    res.json({ historial: [], stats });
  });

  return router;
};