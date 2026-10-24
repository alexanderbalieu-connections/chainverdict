import http from 'node:http';

const HOSTS = new Map([
  ['chainverdict.xyz', 'chainverdict'], ['www.chainverdict.xyz', 'chainverdict'],
  ['trade.chainverdict.xyz', 'traderails'],
  ['chainverdict-0v0s.onrender.com', 'chainverdict'],
]);
export function roleForHost(host) {
  if (typeof host !== 'string' || !/^[a-zA-Z0-9.-]+(?::\d+)?$/.test(host)) return null;
  return HOSTS.get(host.toLowerCase().replace(/:\d+$/, '')) || null;
}
const HOP = new Set(['connection','keep-alive','proxy-authenticate','proxy-authorization','te','trailer','transfer-encoding','upgrade','expect']);
export function proxyHeaders(headers) {
  const excluded=new Set([...HOP,...String(headers.connection||'').toLowerCase().split(',').map(s=>s.trim())]);
  return Object.fromEntries(Object.entries(headers).filter(([k])=>!excluded.has(k.toLowerCase())));
}
export function createPortfolioGateway({ports,ready=()=>true}) {
  return http.createServer({maxHeaderSize:65536,requestTimeout:120000,headersTimeout:30000},(req,res)=>{
    if(req.url==='/_portfolio/health') {
      const ok=Object.keys(ports).every(ready);res.writeHead(ok?200:503,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify({ok}));return;
    }
    const role=roleForHost(req.headers.host);
    if(!role||!ports[role]){res.writeHead(404);res.end();return;}
    if(!ready(role)){res.writeHead(503,{'retry-after':'5'});res.end();return;}
    const headers=proxyHeaders(req.headers);
    // Keep the validated public host for signed resources and facilitator URLs.
    headers.host=req.headers.host;
    headers['x-forwarded-host']=req.headers.host;
    headers['x-forwarded-proto']='https';
    const upstream=http.request({hostname:'127.0.0.1',port:ports[role],method:req.method,path:req.url,headers},response=>{
      res.writeHead(response.statusCode,proxyHeaders(response.headers));response.pipe(res);
      response.on('error',()=>res.destroy());
    });
    upstream.on('error',()=>{if(!res.headersSent){res.writeHead(502);res.end();}else res.destroy();});
    req.on('aborted',()=>upstream.destroy());
    res.on('close',()=>{if(!res.writableFinished)upstream.destroy();});
    req.pipe(upstream); // no body reserialization, buffering, or paid-request retries
  });
}

const SYSTEM=['PATH','HOME','TMPDIR','LANG','TZ','NODE_ENV'];
export const CONFIG_KEYS=new Set(['PAY_TO_ADDRESS','X402_NETWORK','X402_ENABLED','RPC_URL','FACILITATOR_URL','CDP_API_KEY_ID','CDP_API_KEY_SECRET','SIGNING_KEY_PKCS8_B64','PRICE_IDENTIFIER','PRICE_DECODE','PRICE_HS','TRADERAILS_RETIRED']);
export function childEnvironment(role,env,port) {
  if(!['chainverdict','traderails'].includes(role))throw Error('Unknown API child');
  const key=role==='chainverdict'?'CHAINVERDICT_LEGACY_CONFIG':'TRADERAILS_LEGACY_CONFIG';
  let config;try{config=role==='chainverdict'&&!env[key]?Object.fromEntries(Object.entries(env).filter(([k])=>CONFIG_KEYS.has(k))):JSON.parse(env[key]||'');}catch{throw Error('Missing or invalid '+key);}
  if(!config||Array.isArray(config)||typeof config!=='object'||Object.entries(config).some(([k,v])=>!CONFIG_KEYS.has(k)||typeof v!=='string'))throw Error('Invalid scoped service configuration');
  if(!config.SIGNING_KEY_PKCS8_B64||!config.PAY_TO_ADDRESS)throw Error('Pinned signing identity and payout are required');
  return {...Object.fromEntries(SYSTEM.filter(k=>env[k]!==undefined).map(k=>[k,env[k]])),...config,PORT:String(port),CV_NO_LISTEN:'1'};
}
