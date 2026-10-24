const role=process.argv[2];let app;
if(role==='chainverdict')({app}=await import('../src/index.js'));
else if(role==='traderails'){const {createApp}=await import('../apps/traderails/server.js');({app}=createApp());}
else throw Error('Unknown service');
const server=app.listen(Number(process.env.PORT),'127.0.0.1',()=>process.send?.({ready:true}));
process.on('SIGTERM',()=>{server.close(()=>process.exit(0));setTimeout(()=>process.exit(0),20000).unref();});
