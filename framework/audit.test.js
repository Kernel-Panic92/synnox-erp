const test = require('node:test');
const assert = require('node:assert/strict');
const {
  configureAudit,
  auditarEvento,
  sanitizeMetadata,
  diffSeguro
} = require('./audit');

test('sanitizes sensitive keys recursively', () => {
  const clean = sanitizeMetadata({ password: 'x', nested: { token: 'y', keep: true } });
  assert.deepEqual(clean, { nested: { keep: true } });
});

test('auditarEvento normalizes and inserts without exposing secrets', async () => {
  let query;
  configureAudit({
    query: async (sql, params) => {
      query = { sql, params };
      return { rows: [{ id: 42 }] };
    }
  }, { maskIp: true });

  const id = await auditarEvento({
    modulo: 'proyectos', categoria: 'crud', accion: 'update', resultado: 'exito',
    actor_email: 'admin@example.com', ip: '192.168.1.44',
    metadata: { password: 'hidden', despues: { estado: 'aprobado' } }
  });

  assert.equal(id, 42);
  assert.equal(query.params[9], '192.168.1.0');
  assert.equal(query.params[7], 'a***@example.com');
  assert.deepEqual(JSON.parse(query.params[14]), { despues: { estado: 'aprobado' } });
});

test('audit failure does not throw', async () => {
  configureAudit({ query: async () => { throw new Error('database unavailable'); } });
  assert.equal(await auditarEvento({ modulo: 'system', accion: 'test' }), null);
});

test('diffSeguro excludes sensitive fields', () => {
  assert.deepEqual(diffSeguro({ status: 'old', token: 'x' }, { status: 'new', token: 'y' }), {
    status: { antes: 'old', despues: 'new' }
  });
});
