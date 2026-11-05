import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseQuery,validateSearch,addDays,validDate,koreaToday} from '../server/domain.js';
import {demoSearch,liveSearch} from '../server/provider.js';
const today='2026-11-02';
const criteria={region:'전체 지역',destination:'all',checkIn:'2026-12-18',checkOut:'2026-12-20',adults:2,children:2,roomType:'all',minSize:0};
test('Korean natural-language requirements become exact confirmed fields',()=>{
 const {patch}=parseQuery('12월 18일부터 2박, 양양 성인 2명 아이 2명 30평 이상 스위트',today);
 assert.deepEqual(patch,{destination:'yangyang',region:'강원',roomType:'suite',minSize:30,adults:2,children:2,checkIn:'2026-12-18',checkOut:'2026-12-20'});
});
test('family totals, date ranges and missing date clarification',()=>{
 const p=parseQuery('12월 18일부터 20일까지 홍천 4인 가족 아이 2명 패밀리',today).patch;
 assert.equal(p.adults,2);assert.equal(p.children,2);assert.equal(p.checkOut,'2026-12-20');
 const q=parseQuery('다음 주말 강원도 스위트',today);assert.equal(q.patch.checkIn,undefined);assert.ok(q.notes.some(n=>n.includes('정확한')));
 assert.equal(parseQuery('양양 아이 2명',today).patch.adults,undefined);
});
test('ISO dates, year rollover and Seoul calendar',()=>{
 assert.equal(parseQuery('2027-01-10 3박 제주 성인 2명',today).patch.checkOut,'2027-01-13');
 assert.equal(parseQuery('1월 3일 2박',today).patch.checkIn,'2027-01-03');
 assert.equal(addDays('2026-12-31',1),'2027-01-01');
 assert.equal(koreaToday(new Date('2026-11-01T16:00:00Z')),'2026-11-02');
});
test('invalid dates, past dates, capacity and excessive stays are rejected',()=>{
 assert.equal(validDate('2026-02-30'),false);assert.deepEqual(validateSearch(criteria,today),[]);
 for(const patch of [{checkOut:criteria.checkIn},{checkIn:'2025-01-01'},{adults:0},{children:-1},{minSize:-1},{checkOut:'2027-12-20'},{destination:'invalid'}])assert.ok(validateSearch({...criteria,...patch},today).length);
});
test('demo filters region, resort, room, area and total guests together',()=>{
 const rooms=demoSearch({...criteria,region:'강원',destination:'yangyang',roomType:'suite',minSize:30});assert.equal(rooms.length,1);assert.equal(rooms[0].source,'demo');
 assert.equal(demoSearch({...criteria,adults:12}).length,0);assert.equal(demoSearch({...criteria,minSize:100}).length,0);
});
test('live mode fails closed without a verified connector',async()=>{
 const old=process.env.SONO_CONNECTOR_URL,user=process.env.SONO_USERNAME,password=process.env.SONO_PASSWORD;delete process.env.SONO_CONNECTOR_URL;delete process.env.SONO_USERNAME;delete process.env.SONO_PASSWORD;
 try{await assert.rejects(liveSearch(criteria),e=>e.code==='SONO_CREDENTIALS_MISSING');}finally{if(old)process.env.SONO_CONNECTOR_URL=old;if(user)process.env.SONO_USERNAME=user;if(password)process.env.SONO_PASSWORD=password;}
});
test('live mode rejects stale data and mismatched stay dates',async()=>{
 const previous=globalThis.fetch,old=process.env.SONO_CONNECTOR_URL;process.env.SONO_CONNECTOR_URL='https://example.com/search';
 const room={...demoSearch(criteria)[0],availability:'available',checkIn:criteria.checkIn,checkOut:criteria.checkOut};
 try{
 globalThis.fetch=async()=>({ok:true,json:async()=>({source:'sono',checkedAt:'2020-01-01T00:00:00Z',rooms:[]})});await assert.rejects(liveSearch(criteria),e=>e.code==='INVALID_RESPONSE');
 globalThis.fetch=async()=>({ok:true,json:async()=>({source:'sono',checkedAt:new Date().toISOString(),rooms:[{...room,checkIn:'2026-12-19'}]})});await assert.rejects(liveSearch(criteria),e=>e.code==='INVALID_RESPONSE');
 globalThis.fetch=async()=>({ok:true,json:async()=>({source:'sono',checkedAt:new Date().toISOString(),rooms:[room]})});const r=await liveSearch(criteria);assert.equal(r.rooms[0].source,'sono');
 }finally{globalThis.fetch=previous;if(old)process.env.SONO_CONNECTOR_URL=old;else delete process.env.SONO_CONNECTOR_URL;}
});
