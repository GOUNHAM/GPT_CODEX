'use strict';
const path = require('node:path');
const fs = require('node:fs');
const net = require('node:net');
const http = require('node:http');
const readline = require('node:readline');
const { Writable } = require('node:stream');
const { spawn } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');

function serverEnvironment(inherited, username, password, port) {
  const env = { ...inherited, NODE_ENV: 'production', HOST: '127.0.0.1', PORT: String(port), SONO_USERNAME: username, SONO_PASSWORD: password, APP_START_MODE: 'live', APP_DEFAULT_BOOKING_BASIS: 'standard', APP_DEFAULT_DESTINATION: 'yangyang' };
  // A separately configured external provider must not override the packaged direct client.
  delete env.SONO_CONNECTOR_URL;
  delete env.SONO_CONNECTOR_TOKEN;
  return env;
}
function inputSession(input = process.stdin, stdout = process.stdout) {
  let muted = false;
  const output = new Writable({ write(chunk, encoding, done) { if (!muted) stdout.write(chunk, encoding); done(); } });
  const rl = readline.createInterface({ input, output, terminal: Boolean(input.isTTY) });
  return {
    ask(prompt, secret = false) { return new Promise(resolve => {
      stdout.write(prompt); muted = secret;
      rl.question('', value => { muted = false; if (secret) stdout.write('\n'); resolve(value); });
    }); },
    close() { rl.close(); },
  };
}
async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();server.once('error', reject);
    server.listen(0, '127.0.0.1', () => { const port = server.address().port;server.close(error => error ? reject(error) : resolve(port)); });
  });
}
function health(port) {
  return new Promise(resolve => {
    const request = http.get({ hostname: '127.0.0.1', port, path: '/api/status', timeout: 800 }, response => {
      let data = '';response.on('data', chunk => { data += chunk;if (data.length > 8192) response.destroy(); });
      response.on('end', () => { try { resolve(response.statusCode === 200 && JSON.parse(data).mode === 'read-only'); } catch { resolve(false); } });
      response.on('error', () => resolve(false));
    });
    request.on('timeout', () => request.destroy());request.on('error', () => resolve(false));
  });
}
async function launch({ root = __dirname, noBrowser = false, account } = {}) {
  const app = path.join(root, 'app'), serverFile = path.join(app, 'server', 'index.js');
  if (!fs.existsSync(serverFile) || !fs.existsSync(path.join(app, 'dist', 'index.html'))) throw Error('INCOMPLETE_PACKAGE');
  console.log('\n  Stay Desk · 실제 콘도 조회\n');
  console.log('  소노 계정 정보는 파일에 저장되지 않습니다.\n');
  let username = account?.username, password = account?.password;
  if (!account) {
    const session = inputSession();
    try { username = (await session.ask('  소노 아이디: ')).trim();password = await session.ask('  소노 비밀번호 (입력해도 화면에 보이지 않습니다): ', true); }
    finally { session.close(); }
  }
  if (!username || !password) throw Error('ACCOUNT_REQUIRED');
  const port = await freePort(), env = serverEnvironment(process.env, username, password, port);
  username = undefined;password = undefined;
  const child = spawn(process.execPath, [serverFile], { cwd: app, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  delete env.SONO_USERNAME;delete env.SONO_PASSWORD;
  let failed = false;
  child.on('error', () => { failed = true; });
  child.stdout.resume();child.stderr.resume();
  const stop = () => { if (child.exitCode === null) child.kill(); };
  process.once('SIGINT', stop);process.once('SIGTERM', stop);process.once('exit', stop);
  try {
    let ready = false;
    for (let i = 0; i < 60; i++) {
      if (failed || child.exitCode !== null) throw Error('SERVER_START_FAILED');
      if (await health(port)) { ready = true;break; }
      await delay(250);
    }
    if (!ready) throw Error('SERVER_START_FAILED');
    const url = `http://127.0.0.1:${port}`;
    console.log('  앱이 준비되었습니다. 브라우저에서 리조트·날짜를 선택하고 조회하세요.');
    console.log('  이 창을 열어 두세요. 종료하려면 Ctrl+C를 누르세요.\n');
    if (!noBrowser) {
      const browser = process.platform === 'win32'
        ? spawn('cmd.exe', ['/d', '/c', 'start', '', url], { stdio: 'ignore', windowsHide: true })
        : spawn('xdg-open', [url], { stdio: 'ignore' });
      browser.on('error', () => console.log(`  브라우저가 열리지 않으면 주소창에 입력하세요: ${url}`));
      browser.on('exit', code => { if (code) console.log(`  브라우저가 열리지 않으면 주소창에 입력하세요: ${url}`); });
    }
    return { child, port, url, stop, dispose() { stop();process.removeListener('SIGINT', stop);process.removeListener('SIGTERM', stop);process.removeListener('exit', stop); } };
  } catch (error) { stop();process.removeListener('SIGINT', stop);process.removeListener('SIGTERM', stop);process.removeListener('exit', stop);throw error; }
}
if (require.main === module) launch({ noBrowser: process.argv.includes('--no-browser') }).then(({ child, dispose }) => {
  child.once('exit', code => { dispose();if (code && code !== 0) { console.error('  앱이 종료되었습니다. 압축을 모두 풀었는지 확인하고 다시 실행해 주세요.');process.exitCode = 1; } });
}).catch(error => {
  console.error(error.message === 'ACCOUNT_REQUIRED' ? '\n  아이디와 비밀번호를 모두 입력한 후 다시 실행해 주세요.' : '\n  앱을 시작하지 못했습니다. ZIP 파일을 폴더에 모두 풀고 START.cmd를 실행해 주세요.');
  process.exitCode = 1;
});
module.exports = { serverEnvironment, inputSession, freePort, health, launch };
