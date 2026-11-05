import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SonoClient } from '../server/sono-client.js';

function fixture({login = {userInfo:{needPwdChangeYn:'N',needNumChangeYn:'N'}},memberships = [],allMemberships = [],userInfo = {userInfo:{privateProfile:'must-not-leak'}},responseStatus = 200,clock = {value:1000000}} = {}) {
 const calls = [];
 const env={SONO_USERNAME:'test-user',SONO_PASSWORD:'test-password',HTTPS_PROXY:'http://test-proxy:8080'};
 const createContext = async options => {
  calls.push({type:'context',options});
  const respond=(url,method,options)=>{
   calls.push({type:method,url,options});
   const body=url.includes('/auth/login')?login:url.includes('/auth/userinfo')?userInfo:url.includes('/totalMemberNoList')?allMemberships:memberships;
   return {ok:()=>responseStatus===200,status:()=>responseStatus,json:async()=>({success:true,body}),dispose:async()=>{}};
  };
  return {get:async(url,options)=>respond(url,'get',options),post:async(url,options)=>respond(url,'post',options),dispose:async()=>{calls.push({type:'dispose'});}};
 };
 const client=new SonoClient({env,createContext,now:()=>clock.value});
 return {client,calls,env,clock};
}
test('official login verifies its session, honors proxy/TLS and exposes no account or profile',async()=>{
 const {client,calls}=fixture();const state=await client.checkConnection();
 assert.equal(state.authenticated,true);assert.equal(state.membershipCount,0);assert.equal(state.state,'membership_missing');assert.equal(state.roomSearchReady,false);
 assert.equal(calls[0].options.proxy.server,'http://test-proxy:8080');assert.equal(calls[0].options.ignoreHTTPSErrors,false);
 assert.deepEqual(calls.filter(c=>c.type==='post').map(c=>c.url),['/api/hms/user/management/auth/login?lang=ko&deviceType=PC&mobileAppYn=N']);
 assert.ok(calls.some(c=>c.url?.includes('/auth/userinfo')));
 for(const secret of ['test-user','test-password','privateProfile','must-not-leak'])assert.ok(!JSON.stringify(state).includes(secret));
 await client.dispose();
});
test('missing membership is a blocking error, never an empty availability result',async()=>{
 const {client}=fixture();await assert.rejects(client.search({}),error=>error.code==='SONO_MEMBERSHIP_MISSING'&&error.status===409&&error.connection.membershipCount===0);await client.dispose();
});
test('concurrent checks use one login and cache memberships for one minute',async()=>{
 const {client,calls,clock}=fixture();await Promise.all([client.checkConnection(),client.checkConnection(),client.checkConnection()]);await client.checkConnection();
 assert.equal(calls.filter(c=>c.type==='post').length,1);assert.equal(calls.filter(c=>c.url?.includes('/memberNoList')).length,1);
 clock.value+=61000;await client.checkConnection();assert.equal(calls.filter(c=>c.type==='post').length,1);assert.equal(calls.filter(c=>c.url?.includes('/memberNoList')).length,2);await client.dispose();
});
test('rejected and locked accounts do not retry for thirty minutes',async()=>{
 for(const [login,code] of [[{userInfo:null,failCnt:1},'SONO_AUTH_FAILED'],[{lock:true},'SONO_ACCOUNT_LOCKED']]){
 const {client,calls}=fixture({login});await assert.rejects(client.checkConnection(),e=>e.code===code);await assert.rejects(client.checkConnection(),e=>e.code===code);assert.equal(calls.filter(c=>c.type==='post').length,1);assert.equal(client.status().authenticated,false);
 }
});
test('login success without a verified session and additional authentication fail closed',async()=>{
 const f=fixture({userInfo:{userInfo:null}});await assert.rejects(f.client.checkConnection(),e=>e.code==='SONO_AUTH_FAILED');
 const a=fixture({login:{userInfo:{needPwdChangeYn:'Y'}}});await assert.rejects(a.client.checkConnection(),e=>e.code==='SONO_ACCOUNT_ACTION_REQUIRED');
});
test('missing credentials never make network requests; failures omit upstream text',async()=>{
 const f=fixture();delete f.env.SONO_PASSWORD;await assert.rejects(f.client.checkConnection(),e=>e.code==='SONO_CREDENTIALS_MISSING');assert.equal(f.calls.length,0);
 const g=fixture({responseStatus:403});await assert.rejects(g.client.checkConnection(),e=>e.code==='SONO_UNREACHABLE');
});
test('new credentials reset authentication cooldown and sessions expire without leaking old state',async()=>{
 const f=fixture({login:{userInfo:null}});await assert.rejects(f.client.checkConnection());f.env.SONO_PASSWORD='changed-test-password';await assert.rejects(f.client.checkConnection());assert.equal(f.calls.filter(c=>c.type==='post').length,2);
 const g=fixture();await g.client.checkConnection();g.clock.value+=16*60_000;assert.equal(g.client.status().state,'unchecked');await g.client.checkConnection();assert.equal(g.calls.filter(c=>c.type==='post').length,2);await g.client.dispose();
});
test('unverified room search and all non-read-only endpoints remain blocked',async()=>{
 const {client,calls}=fixture({memberships:[{memNo:'private-test-number'}]});await assert.rejects(client.search({}),e=>e.code==='SONO_SEARCH_NOT_VERIFIED');assert.equal(calls.filter(c=>c.type==='post').length,1);
 await assert.rejects(client.call('/memberReservation/room/reserve/pay-now',{}),e=>e.code==='READ_ONLY');assert.equal(calls.filter(c=>c.type==='post').length,1);await client.dispose();
});

test('D membership is detected separately and never silently used for corporate requests',async()=>{
 const {client}=fixture({allMemberships:[{memNo:'private-d-number',memIndNm:'D멤버스'}]});const state=await client.checkConnection();
 assert.equal(state.membershipCount,0);assert.equal(state.totalMembershipCount,1);assert.equal(state.standardAvailable,true);assert.equal(state.state,'general_only');assert.ok(!JSON.stringify(state).includes('private-d-number'));
 await assert.rejects(client.search({bookingBasis:'corporate'}),e=>e.code==='SONO_MEMBERSHIP_MISSING');await assert.rejects(client.search({bookingBasis:'standard',destination:'all'}),e=>e.code==='SONO_DESTINATION_REQUIRED');await client.dispose();
});
test('a D membership is not selected arbitrarily from several identities',async()=>{
 const {client}=fixture({allMemberships:[{memNo:'first',memIndNm:'D멤버스'},{memNo:'second',memIndNm:'D멤버스'}]});const state=await client.checkConnection();assert.equal(state.standardAvailable,false);await assert.rejects(client.search({bookingBasis:'standard'}),e=>e.code==='SONO_STANDARD_UNAVAILABLE');await client.dispose();
});
