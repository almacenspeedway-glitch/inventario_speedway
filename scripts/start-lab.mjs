import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const mode = process.argv.includes('--dev') ? 'dev' : 'start';
const child = spawn(process.execPath,[path.join(root,'web/node_modules/next/dist/bin/next'),mode,...(mode==='dev'?['--webpack']:[]),'--hostname','127.0.0.1','--port','4174'],{
  cwd:path.join(root,'web'),stdio:'inherit',env:{...process.env,SPEEDWAY_LOCAL_LAB:'1',NEXT_TELEMETRY_DISABLED:'1'}
});
child.on('exit',code=>process.exit(code ?? 1));
process.on('SIGINT',()=>child.kill('SIGINT'));
