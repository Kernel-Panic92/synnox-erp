import pool from '../config/db.js';
import crypto from 'crypto';

const TOOLS = [
  {
    name: 'dashboard',
    description: 'Resumen del dashboard: tareas por estado, por asignado, y tareas recientes',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'listar_proyectos',
    description: 'Lista todos los proyectos con conteo de tareas por estado',
    inputSchema: {
      type: 'object',
      properties: {
        estado: { type: 'string', description: 'Filtrar por estado (activo, completado)' },
        q: { type: 'string', description: 'Búsqueda por nombre' },
        limite: { type: 'number', description: 'Máximo de resultados (default 50)' }
      }
    }
  },
  {
    name: 'obtener_proyecto',
    description: 'Obtiene detalle de un proyecto específico con sus tareas',
    inputSchema: {
      type: 'object',
      properties: {
        proyecto_id: { type: 'number', description: 'ID del proyecto' }
      },
      required: ['proyecto_id']
    }
  },
  {
    name: 'crear_proyecto',
    description: 'Crea un nuevo proyecto',
    inputSchema: {
      type: 'object',
      properties: {
        nombre: { type: 'string', description: 'Nombre del proyecto' },
        descripcion: { type: 'string', description: 'Descripción del proyecto' },
        fecha_limite: { type: 'string', description: 'Fecha límite YYYY-MM-DD' },
        asignado_a: { type: 'number', description: 'ID del usuario asignado' }
      },
      required: ['nombre']
    }
  },
  {
    name: 'listar_tareas',
    description: 'Lista tareas con filtros opcionales y paginación',
    inputSchema: {
      type: 'object',
      properties: {
        proyecto_id: { type: 'number', description: 'Filtrar por proyecto' },
        estado: { type: 'string', description: 'Filtrar por estado (pendiente, en_progreso, revision, completada)' },
        prioridad: { type: 'string', description: 'Filtrar por prioridad (baja, media, alta, critica)' },
        asignado_a: { type: 'number', description: 'Filtrar por usuario asignado' },
        q: { type: 'string', description: 'Búsqueda por título o descripción' },
        pagina: { type: 'number', description: 'Página (default 1)' },
        limite: { type: 'number', description: 'Por página (default 20)' }
      }
    }
  },
  {
    name: 'obtener_tarea',
    description: 'Obtiene detalle de una tarea específica con comentarios',
    inputSchema: {
      type: 'object',
      properties: {
        tarea_id: { type: 'number', description: 'ID de la tarea' }
      },
      required: ['tarea_id']
    }
  },
  {
    name: 'buscar_tareas',
    description: 'Busca tareas por título o descripción',
    inputSchema: {
      type: 'object',
      properties: {
        q: { type: 'string', description: 'Término de búsqueda' },
        limite: { type: 'number', description: 'Máximo de resultados (default 20)' }
      },
      required: ['q']
    }
  },
  {
    name: 'crear_tarea',
    description: 'Crea una nueva tarea en un proyecto',
    inputSchema: {
      type: 'object',
      properties: {
        proyecto_id: { type: 'number', description: 'ID del proyecto' },
        titulo: { type: 'string', description: 'Título de la tarea' },
        descripcion: { type: 'string', description: 'Descripción detallada' },
        tipo: { type: 'string', description: 'Tipo de tarea (tarea, bug, feature, mejora)' },
        prioridad: { type: 'string', description: 'Prioridad (baja, media, alta, critica)' },
        asignado_a: { type: 'number', description: 'ID del usuario asignado' },
        fecha_limite: { type: 'string', description: 'Fecha límite YYYY-MM-DD' },
        estimacion_horas: { type: 'number', description: 'Estimación en horas' }
      },
      required: ['titulo']
    }
  },
  {
    name: 'actualizar_tarea',
    description: 'Actualiza una tarea existente',
    inputSchema: {
      type: 'object',
      properties: {
        tarea_id: { type: 'number', description: 'ID de la tarea' },
        titulo: { type: 'string', description: 'Nuevo título' },
        descripcion: { type: 'string', description: 'Nueva descripción' },
        estado: { type: 'string', description: 'Nuevo estado (pendiente, en_progreso, revision, completada)' },
        prioridad: { type: 'string', description: 'Nueva prioridad' },
        asignado_a: { type: 'number', description: 'Nuevo usuario asignado' },
        fecha_limite: { type: 'string', description: 'Nueva fecha límite' }
      },
      required: ['tarea_id']
    }
  },
  {
    name: 'comentarios',
    description: 'Lista los comentarios de una tarea',
    inputSchema: {
      type: 'object',
      properties: {
        tarea_id: { type: 'number', description: 'ID de la tarea' }
      },
      required: ['tarea_id']
    }
  },
  {
    name: 'agregar_comentario',
    description: 'Agrega un comentario a una tarea',
    inputSchema: {
      type: 'object',
      properties: {
        tarea_id: { type: 'number', description: 'ID de la tarea' },
        contenido: { type: 'string', description: 'Texto del comentario' }
      },
      required: ['tarea_id', 'contenido']
    }
  },
  {
    name: 'aprobar_tarea',
    description: 'Aprueba una tarea en estado revisión',
    inputSchema: {
      type: 'object',
      properties: {
        tarea_id: { type: 'number', description: 'ID de la tarea' }
      },
      required: ['tarea_id']
    }
  },
  {
    name: 'rechazar_tarea',
    description: 'Rechaza una tarea en estado revisión',
    inputSchema: {
      type: 'object',
      properties: {
        tarea_id: { type: 'number', description: 'ID de la tarea' },
        motivo: { type: 'string', description: 'Motivo del rechazo' }
      },
      required: ['tarea_id', 'motivo']
    }
  },
  {
    name: 'estadisticas',
    description: 'Estadísticas generales: tareas por prioridad, tiempo estimado vs real, productividad por usuario',
    inputSchema: { type: 'object', properties: {} }
  }
];

