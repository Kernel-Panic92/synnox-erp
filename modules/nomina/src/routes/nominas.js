const express = require('express');

function generarPeriodos({ db, uid }, anio, tipo, periodos) {
  const cfg = {};
  try {
    const rows = db.prepare('SELECT clave, valor FROM configuracion').all();
    for (const r of rows) cfg[r.clave] = r.valor;
  } catch {}

  const diasDefault = tipo === 'quincenal'
    ? parseInt(cfg.calendario_dias_quincenal || '2')
    : tipo === 'mensual'
      ? parseInt(cfg.calendario_dias_mensual || '5')
      : parseInt(cfg.calendario_dias_semanal || '1');

  const insert = db.prepare('INSERT INTO nominas (id,nombre,tipo,inicio,fin,fecha_limite) VALUES (?,?,?,?,?,?)');
  const created = [];
  db.transaction(() => {
    for (const p of periodos) {
      let inicio, fin;
      if (p.inicio && p.fin) {
        inicio = p.inicio;
        fin = p.fin;
      } else if (tipo === 'mensual') {
        const meses = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
        const idx = meses.indexOf(p.nombre.replace(` ${anio}`, ''));
        if (idx === -1) continue;
        inicio = `${anio}-${String(idx + 1).padStart(2, '0')}-01`;
        fin = new Date(anio, idx + 1, 0).toISOString().slice(0, 10);
      } else if (tipo === 'quincenal') {
        const meses = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
        const parts = p.nombre.split(' ');
        const mes = parts[0];
        const quincena = parseInt(parts[1]);
        const idx = meses.indexOf(mes);
        if (idx === -1) continue;
        if (quincena === 1) {
          inicio = `${anio}-${String(idx + 1).padStart(2, '0')}-01`;
          fin = `${anio}-${String(idx + 1).padStart(2, '0')}-15`;
        } else {
          inicio = `${anio}-${String(idx + 1).padStart(2, '0')}-16`;
          fin = new Date(anio, idx + 1, 0).toISOString().slice(0, 10);
        }
      } else {
        continue;
      }

      const finDate = new Date(fin + 'T12:00:00');
      finDate.setDate(finDate.getDate() - diasDefault);
      const fecha_limite = finDate.toISOString().slice(0, 10);

      const id = uid();
      insert.run(id, p.nombre, tipo, inicio, fin, fecha_limite);
      created.push({ id, nombre: p.nombre, tipo, inicio, fin, fecha_limite });
    }
  })();
  return created;
}

module.exports = function createNominasRouter(deps) {
  const router = express.Router();
  const { middlewares: { todosRoles, adminRrhh, soloAdmin } } = deps;

  router.get('/', todosRoles, (req, res) =>
    res.json(deps.db.prepare('SELECT * FROM nominas ORDER BY inicio DESC').all()));

  router.post('/', adminRrhh, (req, res) => {
    const { nombre, tipo, inicio, fin, fecha_limite } = req.body;
    const id = deps.uid();
    deps.db.prepare('INSERT INTO nominas (id,nombre,tipo,inicio,fin,fecha_limite) VALUES (?,?,?,?,?,?)').run(id, nombre, tipo, inicio, fin, fecha_limite || '');
    res.json({ id });
  });

  router.post('/generar', adminRrhh, (req, res) => {
    const { anio, tipo, periodos } = req.body;
    if (!anio || !tipo || !periodos?.length) {
      return res.status(400).json({ error: 'Datos inválidos' });
    }
    try {
      const created = generarPeriodos(deps, anio, tipo, periodos);
      res.json({ ok: true, count: created.length, periodos: created });
    } catch (e) {
      console.error('Error generating periods:', e);
      console.error('Error generando períodos:', e.message);
      res.status(500).json({ error: 'Error generando períodos' });
    }
  });

  router.put('/:id', adminRrhh, (req, res) => {
    const { fecha_limite } = req.body;
    if (fecha_limite !== undefined) {
      deps.db.prepare('UPDATE nominas SET fecha_limite = ? WHERE id = ?').run(fecha_limite, req.params.id);
    }
    res.json({ ok: true });
  });

  router.delete('/:id', soloAdmin, (req, res) => {
    deps.db.prepare('DELETE FROM nominas WHERE id=?').run(req.params.id);
    res.json({ ok: true });
  });

  return router;
};
