// Shared in-memory centros store - both launcher and modules can use this
let _centros = [];
let _ts = 0;
const TTL = 30000;

export function setCentros(data) {
  _centros = Array.isArray(data) ? data : [];
  _ts = Date.now();
}

export function getCentros() {
  if (Date.now() - _ts < TTL) return _centros;
  return _centros;
}
