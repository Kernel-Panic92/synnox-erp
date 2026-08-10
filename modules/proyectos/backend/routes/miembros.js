import express from 'express';
import pool from '../config/db.js';
import { requirePermiso } from '../../../../framework/auth.mjs';
import { notificar, getProyectoCompleto, getEmailBaseUrl } from '../utils/notify.js';
import { enviarCorreo } from '../utils/email.js';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { templateAsignacion } = require('../../../../framework/email-templates');

const router = express.Router();

const LAUNCHER_URL = process.env.LAUNCHER_URL || 'http://localhost:3002';

let _usersCache = null;
let _usersCacheTs = 0;
const USERS_CACHE_TTL = 60000;

async function getLauncherUsers() {
  const now = Date.now();
  if (_usersCache && (now - _usersCacheTs) < USERS_CACHE_TTL) return _usersCache;
  try {
    const res = await fetch(`${LAUNCHER_URL}/api/usuarios/public`, { signal: AbortSignal.timeout(3000) });
    if (res.ok) {
      const data = await res.json();
      _usersCache = Array.isArray(data) ? data : (data.usuarios || []);
      _usersCacheTs = now;
      return _usersCache;
    }
  } catch {}
  return [];
}

async function esMiembroOCreador(proyectoId, userId) {
  const check = await pool.query(
    `SELECT 1 FROM projects.proyectos WHERE id = $1 AND asignado_a = $2`,
    [proyectoId, userId]
  );
  if (check.rows.length > 0) return true;
  const member = await pool.query(
    `SELECT 1 FROM projects.proyecto_miembros WHERE proyecto_id = $1 AND usuario_id = $2`,
    [proyectoId, userId]
  );
  return member.rows.length > 0;
}

