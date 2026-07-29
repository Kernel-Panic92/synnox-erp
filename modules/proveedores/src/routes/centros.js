const router = require('express').Router();
const db = require('../db');
const { authMiddleware, requirePermiso } = require('../middleware/auth');

router.use(authMiddleware);

const LAUNCHER_URL = process.env.LAUNCHER_URL || 'http://localhost:3002';

// ─── GET /api/centros ──────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const { rows } = await db.query(
      'SELECT * FROM centros_operacion ORDER BY nombre ASC'
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/centros/:id ─────────────────────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const { rows } = await db.query(
      'SELECT * FROM centros_operacion WHERE id = $1',
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Centro no encontrado' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/centros/sync ──────────────────────────────────────────────
// Sincroniza centros desde el launcher (fuente única de verdad)
router.post('/sync', requirePermiso('configurar'), async (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    const response = await fetch(`${LAUNCHER_URL}/api/centros`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!response.ok) {
      return res.status(502).json({ error: 'No se pudo conectar con el launcher' });
    }
    const launcherCentros = await response.json();

    let created = 0, updated = 0, unchanged = 0;
    for (const lc of launcherCentros) {
      const { rows: existing } = await db.query(
        'SELECT id, nombre, activo FROM centros_operacion WHERE nombre = $1',
        [lc.nombre]
      );
      if (existing.length === 0) {
        await db.query(
          `INSERT INTO centros_operacion (nombre, codigo, descripcion, direccion, telefono, email, activo)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [lc.nombre, lc.codigo || null, lc.descripcion || null, lc.direccion || null, lc.telefono || null, lc.email || null, lc.activo !== false]
        );
        created++;
      } else {
        const needsUpdate =
          existing[0].activo !== (lc.activo !== false);
        if (needsUpdate) {
          await db.query(
            'UPDATE centros_operacion SET activo = $1 WHERE id = $2',
            [lc.activo !== false, existing[0].id]
          );
          updated++;
        } else {
          unchanged++;
        }
      }
    }

    res.json({ ok: true, created, updated, unchanged, total: launcherCentros.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/centros ────────────────────────────────────────────────────
// CRUD deshabilitado — los centros se gestionan desde el Launcher
router.post('/', requirePermiso('crear'), async (req, res) => {
  res.status(400).json({ error: 'Los centros se gestionan desde el panel de administración del Launcher' });
});

// ─── PUT /api/centros/:id ─────────────────────────────────────────────────
router.put('/:id', requirePermiso('editar'), async (req, res) => {
  res.status(400).json({ error: 'Los centros se gestionan desde el panel de administración del Launcher' });
});

// ─── DELETE /api/centros/:id ───────────────────────────────────────────────
router.delete('/:id', requirePermiso('eliminar'), async (req, res) => {
  res.status(400).json({ error: 'Los centros se gestionan desde el panel de administración del Launcher' });
});

module.exports = router;
