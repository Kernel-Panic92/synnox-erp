import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import pool from '../config/db.js';
import { parsearPdfSiesa } from '../utils/siesaPdfParser.js';
import { parsearWidetech } from '../utils/widgetechExcelParser.js';
import { geocodificar } from '../utils/geocoding.js';
import { parsearMaestroClientes } from '../utils/maestroClientesParser.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadDir = path.join(__dirname, '..', '..', 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const upload = multer({ dest: uploadDir });

const router = express.Router();

router.get('/historial', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM logistics.importaciones ORDER BY created_at DESC LIMIT 20');
    res.json({ exitosa: true, importaciones: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/siesa', upload.single('archivo'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Archivo PDF requerido' });

    const resultado = await parsearPdfSiesa(req.file.path);

    if (!resultado.exitosa) {
      await pool.query(
        `INSERT INTO logistics.importaciones (tipo, nombre_archivo, registros_importados, registros_fallidos, estado, detalles)
         VALUES ('siesa_pdf', $1, 0, 0, 'fallida', $2)`,
        [req.file.originalname, JSON.stringify({ error: resultado.error })]
      );
      return res.status(422).json({ error: resultado.error });
    }

    let importados = 0;
    let fallidos = 0;
    let geocodificados = 0;
    let clientesNuevos = 0;
    let clientesActualizados = 0;
    const errores = [];

    async function buscarOCrearCliente(pedido) {
      const nombre = limpiarNombreCliente(pedido.clienteNombre || pedido.clienteDir || '');
      if (!nombre) return null;

      // 1) Buscar por teléfono (más confiable ante cambios de formato)
      if (pedido.telefono) {
        const porTel = await pool.query(
          `SELECT * FROM logistics.clientes WHERE telefono=$1 ORDER BY updated_at DESC LIMIT 1`,
          [pedido.telefono]
        );
        if (porTel.rows.length > 0) {
          const cl = porTel.rows[0];
          await pool.query(
            `UPDATE logistics.clientes SET nombre=$1, direccion=$2, ciudad=$3, telefono=$4, ultima_importacion=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP WHERE id=$5`,
            [nombre, pedido.direccion || cl.direccion, pedido.ciudad || cl.ciudad, pedido.telefono || cl.telefono, cl.id]
          );
          clientesActualizados++;
          return { ...cl, nombre };
        }
      }

      const normalized = nombre.toLowerCase().replace(/\s+/g, ' ');

      // 2) Fuzzy match por nombre (pg_trgm — resistente a basura en extracción)
      const fuzzy = await pool.query(
        `SELECT *, similarity(LOWER(nombre), $1) AS sim FROM logistics.clientes WHERE similarity(LOWER(nombre), $1) > 0.3 ORDER BY sim DESC LIMIT 1`,
        [normalized]
      );
      if (fuzzy.rows.length > 0) {
        const cl = fuzzy.rows[0];
        await pool.query(
          `UPDATE logistics.clientes SET direccion=$1, ciudad=$2, telefono=COALESCE(NULLIF($3,''), telefono), ultima_importacion=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP WHERE id=$4`,
          [pedido.direccion || cl.direccion, pedido.ciudad || cl.ciudad, pedido.telefono || cl.telefono, cl.id]
        );
        clientesActualizados++;
        return cl;
      }

      // 3) Legacy: match exacto
      const exacto = await pool.query('SELECT * FROM logistics.clientes WHERE LOWER(nombre)=$1', [normalized]);
      if (exacto.rows.length > 0) {
        const cl = exacto.rows[0];
        let updateFields = [];
        let values = [];
        let idx = 1;

        if (pedido.direccion && pedido.direccion !== cl.direccion) {
          updateFields.push(`direccion=$${idx++}`); values.push(pedido.direccion);
          updateFields.push(`geocodificado=false`);
        }
        if (pedido.ciudad && pedido.ciudad !== cl.ciudad) { updateFields.push(`ciudad=$${idx++}`); values.push(pedido.ciudad); }
        if (pedido.telefono && pedido.telefono !== cl.telefono) { updateFields.push(`telefono=$${idx++}`); values.push(pedido.telefono); }
        updateFields.push(`ultima_importacion=CURRENT_TIMESTAMP`);
        updateFields.push(`updated_at=CURRENT_TIMESTAMP`);

        if (updateFields.length > 2) {
          values.push(cl.id);
          await pool.query(`UPDATE logistics.clientes SET ${updateFields.join(',')} WHERE id=$${idx}`, values);
          clientesActualizados++;
        }
        return cl;
      }

      // 4) Crear nuevo
      let lat = null, lng = null;
      if (pedido.direccion) {
        const coords = await geocodificar(pedido.direccion, pedido.ciudad || 'Medellín');
        if (coords) { lat = coords.lat; lng = coords.lng; geocodificados++; }
      }

      const nuevo = await pool.query(
        `INSERT INTO logistics.clientes (nombre, direccion, ciudad, telefono, latitud, longitud, geocodificado, ultima_importacion)
         VALUES ($1,$2,$3,$4,$5,$6,$7,CURRENT_TIMESTAMP)
         ON CONFLICT (nombre) DO UPDATE SET ultima_importacion=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP
         RETURNING *`,
        [nombre, pedido.direccion || '', pedido.ciudad || '', pedido.telefono || '', lat, lng, lat !== null]
      );
      if (nuevo.rows[0]?.created_at === nuevo.rows[0]?.updated_at) clientesNuevos++;
      return nuevo.rows[0];
    }

    function limpiarNombreCliente(nombre) {
      if (!nombre) return '';
      return nombre
        .replace(/\s+\d[\d\.,]+\s*(FEV[-\s]\d+)?\s*$/i, '')
        .replace(/\s+FEV[-\s]\d+\s*$/i, '')
        .replace(/\s+$/, '')
        .trim();
    }

    for (const pedido of resultado.pedidos) {
      try {
        const cliente = await buscarOCrearCliente(pedido);
        let lat = null, lng = null;
        if (cliente?.latitud && cliente?.longitud) {
          lat = cliente.latitud; lng = cliente.longitud;
        } else if (pedido.direccion) {
          const coords = await geocodificar(pedido.direccion, pedido.ciudad || 'Medellín');
          if (coords) { lat = coords.lat; lng = coords.lng; geocodificados++; }
        }
        // Auto-crear vehículo si la placa vino en el PDF y no existe
        let vehiculoId = null;
        if (pedido.placa) {
          const veh = await pool.query('SELECT id FROM logistics.vehiculos WHERE placa=$1', [pedido.placa]);
          if (veh.rows.length > 0) {
            vehiculoId = veh.rows[0].id;
          } else {
            const nuevo = await pool.query(
              `INSERT INTO logistics.vehiculos (placa, alias, estado) VALUES ($1,$2,'disponible') ON CONFLICT (placa) DO UPDATE SET alias=EXCLUDED.alias RETURNING id`,
              [pedido.placa, 'Importado SIESA']
            );
            vehiculoId = nuevo.rows[0].id;
          }
        }
        await pool.query(
          `INSERT INTO logistics.pedidos_logistica (numero_factura, cliente_id, cliente_nombre, direccion, ciudad, telefono, latitud, longitud, valor_credito, valor_contado, conductor, placa, nro_guia, estado)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'pendiente')
           ON CONFLICT (numero_factura) DO NOTHING`,
          [pedido.numeroFactura, cliente?.id || null, cliente?.nombre || pedido.clienteNombre || pedido.clienteDir,
           pedido.direccion || '', pedido.ciudad || '', pedido.telefono || '', lat, lng,
           pedido.valor || 0, pedido.valorContado || 0, pedido.conductor || '', pedido.placa || '', pedido.nroGuia || '']
        );
        importados++;
      } catch (e) {
        fallidos++;
        errores.push({ factura: pedido.numeroFactura, error: e.message });
      }
    }

    await pool.query(
      `INSERT INTO logistics.importaciones (tipo, nombre_archivo, registros_importados, registros_fallidos, estado, detalles)
       VALUES ('siesa_pdf', $1, $2, $3, $4, $5)`,
      [req.file.originalname, importados, fallidos, fallidos > 0 ? 'parcial' : 'exitosa',
       JSON.stringify({ conductor: resultado.conductor, placa: resultado.placa, errores })]
    );

    fs.unlink(req.file.path, () => {});

    res.json({
      exitosa: true,
      totalPedidos: resultado.totalPedidos,
      importados, fallidos, geocodificados,
      clientesNuevos, clientesActualizados,
      conductor: resultado.conductor,
      placa: resultado.placa,
      debug: resultado._debug || null
    });
  } catch (err) {
    if (req.file) fs.unlink(req.file.path, () => {});
    res.status(500).json({ error: err.message });
  }
});

