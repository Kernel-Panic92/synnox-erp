import pool from '../config/db.js';

// Bloquea la edición/eliminación de clientes y sucursales gestionados en el ERP SIESA (origen='siesa').
// Admin y gerente pueden desbloquear; vendedores solo lectura.
export async function requireClienteEditable(req, res, next) {
  try {
    if (req.user?.rol === 'admin' || req.user?.rol === 'gerente') return next();

    const { id } = req.params;
    if (!id) return next();

    const r = await pool.query(`SELECT origen FROM crm.clientes WHERE id = $1`, [id]);
    if (r.rows.length && r.rows[0].origen === 'siesa') {
      return res.status(403).json({ error: 'Cliente gestionado en el ERP SIESA (solo lectura). Los cambios se hacen en el ERP y se sincronizan.' });
    }
    next();
  } catch {
    next();
  }
}

// Bloquea edición/eliminación de sucursales cuyo cliente padre es del ERP SIESA
export async function requireSucursalEditable(req, res, next) {
  try {
    if (req.user?.rol === 'admin' || req.user?.rol === 'gerente') return next();

    const { id } = req.params;
    if (!id) return next();

    const r = await pool.query(`
      SELECT c.origen FROM crm.sucursales s
      JOIN crm.clientes c ON c.id = s.cliente_id
      WHERE s.id = $1
    `, [id]);
    if (r.rows.length && r.rows[0].origen === 'siesa') {
      return res.status(403).json({ error: 'Sucursal de cliente ERP SIESA (solo lectura). Los cambios se hacen en el ERP y se sincronizan.' });
    }
    next();
  } catch {
    next();
  }
}

// Bloquea CREAR sucursales en clientes del ERP SIESA (todos los roles; las sucursales vienen del sync)
export async function requireClienteSiesaNoCreate(req, res, next) {
  try {
    const { clienteId } = req.params;
    if (!clienteId) return next();
    const r = await pool.query(`SELECT origen FROM crm.clientes WHERE id = $1`, [clienteId]);
    if (r.rows.length && r.rows[0].origen === 'siesa') {
      return res.status(403).json({ error: 'Sucursales de clientes ERP SIESA se gestionan en el ERP y se sincronizan. No se crean en el CRM.' });
    }
    next();
  } catch {
    next();
  }
}