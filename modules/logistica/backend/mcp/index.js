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
  },
  {
    name: 'listar_devoluciones',
    description: 'Lista devoluciones con filtros, búsqueda y paginación. Solo lectura.',
    inputSchema: {
      type: 'object',
      properties: {
        fecha_inicio: { type: 'string', description: 'Fecha inicial YYYY-MM-DD' },
        fecha_fin: { type: 'string', description: 'Fecha final YYYY-MM-DD' },
        cliente: { type: 'string', description: 'Filtrar por nombre del cliente' },
        centro_operaciones: { type: 'string', description: 'Filtrar por centro de operaciones' },
        causa: { type: 'string', description: 'Filtrar por causal de devolución' },
        estado: { type: 'string', enum: ['registrada', 'en_proceso', 'resuelta', 'cerrada'] },
        fuente: { type: 'string', enum: ['manual', 'smart2go'] },
        busqueda: { type: 'string', description: 'Buscar por cliente, sucursal, mercaderista, factura o productos' },
        ordenar_por: { type: 'string', enum: ['fecha_reporte', 'created_at', 'cliente_nombre', 'valor_total', 'causa', 'estado'] },
        orden: { type: 'string', enum: ['ASC', 'DESC'], default: 'DESC' },
        pagina: { type: 'number', minimum: 1, default: 1 },
        limite: { type: 'number', minimum: 1, maximum: 100, default: 50 }
      }
    }
  },
  {
    name: 'obtener_devolucion',
    description: 'Obtiene el detalle de una devolución y la referencia del pedido asociado. Solo lectura.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'ID de la devolución' }
      },
      required: ['id']
    }
  },
  {
    name: 'resumen_devoluciones',
    description: 'Obtiene estadísticas de devoluciones por causa, cliente, estado y fecha. Solo lectura.',
    inputSchema: {
      type: 'object',
      properties: {
        fecha_inicio: { type: 'string', description: 'Fecha inicial YYYY-MM-DD' },
        fecha_fin: { type: 'string', description: 'Fecha final YYYY-MM-DD' }
      }
    }
  },
  {
    name: 'listar_causales_devolucion',
    description: 'Lista las causales de devolución activas o todas las causales. Solo lectura.',
    inputSchema: {
      type: 'object',
      properties: {
        incluir_inactivas: { type: 'boolean', default: false }
      }
    }
  },
  {
    name: 'listar_geocercas',
    description: 'Lista geocercas con filtros por estado, fuente y nombre. Solo lectura.',
    inputSchema: {
      type: 'object',
      properties: {
        activa: { type: 'boolean', description: 'Filtrar por geocercas activas o inactivas' },
        fuente: { type: 'string', description: 'Fuente de la geocerca, por ejemplo manual o widetech' },
        q: { type: 'string', description: 'Buscar por nombre' }
      }
    }
  },
  {
    name: 'obtener_geocerca',
    description: 'Obtiene una geocerca específica y la cantidad de alertas registradas.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'ID de la geocerca' }
      },
      required: ['id']
    }
  },
  {
    name: 'listar_alertas_geocerca',
    description: 'Lista el historial de entradas y salidas de una geocerca. Solo lectura.',
    inputSchema: {
      type: 'object',
      properties: {
        geocerca_id: { type: 'number', description: 'ID de la geocerca' },
        vehiculo_id: { type: 'number', description: 'Filtrar por vehículo' },
        fecha_desde: { type: 'string', description: 'Fecha inicial YYYY-MM-DD' },
        fecha_hasta: { type: 'string', description: 'Fecha final YYYY-MM-DD' },
        pagina: { type: 'number', minimum: 1, default: 1 },
        limite: { type: 'number', minimum: 1, maximum: 100, default: 50 }
      },
      required: ['geocerca_id']
    }
  }
];

