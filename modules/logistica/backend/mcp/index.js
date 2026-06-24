import pool from '../config/db.js';

const TOOLS = [
  {
    name: 'dashboard',
    description: 'Obtiene resumen del dashboard: vehículos, pedidos pendientes, rutas activas',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'listar_vehiculos',
    description: 'Lista vehículos, opcionalmente filtrados por sede o estado',
    inputSchema: {
      type: 'object',
      properties: {
        sede: { type: 'string', description: 'Filtrar por nombre de sede' },
        estado: { type: 'string', description: 'Filtrar por estado (disponible, en_ruta, mantenimiento)' }
      }
    }
  },
  {
    name: 'listar_sedes',
    description: 'Lista todas las sedes registradas',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'listar_pedidos',
    description: 'Lista pedidos con filtros opcionales',
    inputSchema: {
      type: 'object',
      properties: {
        estado: { type: 'string', description: 'Filtrar por estado (pendiente, en_ruta, entregado)' },
        fecha: { type: 'string', description: 'Fecha YYYY-MM-DD' },
        q: { type: 'string', description: 'Búsqueda por factura, cliente, dirección o ciudad' }
      }
    }
  },
  {
    name: 'buscar_clientes',
    description: 'Busca clientes por nombre o código SIE-SA',
    inputSchema: {
      type: 'object',
      properties: {
        q: { type: 'string', description: 'Término de búsqueda (nombre o código)' },
        limit: { type: 'number', description: 'Máximo de resultados (default 20)' }
      },
      required: ['q']
    }
  },
  {
    name: 'crear_pedido',
    description: 'Crea un nuevo pedido de logística',
    inputSchema: {
      type: 'object',
      properties: {
        numero_factura: { type: 'string', description: 'Número de factura (requerido)' },
        cliente_id: { type: 'number', description: 'ID del cliente en logistics' },
        cliente_nombre: { type: 'string', description: 'Nombre del cliente' },
        direccion: { type: 'string', description: 'Dirección de entrega' },
        ciudad: { type: 'string', description: 'Ciudad' },
        telefono: { type: 'string', description: 'Teléfono' },
        valor_credito: { type: 'number', description: 'Valor del pedido' },
        sede: { type: 'string', description: 'Sede asignada' },
        vehiculo_id: { type: 'number', description: 'ID del vehículo asignado (requerido)' },
        latitud: { type: 'number', description: 'Latitud' },
        longitud: { type: 'number', description: 'Longitud' }
      },
      required: ['numero_factura', 'vehiculo_id']
    }
  },
  {
    name: 'generar_rutas',
    description: 'Genera rutas optimizadas para una fecha usando los pedidos pendientes',
    inputSchema: {
      type: 'object',
      properties: {
        fecha: { type: 'string', description: 'Fecha YYYY-MM-DD (requerido)' },
        zona: { type: 'string', description: 'Nombre de la zona/ruta para filtrar pedidos' },
        sede_id: { type: 'number', description: 'ID de la sede como depósito' },
        tipo: { type: 'string', description: "'vehiculo' o 'moto'" }
      },
      required: ['fecha']
    }
  },
  {
    name: 'listar_rutas',
    description: 'Lista rutas generadas, opcionalmente por fecha o sede',
    inputSchema: {
      type: 'object',
      properties: {
        fecha: { type: 'string', description: 'Fecha YYYY-MM-DD' },
        sede: { type: 'string', description: 'Filtrar por nombre de sede' }
      }
    }
  },
  {
    name: 'obtener_ruta',
    description: 'Obtiene detalle de una ruta: paradas, geometría, vehículo',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'ID de la ruta (requerido)' }
      },
      required: ['id']
    }
  }
];

async function handleInitialize(id) {
  return {
    jsonrpc: '2.0', id,
    result: {
      protocolVersion: '0.1.0',
      capabilities: { tools: {} },
      serverInfo: { name: 'horix-logistics', version: '1.0.0' }
    }
  };
}

function handlePing(id) {
  return { jsonrpc: '2.0', id, result: {} };
}

function handleListTools(id) {
  return { jsonrpc: '2.0', id, result: { tools: TOOLS } };
}

async function handleCallTool(id, name, args) {
  const handlers = {
    dashboard: () => toolDashboard(args),
    listar_vehiculos: () => toolListarVehiculos(args),
    listar_sedes: () => toolListarSedes(args),
    listar_pedidos: () => toolListarPedidos(args),
    buscar_clientes: () => toolBuscarClientes(args),
    crear_pedido: () => toolCrearPedido(args),
    generar_rutas: () => toolGenerarRutas(args),
    listar_rutas: () => toolListarRutas(args),
    obtener_ruta: () => toolObtenerRuta(args)
  };

  if (!handlers[name]) {
    return { jsonrpc: '2.0', id, error: { code: -32601, message: `Tool not found: ${name}` } };
  }

  try {
    const result = await handlers[name]();
    return { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] } };
  } catch (err) {
    return { jsonrpc: '2.0', id, error: { code: -32000, message: err.message } };
  }
}

