import pool from '../config/db.js';

const TOOLS = [];

async function ejecutarTool(name, args) {
  switch (name) {
    default: throw new Error('Tool no encontrada: ' + name);
  }
}

export function createMiddleware() {
  return async (req, res) => {
    const body = req.body;
    if (!body) return res.status(400).json({ jsonrpc: '2.0', error: { code: -32700, message: 'Parse error' } });

    const { method, id } = body;

    if (method === 'initialize') {
      res.setHeader('mcp-session-id', `crm-${Date.now()}`);
      return res.json({ jsonrpc: '2.0', id, result: { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'crm', version: '1.0.0' } } });
    }

    if (method === 'ping') {
      return res.json({ jsonrpc: '2.0', id, result: {} });
    }

    if (method === 'tools/list') {
      return res.json({ jsonrpc: '2.0', id, result: { tools: TOOLS } });
    }

    if (method === 'tools/call') {
      const { name, arguments: args } = body.params || {};
      try {
        const result = await ejecutarTool(name, args || {});
        return res.json({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: typeof result === 'string' ? result : JSON.stringify(result) }] } });
      } catch (err) {
        return res.json({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: JSON.stringify({ error: err.message }) }], isError: true } });
      }
    }

    if (method?.startsWith('notifications/')) {
      return res.status(202).json({});
    }

    res.status(400).json({ jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found' } });
  };
}
