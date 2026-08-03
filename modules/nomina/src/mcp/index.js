const { db } = require('../db');
const crypto = require('crypto');

const TOOLS = [
  {
    name: 'consultar',
    description: 'Consulta datos de una tabla con filtros opcionales.',
    inputSchema: {
      type: 'object', properties: {
        tabla: { type: 'string', description: 'Nombre de la tabla' },
        columnas: { type: 'array', items: { type: 'string' }, description: 'Columnas a seleccionar' },
        donde: { type: 'object', description: 'Filtros campo:valor' },
        orden: { type: 'string', description: 'Orden (ej: nombre ASC)' },
        limite: { type: 'number', description: 'Límite de filas (máx 200)' }
      }, required: ['tabla']
    }
  },
  {
    name: 'describir',
    description: 'Muestra el esquema de una tabla.',
    inputSchema: {
      type: 'object', properties: {
        tabla: { type: 'string', description: 'Nombre de la tabla' }
      }, required: ['tabla']
    }
  },
  {
    name: 'tablas',
    description: 'Lista todas las tablas con su cantidad de filas.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'registros',
    description: 'Busca registros de horas extra con filtros opcionales.',
    inputSchema: {
      type: 'object', properties: {
        sede: { type: 'string' }, estado: { type: 'string', enum: ['pendiente', 'aprobado', 'rechazado'] },
        empleadoId: { type: 'string' }, nominaId: { type: 'string' },
        fechaInicio: { type: 'string' }, fechaFin: { type: 'string' },
        tipo: { type: 'string' }, limite: { type: 'number', default: 50 }
      }
    }
  },
  {
    name: 'resumen_por_sede',
    description: 'Agrupa registros por sede.',
    inputSchema: { type: 'object', properties: { fechaInicio: { type: 'string' }, fechaFin: { type: 'string' } } }
  },
  {
    name: 'resumen_por_estado',
    description: 'Cantidad de registros agrupados por estado.',
    inputSchema: { type: 'object', properties: { fechaInicio: { type: 'string' }, fechaFin: { type: 'string' } } }
  },
  {
    name: 'empleados',
    description: 'Busca empleados por nombre, cédula o sede.',
    inputSchema: { type: 'object', properties: { termino: { type: 'string' }, sede: { type: 'string' }, limite: { type: 'number', default: 50 } } }
  },
  {
    name: 'nominas',
    description: 'Lista los períodos de nómina.',
    inputSchema: { type: 'object', properties: { limite: { type: 'number', default: 20 } } }
  },
  {
    name: 'tipos',
    description: 'Lista los tipos de horas extra activos.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'estadisticas',
    description: 'Estadísticas generales del sistema.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'empleado_detalle',
    description: 'Detalle completo de un empleado y sus registros.',
    inputSchema: { type: 'object', properties: { empleadoId: { type: 'string' } }, required: ['empleadoId'] }
  },
  {
    name: 'crear_registro',
    description: 'Crea un nuevo registro de horas extra.',
    inputSchema: {
      type: 'object', properties: {
        empleadoId: { type: 'string' }, nominaId: { type: 'string' },
        fecha: { type: 'string' }, horas: { type: 'number' },
        tipo: { type: 'string' }, concepto: { type: 'string' },
        observaciones: { type: 'string' }, transporte: { type: 'number' }
      }, required: ['empleadoId', 'nominaId', 'fecha', 'horas', 'tipo']
    }
  },
  {
    name: 'aprobar_rechazar',
    description: 'Aprueba o rechaza un registro de horas extra.',
    inputSchema: {
      type: 'object', properties: {
        registroId: { type: 'string' },
        estado: { type: 'string', enum: ['aprobado', 'rechazado'] },
        motivo: { type: 'string' }
      }, required: ['registroId', 'estado']
    }
  },
  {
    name: 'crear_empleado',
    description: 'Da de alta un nuevo empleado.',
    inputSchema: {
      type: 'object', properties: {
        nombre: { type: 'string' }, cedula: { type: 'string' },
        cargo: { type: 'string' }, departamento: { type: 'string' },
        sede: { type: 'string' }, email: { type: 'string' },
        telefono: { type: 'string' }
      }, required: ['nombre', 'cedula', 'cargo', 'departamento']
    }
  },
  {
    name: 'reporte_mensual',
    description: 'Genera reporte mensual de horas extra por sede.',
    inputSchema: {
      type: 'object', properties: {
        mes: { type: 'number', description: '1-12' },
        anio: { type: 'number' }
      }
    }
  },
  {
    name: 'exportar_csv',
    description: 'Exporta registros como CSV.',
    inputSchema: {
      type: 'object', properties: {
        estado: { type: 'string' }, sede: { type: 'string' },
        fechaInicio: { type: 'string' }, fechaFin: { type: 'string' },
        limite: { type: 'number', default: 200 }
      }
    }
  }
];