async function ejecutarTool(name, args, userId) {
  switch (name) {
    case 'dashboard': {
      const [porEstado, porAsignado, recientes, pendientesAprobacion] = await Promise.all([
        pool.query(`SELECT estado, COUNT(*) as total FROM projects.tareas GROUP BY estado`),
        pool.query(`SELECT u.nombre, COUNT(*) as total FROM projects.tareas t LEFT JOIN usuarios u ON t.asignado_a = u.id WHERE t.asignado_a IS NOT NULL GROUP BY t.asignado_a, u.nombre ORDER BY total DESC`),
        pool.query(`SELECT t.id, t.titulo, t.estado, t.prioridad, t.fecha_limite, p.nombre as proyecto FROM projects.tareas t LEFT JOIN projects.proyectos p ON t.proyecto_id = p.id ORDER BY t.created_at DESC LIMIT 10`),
        pool.query(`SELECT COUNT(*) as total FROM projects.tareas WHERE estado_aprobacion = 'pendiente' AND estado = 'revision'`)
      ]);
      return {
        tareas_por_estado: porEstado.rows,
        tareas_por_asignado: porAsignado.rows,
        tareas_recientes: recientes.rows,
        aprobacion_pendiente: parseInt(pendientesAprobacion.rows[0]?.total || 0)
      };
    }

    case 'listar_proyectos': {
      const { estado, q, limite } = args;
      let where = 'WHERE 1=1';
      const params = [];
      if (estado) { params.push(estado); where += ` AND p.estado = $${params.length}`; }
      if (q) { params.push(`%${q}%`); where += ` AND p.nombre ILIKE $${params.length}`; }
      params.push(Math.min(parseInt(limite) || 50, 200));
      const result = await pool.query(`
        SELECT p.id, p.nombre, p.descripcion, p.estado, p.fecha_limite, p.created_at,
          COUNT(t.id) FILTER (WHERE t.estado = 'pendiente') as pendientes,
          COUNT(t.id) FILTER (WHERE t.estado = 'en_progreso') as en_progreso,
          COUNT(t.id) FILTER (WHERE t.estado = 'completada') as completadas,
          COUNT(t.id) as total_tareas
        FROM projects.proyectos p
        LEFT JOIN projects.tareas t ON t.proyecto_id = p.id
        ${where}
        GROUP BY p.id ORDER BY p.created_at DESC LIMIT $${params.length}
      `, params);
      return result.rows;
    }

    case 'obtener_proyecto': {
      const { proyecto_id } = args;
      const [proyecto, tareas] = await Promise.all([
        pool.query('SELECT * FROM projects.proyectos WHERE id = $1', [proyecto_id]),
        pool.query('SELECT id, titulo, estado, prioridad, asignado_a, fecha_limite FROM projects.tareas WHERE proyecto_id = $1 ORDER BY orden', [proyecto_id])
      ]);
      if (!proyecto.rows.length) return { error: 'Proyecto no encontrado' };
      return { ...proyecto.rows[0], tareas: tareas.rows };
    }

    case 'crear_proyecto': {
      const { nombre, descripcion, fecha_limite, asignado_a } = args;
      const result = await pool.query(
        `INSERT INTO projects.proyectos (nombre, descripcion, fecha_limite, asignado_a) VALUES ($1, $2, $3, $4) RETURNING *`,
        [nombre, descripcion || '', fecha_limite || null, asignado_a || null]
      );
      return result.rows[0];
    }

    case 'listar_tareas': {
      const { proyecto_id, estado, prioridad, asignado_a, q, pagina, limite } = args;
      let where = 'WHERE 1=1';
      const params = [];
      if (proyecto_id) { params.push(proyecto_id); where += ` AND t.proyecto_id = $${params.length}`; }
      if (estado) { params.push(estado); where += ` AND t.estado = $${params.length}`; }
      if (prioridad) { params.push(prioridad); where += ` AND t.prioridad = $${params.length}`; }
      if (asignado_a) { params.push(asignado_a); where += ` AND t.asignado_a = $${params.length}`; }
      if (q) { params.push(`%${q}%`); where += ` AND (t.titulo ILIKE $${params.length} OR t.descripcion ILIKE $${params.length})`; }
      const page = Math.max(parseInt(pagina) || 1, 1);
      const perPage = Math.min(parseInt(limite) || 20, 100);
      params.push(perPage, (page - 1) * perPage);
      const result = await pool.query(`
        SELECT t.id, t.titulo, t.descripcion, t.estado, t.prioridad, t.tipo, t.fecha_limite,
               t.estimacion_horas, t.horas_invertidas, t.created_at,
               p.nombre as proyecto, u.nombre as asignado_nombre
        FROM projects.tareas t
        LEFT JOIN projects.proyectos p ON t.proyecto_id = p.id
        LEFT JOIN usuarios u ON t.asignado_a = u.id
        ${where}
        ORDER BY t.created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}
      `, params);
      return { tareas: result.rows, pagina: page, limite: perPage };
    }

    case 'obtener_tarea': {
      const { tarea_id } = args;
      const [tarea, comentarios] = await Promise.all([
        pool.query(`SELECT t.*, p.nombre as proyecto FROM projects.tareas t LEFT JOIN projects.proyectos p ON t.proyecto_id = p.id WHERE t.id = $1`, [tarea_id]),
        pool.query(`SELECT c.*, u.nombre as autor FROM projects.comentarios c LEFT JOIN usuarios u ON c.usuario_id = u.id WHERE c.tarea_id = $1 ORDER BY c.created_at`, [tarea_id])
      ]);
      if (!tarea.rows.length) return { error: 'Tarea no encontrada' };
      return { ...tarea.rows[0], comentarios: comentarios.rows };
    }

    case 'buscar_tareas': {
      const { q, limite } = args;
      const result = await pool.query(`
        SELECT t.id, t.titulo, t.estado, t.prioridad, p.nombre as proyecto
        FROM projects.tareas t
        LEFT JOIN projects.proyectos p ON t.proyecto_id = p.id
        WHERE t.titulo ILIKE $1 OR t.descripcion ILIKE $1
        ORDER BY t.created_at DESC LIMIT $2
      `, [`%${q}%`, Math.min(parseInt(limite) || 20, 100)]);
      return result.rows;
    }

    case 'crear_tarea': {
      const { proyecto_id, titulo, descripcion, tipo, prioridad, asignado_a, fecha_limite, estimacion_horas } = args;
      const result = await pool.query(
        `INSERT INTO projects.tareas (proyecto_id, titulo, descripcion, tipo, prioridad, asignado_a, reportero, fecha_limite, estimacion_horas)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
        [proyecto_id || null, titulo, descripcion || '', tipo || 'tarea', prioridad || 'media', asignado_a || null, userId, fecha_limite || null, estimacion_horas || null]
      );
      return result.rows[0];
    }

    case 'actualizar_tarea': {
      const { tarea_id, ...fields } = args;
      const sets = [];
      const params = [];
      for (const [key, val] of Object.entries(fields)) {
        if (val !== undefined && ['titulo', 'descripcion', 'estado', 'prioridad', 'asignado_a', 'fecha_limite'].includes(key)) {
          params.push(val);
          sets.push(`${key} = $${params.length}`);
        }
      }
      if (!sets.length) return { error: 'No hay campos para actualizar' };
      params.push(tarea_id);
      const result = await pool.query(`UPDATE projects.tareas SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $${params.length} RETURNING *`, params);
      return result.rows[0] || { error: 'Tarea no encontrada' };
    }

    case 'comentarios': {
      const { tarea_id } = args;
      const result = await pool.query(`
        SELECT c.*, u.nombre as autor FROM projects.comentarios c
        LEFT JOIN usuarios u ON c.usuario_id = u.id
        WHERE c.tarea_id = $1 ORDER BY c.created_at
      `, [tarea_id]);
      return result.rows;
    }

    case 'agregar_comentario': {
      const { tarea_id, contenido } = args;
      const result = await pool.query(
        `INSERT INTO projects.comentarios (tarea_id, usuario_id, contenido) VALUES ($1, $2, $3) RETURNING *`,
        [tarea_id, userId, contenido]
      );
      return result.rows[0];
    }

    case 'aprobar_tarea': {
      const { tarea_id } = args;
      const result = await pool.query(
        `UPDATE projects.tareas SET estado = 'completada', estado_aprobacion = 'aprobada', aprobado_por = $1, aprobado_en = NOW() WHERE id = $2 AND estado = 'revision' AND estado_aprobacion = 'pendiente' RETURNING *`,
        [userId, tarea_id]
      );
      return result.rows[0] || { error: 'Tarea no encontrada o no elegible para aprobación' };
    }

    case 'rechazar_tarea': {
      const { tarea_id, motivo } = args;
      const result = await pool.query(
        `UPDATE projects.tareas SET estado = 'en_progreso', estado_aprobacion = 'rechazada', motivo_rechazo = $1, aprobado_por = $2, aprobado_en = NOW() WHERE id = $3 AND estado = 'revision' AND estado_aprobacion = 'pendiente' RETURNING *`,
        [motivo, userId, tarea_id]
      );
      return result.rows[0] || { error: 'Tarea no encontrada o no elegible para rechazo' };
    }

    case 'estadisticas': {
      const [porPrioridad, tiempoEstimado, porUsuario] = await Promise.all([
        pool.query(`SELECT prioridad, COUNT(*) as total FROM projects.tareas GROUP BY prioridad`),
        pool.query(`SELECT SUM(estimacion_horas) as total_estimado, SUM(horas_invertidas) as total_real, COUNT(*) as total_tareas FROM projects.tareas WHERE estimacion_horas IS NOT NULL OR horas_invertidas > 0`),
        pool.query(`SELECT u.nombre, COUNT(*) as tareas, SUM(CASE WHEN t.estado = 'completada' THEN 1 ELSE 0 END) as completadas FROM projects.tareas t LEFT JOIN usuarios u ON t.asignado_a = u.id WHERE t.asignado_a IS NOT NULL GROUP BY t.asignado_a, u.nombre`)
      ]);
      return {
        por_prioridad: porPrioridad.rows,
        tiempo: tiempoEstimado.rows[0],
        por_usuario: porUsuario.rows
      };
    }

    default:
      throw new Error('Tool no encontrada: ' + name);
  }
}

const sessions = new Map();

export function createMiddleware() {
  return (req, res) => {
    if (req.method === 'GET') return res.json({ status: 'ok', server: 'proyectos-mcp' });
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    if (!req.body || req.body.jsonrpc !== '2.0') {
      return res.status(400).json({ jsonrpc: '2.0', error: { code: -32600, message: 'Invalid Request' }, id: null });
    }
    const msg = req.body;
    const sessionId = req.headers['mcp-session-id'];
    const id = msg.id ?? null;
    switch (msg.method) {
      case 'initialize': {
        const newSessionId = crypto.randomUUID();
        sessions.set(newSessionId, { createdAt: Date.now() });
        res.setHeader('mcp-session-id', newSessionId);
        return res.json({ jsonrpc: '2.0', id, result: { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'proyectos', version: '1.0.0' } } });
      }
      case 'ping': return res.json({ jsonrpc: '2.0', id, result: {} });
      case 'tools/list':
        if (!sessionId || !sessions.has(sessionId)) return res.status(401).json({ jsonrpc: '2.0', error: { code: -32001, message: 'Sesión inválida' }, id });
        return res.json({ jsonrpc: '2.0', id, result: { tools: TOOLS } });
      case 'tools/call': {
        if (!sessionId || !sessions.has(sessionId)) return res.status(401).json({ jsonrpc: '2.0', error: { code: -32001, message: 'Sesión inválida' }, id });
        const { name, arguments: args } = msg.params || {};
        ejecutarTool(name, args || {}, req.user?.id).then(result => {
          res.json({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] } });
        }).catch(err => {
          res.json({ jsonrpc: '2.0', id, result: { isError: true, content: [{ type: 'text', text: 'Error: ' + err.message }] } });
        });
        return;
      }
      case 'notifications/initialized': return res.status(202).end();
      default: return res.status(400).json({ jsonrpc: '2.0', error: { code: -32601, message: 'Method not found' }, id });
    }
  };
}
