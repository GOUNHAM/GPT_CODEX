import {test} from 'node:test';
import assert from 'node:assert/strict';
import {candidates,roomSpec,normalizePrice,normalizeRoom,matchStores,roomKind} from '../server/sono-rooms.js';
const c={bookingBasis:'standard',destination:'yangyang',region:'강원',checkIn:'2027-01-30',checkOut:'2027-02-01',adults:2,children:2,roomType:'suite',minSize:0};
const store={storeCd:'10',name:'쏠비치 양양 리조트',destination:'yangyang',region:'강원'};
const room={rmTypeCd:'suite-test',rmTypeNm:'스위트(취사/오션뷰/침대)',rsvStatusCd:'A',rsvRmCnt:5,ciOverStnd:5,cookNm:'취사',viewNm:'오션뷰'};
const detail=[{roomTypeNm:'스위트',viewList:[{rmTypeList:[room]}]}];
const inventory=[{storeCd:'10',rmTypeList:[{...room,ciYmd:'20270130'},{...room,ciYmd:'20270131',rsvStatusCd:'E',rsvRmCnt:2}]}];
const spec={facilityNm:'스위트',roomPyeong:'<p>56.1㎡&nbsp;</p>',personCnt:'<p>5인(최대 7인)</p>'};
const pricing={totAmt:420000,daysAmtInfoList:[{stndYmd:'20270130',totAmt:200000},{stndYmd:'20270131',totAmt:220000}]};
test('same room type must be available on every night; checkout is excluded',()=>{
 const rows=candidates(c,store,inventory,detail);assert.equal(rows.length,1);assert.equal(rows[0].remaining,2);
 for(const status of ['W','D','X','G','N'])assert.equal(candidates(c,store,[{...inventory[0],rmTypeList:inventory[0].rmTypeList.map((r,i)=>i?{...r,rsvStatusCd:status}:r)}],detail).length,0);
 assert.throws(()=>candidates(c,store,[{...inventory[0],rmTypeList:[inventory[0].rmTypeList[0]]}],detail),/INCOMPLETE/);
 assert.throws(()=>candidates(c,store,[{...inventory[0],rmTypeList:[...inventory[0].rmTypeList,inventory[0].rmTypeList[0]]}],detail),/INCOMPLETE/);
});
test('wait lists, errors, zero rooms and mismatched types cannot become available',()=>{
 for(const patch of [{rsvStatusCd:'W'},{rsvRmCnt:0},{rsvStatusCd:'N',errorId:'unavailable-code',errorMsg:'not eligible'}])assert.equal(candidates(c,store,inventory,[{roomTypeNm:'스위트',viewList:[{rmTypeList:[{...room,...patch}]}]}]).length,0);
 assert.equal(candidates({...c,roomType:'family'},store,inventory,detail).length,0);
 assert.throws(()=>candidates(c,store,inventory,[{roomTypeNm:'스위트',viewList:[{rmTypeList:[{...room,errorMsg:'upstream error'}]}]}]),/INVALID_INVENTORY/);
});
test('official area and maximum guests are parsed without invented nominal room sizes',()=>{
 const s=roomSpec(spec);assert.equal(s.sizeSqm,56.1);assert.ok(Math.abs(s.size-16.97)<.01);assert.equal(s.capacity,7);assert.equal(s.capacityBasis,'maximum');
 assert.equal(roomSpec({personCnt:'4인'}).capacityBasis,'standard');assert.equal(roomSpec({}).size,null);assert.equal(roomSpec({roomPyeong:'면적 안내 없음'}).size,null);
});
test('room mapping enforces actual capacity and official area with nulls preserved',()=>{
 const candidate=candidates(c,store,inventory,detail)[0];const p=normalizePrice(pricing,c);const result=normalizeRoom(candidate,spec,c,p);
 assert.equal(result.bookingBasis,'standard');assert.equal(result.capacity,7);assert.equal(result.price,210000);assert.equal(result.totalPrice,420000);assert.equal(result.kitchen,true);
 assert.equal(normalizeRoom(candidate,spec,{...c,minSize:30},p),null);assert.equal(normalizeRoom(candidate,spec,{...c,adults:8},p),null);
 assert.equal(normalizeRoom(candidate,{personCnt:'4인'},c,p).size,null);assert.equal(normalizeRoom(candidate,{personCnt:'4인'},{...c,minSize:1},p),null);
 assert.ok(!JSON.stringify(result).includes('memNo'));
});
test('all dates and the actual total must agree with daily official prices',()=>{
 assert.equal(normalizePrice(pricing,c).nightlyPrices[1].date,'2027-01-31');
 for(const patch of [{totAmt:1},{daysAmtInfoList:[pricing.daysAmtInfoList[0]]},{daysAmtInfoList:[...pricing.daysAmtInfoList,pricing.daysAmtInfoList[0]]},{totAmt:-1}])assert.throws(()=>normalizePrice({...pricing,...patch},c),/INVALID_PRICE/);
});
test('destination mapping preserves official store names and excludes outsourced/unrelated stores',()=>{
 const places={placeList:[{placeNm:'쏠비치 양양',storeList:[{storeCd:'10',storeFullNm:'쏠비치 양양 리조트',outsYn:'N'},{storeCd:'13',storeFullNm:'쏠비치 양양 호텔',outsYn:'N'},{storeCd:'99',storeFullNm:'양양 외부업체',outsYn:'Y'}]},{placeNm:'소노캄 거제',storeList:[{storeCd:'24',storeFullNm:'소노캄 거제',outsYn:'N'}]}]};
 assert.deepEqual(matchStores(c,places).map(s=>s.storeCd),['10','13']);assert.equal(roomKind('로얄 스위트'),'royal');assert.equal(roomKind('슈페리어'),'other');
});

test('verified membership grade discounts reconcile base daily rates with the actual total',()=>{
 const p=normalizePrice({...pricing,originAmt:420000,totAmt:400000,levelAmt:20000,dcAmt:0,benefitDiscountList:[]},c);assert.equal(p.discountAmount,20000);assert.equal(p.rateSubtotal-p.discountAmount,p.totalPrice);assert.equal(p.price,200000);assert.equal(p.discountLabel,'회원등급 할인');
 for(const patch of [{levelAmt:10000},{dcAmt:1000},{originAmt:410000},{speclBnftAmt:1000}])assert.throws(()=>normalizePrice({...pricing,originAmt:420000,totAmt:400000,levelAmt:20000,dcAmt:0,...patch},c),/INVALID_PRICE/);
});
