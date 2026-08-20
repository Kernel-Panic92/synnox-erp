# Auditoria central

La migracion `migrations/001_auditoria_central.sql` crea la tabla central en
PostgreSQL. Los modulos pueden inicializar el helper una vez al arrancar:

```js
const { configureAudit, auditarEvento } = require('../../../framework/audit');

configureAudit(pool, {
  maskIp: process.env.AUDIT_MASK_IP === 'true',
  integritySecret: process.env.AUDIT_INTEGRITY_SECRET
});

await auditarEvento({
  modulo: 'proyectos',
  categoria: 'business',
  accion: 'approve',
  resultado: 'exito',
  actor_id: req.usuario?.id,
  ip: req.ip,
  user_agent: req.headers['user-agent'],
  entidad_tipo: 'proyecto',
  entidad_id: proyectoId,
  metadata: { antes: { estado: 'pendiente' }, despues: { estado: 'aprobado' } }
});
```

El helper elimina claves sensibles, limita campos largos y nunca propaga un
fallo de auditoria a la operacion de negocio. Los registros existentes no se
actualizan ni eliminan por APIs de aplicacion.
