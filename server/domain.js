export const destinations = [
 {id:'all',name:'전체 리조트',region:'전체 지역'},
 {id:'yangyang',name:'쏠비치 양양',region:'강원',keywords:['양양']},
 {id:'samcheok',name:'쏠비치 삼척',region:'강원',keywords:['삼척']},
 {id:'jindo',name:'쏠비치 진도',region:'전라',keywords:['진도']},
 {id:'hongcheon',name:'비발디파크 (홍천)',region:'강원',keywords:['홍천','비발디']},
 {id:'goseong',name:'델피노 (설악)',region:'강원',keywords:['델피노','고성','속초']},
 {id:'geoje',name:'소노캄 거제',region:'경상',keywords:['거제']},
 {id:'jeju',name:'소노벨 제주',region:'제주',keywords:['제주']},
 {id:'gyeongju',name:'소노캄 경주',region:'경상',keywords:['경주']},
 {id:'danyang',name:'소노벨 단양',region:'충청',keywords:['단양']},
 {id:'byeonsan',name:'소노벨 변산',region:'전라',keywords:['변산','부안']},
 {id:'yeosu',name:'소노캄 여수',region:'전라',keywords:['여수']},
 {id:'cheonan',name:'소노벨 천안',region:'충청',keywords:['천안']}
];
export function koreaToday(now=new Date()) {return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);}
export function addDays(value,n) { const d = new Date(`${value}T12:00:00Z`); d.setUTCDate(d.getUTCDate()+n); return d.toISOString().slice(0,10); }
export function validDate(v){return typeof v==='string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)) && new Date(v+'T12:00:00Z').toISOString().slice(0,10)===v;}
export function parseQuery(text, today=koreaToday()) {
 const patch={}, notes=[]; const year=Number(today.slice(0,4));
 const matches=destinations.filter(d=>d.keywords?.some(w=>text.includes(w)));
 if(matches.length===1) {patch.destination=matches[0].id;patch.region=matches[0].region;}
 if(matches.length>1) notes.push('여러 리조트가 언급되었습니다. 조회할 리조트를 선택해 주세요.');
 if(!matches.length) {for(const [key,region] of [['강원','강원'],['전라','전라'],['전남','전라'],['전북','전라'],['경상','경상'],['경남','경상'],['경북','경상'],['충청','충청']]) if(text.includes(key)){patch.region=region;patch.destination='all';}}
 if(/스위트|스위트룸|스윗|suite/i.test(text))patch.roomType='suite';
 else if(/패밀리|family/i.test(text))patch.roomType='family';
 else if(/로얄|royal/i.test(text))patch.roomType='royal';
 const size=text.match(/(\d+(?:\.\d+)?)\s*평/); if(size) patch.minSize=Number(size[1]);
 const adults=text.match(/성인\s*(\d+)\s*(?:명|인)?/);const children=text.match(/(?:아이|아동|어린이|자녀)\s*(\d+)\s*(?:명|인)?/);
 if(adults)patch.adults=Number(adults[1]);if(children)patch.children=Number(children[1]);
 const total=text.replace(/(?:아이|아동|어린이|자녀)\s*\d+\s*(?:명|인)?/g,'').match(/(?:가족\s*)?(\d+)\s*(?:명|인)(?:\s*가족)?/);
 if(!adults&&total){patch.adults=Number(total[1]);if(children)patch.adults-=Number(children[1]);notes.push('총인원을 기준으로 성인 수를 계산했습니다. 성인·아동 구성을 확인해 주세요.');}
 let dates=[];
 for(const m of text.matchAll(/(?:(\d{4})[.\-/년]\s*)?(\d{1,2})\s*(?:월\s*|[.\-/])(\d{1,2})\s*일?/g)) {
  const explicit=Boolean(m[1]);let y=explicit?Number(m[1]):year;
  let value=`${y}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`;
  if(!explicit&&value<today)value=`${y+1}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`;
  dates.push(value);
 }
 if(dates.length){patch.checkIn=dates[0];if(dates[1])patch.checkOut=dates[1];
  if(dates.length===1){const end=text.match(/(?:~|부터|에서|–|-)\s*(\d{1,2})\s*일/);if(end) patch.checkOut=dates[0].slice(0,8)+end[1].padStart(2,'0');}}
 else if(/모레/.test(text))patch.checkIn=addDays(today,2);else if(/내일/.test(text))patch.checkIn=addDays(today,1);else if(/오늘/.test(text))patch.checkIn=today;
 const nights=text.match(/(\d+)\s*박/);if(nights&&patch.checkIn&&validDate(patch.checkIn))patch.checkOut=addDays(patch.checkIn,Number(nights[1]));
 if(patch.checkIn&&!patch.checkOut)notes.push('체크아웃 날짜를 선택해 주세요.');
 if(!patch.checkIn)notes.push('정확한 체크인·체크아웃 날짜를 입력해 주세요.');
 if(/주말|연휴|다음\s*주|다음\s*달/.test(text)&&!patch.checkIn)notes.push('상대적인 일정은 정확한 날짜로 선택해 주세요.');
 if(!matches.length&&!patch.region)notes.push('지역 또는 리조트를 선택해 주세요.');
 if(Object.keys(patch).length===0)notes.push('조건을 찾지 못했습니다. 날짜, 장소, 인원을 포함해 다시 입력해 주세요.');
 return {patch,notes:[...new Set(notes)]};
}
export function validateSearch(c,today=koreaToday()){
 const errors=[];
 if(c.bookingBasis!==undefined&&!['corporate','standard'].includes(c.bookingBasis))errors.push('예약 조회 기준을 확인해 주세요.');
 if(!validDate(c.checkIn)||!validDate(c.checkOut))errors.push('체크인과 체크아웃 날짜를 정확히 입력해 주세요.');
 else {if(c.checkIn<today)errors.push('체크인은 오늘 이후여야 합니다.');const days=(Date.parse(c.checkOut)-Date.parse(c.checkIn))/86400000;if(days<1||days>30)errors.push('숙박 기간은 1박부터 30박까지 선택해 주세요.');}
 if(!Number.isInteger(c.adults)||c.adults<1||c.adults>12||!Number.isInteger(c.children)||c.children<0||c.children>10)errors.push('성인 1~12명, 아동 0~10명 범위로 입력해 주세요.');
 if(!['all','family','suite','royal'].includes(c.roomType))errors.push('객실 유형을 확인해 주세요.');
 if(!destinations.some(d=>d.id===c.destination))errors.push('리조트를 확인해 주세요.');
 if(!['전체 지역','강원','전라','경상','충청','제주'].includes(c.region))errors.push('지역을 확인해 주세요.');
 const d=destinations.find(d=>d.id===c.destination);if(d?.keywords&&c.region!=='전체 지역'&&d.region!==c.region)errors.push('리조트와 지역이 일치하지 않습니다.');
 if(!Number.isFinite(c.minSize)||c.minSize<0||c.minSize>100)errors.push('최소 면적은 0~100평으로 입력해 주세요.');
 return errors;
}