async function ejecutarTool(name, args) {
  switch (name) {
    case 'consultar': {
      const { tabla, columnas, donde, orden, limite } = args;
      if (!tabla) throw new Error('tabla requerida');
      if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(tabla)) throw new Error('Nombre de tabla inválido');
      const cols = Array.isArray(columnas) && columnas.length
        ? columnas.map(function(c) { if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(c)) throw new Error('Columna inválida'); return c; }).join(', ')
        : '*';
      let sql = 'SELECT ' + cols + ' FROM ' + tabla;
      const params = [];
      if (donde && typeof donde === 'object') {
        const clauses = Object.entries(donde).map(function([k, v]) {
          if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(k)) throw new Error('Campo inválido');
          params.push(v);
          return k + ' = ?';
        });
        if (clauses.length) sql += ' WHERE ' + clauses.join(' AND ');
      }
      if (orden) {
        if (!/^[a-zA-Z_][a-zA-Z0-9_]*(\s+(ASC|DESC))?$/i.test(orden)) throw new Error('Orden inválido');
        sql += ' ORDER BY ' + orden;
      }
      if (limite) {
        params.push(Math.min(parseInt(limite) || 50, 200));
        sql += ' LIMIT ?';
      }
      return db.prepare(sql).all(...params);
    }
    case 'describir': return db.prepare('SELECT * FROM pragma_table_info(?)').all(args.tabla);
    case 'tablas': {
      return db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(t => {
        const c = db.prepare(`SELECT COUNT(*) AS cnt FROM ${JSON.stringify(t.name)}`).get();
        return { nombre: t.name, filas: c.cnt };
      });
    }
    case 'registros': {
      const c = [], p = [];
      if (args.sede) { c.push('e.sede=?'); p.push(args.sede); }
      if (args.estado) { c.push('r.estado=?'); p.push(args.estado); }
      if (args.empleadoId) { c.push('r.empleadoId=?'); p.push(args.empleadoId); }
      if (args.nominaId) { c.push('r.nominaId=?'); p.push(args.nominaId); }
      if (args.tipo) { c.push('r.tipo=?'); p.push(args.tipo); }
      if (args.fechaInicio) { c.push('r.fecha>=?'); p.push(args.fechaInicio); }
      if (args.fechaFin) { c.push('r.fecha<=?'); p.push(args.fechaFin); }
      const w = c.length ? 'WHERE ' + c.join(' AND ') : '';
      const lim = Math.min(parseInt(args.limite) || 50, 200);
      return db.prepare(`SELECT r.*,e.nombre AS empleadoNombre,e.cedula,e.sede,e.departamento FROM registros r JOIN empleados e ON r.empleadoId=e.id ${w} ORDER BY r.fecha DESC LIMIT ?`).all(...p, lim);
    }
    case 'resumen_por_sede': {
      const p = []; let w = '';
      if (args.fechaInicio && args.fechaFin) { w = 'WHERE r.fecha>=? AND r.fecha<=?'; p.push(args.fechaInicio, args.fechaFin); }
      return db.prepare(`SELECT e.sede,COUNT(*) AS total,SUM(r.horas) AS horas,r.estado FROM registros r JOIN empleados e ON r.empleadoId=e.id ${w} GROUP BY e.sede,r.estado ORDER BY e.sede,r.estado`).all(...p);
    }
    case 'resumen_por_estado': {
      const p = []; let w = '';
      if (args.fechaInicio && args.fechaFin) { w = 'WHERE r.fecha>=? AND r.fecha<=?'; p.push(args.fechaInicio, args.fechaFin); }
      return db.prepare(`SELECT r.estado,COUNT(*) AS total,SUM(r.horas) AS horas FROM registros r ${w} GROUP BY r.estado`).all(...p);
    }
    case 'empleados': {
      const p = []; let w = '';
      if (args.termino) { w = 'WHERE e.nombre LIKE ? OR e.cedula LIKE ?'; p.push(`%${args.termino}%`, `%${args.termino}%`); }
      if (args.sede) { w = w ? `${w} AND e.sede=?` : 'WHERE e.sede=?'; p.push(args.sede); }
      const lim = Math.min(parseInt(args.limite) || 50, 200);
      return db.prepare(`SELECT * FROM empleados e ${w} ORDER BY e.nombre LIMIT ?`).all(...p, lim);
    }
    case 'nominas': return db.prepare('SELECT * FROM nominas ORDER BY inicio DESC LIMIT ?').all(Math.min(parseInt(args.limite) || 20, 100));
    case 'tipos': return db.prepare('SELECT * FROM tipos WHERE activo=1 ORDER BY id').all();
    case 'estadisticas': {
      return {
        totalRegistros: db.prepare('SELECT COUNT(*) AS c FROM registros').get().c,
        totalEmpleados: db.prepare('SELECT COUNT(*) AS c FROM empleados').get().c,
        totalHoras: db.prepare('SELECT COALESCE(SUM(horas),0) AS h FROM registros').get().h,
        pendientes: db.prepare("SELECT COUNT(*) AS c FROM registros WHERE estado='pendiente'").get().c,
        aprobados: db.prepare("SELECT COUNT(*) AS c FROM registros WHERE estado='aprobado'").get().c,
        sedes: db.prepare('SELECT COUNT(DISTINCT sede) AS c FROM empleados').get().c
      };
    }
    case 'empleado_detalle': {
      const emp = db.prepare('SELECT * FROM empleados WHERE id=?').get(args.empleadoId);
      if (!emp) throw new Error('Empleado no encontrado');
      const registros = db.prepare('SELECT r.*,t.nombre AS tipoNombre FROM registros r LEFT JOIN tipos t ON r.tipo=t.id WHERE r.empleadoId=? ORDER BY r.fecha DESC LIMIT 50').all(args.empleadoId);
      return { empleado: emp, registros };
    }
    case 'crear_registro': {
      const emp = db.prepare('SELECT activo FROM empleados WHERE id=?').get(args.empleadoId);
      if (!emp) throw new Error('Empleado no encontrado');
      if (emp.activo !== 1) throw new Error('No se pueden registrar novedades a un empleado inactivo');
      const id = require('crypto').randomUUID();
      const ahora = new Date().toISOString();
      db.prepare(`INSERT INTO registros (id, empleadoId, nominaId, fecha, horas, tipo, concepto, observaciones, transporte, sede, estado, creado, aprobador, motivo) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        id, args.empleadoId, args.nominaId, args.fecha, args.horas, args.tipo,
        args.concepto || '', args.observaciones || '', args.transporte || 0,
        args.sede || 'Principal', 'pendiente', ahora, '', ''
      );
      return { id, creado: ahora, estado: 'pendiente' };
    }
    case 'aprobar_rechazar': {
      const reg = db.prepare('SELECT * FROM registros WHERE id=?').get(args.registroId);
      if (!reg) throw new Error('Registro no encontrado');
      const ahora = new Date().toISOString();
      db.prepare('UPDATE registros SET estado=?, aprobadoPor=?, fechaAprobado=?, motivo=? WHERE id=?')
        .run(args.estado, 'mcp', ahora, args.motivo || '', args.registroId);
      return { id: args.registroId, estado: args.estado, actualizado: ahora };
    }
    case 'crear_empleado': {
      const id = require('crypto').randomUUID();
      db.prepare('INSERT INTO empleados (id, nombre, cedula, cargo, departamento, sede, email, telefono) VALUES (?,?,?,?,?,?,?,?)')
        .run(id, args.nombre, args.cedula, args.cargo, args.departamento, args.sede || 'Principal', args.email || '', args.telefono || '');
      return { id, nombre: args.nombre, creado: true };
    }
    case 'reporte_mensual': {
      const mes = args.mes || new Date().getMonth() + 1;
      const anio = args.anio || new Date().getFullYear();
      const prefijo = `${anio}-${String(mes).padStart(2, '0')}`;
      return db.prepare(`
        SELECT e.sede, e.departamento, COUNT(*) AS total_registros,
               SUM(r.horas) AS total_horas, AVG(r.horas) AS promedio_horas,
               SUM(CASE WHEN r.estado='pendiente' THEN 1 ELSE 0 END) AS pendientes,
               SUM(CASE WHEN r.estado='aprobado' THEN 1 ELSE 0 END) AS aprobados,
               SUM(CASE WHEN r.estado='rechazado' THEN 1 ELSE 0 END) AS rechazados
        FROM registros r JOIN empleados e ON r.empleadoId=e.id
        WHERE r.fecha LIKE ?
        GROUP BY e.sede, e.departamento ORDER BY e.sede, e.departamento
      `).all(prefijo + '%');
    }
    case 'exportar_csv': {
      const c = [], p = [];
      if (args.estado) { c.push('r.estado=?'); p.push(args.estado); }
      if (args.sede) { c.push('e.sede=?'); p.push(args.sede); }
      if (args.fechaInicio) { c.push('r.fecha>=?'); p.push(args.fechaInicio); }
      if (args.fechaFin) { c.push('r.fecha<=?'); p.push(args.fechaFin); }
      const w = c.length ? 'WHERE ' + c.join(' AND ') : '';
      const lim = Math.min(parseInt(args.limite) || 200, 1000);
      const rows = db.prepare(`SELECT r.id,r.fecha,r.horas,r.tipo,r.estado,r.concepto,r.observaciones,r.transporte,e.nombre AS empleado,e.cedula,e.sede,e.departamento FROM registros r JOIN empleados e ON r.empleadoId=e.id ${w} ORDER BY r.fecha DESC LIMIT ?`).all(...p, lim);
      const headers = ['id','fecha','horas','tipo','estado','concepto','observaciones','transporte','empleado','cedula','sede','departamento'];
      const esc = v => '"' + String(v).replace(/"/g, '""') + '"';
      const lines = rows.map(r => headers.map(h => esc(r[h])).join(','));
      return headers.join(',') + '\n' + lines.join('\n');
    }
    default: throw new Error('Tool no encontrada: ' + name);
  }
}

function rpcResult(id, result) { return { jsonrpc: '2.0', result, id }; }
function rpcError(id, code, message) { return { jsonrpc: '2.0', error: { code, message }, id }; }

// ── MCP endpoint ──
function createRouter() {
  const express = require('express');
  const router = express.Router();

  router.use(express.json());

  // GET — health check
  router.get('/', (req, res) => res.json({ status: 'ok', server: 'synnox-nomina-mcp' }));

  // Sin OAuth por ahora — aceptamos todas las requests
  router.use((req, res, next) => next());

  // GET — health check
  router.get('/', (req, res) => res.json({ status: 'ok', server: 'synnox-nomina-mcp' }));

  // POST — MCP JSON-RPC
  router.post('/', (req, res) => {
    const msg = req.body;
    if (!msg || msg.jsonrpc !== '2.0') {
      return res.status(400).json(rpcError(null, -32600, 'Invalid Request'));
    }

    const sessionId = req.headers['mcp-session-id'];
    const id = msg.id ?? null;

    switch (msg.method) {
      case 'initialize': {
        const newSessionId = crypto.randomUUID();
        sessions.set(newSessionId, { createdAt: Date.now() });
        res.setHeader('mcp-session-id', newSessionId);
        return res.json(rpcResult(id, {
          protocolVersion: '2025-03-26',
          capabilities: { tools: {} },
          serverInfo: { name: 'synnox-nomina-mcp', version: '1.0.0' }
        }));
      }

      case 'tools/list': {
        if (!sessionId || !sessions.has(sessionId)) {
          return res.status(401).json(rpcError(id, -32001, 'Sesión inválida'));
        }
        return res.json(rpcResult(id, { tools: TOOLS }));
      }

      case 'tools/call': {
        if (!sessionId || !sessions.has(sessionId)) {
          return res.status(401).json(rpcError(id, -32001, 'Sesión inválida'));
        }
        const { name, arguments: args } = msg.params || {};
        ejecutarTool(name, args || {}).then(result => {
          res.json(rpcResult(id, { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }));
        }).catch(err => {
          res.json(rpcResult(id, { isError: true, content: [{ type: 'text', text: 'Error: ' + err.message }] }));
        });
        return;
      }

      case 'notifications/initialized':
        return res.status(202).end();

      default:
        return res.status(400).json(rpcError(id, -32601, 'Method not found'));
    }
  });

  return router;
}

const sessions = new Map();

module.exports = { createMiddleware: createRouter, ejecutarTool };
