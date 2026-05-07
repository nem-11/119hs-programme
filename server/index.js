const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const path = require('path');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3001;
const SECRET = process.env.JWT_SECRET || '119hs-secret-change-me';

app.use(cors());
app.use(express.json({limit:'50mb'}));
app.use(express.static(path.join(__dirname,'../client/build')));

function auth(req,res,next){const t=req.headers.authorization?.split(' ')[1];if(!t)return res.status(401).json({error:'No token'});try{req.user=jwt.verify(t,SECRET);next()}catch(e){res.status(401).json({error:'Invalid token'})}}
function admin(req,res,next){if(req.user.role!=='admin')return res.status(403).json({error:'Admin only'});next()}
function editor(req,res,next){if(req.user.role==='viewer')return res.status(403).json({error:'Editor required'});next()}

app.post('/api/login',(req,res)=>{const{username,password}=req.body;const u=db.getUser(username);if(!u)return res.status(401).json({error:'Invalid'});const bcrypt=require('bcryptjs');if(!bcrypt.compareSync(password,u.password_hash))return res.status(401).json({error:'Invalid'});const token=jwt.sign({id:u.id,username:u.username,name:u.name,role:u.role,tabs:JSON.parse(u.tabs)},SECRET,{expiresIn:'7d'});res.json({token,user:{id:u.id,username:u.username,name:u.name,role:u.role,tabs:JSON.parse(u.tabs)}})});
app.get('/api/schedule/:tab',auth,(req,res)=>res.json(db.getSchedule(req.params.tab)));
app.put('/api/schedule/:tab/:date',auth,admin,(req,res)=>{db.setScheduleDay(req.params.tab,req.params.date,req.body.data);res.json({ok:true})});
app.post('/api/schedule/activity',auth,admin,(req,res)=>{const{tab,date,tower,zone_name,activity}=req.body;db.addScheduleActivity(tab,date,tower,zone_name,activity);res.json({ok:true})});
app.delete('/api/schedule/activity',auth,admin,(req,res)=>{const{tab,date,tower,zone_name,activity}=req.body;db.removeScheduleActivity(tab,date,tower,zone_name,activity);res.json({ok:true})});
app.get('/api/completions',auth,(req,res)=>res.json(db.getCompletions()));
app.post('/api/completions',auth,editor,(req,res)=>{const{date,key,by}=req.body;const e=db.getCompletion(date,key);if(e){db.deleteCompletion(date,key);res.json({action:'removed'})}else{db.addCompletion(date,key,by);res.json({action:'added'})}});
app.get('/api/milestones',auth,(req,res)=>res.json(db.getMilestones()));
app.post('/api/milestones',auth,admin,(req,res)=>{db.addMilestone(req.body.date,req.body.label,req.body.status||'planned');res.json({ok:true})});
app.get('/api/users',auth,admin,(req,res)=>res.json(db.getUsers().map(u=>({...u,password_hash:undefined}))));
app.post('/api/users',auth,admin,(req,res)=>{const bcrypt=require('bcryptjs');const{username,password,name,role,tabs}=req.body;db.addUser(username,bcrypt.hashSync(password,10),name,role,JSON.stringify(tabs));res.json({ok:true})});
app.delete('/api/users/:id',auth,admin,(req,res)=>{db.deleteUser(req.params.id);res.json({ok:true})});
app.get('/api/drawings',auth,(req,res)=>res.json(db.getDrawings()));
app.get('/api/drawings/:id',auth,(req,res)=>{const d=db.getDrawing(req.params.id);if(!d)return res.status(404).json({error:'Not found'});res.json(d)});
app.get('/api/activities',auth,(req,res)=>res.json(db.getActivities()));
app.post('/api/drawings',auth,editor,(req,res)=>{const{name,tab,floor,image_data,width,height,file_url}=req.body;const r=db.addDrawing(name,tab,floor,image_data,width||0,height||0,file_url||null);res.json({ok:true,id:r.lastInsertRowid})});
app.delete('/api/drawings/:id',auth,admin,(req,res)=>{db.deleteDrawing(req.params.id);res.json({ok:true})});
app.get('/api/zones',auth,(req,res)=>res.json(db.getAllZones()));
app.get('/api/zones/:did',auth,(req,res)=>res.json(db.getZones(req.params.did)));
app.post('/api/zones',auth,editor,(req,res)=>{
  const{drawing_id,name,tower,geometry,activity_id,x,y,w,h}=req.body;
  let geom=geometry;
  if(!geom&&x!=null&&y!=null&&w!=null&&h!=null)geom={kind:'rect',x,y,w,h};
  if(!geom)return res.status(400).json({error:'geometry required'});
  const r=db.addZone(drawing_id,name,tower,geom,activity_id??null);
  res.json({ok:true,id:r.lastInsertRowid});
});
app.put('/api/zones/:id',auth,editor,(req,res)=>{
  const ok=db.updateZone(req.params.id,req.body);
  if(!ok)return res.status(404).json({error:'Not found'});
  res.json({ok:true});
});
app.delete('/api/zones/:id',auth,editor,(req,res)=>{db.deleteZone(req.params.id);res.json({ok:true})});
app.get('/api/programme-items/drawing/:did',auth,(req,res)=>res.json(db.getProgrammeItemsByDrawing(req.params.did)));
app.get('/api/programme-items/zone/:zid',auth,(req,res)=>res.json(db.getProgrammeItemsByZone(req.params.zid)));
app.post('/api/programme-items',auth,editor,(req,res)=>{
  const{zone_id,activity_id,start_date,end_date,status,notes}=req.body;
  if(!zone_id||!activity_id||!start_date||!end_date)return res.status(400).json({error:'Missing fields'});
  const r=db.addProgrammeItem(zone_id,activity_id,start_date,end_date,status,notes);
  res.json({ok:true,id:r.lastInsertRowid});
});
app.put('/api/programme-items/:id',auth,editor,(req,res)=>{
  const ok=db.updateProgrammeItem(req.params.id,req.body);
  if(!ok)return res.status(404).json({error:'Not found'});
  res.json({ok:true});
});
app.delete('/api/programme-items/:id',auth,editor,(req,res)=>{db.deleteProgrammeItem(req.params.id);res.json({ok:true})});
app.get('/api/templates',auth,(req,res)=>res.json(db.getTemplates()));
app.post('/api/templates',auth,admin,(req,res)=>{const{name,tab,tower,zone_name,sequence,durations}=req.body;const r=db.addTemplate(name,tab,tower,zone_name,JSON.stringify(sequence),JSON.stringify(durations));res.json({ok:true,id:r.lastInsertRowid})});
app.delete('/api/templates/:id',auth,admin,(req,res)=>{db.deleteTemplate(req.params.id);res.json({ok:true})});
app.post('/api/templates/apply',auth,admin,(req,res)=>{const{tab,tower,zone_name,sequence,durations,startDate}=req.body;db.applyTemplate(tab,tower,zone_name,JSON.stringify(sequence),JSON.stringify(durations),startDate);res.json({ok:true})});
app.get('*',(req,res)=>res.sendFile(path.join(__dirname,'../client/build/index.html')));

// Start with async db init
db.init().then(() => {
  app.listen(PORT, () => console.log(`119HS server on port ${PORT}`));
}).catch(err => { console.error('DB init failed:', err); process.exit(1); });