async function toolDashboard() {
  const [vehiculos, pedidos, rutasHoy] = await Promise.all([
    pool.query('SELECT id, placa, estado FROM logistics.vehiculos'),
    pool.query("SELECT COUNT(*) AS total FROM logistics.pedidos_logistica WHERE estado='pendiente' AND ruta_id IS NULL"),
    pool.query("SELECT COUNT(*) AS total FROM logistics.rutas WHERE fecha=CURRENT_DATE")
  ]);
  return {
    total_vehiculos: vehiculos.rows.length,
    vehiculos_disponibles: vehiculos.rows.filter(v => v.estado === 'disponible').length,
    pedidos_pendientes: parseInt(pedidos.rows[0].total),
    rutas_hoy: parseInt(rutasHoy.rows[0].total)
  };
}

async function toolListarVehiculos({ sede, estado } = {}) {
  let sql = 'SELECT v.*, s.nombre AS sede_nombre FROM logistics.vehiculos v LEFT JOIN logistics.sedes s ON s.nombre = v.sede WHERE 1=1';
  const params = [];
  let idx = 1;
  if (sede) { params.push(sede); sql += ` AND v.sede=$${idx++}`; }
  if (estado) { params.push(estado); sql += ` AND v.estado=$${idx++}`; }
  sql += ' ORDER BY v.placa';
  const { rows } = await pool.query(sql, params);
  return { total: rows.length, vehiculos: rows };
}

async function toolListarSedes() {
  const { rows } = await pool.query('SELECT * FROM logistics.sedes WHERE activo=true ORDER BY nombre');
  return { total: rows.length, sedes: rows };
}

async function toolListarPedidos({ estado, fecha, q } = {}) {
  let sql = 'SELECT p.*, c.nombre AS cliente_nombre_real, c.ruta AS cliente_ruta, c.ruta_moto AS cliente_ruta_moto FROM logistics.pedidos_logistica p LEFT JOIN logistics.clientes c ON c.id = p.cliente_id WHERE 1=1';
  const params = [];
  let idx = 1;
  if (fecha) { params.push(fecha); sql += ` AND DATE(p.created_at)=$${idx++}`; }
  if (estado) { params.push(estado); sql += ` AND p.estado=$${idx++}`; }
  if (q) {
    params.push('%' + q + '%');
    const col = `$${idx}`;
    sql += ` AND (p.numero_factura ILIKE ${col} OR p.cliente_nombre ILIKE ${col} OR c.nombre ILIKE ${col} OR p.direccion ILIKE ${col} OR p.ciudad ILIKE ${col})`;
    idx++;
  }
  sql += ' ORDER BY p.id DESC LIMIT 100';
  const { rows } = await pool.query(sql, params);
  return { total: rows.length, pedidos: rows };
}

async function toolBuscarClientes({ q, limit } = {}) {
  if (!q) throw new Error('Parámetro "q" requerido');
  const lim = limit || 20;
  const { rows } = await pool.query(
    `SELECT * FROM logistics.clientes WHERE nombre ILIKE $1 OR codigo_siesa ILIKE $1 ORDER BY nombre LIMIT $2`,
    [`%${q}%`, lim]
  );
  return { total: rows.length, clientes: rows };
}

