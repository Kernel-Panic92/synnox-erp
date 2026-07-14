import express from 'express';
import pool from '../config/db.js';
import ExcelJS from 'exceljs';

const router = express.Router();

function paginar(q, page, limit, sort, order, mapRow) {
  const offset = (page - 1) * limit;
  const countSql = `SELECT COUNT(*) as total FROM (${q}) _sub`;
  const dataSql = `${q} ORDER BY ${sort} ${order} LIMIT ${limit} OFFSET ${offset}`;
  return { countSql, dataSql };
}

async function ejecutarReporte(q, params, page, limit, sort, order, mapRow) {
  const { countSql, dataSql } = paginar(q, page, limit, sort, order);
  const [{ rows: countRows }, { rows }] = await Promise.all([
    pool.query(countSql, params),
    pool.query(dataSql, params)
  ]);
  const total = parseInt(countRows[0].total, 10);
  return {
    rows: mapRow ? rows.map(mapRow) : rows,
    total,
    page,
    totalPages: Math.ceil(total / limit)
  };
}

// ── Reporte de Rutas ──
router.get('/rutas', async (req, res) => {
  try {
    const { fechaDesde, fechaHasta, sede, estado, page = 1, limit = 50, sort = 'r.fecha', order = 'DESC' } = req.query;
    let sql = `SELECT r.id, r.nombre, r.fecha, v.placa, v.alias as vehiculo_alias, r.sede,
      r.estado, r.cantidad_paradas, r.paradas_completadas, r.paradas_fallidas,
      r.distancia_total_estimada, r.distancia_total_real,
      r.tiempo_estimado, r.tiempo_real, r.eficiencia,
      r.hora_inicio_real, r.hora_fin_real, r.conductor_nombre
      FROM logistics.rutas r JOIN logistics.vehiculos v ON r.vehiculo_id=v.id WHERE 1=1`;
    const params = [];
    if (fechaDesde) { params.push(fechaDesde); sql += ` AND r.fecha >= $${params.length}`; }
    if (fechaHasta) { params.push(fechaHasta); sql += ` AND r.fecha <= $${params.length}`; }
    if (sede) { params.push(sede); sql += ` AND r.sede = $${params.length}`; }
    if (estado) { params.push(estado); sql += ` AND r.estado = $${params.length}`; }

    const [data, summary] = await Promise.all([
      ejecutarReporte(sql, params, +page, +limit, sort, order),
      pool.query(`SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE r.estado='planificada') as planificadas,
        COUNT(*) FILTER (WHERE r.estado='en_ejecucion') as en_ejecucion,
        COUNT(*) FILTER (WHERE r.estado='completada') as completadas,
        COUNT(*) FILTER (WHERE r.estado='fallida') as fallidas,
        COALESCE(SUM(r.cantidad_paradas),0) as paradas_totales,
        COALESCE(SUM(r.paradas_completadas),0) as paradas_completadas_total,
        COALESCE(AVG(r.eficiencia),0) as eficiencia_promedio,
        COALESCE(SUM(r.distancia_total_estimada),0) as distancia_estimada_total,
        COALESCE(SUM(r.distancia_total_real),0) as distancia_real_total
        FROM logistics.rutas r WHERE 1=1` + (fechaDesde ? ` AND r.fecha>='${fechaDesde}'` : '') + (fechaHasta ? ` AND r.fecha<='${fechaHasta}'` : '') + (sede ? ` AND r.sede='${sede}'` : '') + (estado ? ` AND r.estado='${estado}'` : ''))
    ]);
    res.json({ exitosa: true, ...data, summary: summary.rows[0] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Reporte de Pedidos ──
router.get('/pedidos', async (req, res) => {
  try {
    const { fechaDesde, fechaHasta, estado, ciudad, page = 1, limit = 50, sort = 'p.created_at', order = 'DESC' } = req.query;
    let sql = `SELECT p.id, p.numero_factura, p.cliente_nombre, p.direccion, p.ciudad, p.estado,
      p.valor_credito, p.created_at, p.ruta_id, v.placa, v.alias as vehiculo_alias,
      r.nombre as ruta_nombre
      FROM logistics.pedidos_logistica p
      LEFT JOIN logistics.rutas r ON p.ruta_id=r.id
      LEFT JOIN logistics.vehiculos v ON r.vehiculo_id=v.id
      WHERE 1=1`;
    const params = [];
    if (fechaDesde) { params.push(fechaDesde); sql += ` AND p.created_at >= $${params.length}`; }
    if (fechaHasta) { params.push(fechaHasta); sql += ` AND p.created_at <= $${params.length}`; }
    if (estado) { params.push(estado); sql += ` AND p.estado = $${params.length}`; }
    if (ciudad) { params.push(ciudad); sql += ` AND p.ciudad ILIKE $${params.length}`; }

    const summarySql = `SELECT
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE p.estado='pendiente') as pendientes,
      COUNT(*) FILTER (WHERE p.estado='asignado') as asignados,
      COUNT(*) FILTER (WHERE p.estado='en_ruta') as en_ruta,
      COUNT(*) FILTER (WHERE p.estado='entregado') as entregados,
      COUNT(*) FILTER (WHERE p.estado='fallido') as fallidos,
      COALESCE(SUM(p.valor_credito),0) as valor_total
      FROM logistics.pedidos_logistica p WHERE 1=1` +
      (fechaDesde ? ` AND p.created_at>='${fechaDesde}'` : '') + (fechaHasta ? ` AND p.created_at<='${fechaHasta}'` : '') + (estado ? ` AND p.estado='${estado}'` : '') + (ciudad ? ` AND p.ciudad ILIKE '${ciudad}'` : '');

    const [data, summary] = await Promise.all([
      ejecutarReporte(sql, params, +page, +limit, sort, order),
      pool.query(summarySql)
    ]);
    res.json({ exitosa: true, ...data, summary: summary.rows[0] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Reporte de Vehículos ──
router.get('/vehiculos', async (req, res) => {
  try {
    const { estado, sede, page = 1, limit = 50, sort = 'v.placa', order = 'ASC' } = req.query;
    let sql = `SELECT v.id, v.placa, v.alias, v.estado, v.sede,
      v.capacidad_peso, v.capacidad_volumen,
      (SELECT COUNT(*) FROM logistics.pedidos_logistica p
        JOIN logistics.rutas r ON p.ruta_id=r.id
        WHERE r.vehiculo_id=v.id AND p.estado!='entregado' AND p.estado!='fallido'
      ) as pedidos_activos
      FROM logistics.vehiculos v WHERE 1=1`;
    const params = [];
    if (estado) { params.push(estado); sql += ` AND v.estado = $${params.length}`; }
    if (sede) { params.push(sede); sql += ` AND v.sede = $${params.length}`; }

    const summarySql = `SELECT
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE v.estado='disponible') as disponibles,
      COUNT(*) FILTER (WHERE v.estado='en_ruta') as en_ruta,
      COUNT(*) FILTER (WHERE v.estado='mantencion' OR v.estado='inactivo') as mantenimiento,
      COALESCE(SUM(v.capacidad_peso),0) as capacidad_peso_total,
      COALESCE(SUM(v.capacidad_volumen),0) as capacidad_volumen_total
      FROM logistics.vehiculos v WHERE 1=1` +
      (estado ? ` AND v.estado='${estado}'` : '') + (sede ? ` AND v.sede='${sede}'` : '');

    const [data, summary] = await Promise.all([
      ejecutarReporte(sql, params, +page, +limit, sort, order),
      pool.query(summarySql)
    ]);
    res.json({ exitosa: true, ...data, summary: summary.rows[0] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Reporte de Eficiencia ──
router.get('/eficiencia', async (req, res) => {
  try {
    const { fechaDesde, fechaHasta, vehiculoId, page = 1, limit = 50, sort = 'h.fecha', order = 'DESC' } = req.query;
    let sql = `SELECT h.*, v.placa, v.alias as vehiculo_alias
      FROM logistics.historico_eficiencia h
      JOIN logistics.vehiculos v ON h.vehiculo_id=v.id
      WHERE 1=1`;
    const params = [];
    if (fechaDesde) { params.push(fechaDesde); sql += ` AND h.fecha >= $${params.length}`; }
    if (fechaHasta) { params.push(fechaHasta); sql += ` AND h.fecha <= $${params.length}`; }
    if (vehiculoId) { params.push(vehiculoId); sql += ` AND h.vehiculo_id = $${params.length}`; }

    const summarySql = `SELECT
      COUNT(*) as total_rutas,
      COALESCE(SUM(h.paradas_planificadas),0) as paradas_planificadas,
      COALESCE(SUM(h.paradas_completadas),0) as paradas_completadas,
      COALESCE(AVG(h.tasa_exito),0) as tasa_exito_promedio,
      COALESCE(AVG(h.eficiencia_distancia),0) as eficiencia_distancia_promedio,
      COALESCE(AVG(h.eficiencia_tiempo),0) as eficiencia_tiempo_promedio,
      COALESCE(SUM(h.distancia_planificada),0) as distancia_planificada_total,
      COALESCE(SUM(h.distancia_real),0) as distancia_real_total
      FROM logistics.historico_eficiencia h WHERE 1=1` +
      (fechaDesde ? ` AND h.fecha>='${fechaDesde}'` : '') + (fechaHasta ? ` AND h.fecha<='${fechaHasta}'` : '') + (vehiculoId ? ` AND h.vehiculo_id=${vehiculoId}` : '');

    const [data, summary] = await Promise.all([
      ejecutarReporte(sql, params, +page, +limit, sort, order),
      pool.query(summarySql)
    ]);
    res.json({ exitosa: true, ...data, summary: summary.rows[0] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Exportar reporte a Excel ──
router.post('/exportar', async (req, res) => {
  try {
    const { tipo, fechaDesde, fechaHasta, sede, estado, ciudad, vehiculoId } = req.body;
    let rows, summary, columns, filename, sheetName;

    const wb = new ExcelJS.Workbook();
    wb.creator = process.env.COMPANY_NAME || 'SynnoxERP';
    const ws = wb.addWorksheet('Reporte');

    if (tipo === 'rutas') {
      let sql = `SELECT r.nombre, r.fecha, v.placa, r.sede, r.estado, r.cantidad_paradas,
        r.paradas_completadas, r.paradas_fallidas, r.distancia_total_estimada,
        r.distancia_total_real, r.tiempo_estimado, r.tiempo_real, r.eficiencia
        FROM logistics.rutas r JOIN logistics.vehiculos v ON r.vehiculo_id=v.id WHERE 1=1`;
      const p = [];
      if (fechaDesde) { p.push(fechaDesde); sql += ` AND r.fecha>=$${p.length}`; }
      if (fechaHasta) { p.push(fechaHasta); sql += ` AND r.fecha<=$${p.length}`; }
      if (sede) { p.push(sede); sql += ` AND r.sede=$${p.length}`; }
      if (estado) { p.push(estado); sql += ` AND r.estado=$${p.length}`; }
      sql += ' ORDER BY r.fecha DESC';
      const r = await pool.query(sql, p);
      rows = r.rows;
      columns = ['Nombre','Fecha','Vehículo','Sede','Estado','Paradas','Completadas','Fallidas','Dist. Est. (km)','Dist. Real (km)','Tiempo Est. (min)','Tiempo Real (min)','Eficiencia (%)'];
      filename = `reporte_rutas_${new Date().toISOString().slice(0,10)}.xlsx`;
      sheetName = 'Rutas';
    } else if (tipo === 'pedidos') {
      let sql = `SELECT p.numero_factura, p.cliente_nombre, p.direccion, p.ciudad, p.estado,
        p.valor_credito, p.created_at, r.nombre as ruta_nombre
        FROM logistics.pedidos_logistica p
        LEFT JOIN logistics.rutas r ON p.ruta_id=r.id WHERE 1=1`;
      const p = [];
      if (fechaDesde) { p.push(fechaDesde); sql += ` AND p.created_at>=$${p.length}`; }
      if (fechaHasta) { p.push(fechaHasta); sql += ` AND p.created_at<=$${p.length}`; }
      if (estado) { p.push(estado); sql += ` AND p.estado=$${p.length}`; }
      if (ciudad) { p.push(`%${ciudad}%`); sql += ` AND p.ciudad ILIKE $${p.length}`; }
      sql += ' ORDER BY p.created_at DESC';
      const r = await pool.query(sql, p);
      rows = r.rows;
      columns = ['Factura','Cliente','Dirección','Ciudad','Estado','Valor','Creado','Ruta'];
      filename = `reporte_pedidos_${new Date().toISOString().slice(0,10)}.xlsx`;
      sheetName = 'Pedidos';
    } else if (tipo === 'vehiculos') {
      let sql = `SELECT v.placa, v.alias, v.estado, v.sede, v.capacidad_peso, v.capacidad_volumen,
        (SELECT COUNT(*) FROM logistics.pedidos_logistica p
          JOIN logistics.rutas r ON p.ruta_id=r.id
          WHERE r.vehiculo_id=v.id AND p.estado!='entregado' AND p.estado!='fallido'
        ) as pedidos_activos
        FROM logistics.vehiculos v WHERE 1=1`;
      const p = [];
      if (estado) { p.push(estado); sql += ` AND v.estado=$${p.length}`; }
      if (sede) { p.push(sede); sql += ` AND v.sede=$${p.length}`; }
      sql += ' ORDER BY v.placa';
      const r = await pool.query(sql, p);
      rows = r.rows;
      columns = ['Placa','Alias','Estado','Sede','Cap. Peso (kg)','Cap. Volumen (m³)','Pedidos Activos'];
      filename = `reporte_vehiculos_${new Date().toISOString().slice(0,10)}.xlsx`;
      sheetName = 'Vehículos';
    } else if (tipo === 'eficiencia') {
      let sql = `SELECT v.placa, h.fecha, h.paradas_planificadas, h.paradas_completadas,
        h.paradas_fallidas, h.distancia_planificada, h.distancia_real,
        h.tiempo_planificado, h.tiempo_real, h.tasa_exito, h.eficiencia_distancia,
        h.eficiencia_tiempo
        FROM logistics.historico_eficiencia h
        JOIN logistics.vehiculos v ON h.vehiculo_id=v.id WHERE 1=1`;
      const p = [];
      if (fechaDesde) { p.push(fechaDesde); sql += ` AND h.fecha>=$${p.length}`; }
      if (fechaHasta) { p.push(fechaHasta); sql += ` AND h.fecha<=$${p.length}`; }
      if (vehiculoId) { p.push(vehiculoId); sql += ` AND h.vehiculo_id=$${p.length}`; }
      sql += ' ORDER BY h.fecha DESC';
      const r = await pool.query(sql, p);
      rows = r.rows;
      columns = ['Vehículo','Fecha','Paradas Plan.','Paradas Comp.','Paradas Fall.','Dist. Plan. (km)','Dist. Real (km)','Tiempo Plan. (min)','Tiempo Real (min)','Tasa Éxito (%)','Efic. Distancia (%)','Efic. Tiempo (%)'];
      filename = `reporte_eficiencia_${new Date().toISOString().slice(0,10)}.xlsx`;
      sheetName = 'Eficiencia';
    } else {
      return res.status(400).json({ error: 'Tipo de reporte inválido' });
    }

    ws.columns = columns.map(c => ({ header: c, key: c, width: 20 }));
    const headerRow = ws.getRow(1);
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2563EB' } };

    rows.forEach(r => {
      ws.addRow(Object.values(r));
    });

    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: rows.length + 1, column: columns.length } };
    ws.views = [{ state: 'frozen', ySplit: 1 }];

    const buf = await wb.xlsx.writeBuffer();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(Buffer.from(buf));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

export default router;
