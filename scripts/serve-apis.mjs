import {fork} from 'node:child_process';
import {createPortfolioGateway,childEnvironment} from '../src/api-gateway.js';

const ports={chainverdict:18801,traderails:18802};
const heaps={chainverdict:96,traderails:64};
const children=new Map(),ready=new Set(),restarts=new Map();let stopping=false;
// Parse all scoped configurations before changing the serving state.
const environments=Object.fromEntries(Object.entries(ports).map(([role,port])=>[role,childEnvironment(role,process.env,port)]));
for(const role of Object.keys(ports))start(role);
function start(role){
  if(stopping)return;
  const child=fork(new URL('./api-child.mjs',import.meta.url),[role],{env:environments[role],execArgv:[`--max-old-space-size=${heaps[role]}`],stdio:['ignore','inherit','inherit','ipc']});children.set(role,child);
  let stable;
  child.on('message',m=>{if(m?.ready){ready.add(role);process.send?.({childReady:role,pid:child.pid});if(!stable){stable=setTimeout(()=>restarts.set(role,0),60000);stable.unref();}}});
  child.on('error',()=>{ready.delete(role);console.error('portfolio child unavailable:',role);});
  child.on('exit',()=>{
    clearTimeout(stable);ready.delete(role);process.send?.({childExited:role});
    if(!stopping){const count=(restarts.get(role)||0)+1;restarts.set(role,count);const delay=Math.min(60000,5000*2**Math.min(count-1,4));console.error('portfolio worker restart:',role,'attempt',count,'delay_ms',delay);setTimeout(()=>start(role),delay);}
  });
}
const server=createPortfolioGateway({ports,ready:role=>ready.has(role)});
server.listen(Number(process.env.PORT||10000),'0.0.0.0',()=>console.log('portfolio gateway listening on '+server.address().port));
function stop(){if(stopping)return;stopping=true;server.close();for(const child of children.values())child.kill('SIGTERM');setTimeout(()=>process.exit(0),25000).unref();}
process.on('SIGTERM',stop);process.on('SIGINT',stop);