async function toolCrearPedido(args) {
  if (!args.numero_factura) throw new Error('numero_factura requerido');
  if (!args.vehiculo_id) throw new Error('vehiculo_id requerido');

  const { rows } = await pool.query(
    `INSERT INTO logistics.pedidos_logistica (numero_factura, cliente_id, cliente_nombre, direccion, ciudad, telefono, valor_credito, estado, sede, latitud, longitud, vehiculo_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
    [args.numero_factura, args.cliente_id || null, args.cliente_nombre || null, args.direccion || null,
     args.ciudad || null, args.telefono || null, args.valor_credito || null, 'pendiente',
     args.sede || null, args.latitud || null, args.longitud || null, args.vehiculo_id]
  );
  return { pedido: rows[0] };
}

async function toolGenerarRutas({ fecha, zona, sede_id, tipo } = {}) {
  if (!fecha) throw new Error('Parámetro "fecha" requerido (YYYY-MM-DD)');
  const rutaCol = tipo === 'moto' ? 'c.ruta_moto' : 'c.ruta';

  let depot = null;
  let sedeNombre = null;

  if (zona && !sede_id) {
    const ciudadRow = await pool.query(
      `SELECT c.ciudad, COUNT(*) AS cnt FROM logistics.clientes c
       WHERE ${rutaCol}=$1 AND c.ciudad IS NOT NULL AND c.ciudad!=''
       GROUP BY c.ciudad ORDER BY cnt DESC LIMIT 1`,
      [zona]
    );
    if (ciudadRow.rows.length > 0) {
      const { rows: sedeRows } = await pool.query(
        'SELECT id, nombre, latitud, longitud FROM logistics.sedes WHERE (ciudad ILIKE $1 OR nombre ILIKE $1) AND activo=true LIMIT 1',
        [`%${ciudadRow.rows[0].ciudad}%`]
      );
      if (sedeRows.length > 0) {
        sedeNombre = sedeRows[0].nombre;
        if (sedeRows[0].latitud) depot = { lat: Number(sedeRows[0].latitud), lng: Number(sedeRows[0].longitud) };
      }
    }
  }

  if (sede_id) {
    const { rows: sedeRows } = await pool.query('SELECT nombre, latitud, longitud FROM logistics.sedes WHERE id=$1 AND activo=true', [sede_id]);
    if (sedeRows.length > 0) {
      sedeNombre = sedeRows[0].nombre;
      if (sedeRows[0].latitud) depot = { lat: Number(sedeRows[0].latitud), lng: Number(sedeRows[0].longitud) };
    }
  }

  const { rows: pedidos } = await pool.query(
    `SELECT p.id, p.latitud, p.longitud, p.vehiculo_id, p.cliente_nombre, p.direccion, ${rutaCol} AS cliente_ruta
     FROM logistics.pedidos_logistica p LEFT JOIN logistics.clientes c ON c.id = p.cliente_id
     WHERE p.estado='pendiente' AND p.ruta_id IS NULL AND p.latitud IS NOT NULL AND p.longitud IS NOT NULL`
  );

  if (pedidos.length === 0) return { error: 'No hay pedidos pendientes con coordenadas' };

  let pedidosFiltrados = pedidos;
  if (zona) pedidosFiltrados = pedidosFiltrados.filter(p => p.cliente_ruta === zona);

  const conVehiculo = pedidosFiltrados.filter(p => p.vehiculo_id);
  if (conVehiculo.length === 0) return { error: 'Ningún pedido pendiente tiene vehículo asignado' };

  const grupos = {};
  for (const p of conVehiculo) {
    if (!grupos[p.vehiculo_id]) grupos[p.vehiculo_id] = [];
    grupos[p.vehiculo_id].push(p);
  }

  let creadas = 0;
  for (const [vehiculoId, pedidosGrupo] of Object.entries(grupos)) {
    const { rows: veh } = await pool.query('SELECT placa, sede FROM logistics.vehiculos WHERE id=$1', [vehiculoId]);
    if (veh.length === 0) continue;
    const vehiculo = veh[0];
    const nombreRuta = `${zona || 'SIN ZONA'} - ${vehiculo.placa} - ${fecha}`;

    await pool.query(
      `INSERT INTO logistics.rutas (nombre, vehiculo_id, vehiculo_placa, sede, fecha, estado, depot_lat, depot_lng, distancia_total, tiempo_total, geometria)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [nombreRuta, vehiculoId, vehiculo.placa, sedeNombre || vehiculo.sede || null, fecha, 'planificada',
       depot?.lat || null, depot?.lng || null, 0, 0, null]
    );
    creadas++;
  }

  return { rutas_creadas: creadas, mensaje: `Se crearon ${creadas} ruta(s)` };
}

async function toolListarRutas({ fecha, sede } = {}) {
  let sql = 'SELECT r.*, v.placa FROM logistics.rutas r LEFT JOIN logistics.vehiculos v ON v.id = r.vehiculo_id WHERE 1=1';
  const params = [];
  let idx = 1;
  if (fecha) { params.push(fecha); sql += ` AND r.fecha=$${idx++}`; }
  if (sede) { params.push(sede); sql += ` AND r.sede=$${idx++}`; }
  sql += ' ORDER BY r.fecha DESC, r.id';
  const { rows } = await pool.query(sql, params);
  return { total: rows.length, rutas: rows };
}

async function toolObtenerRuta({ id } = {}) {
  if (!id) throw new Error('Parámetro "id" requerido');
  const { rows: rutas } = await pool.query(
    'SELECT r.*, v.placa FROM logistics.rutas r LEFT JOIN logistics.vehiculos v ON v.id = r.vehiculo_id WHERE r.id=$1', [id]
  );
  if (rutas.length === 0) return { error: 'Ruta no encontrada' };

  const { rows: paradas } = await pool.query(
    `SELECT pr.*, p.numero_factura, p.cliente_nombre, p.direccion, p.ciudad, p.latitud, p.longitud
     FROM logistics.paradas_ruta pr
     LEFT JOIN logistics.pedidos_logistica p ON p.id = pr.pedido_id
     WHERE pr.ruta_id=$1 ORDER BY pr.secuencia`, [id]
  );

  return { ruta: rutas[0], paradas };
}

export function createMiddleware() {
  return async (req, res) => {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const { method, params, id } = req.body;
    if (!id) return res.status(400).json({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid Request' } });

    let response;
    switch (method) {
      case 'initialize':
        response = await handleInitialize(id);
        break;
      case 'ping':
        response = handlePing(id);
        break;
      case 'tools/list':
        response = handleListTools(id);
        break;
      case 'tools/call':
        response = await handleCallTool(id, params?.name, params?.arguments);
        break;
      case 'notifications/initialized':
      case 'notifications/cancelled':
        return res.json({ jsonrpc: '2.0', id, result: {} });
      default:
        response = { jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } };
    }

    res.json(response);
  };
}
