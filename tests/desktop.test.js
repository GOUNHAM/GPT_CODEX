import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {PassThrough,Writable} from 'node:stream';
const require=createRequire(import.meta.url);
const {serverEnvironment,inputSession}=require('../desktop/launcher.cjs');
test('portable launch stays on loopback, starts real general lookup and does not reuse a remote connector',()=>{
 const inherited={HTTPS_PROXY:'http://example-proxy:8080',SONO_CONNECTOR_URL:'https://external.invalid',SONO_CONNECTOR_TOKEN:'private-token'};
 const env=serverEnvironment(inherited,'test-user','test-password',45678);
 assert.equal(env.HOST,'127.0.0.1');assert.equal(env.PORT,'45678');assert.equal(env.NODE_ENV,'production');assert.equal(env.APP_START_MODE,'live');assert.equal(env.APP_DEFAULT_BOOKING_BASIS,'standard');assert.equal(env.APP_DEFAULT_DESTINATION,'yangyang');assert.equal(env.SONO_CONNECTOR_URL,undefined);assert.equal(env.SONO_CONNECTOR_TOKEN,undefined);assert.equal(env.HTTPS_PROXY,inherited.HTTPS_PROXY);assert.equal(env.SONO_PASSWORD,'test-password');assert.equal(inherited.SONO_CONNECTOR_TOKEN,'private-token');
});
test('password prompt does not echo the entered password to the console',async()=>{
 const input=new PassThrough();input.isTTY=true;input.setRawMode=()=>{};let displayed='';
 const stdout=new Writable({write(chunk,encoding,done){displayed+=chunk.toString();done();}});
 const session=inputSession(input,stdout);
 try{const answer=session.ask('비밀번호: ',true);input.write('not-a-real-password\r');assert.equal(await answer,'not-a-real-password');assert.ok(displayed.includes('비밀번호'));assert.ok(!displayed.includes('not-a-real-password'));}finally{session.close();input.destroy();}
});
