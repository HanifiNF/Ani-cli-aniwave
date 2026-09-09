const { spawn } = require('node:child_process');
const { resolve } = require('node:path');
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(require('electron'), [...process.argv.slice(2), resolve(__dirname, 'player-integration.cjs')], { env, stdio:'inherit' });
child.on('error', error => { console.error(error); process.exitCode=1; });
child.on('exit', code => { process.exitCode=code ?? 1; });
