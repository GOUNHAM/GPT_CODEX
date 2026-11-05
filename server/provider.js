import { destinations } from './domain.js';
import { sonoClient } from './sono-client.js';
// Illustrative fixtures only. Never returned as live availability.
const fixtures=[
 ['yangyang','suite','스위트 · 오션뷰',32,5,228000,'ocean',true],
 ['samcheok','suite','스위트 · 패밀리 트윈',30,5,242000,'coast',true],
 ['goseong','suite','스위트 · 마운틴뷰',35,5,198000,'mountain',true],
 ['hongcheon','family','패밀리 · 온돌',20,4,156000,'forest',true],
 ['jindo','royal','로얄 스위트 · 오션뷰',42,6,328000,'sunset',true],
 ['geoje','suite','스위트 · 오션뷰',32,5,216000,'island',true],
 ['jeju','family','패밀리 · 가든뷰',22,4,168000,'forest',true],
 ['gyeongju','suite','스위트 · 레이크뷰',30,5,188000,'coast',true],
 ['byeonsan','suite','스위트 · 오션뷰',30,5,202000,'sunset',true],
 ['danyang','family','패밀리 · 리버뷰',20,4,138000,'mountain',true],
 ['yeosu','suite','스위트 · 오션뷰',31,4,218000,'ocean',true],
 ['cheonan','family','패밀리 · 트윈',22,4,148000,'forest',true]
];
export function demoSearch(c){return fixtures.filter(([id,type,,size,capacity])=>{
 const d=destinations.find(x=>x.id===id);return (c.destination==='all'||c.destination===id)&&(c.region==='전체 지역'||c.region===d.region)&&(c.roomType==='all'||c.roomType===type)&&size>=c.minSize&&capacity>=c.adults+c.children;
}).map(([id,type,title,size,capacity,price,scene,kitchen],i)=>({id:`${id}-${type}`,resort:destinations.find(x=>x.id===id).name,region:destinations.find(x=>x.id===id).region,destination:id,type,title,size,capacity,price,scene,kitchen,source:'demo'}));}
export class ProviderError extends Error {constructor(code,message,status=503){super(message);this.code=code;this.status=status;}}
export async function liveSearch(criteria){
 const url=process.env.SONO_CONNECTOR_URL;
 if(!url) return sonoClient.search(criteria);
 const endpoint=new URL(url);if(endpoint.protocol!=='https:'&&!(endpoint.protocol==='http:'&&['localhost','127.0.0.1'].includes(endpoint.hostname)))throw new ProviderError('INVALID_CONNECTOR','조회 서비스는 HTTPS 연결이 필요합니다.');
 let response;try{response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json',...(process.env.SONO_CONNECTOR_TOKEN?{Authorization:`Bearer ${process.env.SONO_CONNECTOR_TOKEN}`}:{})},body:JSON.stringify(criteria),signal:AbortSignal.timeout(30000),redirect:'error'});}catch{throw new ProviderError('PROVIDER_UNREACHABLE','예약 조회 서비스에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.');}
 if(!response.ok)throw new ProviderError('PROVIDER_ERROR','예약 조회 서비스가 요청을 처리하지 못했습니다. 관리자에게 연결 상태 확인을 요청해 주세요.');
 let body;try{body=await response.json();}catch{throw new ProviderError('INVALID_RESPONSE','예약 조회 서비스 응답 형식을 확인해 주세요.');}
 if(body.source!=='sono'||!Array.isArray(body.rooms)||!body.checkedAt||Number.isNaN(Date.parse(body.checkedAt))||Math.abs(Date.now()-Date.parse(body.checkedAt))>300000)throw new ProviderError('INVALID_RESPONSE','최신 소노 조회 결과를 확인할 수 없습니다.');
 const rooms=body.rooms.map(r=>{
 if(typeof r.id!=='string'||typeof r.resort!=='string'||typeof r.title!=='string'||!destinations.some(d=>d.id===r.destination&&d.region===r.region)||!['family','suite','royal'].includes(r.type)||!Number.isFinite(r.size)||!Number.isInteger(r.capacity)||!Number.isFinite(r.price)||r.price<0||r.availability!=='available'||r.checkIn!==criteria.checkIn||r.checkOut!==criteria.checkOut)throw new ProviderError('INVALID_RESPONSE','날짜와 예약 가능 여부가 확인된 객실 응답이 필요합니다.');
 return {id:r.id,resort:r.resort,title:r.title,destination:r.destination,region:r.region,type:r.type,size:r.size,capacity:r.capacity,price:r.price,kitchen:Boolean(r.kitchen),scene:'ocean',source:'sono'};
 }).filter(r=>(criteria.destination==='all'||r.destination===criteria.destination)&&(criteria.region==='전체 지역'||r.region===criteria.region)&&(criteria.roomType==='all'||r.type===criteria.roomType)&&r.size>=criteria.minSize&&r.capacity>=criteria.adults+criteria.children);
 return {rooms,checkedAt:body.checkedAt};
}
