import test from 'node:test';import assert from 'node:assert/strict';import http from 'node:http';
import {roleForHost,proxyHeaders,childEnvironment,createPortfolioGateway,CONFIG_KEYS} from '../src/api-gateway.js';
import fs from 'node:fs';import path from 'node:path';
test('every application environment read is passed through or deliberately assigned',()=>{
 const assigned=new Set(['PORT','CV_NO_LISTEN','PATH','HOME','TMPDIR','LANG','TZ','NODE_ENV']);
 const walk=p=>fs.readdirSync(p,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(p,e.name)):[path.join(p,e.name)]);
 const files=[...walk('src'),...walk('apps/traderails/src'),...walk('apps/traderails/lib'),'apps/traderails/server.js'];
 for(const file of files.filter(p=>p.endsWith('.js'))){const source=fs.readFileSync(file,'utf8');for(const [,name]of source.matchAll(/process\.env\.([A-Z0-9_]+)/g))assert.ok(CONFIG_KEYS.has(name)||assigned.has(name),file+' reads unassigned '+name);assert.ok(!/process\.env\[/.test(source),'computed environment read requires explicit review: '+file);}
});
test('portfolio routes only exact approved hosts',()=>{
 assert.equal(roleForHost('CHAINVERDICT.XYZ:443'),'chainverdict');assert.equal(roleForHost('trade.chainverdict.xyz'),'traderails');assert.equal(roleForHost('pulse.chainverdict.xyz'),null);
 for(const host of ['chainverdict.xyz.evil.test','evil.test','chainverdict.xyz@evil.test','chainverdict.xyz,evil.test',null])assert.equal(roleForHost(host),null);
});
test('legacy children receive only their own approved configuration',()=>{
 const config={SIGNING_KEY_PKCS8_B64:'test',PAY_TO_ADDRESS:'test',CDP_API_KEY_SECRET:'own-secret'};
 const env={PATH:'/bin',ATTEST_PRIVATE_KEY:'pulse-secret',TRADERAILS_LEGACY_CONFIG:'other-secret',CHAINVERDICT_LEGACY_CONFIG:JSON.stringify(config)};
 const child=childEnvironment('chainverdict',env,18801);assert.equal(child.CDP_API_KEY_SECRET,'own-secret');assert.equal(child.ATTEST_PRIVATE_KEY,undefined);assert.equal(child.TRADERAILS_LEGACY_CONFIG,undefined);assert.equal(child.PORT,'18801');
 assert.throws(()=>childEnvironment('chainverdict',{},18801));
 assert.throws(()=>childEnvironment('chainverdict',{CHAINVERDICT_LEGACY_CONFIG:JSON.stringify({...config,NODE_OPTIONS:'unsafe'})},18801));
});
test('gateway preserves paid request bytes and signature headers, without retrying',async()=>{
 let calls=0;const body=Buffer.from('{ "order": "unchanged" }');
 const backend=http.createServer(async(req,res)=>{calls++;const chunks=[];for await(const c of req)chunks.push(c);assert.deepEqual(Buffer.concat(chunks),body);assert.equal(req.headers.host,'trade.chainverdict.xyz');assert.equal(req.headers['payment-signature'],'opaque-proof');res.writeHead(200,{'x-signature':'signed','set-cookie':['a=1','b=2'],'content-type':'application/octet-stream'});res.end(body);});
 await new Promise(r=>backend.listen(0,'127.0.0.1',r));const gateway=createPortfolioGateway({ports:{traderails:backend.address().port}});await new Promise(r=>gateway.listen(0,'127.0.0.1',r));
 try{const result=await new Promise((resolve,reject)=>{const req=http.request({hostname:'127.0.0.1',port:gateway.address().port,path:'/paid',method:'POST',headers:{host:'trade.chainverdict.xyz','payment-signature':'opaque-proof'}},res=>{const chunks=[];res.on('data',c=>chunks.push(c));res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:Buffer.concat(chunks)}));});req.on('error',reject);req.end(body);});assert.equal(result.status,200);assert.deepEqual(result.body,body);assert.equal(result.headers['x-signature'],'signed');assert.deepEqual(result.headers['set-cookie'],['a=1','b=2']);assert.equal(calls,1);}finally{await Promise.all([new Promise(r=>gateway.close(r)),new Promise(r=>backend.close(r))]);}
 assert.deepEqual(proxyHeaders({connection:'x-private','x-private':'remove','payment-signature':'keep'}),{'payment-signature':'keep'});
});
test('synchronous dispatch errors return a gateway error without crashing',async()=>{
 const gateway=createPortfolioGateway({ports:{traderails:-1}});await new Promise(r=>gateway.listen(0,'127.0.0.1',r));
 try{const status=await new Promise((resolve,reject)=>{http.get({hostname:'127.0.0.1',port:gateway.address().port,headers:{host:'trade.chainverdict.xyz'}},r=>{r.resume();resolve(r.statusCode);}).on('error',reject);});assert.equal(status,502);}finally{await new Promise(r=>gateway.close(r));}
});