// GET /api/proyectos/:id/miembros — listar miembros
router.get('/:id/miembros', requirePermiso('ver', 'proyectos'), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT pm.*, p.asignado_a
       FROM projects.proyecto_miembros pm
       JOIN projects.proyectos p ON p.id = pm.proyecto_id
       WHERE pm.proyecto_id = $1
       ORDER BY pm.rol DESC, pm.created_at ASC`,
      [req.params.id]
    );
    const users = await getLauncherUsers();
    const miembros = result.rows.map(m => {
      const user = users.find(u => u.id === m.usuario_id);
      return {
        usuario_id: m.usuario_id,
        rol: m.rol,
        created_at: m.created_at,
        nombre: user?.nombre || `#${m.usuario_id}`,
        email: user?.email || ''
      };
    });
    res.json({ exitosa: true, miembros, asignado_a: result.rows[0]?.asignado_a || null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/proyectos/:id/miembros — agregar miembro
router.post('/:id/miembros', requirePermiso('editar', 'proyectos'), async (req, res) => {
  try {
    const { usuario_id, rol } = req.body;
    if (!usuario_id) return res.status(400).json({ error: 'usuario_id requerido' });

    const validRoles = ['lider', 'miembro', 'observador'];
    const miembroRol = validRoles.includes(rol) ? rol : 'miembro';

    const esAdmin = req.user.rol === 'admin' || req.user.rol === 'gerente';
    const esCreador = await pool.query(
      'SELECT 1 FROM projects.proyectos WHERE id = $1 AND asignado_a = $2',
      [req.params.id, req.user.id]
    );
    if (!esAdmin && esCreador.rows.length === 0) {
      return res.status(403).json({ error: 'Solo el creador o un admin pueden agregar miembros' });
    }

    const result = await pool.query(
      `INSERT INTO projects.proyecto_miembros (proyecto_id, usuario_id, rol)
       VALUES ($1, $2, $3)
       ON CONFLICT (proyecto_id, usuario_id) DO UPDATE SET rol = $3
       RETURNING *`,
      [req.params.id, usuario_id, miembroRol]
    );

    // Notificar al usuario agregado
    try {
      const proyecto = await getProyectoCompleto(pool, req.params.id);
      if (proyecto) {
        const esLider = miembroRol === 'lider';
        const titulo = esLider ? 'Responsable de proyecto' : 'Agregado a proyecto';
        const mensaje = esLider
          ? `Ahora eres el responsable del proyecto "${proyecto.nombre}" — asignado por ${req.user.nombre}`
          : `Ahora haces parte del proyecto "${proyecto.nombre}" como ${miembroRol} — asignado por ${req.user.nombre}`;
        const emailAsunto = esLider
          ? `[Proyectos] Responsable asignado: ${proyecto.nombre}`
          : `[Proyectos] Agregado a: ${proyecto.nombre}`;
        notificar({
          usuario_id,
          modulo: 'proyectos',
          tipo: 'proyecto_miembro',
          titulo,
          mensaje,
          url: '/proyectos/#proyectos',
          email: (await getLauncherUsers()).find(u => u.id === usuario_id)?.email,
          emailAsunto,
          emailHtml: templateAsignacion({ entidad: 'proyecto', nombre: proyecto.nombre, asignador: req.user.nombre, descripcion: esLider ? 'Rol: Responsable' : `Rol: ${miembroRol}`, url: `${await getEmailBaseUrl()}/#proyectos`, module: 'proyectos', baseUrl: await getEmailBaseUrl() }),
          enviarCorreo
        });
      }
    } catch (e) { console.warn('[notify] Error:', e.message); }

    res.status(201).json({ exitosa: true, miembro: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/proyectos/:id/miembros/:userId — cambiar rol
router.put('/:id/miembros/:userId', requirePermiso('editar', 'proyectos'), async (req, res) => {
  try {
    const { rol } = req.body;
    const validRoles = ['lider', 'miembro', 'observador'];
    if (!validRoles.includes(rol)) return res.status(400).json({ error: 'Rol inválido. Opciones: lider, miembro, observador' });

    const esAdmin = req.user.rol === 'admin' || req.user.rol === 'gerente';
    const esCreador = await pool.query(
      'SELECT 1 FROM projects.proyectos WHERE id = $1 AND asignado_a = $2',
      [req.params.id, req.user.id]
    );
    if (!esAdmin && esCreador.rows.length === 0) {
      return res.status(403).json({ error: 'Solo el creador o un admin pueden cambiar roles' });
    }

    const result = await pool.query(
      `UPDATE projects.proyecto_miembros SET rol = $1
       WHERE proyecto_id = $2 AND usuario_id = $3
       RETURNING *`,
      [rol, req.params.id, req.params.userId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Miembro no encontrado' });

    res.json({ exitosa: true, miembro: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/proyectos/:id/miembros/:userId — quitar miembro
router.delete('/:id/miembros/:userId', requirePermiso('editar', 'proyectos'), async (req, res) => {
  try {
    const esAdmin = req.user.rol === 'admin' || req.user.rol === 'gerente';
    const esCreador = await pool.query(
      'SELECT 1 FROM projects.proyectos WHERE id = $1 AND asignado_a = $2',
      [req.params.id, req.user.id]
    );
    if (!esAdmin && esCreador.rows.length === 0) {
      return res.status(403).json({ error: 'Solo el creador o un admin pueden quitar miembros' });
    }

    const result = await pool.query(
      'DELETE FROM projects.proyecto_miembros WHERE proyecto_id = $1 AND usuario_id = $2 RETURNING id',
      [req.params.id, req.params.userId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Miembro no encontrado' });

    res.json({ exitosa: true, mensaje: 'Miembro eliminado' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/proyectos/:id/miembros — reemplazar todos los miembros (bulk)
router.put('/:id/miembros', requirePermiso('editar', 'proyectos'), async (req, res) => {
  try {
    const { miembros } = req.body;
    if (!Array.isArray(miembros)) return res.status(400).json({ error: 'miembros debe ser un array' });

    const esAdmin = req.user.rol === 'admin' || req.user.rol === 'gerente';
    const esCreador = await pool.query(
      'SELECT 1 FROM projects.proyectos WHERE id = $1 AND asignado_a = $2',
      [req.params.id, req.user.id]
    );
    if (!esAdmin && esCreador.rows.length === 0) {
      return res.status(403).json({ error: 'Solo el creador o un admin pueden gestionar miembros' });
    }

    const validRoles = ['lider', 'miembro', 'observador'];

    // Obtener miembros actuales para comparar
    const miembrosActuales = await pool.query(
      'SELECT usuario_id FROM projects.proyecto_miembros WHERE proyecto_id = $1',
      [req.params.id]
    );
    const idsActuales = new Set(miembrosActuales.rows.map(m => m.usuario_id));
    const nuevosIds = miembros.filter(m => m.usuario_id && !idsActuales.has(m.usuario_id)).map(m => m.usuario_id);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM projects.proyecto_miembros WHERE proyecto_id = $1', [req.params.id]);
      for (const m of miembros) {
        if (!m.usuario_id) continue;
        const rol = validRoles.includes(m.rol) ? m.rol : 'miembro';
        await client.query(
          `INSERT INTO projects.proyecto_miembros (proyecto_id, usuario_id, rol) VALUES ($1, $2, $3)`,
          [req.params.id, m.usuario_id, rol]
        );
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }

    // Notificar solo a los miembros nuevos
    if (nuevosIds.length) {
      try {
        const proyecto = await getProyectoCompleto(pool, req.params.id);
        if (proyecto) {
          const users = await getLauncherUsers();
          for (const uid of nuevosIds) {
            const m = miembros.find(x => x.usuario_id === uid);
            const esLider = m?.rol === 'lider';
            const titulo = esLider ? 'Responsable de proyecto' : 'Agregado a proyecto';
            const mensaje = esLider
              ? `Ahora eres el responsable del proyecto "${proyecto.nombre}" — asignado por ${req.user.nombre}`
              : `Ahora haces parte del proyecto "${proyecto.nombre}" como ${m?.rol || 'miembro'} — asignado por ${req.user.nombre}`;
            const emailAsunto = esLider
              ? `[Proyectos] Responsable asignado: ${proyecto.nombre}`
              : `[Proyectos] Agregado a: ${proyecto.nombre}`;
            const user = users.find(u => u.id === uid);
            notificar({
              usuario_id: uid,
              modulo: 'proyectos',
              tipo: 'proyecto_miembro',
              titulo,
              mensaje,
              url: '/proyectos/#proyectos',
              email: user?.email,
              emailAsunto,
              emailHtml: templateAsignacion({ entidad: 'proyecto', nombre: proyecto.nombre, asignador: req.user.nombre, descripcion: esLider ? 'Rol: Responsable' : `Rol: ${m?.rol || 'miembro'}`, url: `${await getEmailBaseUrl()}/#proyectos`, module: 'proyectos', baseUrl: await getEmailBaseUrl() }),
              enviarCorreo
            });
          }
        }
      } catch (e) { console.warn('[notify] Error:', e.message); }
    }

    res.json({ exitosa: true, mensaje: 'Miembros actualizados' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
