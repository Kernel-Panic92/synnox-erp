import pool from '../config/db.js';

class WidetechClient {
  constructor() {
    this.baseUrl = '';
    this.user = '';
    this.pass = '';
    this.rateLimitMs = 25000;
    this.lastRequest = 0;
    this._loaded = false;
  }

  async loadConfig() {
    const keys = ['widetech_url','widetech_user','widetech_password','widetech_lang','widetech_rate_limit'];
    const result = await pool.query('SELECT clave, valor FROM logistics.configuracion WHERE clave = ANY($1)', [keys]);
    const cfg = {};
    for (const row of result.rows) cfg[row.clave] = row.valor;
    this.baseUrl = (cfg.widetech_url || 'https://web1ws.shareservice.co').replace(/\/+$/, '');
    this.user = cfg.widetech_user || '';
    this.pass = cfg.widetech_password || '';
    const rl = parseInt(cfg.widetech_rate_limit) || 25;
    this.rateLimitMs = Math.max(20000, rl * 1000);
    this._loaded = true;
  }

  get basicAuth() {
    const str = `${this.user}:${this.pass}`;
    return 'Basic ' + Buffer.from(str, 'utf8').toString('base64');
  }

  async _rateLimit() {
    const now = Date.now();
    const elapsed = now - this.lastRequest;
    if (elapsed < this.rateLimitMs) {
      await new Promise(r => setTimeout(r, this.rateLimitMs - elapsed));
    }
    this.lastRequest = Date.now();
  }

  async _request(path, body = {}) {
    if (!this.user || !this.pass) throw new Error('Widetech no configurado — configura usuario y contraseña en Configuración');
    if (!this._loaded) await this.loadConfig();
    await this._rateLimit();
    const url = this.baseUrl + path;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': this.basicAuth },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30000)
    });
    return res.json();
  }

  _parseTable(data) {
    if (!data.DynamicJson?.[0]?.Struct || !data.DynamicJson?.[0]?.Data) return [];
    const struct = data.DynamicJson[0].Struct;
    return (data.DynamicJson[0].Data || []).map(row => {
      const obj = {};
      struct.forEach((key, i) => obj[key] = row[i] ?? null);
      return obj;
    });
  }

  async getTravel({ startDate, endDate, plate }) {
    const body = { strStartDate: startDate, strEndDate: endDate };
    if (plate) body.strPlate = plate;
    const data = await this._request('/TravelConsole/rest/GetTravel', body);
    if (data.Code !== 0 && data.Code !== 110 && data.Code !== 100) {
      throw new Error(`Widetech GetTravel error ${data.Code}: ${data.Desc}`);
    }
    return this._parseTable(data);
  }

  async checkBoot(plate) {
    const data = await this._request('/TravelConsole/rest/CheckBoot', { strPlate: plate });
    if (data.Code === 112) return { exists: false, dateGps: null };
    if (data.Code !== 0) throw new Error(`Widetech CheckBoot error ${data.Code}: ${data.Desc}`);
    return { exists: true, dateGps: data.DynamicJson?.DateGPS || null };
  }

  async getZones(zoneName) {
    const body = {};
    if (zoneName) body.strName = zoneName;
    const data = await this._request('/TravelConsole/rest/GetZones', body);
    if (data.Err?.Code !== 0 && data.Err?.Code !== undefined && data.Err?.Code !== null) {
      throw new Error(`Widetech GetZones error ${data.Err.Code}: ${data.Err.Desc}`);
    }
    const zones = [];
    for (const table of (data.dataList || [])) {
      if (!table.Struct || !table.Data) continue;
      for (const row of table.Data) {
        const zone = {};
        table.Struct.forEach((key, i) => zone[key] = row[i] ?? null);
        zones.push(zone);
      }
    }
    return zones;
  }

  async createItinerary(data) {
    const body = {
      objItinerario: {
        strManifest: data.manifest || '',
        strPlate: data.plate || '',
        strDate: data.date || '',
        strHour: data.hour || '',
        strDriver: data.driver || '',
        strOrigin: data.origin || '',
        strDestination: data.destination || '',
        strLatitude: data.latOrigin || '',
        strLongitude: data.lngOrigin || '',
      },
      objCheckpoint: (data.checkpoints || []).map((cp, i) => ({
        cpId: i + 1,
        cpName: cp.name || '',
        cpLatitude: String(cp.lat || ''),
        cpLongitude: String(cp.lng || ''),
        cpOrder: cp.order || i,
        cpAltitude: String(cp.altitude || ''),
        cpSpeed: String(cp.speed || ''),
        cpDate: cp.date || '',
        cpIdPort: cp.idPort || '0',
        cpIdPortDest: cp.idPortDest || '0',
      }))
    };
    const dataRaw = await this._request('/TravelConsole/rest/CreateItinerary', body);
    if (dataRaw.Code !== 0) throw new Error(`Widetech CreateItinerary error ${dataRaw.Code}: ${dataRaw.Desc}`);
    return dataRaw;
  }

  async closeItinerary(manifest) {
    const body = { strManifest: manifest };
    const data = await this._request('/TravelConsole/rest/CloseItinerary', body);
    if (data.Code !== 0 && data.Code !== 402) throw new Error(`Widetech CloseItinerary error ${data.Code}: ${data.Desc}`);
    return data;
  }

  async createVehicle(plate, transponder) {
    const body = {
      objMobile: {
        Plate: plate,
        Transponder: {
          Id: transponder.id || 0,
          NitTransponder: transponder.nit || '',
          Password: transponder.password || '',
          User: transponder.user || ''
        }
      }
    };
    const data = await this._request('/TravelConsole/rest/CreateVehicle', body);
    if (data.Code !== 0) throw new Error(`Widetech CreateVehicle error ${data.Code}: ${data.Desc}`);
    return data.DynamicJson?.MobileID || data.Desc;
  }

  async syncOrphanVehicles(travels) {
    const plates = [...new Set(travels.map(t => t.Plate).filter(Boolean))];
    if (!plates.length) return { created: 0, existing: 0 };
    const existing = await pool.query('SELECT placa FROM logistics.vehiculos WHERE placa = ANY($1)', [plates]);
    const existingPlates = new Set(existing.rows.map(r => r.placa));
    let created = 0;
    for (const plate of plates) {
      if (!existingPlates.has(plate)) {
        await pool.query(
          `INSERT INTO logistics.vehiculos (placa, alias, estado, created_at, updated_at)
           VALUES ($1, $2, 'desconocido', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
           ON CONFLICT (placa) DO NOTHING`,
          [plate, '🛰️ Widetech']
        );
        created++;
      }
    }
    return { created, existing: existingPlates.size };
  }
}

const instance = new WidetechClient();
export default instance;