async function handleInitialize(id) {
  return {
    jsonrpc: '2.0', id,
    result: {
      protocolVersion: '0.1.0',
      capabilities: { tools: {} },
      serverInfo: { name: 'synnox-logistics', version: '1.0.0' }
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
    obtener_ruta: () => toolObtenerRuta(args),
    listar_devoluciones: () => toolListarDevoluciones(args),
    obtener_devolucion: () => toolObtenerDevolucion(args),
    resumen_devoluciones: () => toolResumenDevoluciones(args),
    listar_causales_devolucion: () => toolListarCausalesDevolucion(args),
    listar_geocercas: () => toolListarGeocercas(args),
    obtener_geocerca: () => toolObtenerGeocerca(args),
    listar_alertas_geocerca: () => toolListarAlertasGeocerca(args)
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

const MCP_MAX_PAGE_SIZE = 100;

function positiveInteger(value, name) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${name} debe ser un entero positivo`);
  }
  return parsed;
}

function pagination(args = {}, defaultLimit = 50) {
  const page = positiveInteger(args.pagina ?? 1, 'pagina');
  const requestedLimit = positiveInteger(args.limite ?? defaultLimit, 'limite');
  const limit = Math.min(requestedLimit, MCP_MAX_PAGE_SIZE);
  return { page, limit, offset: (page - 1) * limit };
}

function addDateRange(conditions, params, desde, hasta, column) {
  if (desde) {
    params.push(desde);
    conditions.push(`${column} >= $${params.length}`);
  }
  if (hasta) {
    params.push(hasta);
    conditions.push(`${column} <= $${params.length}`);
  }
}

function optionalBoolean(value, name) {
  if (value === true || value === false) return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`${name} debe ser booleano`);
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
  let sql = 'SELECT v.* FROM logistics.vehiculos v WHERE 1=1';
  const params = [];
  let idx = 1;
  if (sede) { params.push(sede); sql += ` AND v.sede=$${idx++}`; }
  if (estado) { params.push(estado); sql += ` AND v.estado=$${idx++}`; }
  sql += ' ORDER BY v.placa';
  const { rows } = await pool.query(sql, params);
  return { total: rows.length, vehiculos: rows };
}

async function toolListarSedes() {
  const centros = (globalThis.__centrosCache || []).filter(c => c.activo);
  return { total: centros.length, sedes: centros };
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
  const centros = globalThis.__centrosCache || [];

  if (zona && !sede_id) {
    const ciudadRow = await pool.query(
      `SELECT c.ciudad, COUNT(*) AS cnt FROM logistics.clientes c
       WHERE ${rutaCol}=$1 AND c.ciudad IS NOT NULL AND c.ciudad!=''
       GROUP BY c.ciudad ORDER BY cnt DESC LIMIT 1`,
      [zona]
    );
    if (ciudadRow.rows.length > 0) {
      const ciudad = ciudadRow.rows[0].ciudad;
      const centro = centros.find(c =>
        (c.ciudad && c.ciudad.toLowerCase().includes(ciudad.toLowerCase())) ||
        (c.nombre && c.nombre.toLowerCase().includes(ciudad.toLowerCase()))
      );
      if (centro) {
        sedeNombre = centro.nombre;
        if (centro.latitud) depot = { lat: Number(centro.latitud), lng: Number(centro.longitud) };
      }
    }
  }

  if (sede_id) {
    const centro = centros.find(c => c.id === Number(sede_id));
    if (centro) {
      sedeNombre = centro.nombre;
      if (centro.latitud) depot = { lat: Number(centro.latitud), lng: Number(centro.longitud) };
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

async function toolListarDevoluciones(args = {}) {
  const conditions = ['1=1'];
  const params = [];
  const {
    fecha_inicio, fecha_fin, cliente, centro_operaciones, causa,
    estado, fuente, busqueda
  } = args;

  addDateRange(conditions, params, fecha_inicio, fecha_fin, 'd.fecha_reporte');
  if (cliente) {
    params.push(`%${cliente}%`);
    conditions.push(`d.cliente_nombre ILIKE $${params.length}`);
  }
  if (centro_operaciones) {
    params.push(centro_operaciones);
    conditions.push(`d.centro_operaciones = $${params.length}`);
  }
  if (causa) {
    params.push(causa);
    conditions.push(`d.causa = $${params.length}`);
  }
  if (estado) {
    params.push(estado);
    conditions.push(`d.estado = $${params.length}`);
  }
  if (fuente) {
    params.push(fuente);
    conditions.push(`d.fuente = $${params.length}`);
  }
  if (busqueda) {
    params.push(`%${busqueda}%`);
    const searchParam = `$${params.length}`;
    conditions.push(`(
      d.cliente_nombre ILIKE ${searchParam}
      OR d.sucursal ILIKE ${searchParam}
      OR d.mercaderista ILIKE ${searchParam}
      OR d.productos_texto ILIKE ${searchParam}
      OR d.numero_factura ILIKE ${searchParam}
      OR d.documento_devolucion ILIKE ${searchParam}
    )`);
  }

  const sortColumns = {
    fecha_reporte: 'd.fecha_reporte',
    created_at: 'd.created_at',
    cliente_nombre: 'd.cliente_nombre',
    valor_total: 'd.valor_total',
    causa: 'd.causa',
    estado: 'd.estado'
  };
  const sortColumn = sortColumns[args.ordenar_por] || sortColumns.fecha_reporte;
  const sortOrder = String(args.orden || 'DESC').toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
  const { page, limit, offset } = pagination(args);
  const where = conditions.join(' AND ');

  const countResult = await pool.query(
    `SELECT COUNT(*)::int AS total FROM logistics.devoluciones d WHERE ${where}`,
    params
  );
  const dataResult = await pool.query(
    `SELECT d.*
     FROM logistics.devoluciones d
     WHERE ${where}
     ORDER BY ${sortColumn} ${sortOrder}
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, offset]
  );
  const total = Number(countResult.rows[0]?.total || 0);

  return {
    rows: dataResult.rows,
    total,
    pagina: page,
    limite: limit,
    totalPaginas: Math.ceil(total / limit)
  };
}

