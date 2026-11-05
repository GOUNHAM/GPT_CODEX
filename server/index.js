import express from 'express';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { parseQuery, validateSearch, destinations } from './domain.js';
import { demoSearch, liveSearch } from './provider.js';
import { sonoClient } from './sono-client.js';
try {process.loadEnvFile();}catch(e){if(e.code!=='ENOENT')throw e;}
const app=express(), root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
app.disable('x-powered-by');
app.use((req,res,next)=>{res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','same-origin');if(req.path.startsWith('/api/')){res.setHeader('Cache-Control','no-store');const origin=req.get('origin');if(origin&&origin!==`${req.protocol}://${req.get('host')}`)return res.status(403).json({message:'동일한 사이트에서 요청해 주세요.'});}next();});
app.use(express.json({limit:'8kb'}));
app.get('/api/status',(req,res)=>{const destination=destinations.find(d=>d.id===process.env.APP_DEFAULT_DESTINATION&&d.id!=='all');res.json({connectorConfigured:Boolean(process.env.SONO_CONNECTOR_URL),connection:sonoClient.status(),mode:'read-only',preferences:{mode:process.env.APP_START_MODE==='live'?'live':'demo',bookingBasis:process.env.APP_DEFAULT_BOOKING_BASIS==='standard'?'standard':'corporate',...(destination?{destination:destination.id,region:destination.region}:{})}});});
app.post('/api/connection/check',async(req,res,next)=>{try{res.json({connection:await sonoClient.checkConnection()});}catch(error){next(error);}});
app.post('/api/parse',(req,res)=>{if(typeof req.body?.text!=='string'||req.body.text.length>2000||!req.body.text.trim())return res.status(400).json({message:'문의 내용을 2,000자 이내로 입력해 주세요.'});res.json(parseQuery(req.body.text));});
app.post('/api/search',async(req,res,next)=>{try{
 const {mode,criteria:raw}=req.body??{};if(!['demo','live'].includes(mode)||!raw||typeof raw!=='object')return res.status(400).json({message:'조회 조건을 확인해 주세요.'});
 const criteria=Object.fromEntries(['region','destination','checkIn','checkOut','adults','children','roomType','minSize','bookingBasis'].map(key=>[key,raw[key]]));
 const errors=validateSearch(criteria);if(errors.length)return res.status(400).json({message:errors.join(' ')});
 if(mode==='demo')return res.json({source:'demo',rooms:demoSearch(criteria),checkedAt:null,criteria});
 const result=await liveSearch(criteria);res.json({source:'sono',...result,criteria});
 }catch(e){next(e);}});
app.use('/api',(req,res)=>res.status(404).json({message:'요청한 기능을 찾을 수 없습니다.'}));
if(process.env.NODE_ENV==='production'){app.use(express.static(path.join(root,'dist')));app.get('/{*path}',(req,res)=>res.sendFile(path.join(root,'dist/index.html')));}else{const {createServer}=await import('vite');const vite=await createServer({root,server:{middlewareMode:true},appType:'spa'});app.use(vite.middlewares);}
app.use((err,req,res,next)=>{res.status(err.status||500).json({code:err.code||'INTERNAL_ERROR',message:err.status?err.message:'요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.',...(err.connection?{connection:err.connection}:{})});});
const port=Number(process.env.PORT||3000);app.listen(port,process.env.HOST||'0.0.0.0',()=>console.log(`Stay Desk listening on port ${port}`));