router.post('/widetech', upload.single('archivo'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Archivo Excel requerido' });

    const resultado = await parsearWidetech(req.file.path);

    if (!resultado.exitosa) {
      await pool.query(
        `INSERT INTO logistics.importaciones (tipo, nombre_archivo, registros_importados, registros_fallidos, estado, detalles)
         VALUES ('widetech_excel', $1, 0, 0, 'fallida', $2)`,
        [req.file.originalname, JSON.stringify({ error: resultado.error })]
      );
      return res.status(422).json({ error: resultado.error });
    }

    let importados = 0;
    let fallidos = 0;

    for (const registro of resultado.registros) {
      try {
        let vehiculoId = null;
        const veh = await pool.query('SELECT id FROM logistics.vehiculos WHERE placa=$1', [registro.placa]);
        if (veh.rows.length > 0) {
          vehiculoId = veh.rows[0].id;
        } else {
          const nuevo = await pool.query(
            `INSERT INTO logistics.vehiculos (placa, alias, estado) VALUES ($1,$2,'disponible') ON CONFLICT (placa) DO UPDATE SET alias=EXCLUDED.alias RETURNING id`,
            [registro.placa, registro.alias]
          );
          vehiculoId = nuevo.rows[0].id;
        }

        await pool.query(
          `INSERT INTO logistics.posiciones_gps (vehiculo_id, fecha_gps, latitud, longitud, localizacion, velocidad, rumbo)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [vehiculoId, registro.fechaGPS, registro.latitud, registro.longitud,
           registro.localizacion, registro.velocidad, registro.rumbo]
        );
        importados++;
      } catch {
        fallidos++;
      }
    }

    await pool.query(
      `INSERT INTO logistics.importaciones (tipo, nombre_archivo, registros_importados, registros_fallidos, estado, detalles)
       VALUES ('widetech_excel', $1, $2, $3, $4, $5)`,
      [req.file.originalname, importados, fallidos, fallidos > 0 ? 'parcial' : 'exitosa', '{}']
    );

    fs.unlink(req.file.path, () => {});

    res.json({
      exitosa: true,
      totalRegistros: resultado.totalRegistros,
      vehiculosUnicos: resultado.vehiculosUnicos,
      importados, fallidos
    });
  } catch (err) {
    if (req.file) fs.unlink(req.file.path, () => {});
    res.status(500).json({ error: err.message });
  }
});

router.post('/maestro-clientes', upload.single('archivo'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Archivo requerido' });

    const resultado = await parsearMaestroClientes(req.file.path);

    if (!resultado.exitosa) {
      fs.unlink(req.file.path, () => {});
      return res.status(422).json({ error: resultado.error });
    }

    let importados = 0;
    let actualizados = 0;
    let errores = [];

    for (const c of resultado.clientes) {
      try {
        const existente = await pool.query(
          `SELECT id FROM logistics.clientes WHERE codigo_siesa=$1 OR (nombre ILIKE $2 AND codigo_siesa IS NULL)`,
          [c.codigo, c.nombre]
        );

        if (existente.rows.length > 0) {
          await pool.query(
            `UPDATE logistics.clientes SET
              direccion=$1, ciudad=$2, ruta=$3, ruta_moto=$4,
              codigo_siesa=COALESCE(NULLIF($5,''), codigo_siesa),
              ultima_importacion=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP
             WHERE id=$6`,
            [c.direccion, c.ciudad, c.ruta || null, c.ruta_moto || null, c.codigo || null, existente.rows[0].id]
          );
          actualizados++;
        } else {
          await pool.query(
            `INSERT INTO logistics.clientes (nombre, direccion, ciudad, ruta, ruta_moto, codigo_siesa, ultima_importacion)
             VALUES ($1,$2,$3,$4,$5,$6,CURRENT_TIMESTAMP)`,
            [c.nombre, c.direccion, c.ciudad, c.ruta || null, c.ruta_moto || null, c.codigo || null]
          );
          importados++;
        }
      } catch (e) {
        errores.push({ nombre: c.nombre, error: e.message });
      }
    }

    fs.unlink(req.file.path, () => {});

    await pool.query(
      `INSERT INTO logistics.importaciones (tipo, nombre_archivo, registros_importados, registros_fallidos, estado, detalles)
       VALUES ('maestro_clientes', $1, $2, $3, $4, $5)`,
      [req.file.originalname, importados + actualizados, errores.length,
       errores.length > 0 ? 'parcial' : 'exitosa',
       JSON.stringify({ importados, actualizados, errores })]
    );

    res.json({
      exitosa: true,
      importados,
      actualizados,
      total: resultado.clientes.length,
      errores: errores.length > 0 ? errores : undefined
    });
  } catch (err) {
    if (req.file) fs.unlink(req.file.path, () => {});
    res.status(500).json({ error: err.message });
  }
});

export default router;
