export function createMiddleware() {
  return async (req, res) => {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    // Auth check: require valid token with proyectos module access
    const token = req.headers.authorization?.replace('Bearer ', '') || req.cookies?.launcher_jwt;
    if (!token) return res.status(401).json({ error: 'No autenticado' });

    try {
      const { default: jwt } = await import('jsonwebtoken');
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      if (!decoded.modulos_permisos?.proyectos) {
        return res.status(403).json({ error: 'Sin acceso al módulo de proyectos' });
      }
      req.user = decoded;
    } catch {
      return res.status(401).json({ error: 'Token inválido' });
    }

    const { method, params, id } = req.body;
    let response;
    switch (method) {
      case 'initialize':
        response = { jsonrpc: '2.0', id, result: { protocolVersion: '0.1.0', capabilities: { tools: {} }, serverInfo: { name: 'proyectos', version: '1.0.0' } } };
        break;
      case 'ping':
        response = { jsonrpc: '2.0', id, result: {} };
        break;
      case 'tools/list':
        response = { jsonrpc: '2.0', id, result: { tools: [] } };
        break;
      case 'tools/call':
        response = { jsonrpc: '2.0', id, error: { code: -32601, message: 'Tool not implemented' } };
        break;
      default:
        response = { jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found' } };
    }
    res.json(response);
  };
}
