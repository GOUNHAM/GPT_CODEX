import { addDays, destinations } from './domain.js';

export function stayDates(c) {
  const days=[];
  for(let date=c.checkIn;date<c.checkOut;date=addDays(date,1))days.push(date.replaceAll('-',''));
  return days;
}
export function roomKind(name='') {
  if(/로얄|royal/i.test(name))return 'royal';
  if(/스위트|suite/i.test(name))return 'suite';
  if(/패밀리|family/i.test(name))return 'family';
  return 'other';
}
function plain(value) {return String(value??'').replace(/<[^>]*>/g,' ').replace(/&nbsp;|&#160;/g,' ').replace(/\s+/g,' ').trim();}
export function roomSpec(body={}) {
  const area=plain(body.roomPyeong);
  const sqm=area.match(/(\d+(?:\.\d+)?)\s*(?:㎡|m²|m2)/i);
  const pyeong=area.match(/(\d+(?:\.\d+)?)\s*평/);
  const sizeSqm=sqm?Number(sqm[1]):pyeong?Number(pyeong[1])*3.305785:null;
  const people=plain(body.personCnt||body.peopleCntText);
  const maximum=people.match(/최대\s*(\d+)\s*인/);
  const standard=people.match(/(\d+)\s*인/);
  return {size:sizeSqm===null?null:sizeSqm/3.305785,sizeSqm,areaText:area||null,capacity:maximum?Number(maximum[1]):standard?Number(standard[1]):null,capacityBasis:maximum?'maximum':'standard'};
}
export function matchStores(c,body) {
  if(!Array.isArray(body?.placeList))throw Error('INVALID_PLACES');
  const destination=destinations.find(d=>d.id===c.destination);
  if(!destination?.keywords)return [];
  const stores=[];
  for(const place of body.placeList)for(const store of place.storeList||[]){
    const name=`${place.placeNm||''} ${store.storeFullNm||store.storeNm||''}`;
    if(destination.keywords.some(k=>name.includes(k))&&store.outsYn!=='Y'&&typeof store.storeCd==='string'&&!stores.some(s=>s.storeCd===store.storeCd))stores.push({storeCd:store.storeCd,name:store.storeFullNm||store.storeNm,destination:destination.id,region:destination.region});
  }
  return stores;
}
export function candidates(c,store,calendar,detail) {
  if(!Array.isArray(calendar)||!Array.isArray(detail))throw Error('INVALID_INVENTORY');
  const days=stayDates(c), inventory=calendar.find(s=>s.storeCd===store.storeCd);
  if(!inventory||!Array.isArray(inventory.rmTypeList))throw Error('INCOMPLETE_CALENDAR');
  const rows=[];
  for(const group of detail){
    if(!Array.isArray(group.viewList))throw Error('INVALID_INVENTORY');
    for(const view of group.viewList){
      if(!Array.isArray(view.rmTypeList))throw Error('INVALID_INVENTORY');
      for(const room of view.rmTypeList){
        const type=roomKind(group.roomTypeNm||group.groupRoomNameNm);
        if(c.roomType!=='all'&&c.roomType!==type)continue;
        if(!['A','E','W','D','N','M','S','R','P','G','T','X'].includes(room.rsvStatusCd))throw Error('INVALID_INVENTORY');
        if(!['A','E'].includes(room.rsvStatusCd))continue;
        if(room.errorId||room.errorMsg)throw Error('INVALID_INVENTORY');
        if(!Number.isFinite(room.rsvRmCnt))throw Error('INVALID_INVENTORY');
        if(room.rsvRmCnt<1)continue;
        if(typeof room.rmTypeCd!=='string')throw Error('INVALID_INVENTORY');
        const nights=days.map(day=>inventory.rmTypeList.filter(r=>r.rmTypeCd===room.rmTypeCd&&r.ciYmd===day));
        if(nights.some(values=>values.length!==1||(['A','E'].includes(values[0].rsvStatusCd)&&(values[0].errorId||values[0].errorMsg))))throw Error('INCOMPLETE_CALENDAR');
        if(!nights.every(([r])=>!r.errorId&&!r.errorMsg&&['A','E'].includes(r.rsvStatusCd)&&Number.isFinite(r.rsvRmCnt)&&r.rsvRmCnt>=1))continue;
        rows.push({store,room,type,remaining:Math.min(room.rsvRmCnt,...nights.map(([r])=>r.rsvRmCnt))});
      }
    }
  }
  return rows;
}
export function normalizePrice(body,c) {
  const dates=stayDates(c);
  if(!Number.isFinite(body?.totAmt)||body.totAmt<0||!Array.isArray(body.daysAmtInfoList))throw Error('INVALID_PRICE');
  const nightlyPrices=dates.map(date=>{
    const rows=body.daysAmtInfoList.filter(d=>d.stndYmd===date);
    if(rows.length!==1||!Number.isFinite(rows[0].totAmt)||rows[0].totAmt<0)throw Error('INVALID_PRICE');
    return {date:date.slice(0,4)+'-'+date.slice(4,6)+'-'+date.slice(6,8),price:rows[0].totAmt};
  });
  const rateSubtotal=nightlyPrices.reduce((sum,d)=>sum+d.price,0);
  let discountAmount=0;
  if(rateSubtotal!==body.totAmt){
    // Verified official response: levelAmt is a separate membership-grade discount;
    // daily amounts remain the base rates. Do not infer other unexplained adjustments.
    if(rateSubtotal!==body.originAmt||!Number.isFinite(body.levelAmt)||body.levelAmt<=0||rateSubtotal-body.levelAmt!==body.totAmt||
      (body.dcAmt??0)!==0||(body.longSbscrbAmt??0)!==0||(body.speclBnftAmt??0)!==0||(body.benefitDiscountList?.length??0)!==0)throw Error('INVALID_PRICE');
    discountAmount=body.levelAmt;
  }
  return {price:body.totAmt/dates.length,totalPrice:body.totAmt,nightlyPrices,rateSubtotal,discountAmount,discountLabel:discountAmount?'회원등급 할인':null};
}
export function normalizeRoom(candidate,specBody,c,price) {
  const {room,store,type,remaining}=candidate, spec=roomSpec(specBody);
  if(!Number.isFinite(spec.capacity))return null;
  if(spec.capacity<c.adults+c.children)return null;
  if(c.minSize>0&&(spec.size===null||spec.size<c.minSize))return null;
  const kitchen=room.cookNm==='취사'?true:room.cookNm==='클린'?false:null;
  return {id:`${store.storeCd}-${room.rmTypeCd}`,resort:store.name,region:store.region,destination:store.destination,type,title:room.rmTypeNm||specBody.facilityNm,...spec,kitchen,remaining,...price,scene:room.viewNm==='오션뷰'?'ocean':'forest',source:'sono',bookingBasis:'standard',checkIn:c.checkIn,checkOut:c.checkOut,officialUrl:'https://www.sonohotelsresorts.com/reserve',availability:'available',capacityNote:room.ciOverStnd<c.adults+c.children?'기준 인원 초과에 따른 추가 요금이 발생할 수 있습니다.':null};
}
export async function mapLimit(items,limit,fn) {
  const results=new Array(items.length);let next=0,failure;
  await Promise.all(Array.from({length:Math.min(limit,items.length)},async()=>{
    while(next<items.length&&!failure){
      const index=next++;
      try{results[index]=await fn(items[index],index);}catch(error){failure=error;}
    }
  }));
  if(failure)throw failure;
  return results;
}

export async function searchStandard(client,c,memberNo,ErrorType) {
  if(c.destination==='all')throw new ErrorType('SONO_DESTINATION_REQUIRED','실시간 일반 조회는 리조트를 선택한 후 이용해 주세요. 같은 지역의 호텔·리조트 객실을 함께 확인합니다.',400);
  const types=await client.call(`/management/member/reserve/userTypeList/${encodeURIComponent(memberNo)}`);
  if(!Array.isArray(types)||!types.some(t=>t.commCd==='Y'))throw new ErrorType('SONO_RESERVATION_ACCESS','이 계정에서 확인된 D멤버스 본인 예약 자격을 사용할 수 없습니다.',409);
  const base={memNo:memberNo,userIndCd:'Y',rsvIndCd:'9',ciYmd:c.checkIn.replaceAll('-',''),coYmd:c.checkOut.replaceAll('-',''),nights:stayDates(c).length,rmCnt:1,adultCnt:c.adults,childCnt:c.children,rmTypeCode:''};
  const places=await client.call('/memberReservation/room/placeList',undefined,{memNo:memberNo,userIndCd:'Y'});
  let stores;try{stores=matchStores(c,places);}catch{throw new ErrorType('SONO_INVALID_RESPONSE','조회 가능한 리조트 목록 형식이 변경되었습니다.');}
  if(!stores.length)throw new ErrorType('SONO_DESTINATION_UNAVAILABLE','선택한 리조트가 이 계정의 일반 예약 목록에 없습니다.',409);
  const records=await mapLimit(stores,3,async store=>{
    const body={...base,storeCdList:[store.storeCd]};
    const calendar=await client.call('/memberReservation/room/list/pc',body);
    const detail=await client.call('/memberReservation/room/detail',{...body,actualMemNo:memberNo,rsvBlckCd:'000'});
    try{return candidates(c,store,calendar,detail);}catch(e){throw new ErrorType('SONO_INVENTORY_INCOMPLETE',e.message==='INCOMPLETE_CALENDAR'?'숙박 기간 전체의 객실 재고를 확인하지 못했습니다. 날짜 범위를 줄여 다시 조회해 주세요.':'공식 객실 상태 응답을 확인하지 못했습니다.');}
  });
  const available=records.flat();
  if(available.length>80)throw new ErrorType('SONO_TOO_MANY_ROOMS','조회 가능한 객실이 많습니다. 객실 유형을 선택하여 범위를 좁혀 주세요.',400);
  const facilityCache=new Map();let omitted=0;
  const mapped=await mapLimit(available,3,async row=>{
    const infos=await client.call('/management/room/reserveRoomInfoList',{condition:[{storeCd:row.store.storeCd,rmTypeCd:row.room.rmTypeCd}]});
    if(!Array.isArray(infos))throw new ErrorType('SONO_INVALID_RESPONSE','공식 객실 사양 응답 형식이 변경되었습니다.');
    const info=infos.find(i=>i.storeCd===row.store.storeCd&&i.roomRmTypeList?.some(r=>r.rmTypeCd===row.room.rmTypeCd));
    if(!info?.facilityCd){omitted++;return null;}
    if(!facilityCache.has(info.facilityCd))facilityCache.set(info.facilityCd,client.call('/management/room/detail',undefined,{facilityCd:info.facilityCd}));
    const spec=await facilityCache.get(info.facilityCd);
    if(spec?.facilityCd!==info.facilityCd)throw new ErrorType('SONO_INVALID_RESPONSE','공식 객실 사양을 해당 객실과 연결하지 못했습니다.');
    const preview=normalizeRoom(row,spec,c,{price:null,totalPrice:null,nightlyPrices:[]});
    if(!preview){if(!roomSpec(spec).capacity||(c.minSize>0&&roomSpec(spec).size===null))omitted++;return null;}
    const pricing=await client.call('/memberReservation/room/detail/price',{memNo:memberNo,ciYmd:base.ciYmd,coYmd:base.coYmd,rsvBlckCd:'000',storeCd:row.store.storeCd,userIndCd:'Y',rsvIndCd:'9',rmTypeCd:row.room.rmTypeCd,rmCnt:1,preAftPayYn:'N'});
    try{return normalizeRoom(row,spec,c,normalizePrice(pricing,c));}catch{throw new ErrorType('SONO_PRICE_UNVERIFIED','숙박 기간 전체의 날짜별 요금과 합계를 확인하지 못했습니다. 다시 조회해 주세요.');}
  });
  const rooms=mapped.filter(Boolean);
  if(!rooms.length&&omitted)throw new ErrorType('SONO_SPECS_UNVERIFIED', '예약 가능한 객실이 있으나 공식 면적·정원 등의 사양을 확인하지 못했습니다. 빈방 없음으로 판단할 수 없습니다.');
  return {rooms,checkedAt:new Date(client.now()).toISOString(),bookingBasis:'standard',scopeLabel:'D멤버스 일반 예약',warnings:['D멤버스 일반 예약 기준입니다. 회사 계약 재고·우대요금이 아닙니다.','평수는 공식 안내의 ㎡를 환산한 값입니다. 분양 평형과 다를 수 있습니다.',...(omitted?[`공식 면적·정원 등의 필수 사양을 확인하지 못한 객실 ${omitted}개는 제외했습니다.`]:[])]};
}
