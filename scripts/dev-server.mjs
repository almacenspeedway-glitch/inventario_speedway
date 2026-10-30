// Compatibility entry point: only the training laboratory remains active.
import { createServer } from 'node:http';
createServer((_request,response)=>{
  response.writeHead(302,{'Location':'http://127.0.0.1:4174/','Cache-Control':'no-store'}).end();
}).listen(4173,'127.0.0.1',()=>console.log('Acceso anterior: http://127.0.0.1:4174/'));