async function toolObtenerDevolucion({ id } = {}) {
  const devolucionId = positiveInteger(id, 'id');
  const { rows } = await pool.query(
    `SELECT d.*,
            p.numero_factura AS pedido_numero_factura,
            p.estado AS pedido_estado,
            p.ruta_id AS pedido_ruta_id
     FROM logistics.devoluciones d
     LEFT JOIN logistics.pedidos_logistica p ON p.id = d.pedido_id
     WHERE d.id = $1`,
    [devolucionId]
  );
  if (rows.length === 0) return { error: 'Devolución no encontrada' };
  return { devolucion: rows[0] };
}

async function toolResumenDevoluciones({ fecha_inicio, fecha_fin } = {}) {
  const conditions = [];
  const params = [];
  addDateRange(conditions, params, fecha_inicio, fecha_fin, 'fecha_reporte');
  const where = conditions.length ? ' AND ' + conditions.join(' AND ') : '';

  const [totalResult, porCausa, porCliente, tendencia, porEstado, conConductor, valorTotal] = await Promise.all([
    pool.query(`SELECT COUNT(*)::int AS total FROM logistics.devoluciones WHERE 1=1${where}`, params),
    pool.query(`SELECT causa, COUNT(*)::int AS cantidad
                FROM logistics.devoluciones WHERE 1=1${where}
                GROUP BY causa ORDER BY cantidad DESC`, params),
    pool.query(`SELECT cliente_nombre, COUNT(*)::int AS cantidad,
                       COALESCE(SUM(valor_total), 0)::numeric AS valor
                FROM logistics.devoluciones WHERE 1=1${where}
                GROUP BY cliente_nombre ORDER BY cantidad DESC LIMIT 10`, params),
    pool.query(`SELECT fecha_reporte AS fecha, COUNT(*)::int AS cantidad
                FROM logistics.devoluciones WHERE 1=1${where}
                GROUP BY fecha_reporte ORDER BY fecha_reporte ASC`, params),
    pool.query(`SELECT estado, COUNT(*)::int AS cantidad
                FROM logistics.devoluciones WHERE 1=1${where}
                GROUP BY estado`, params),
    pool.query(`SELECT COUNT(*)::int AS total
                FROM logistics.devoluciones
                WHERE entregado_conductor = TRUE${where}`, params),
    pool.query(`SELECT COALESCE(SUM(valor_total), 0)::numeric AS total
                FROM logistics.devoluciones WHERE 1=1${where}`, params)
  ]);

  return {
    total: Number(totalResult.rows[0]?.total || 0),
    valor_total: Number(valorTotal.rows[0]?.total || 0),
    con_conductor: Number(conConductor.rows[0]?.total || 0),
    por_causa: porCausa.rows,
    por_cliente: porCliente.rows.map(row => ({
      ...row,
      cantidad: Number(row.cantidad),
      valor: Number(row.valor || 0)
    })),
    tendencia: tendencia.rows,
    por_estado: porEstado.rows
  };
}

