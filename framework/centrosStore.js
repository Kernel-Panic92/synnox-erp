// Shared in-memory centros store - CommonJS for launcher compatibility
let _centros = [];
let _ts = 0;
const TTL = 30000;

function setCentros(data) {
  _centros = Array.isArray(data) ? data : [];
  _ts = Date.now();
}

function getCentros() {
  if (Date.now() - _ts < TTL) return _centros;
  return _centros;
}

module.exports = { setCentros, getCentros };
