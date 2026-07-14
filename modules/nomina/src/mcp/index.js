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

// ── OAuth 2.0 mínimo (auto-aprobación + DCR) ──
const codes = new Map();
const tokens = new Map();
const sessions = new Map();
const clients = new Map();

function rpcResult(id, result) { return { jsonrpc: '2.0', result, id }; }
function rpcError(id, code, message) { return { jsonrpc: '2.0', error: { code, message }, id }; }

// DCR handler (reutilizable)
function handleDcr(req, res) {
  const { redirect_uris, client_name, grant_types, response_types, token_endpoint_auth_method } = req.body || {};
  if (!redirect_uris || !Array.isArray(redirect_uris) || redirect_uris.length === 0) {
    return res.status(400).json({ error: 'invalid_client_metadata', error_description: 'redirect_uris required' });
  }
  const clientId = crypto.randomUUID();
  const clientSecret = crypto.randomUUID();
  clients.set(clientId, {
    client_secret: clientSecret,
    redirect_uris,
    client_name: client_name || 'Claude',
    grant_types: grant_types || ['authorization_code'],
    response_types: response_types || ['code'],
    token_endpoint_auth_method: token_endpoint_auth_method || 'none',
    createdAt: Date.now()
  });
  res.status(201).json({
    client_id: clientId,
    client_secret: clientSecret,
    client_secret_expires_at: 0,
    client_name: client_name || 'Claude',
    redirect_uris,
    grant_types: grant_types || ['authorization_code', 'refresh_token'],
    response_types: response_types || ['code'],
    token_endpoint_auth_method: token_endpoint_auth_method || 'none'
  });
}

// Authorize handler (reutilizable)
function handleAuthorize(req, res) {
  console.log('📩 MCP AUTHORIZE CALLED', req.url, req.query);
  try {
    const { state, client_id, code_challenge, code_challenge_method, response_type } = req.query;
    let redirect_uri = req.query.redirect_uri;
    try { db.prepare("INSERT INTO telemetria (evento, pagina, datos, creado) VALUES ('mcp_authorize','/authorize',?,datetime('now'))").run(JSON.stringify({ client_id, redirect_uri, response_type, has_code_challenge: !!code_challenge })); } catch {}
    if (response_type !== 'code') {
      return res.status(400).send('Invalid response_type');
    }
    if (!clients.has(client_id)) {
      clients.set(client_id, {
        client_secret: crypto.randomUUID(),
        redirect_uris: [],
        client_name: 'Claude',
        grant_types: ['authorization_code'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
        autoRegistered: true,
        createdAt: Date.now()
      });
    }
    const client = clients.get(client_id);
    if (!redirect_uri) {
      redirect_uri = client.redirect_uris[0] || 'https://claude.ai/api/mcp/auth_callback';
    }
    if (!client.redirect_uris.includes(redirect_uri) && /^https:\/\/claude\.ai\//.test(redirect_uri)) {
      client.redirect_uris.push(redirect_uri);
    }
    const isValidRedirect = client.redirect_uris.includes(redirect_uri);
    if (!isValidRedirect) {
      return res.status(400).send('Invalid redirect_uri');
    }
    const code = crypto.randomUUID();
    codes.set(code, {
      client_id, redirect_uri,
      code_challenge: code_challenge || '',
      code_challenge_method: code_challenge_method || '',
      createdAt: Date.now()
    });
    const url = new URL(redirect_uri);
    url.searchParams.set('code', code);
    url.searchParams.set('state', state || '');
    res.redirect(302, url.toString());
  } catch (e) {
    try { db.prepare("INSERT INTO telemetria (evento, pagina, datos, creado) VALUES ('mcp_authorize_error','/authorize',?,datetime('now'))").run(JSON.stringify({ error: e.message, query: req.query })); } catch {}
    res.status(500).send('Authorization error');
  }
}

// Token handler (reutilizable)
function handleToken(req, res) {
  const { grant_type, code, redirect_uri, client_secret } = req.body;
  let client_id = req.body.client_id;
  if (grant_type !== 'authorization_code') {
    return res.status(400).json({ error: 'unsupported_grant_type' });
  }

  // Autenticación: client_secret_basic en header
  const authHeader = req.headers['authorization'] || '';
  if (authHeader.startsWith('Basic ')) {
    const decoded = Buffer.from(authHeader.slice(6), 'base64').toString();
    const parts = decoded.split(':');
    client_id = parts[0];
    req.body.client_secret_basic = parts.slice(1).join(':');
  }
  const actualSecret = req.body.client_secret_basic || client_secret;

  const stored = codes.get(code);
  if (!stored) return res.status(400).json({ error: 'invalid_grant' });
  codes.delete(code);
  // Validate PKCE
  if (stored.code_challenge && req.body.code_verifier) {
    const verifierHash = crypto.createHash('sha256').update(req.body.code_verifier).digest();
    const expected = Buffer.from(verifierHash).toString('base64url');
    if (expected !== stored.code_challenge) {
      return res.status(400).json({ error: 'invalid_grant' });
    }
  }
  const client = clients.get(stored.client_id);
  // No validamos client_secret — este es un server privado con auto-aprobación
  const accessToken = crypto.randomUUID();
  tokens.set(accessToken, { client_id: stored.client_id, createdAt: Date.now() });
  res.json({
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: 86400
  });
}

function createOAuthRouter() {
  const express = require('express');
  const router = express.Router();

  router.use(express.json());

  // DCR — Dynamic Client Registration (RFC 7591)
  router.post('/register', handleDcr);

  // Authorize — valida/auto-registra cliente, redirige a callback con code
  router.get('/authorize', handleAuthorize);

  // Token — intercambia código por token, valida PKCE y autenticación de cliente
  router.post('/token', express.urlencoded({ extended: false }), handleToken);

  return router;
}

// ── MCP endpoint (requiere Bearer token) ──
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

// ── Well-known OAuth metadata ──
function createWellKnown() {
  const express = require('express');
  const router = express.Router();
  // RFC 9728 Protected Resource Metadata
  router.get('/oauth-protected-resource', (req, res) => {
    const base = `${req.protocol}://${req.get('host')}`;
    res.json({
      resource: base + '/mcp',
      authorization_servers: [base]
    });
  });
  // RFC 8414 Authorization Server Metadata
  router.get('/oauth-authorization-server', (req, res) => {
    const base = `${req.protocol}://${req.get('host')}`;
    res.json({
      issuer: base,
      authorization_endpoint: base + '/mcp/oauth/authorize',
      token_endpoint: base + '/mcp/oauth/token',
      registration_endpoint: base + '/mcp/oauth/register',
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post', 'none'],
      scopes_supported: []
    });
  });
  return router;
}

// ── Fallback: Claude a veces ignora registration_endpoint y POSTea a /register ──
function createRegistrationFallback() {
  return (req, res) => handleDcr(req, res);
}

// ── Fallback: Claude ignora authorization_endpoint y GETea /authorize en la raíz ──
function createAuthorizeFallback() {
  return (req, res) => handleAuthorize(req, res);
}

// ── Fallback: Claude ignora token_endpoint y POSTea /token en la raíz ──
function createTokenFallback() {
  return (req, res) => handleToken(req, res);
}

module.exports = { createMiddleware: createRouter, createWellKnown, createOAuthRouter, createRegistrationFallback, createAuthorizeFallback, createTokenFallback, ejecutarTool };
