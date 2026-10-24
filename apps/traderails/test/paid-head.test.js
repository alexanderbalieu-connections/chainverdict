import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {rejectPaidHead} from '../lib/reject-paid-head.js';
const {createApp}=await import('../server.js');
const {app}=createApp({payTo:null,log:()=>{}});
async function listen(t, app) {
 const s=app.listen(0,'127.0.0.1'); await new Promise(r=>s.once('listening',r));
 t.after(()=>s.close()); return `http://127.0.0.1:${s.address().port}`;
}
test('all advertised paid GETs reject HEAD, including Express aliases and payment headers',async t=>{
 const base=await listen(t,app);
 const d=await(await fetch(base+'/.well-known/x402.json')).json();
 for(const route of d.endpoints.filter(r=>r.method==='GET')) {
  const path=route.path.replaceAll('*','test');
  for(const p of [path,path+'/',path.toUpperCase()]) {
   const r=await fetch(base+p+'?probe=1',{method:'HEAD',headers:{'payment-signature':'invalid-must-not-be-used'}});
   assert.equal(r.status,405,p);assert.equal(r.headers.get('allow'),'GET');assert.equal(await r.text(),'');
   assert.equal(r.headers.get('payment-response'),null);
  }
 }
 assert.equal((await fetch(base+'/health',{method:'HEAD'})).status,200);
});
test('guard stops both payment and handler work but preserves GET, OPTIONS and free HEAD',async t=>{
 const a=express();let downstream=0;
 a.use(rejectPaidHead(['GET /paid/*','GET /exact','POST /submit']));
 a.use((req,res)=>{downstream++;res.status(req.method==='GET'?402:204).end();});
 const base=await listen(t,a);
 for(const path of ['/paid/value','/PAID/value/','/exact','/EXACT/']) {
  assert.equal((await fetch(base+path,{method:'HEAD',headers:{'payment-signature':'invalid'}})).status,405);
 }
 assert.equal(downstream,0);
 assert.equal((await fetch(base+'/exact')).status,402);
 assert.equal((await fetch(base+'/exact',{method:'OPTIONS'})).status,204);
 assert.equal((await fetch(base+'/free',{method:'HEAD'})).status,204);
 assert.equal(downstream,3);
});