async function toolListarCausalesDevolucion({ incluir_inactivas = false } = {}) {
  const incluir = optionalBoolean(incluir_inactivas, 'incluir_inactivas');
  const where = incluir ? '' : 'WHERE activo = TRUE';
  const { rows } = await pool.query(
    `SELECT id, codigo, nombre, concepto, notas, activo, created_at, updated_at
     FROM logistics.causales_devolucion
     ${where}
     ORDER BY activo DESC, codigo NULLS LAST, nombre`
  );
  return { total: rows.length, causales: rows };
}

async function toolListarGeocercas({ activa, fuente, q } = {}) {
  const conditions = ['1=1'];
  const params = [];

  if (activa !== undefined) {
    params.push(optionalBoolean(activa, 'activa'));
    conditions.push(`g.activa = $${params.length}`);
  }
  if (fuente) {
    params.push(fuente);
    conditions.push(`g.fuente = $${params.length}`);
  }
  if (q) {
    params.push(`%${q}%`);
    conditions.push(`g.nombre ILIKE $${params.length}`);
  }

  const { rows } = await pool.query(
    `SELECT g.*,
            (SELECT COUNT(*)::int
             FROM logistics.alertas_geocerca a
             WHERE a.geocerca_id = g.id) AS alertas_count
     FROM logistics.geocercas g
     WHERE ${conditions.join(' AND ')}
     ORDER BY g.nombre`,
    params
  );
  return { total: rows.length, geocercas: rows };
}

async function toolObtenerGeocerca({ id } = {}) {
  const geocercaId = positiveInteger(id, 'id');
  const { rows } = await pool.query(
    `SELECT g.*,
            (SELECT COUNT(*)::int
             FROM logistics.alertas_geocerca a
             WHERE a.geocerca_id = g.id) AS alertas_count
     FROM logistics.geocercas g
     WHERE g.id = $1`,
    [geocercaId]
  );
  if (rows.length === 0) return { error: 'Geocerca no encontrada' };
  return { geocerca: rows[0] };
}

async function toolListarAlertasGeocerca(args = {}) {
  const geocercaId = positiveInteger(args.geocerca_id, 'geocerca_id');
  const conditions = ['a.geocerca_id = $1'];
  const params = [geocercaId];

  if (args.vehiculo_id !== undefined) {
    params.push(positiveInteger(args.vehiculo_id, 'vehiculo_id'));
    conditions.push(`a.vehiculo_id = $${params.length}`);
  }
  if (args.fecha_desde) {
    params.push(args.fecha_desde);
    conditions.push(`a.fecha >= $${params.length}::timestamptz`);
  }
  if (args.fecha_hasta) {
    params.push(args.fecha_hasta);
    conditions.push(`a.fecha < ($${params.length}::date + INTERVAL '1 day')`);
  }

  const { page, limit, offset } = pagination(args);
  const where = conditions.join(' AND ');
  const countResult = await pool.query(
    `SELECT COUNT(*)::int AS total
     FROM logistics.alertas_geocerca a
     WHERE ${where}`,
    params
  );
  const dataResult = await pool.query(
    `SELECT a.*, g.nombre AS geocerca_nombre, v.placa, v.alias
     FROM logistics.alertas_geocerca a
     JOIN logistics.geocercas g ON g.id = a.geocerca_id
     JOIN logistics.vehiculos v ON v.id = a.vehiculo_id
     WHERE ${where}
     ORDER BY a.fecha DESC
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, offset]
  );
  const total = Number(countResult.rows[0]?.total || 0);

  return {
    alertas: dataResult.rows,
    total,
    pagina: page,
    limite: limit,
    totalPaginas: Math.ceil(total / limit)
  };
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
