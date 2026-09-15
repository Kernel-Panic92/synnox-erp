import express from 'express';
import { requirePermiso } from '../../../../framework/auth.mjs';
import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const router = express.Router();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
function getLauncherDb(){ return new Database(path.join(__dirname, '..','..','..','..','launcher','launcher.db')); }

router.get('/autocomplete', requirePermiso('ver','crm'), async (req, res)=>{
  try{
    const input = String(req.query.input||'').trim();
    if(!input || input.length<3) return res.json({ ok:true, predictions: [] });
    const ldb = getLauncherDb();
    const row = ldb.prepare("SELECT value FROM config WHERE key='google_maps_key'").get();
    ldb.close();
    const key = row?.value || '';
    if(!key) return res.json({ ok:true, predictions: [], warning: 'API key no configurada' });
    const url = `https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${encodeURIComponent(input)}&components=country:co&language=es&key=${encodeURIComponent(key)}`;
    const r = await fetch(url);
    const j = await r.json();
    if(j.status !== 'OK' && j.status !== 'ZERO_RESULTS') return res.json({ ok:false, error: j.status, predictions: [] });
    res.json({ ok:true, predictions: j.predictions || [] });
  }catch(e){ res.status(500).json({ ok:false, error: e.message }); }
});

router.get('/details', requirePermiso('ver','crm'), async (req, res)=>{
  try{
    const place_id = String(req.query.place_id||'').trim();
    if(!place_id) return res.status(400).json({ ok:false, error:'place_id requerido' });
    const ldb = getLauncherDb();
    const row = ldb.prepare("SELECT value FROM config WHERE key='google_maps_key'").get();
    ldb.close();
    const key = row?.value || '';
    if(!key) return res.status(400).json({ ok:false, error:'API key no configurada' });
    const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${encodeURIComponent(place_id)}&fields=address_components,formatted_address,geometry&language=es&key=${encodeURIComponent(key)}`;
    const r = await fetch(url);
    const j = await r.json();
    if(j.status !== 'OK') return res.json({ ok:false, error: j.status });
    res.json({ ok:true, result: j.result });
  }catch(e){ res.status(500).json({ ok:false, error: e.message }); }
});

export default router;
