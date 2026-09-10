// analytics-collector.js — privacy-friendly event collector for outbackrun.com
//
// Deploy (free, ~10 min, no card):
//   1. dashboard.cloudflare.com -> Workers & Pages -> Create Worker
//   2. Paste this file's code as the worker, Deploy -> note the https://<you>.workers.dev URL
//   3. Worker -> Settings -> Bindings -> Add KV Namespace:
//      variable name MUST be OBR_STATS (create the namespace, e.g. "obr-stats")
//   4. Redeploy, then put that URL into ANALYTICS_ENDPOINT in index.html
//
// Endpoints:
//   POST /  body: {"events":[{e,p,t,s,d},...]}  -> aggregates into KV
//   GET  /  -> JSON aggregates: totals, by_vehicle, crash_by_severity, by_day
//
// No IPs stored, no cookies set, CORS open for the game's origin only if you
// restrict Access-Control-Allow-Origin below.

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export default {
  async fetch(req, env){
    const headers = { ...CORS };
    if(req.method === 'OPTIONS') return new Response(null, { headers });
    if(req.method === 'GET'){
      const agg = (await env.OBR_STATS.get('agg', 'json')) ||
        { totals:{}, by_vehicle:{}, crash_by_severity:{}, by_day:{} };
      return new Response(JSON.stringify(agg, null, 2),
        { headers: { ...headers, 'Content-Type': 'application/json' } });
    }
    if(req.method !== 'POST') return new Response('method not allowed', { status: 405, headers });

    let body;
    try{ body = await req.json(); }catch(e){ return new Response('bad json', { status: 400, headers }); }
    const events = Array.isArray(body.events) ? body.events.slice(0, 50) : [];

    // read-modify-write with retry: last writer wins is fine for counters
    for(let attempt = 0; attempt < 5; attempt++){
      const agg = (await env.OBR_STATS.get('agg', 'json')) ||
        { totals:{}, by_vehicle:{}, crash_by_severity:{}, by_day:{} };
      for(const ev of events){
        const t = String(ev.e || 'unknown').slice(0, 40);
        agg.totals[t] = (agg.totals[t] || 0) + 1;
        const day = new Date(ev.t || Date.now()).toISOString().slice(0, 10);
        agg.by_day[day] = agg.by_day[day] || {};
        agg.by_day[day][t] = (agg.by_day[day][t] || 0) + 1;
        const p = ev.p || {};
        if(t === 'run_start' && p.vehicle){
          const v = String(p.vehicle).slice(0, 24);
          agg.by_vehicle[v] = (agg.by_vehicle[v] || 0) + 1;
        }
        if(t === 'crash' && p.severity){
          const sev = String(p.severity).slice(0, 12);
          agg.crash_by_severity[sev] = (agg.crash_by_severity[sev] || 0) + 1;
        }
      }
      try{
        await env.OBR_STATS.put('agg', JSON.stringify(agg));
        break;
      }catch(e){ /* concurrent write: re-read and retry */ }
    }
    return new Response('ok', { headers });
  }
};
