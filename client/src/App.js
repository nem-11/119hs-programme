import React,{useState,useEffect,useCallback,useMemo,useRef,Component} from 'react';
import * as api from './api';
import './loginLanding.css';
import {actColor,GW_SEQUENCE,INT_SEQUENCE,MAIN_HEADER_TAB_ORDER,PROJECT_PROGRAMME_TAB,drawingTabLabel,pickInitialScopeTab,dateKey,formatDate,formatShort,toHtmlDateInputValue,parseZoneNameForActivity} from './constants';
import {
  bottomNavItemsForRole,
  allowedPageIdsForRole,
  canTick as roleCanTick,
  canEditZonesProgramme,
  showGantt as roleShowGantt,
  isAdmin as roleIsAdmin,
} from './userPermissions';
import {T,S} from './uiTheme';
import ZoneSetupPage from './ZoneSetupPage';
import ProgrammePage from './ProgrammePage';
import PlanPage from './PlanPage';
import GanttPage from './GanttPage';

class AppErrorBoundary extends Component{
  constructor(p){super(p);this.state={err:null};}
  static getDerivedStateFromError(err){return{err};}
  componentDidCatch(err,info){console.error(err,info);}
  render(){
    if(this.state.err)return<div style={{minHeight:'100vh',background:T.bg,padding:24,fontFamily:'Segoe UI,sans-serif'}}>
      <h1 style={{color:'#c0392b',fontSize:22}}>Something went wrong</h1>
      <p style={{color:T.text,maxWidth:520}}>The app stopped due to an error. Try refreshing. If it keeps happening, open the browser console (F12) for details.</p>
      <pre style={{background:T.surface,padding:14,overflow:'auto',fontSize:12,border:`1px solid ${T.hairline}`,borderRadius:8,color:T.text}}>{this.state.err?.message||String(this.state.err)}</pre>
    </div>;
    return this.props.children;
  }
}

function flattenDaySections(dayData){
  const sections=[];
  if(!dayData)return sections;
  Object.entries(dayData).forEach(([tw,zones])=>{
    if(Array.isArray(zones))sections.push({pfx:tw,acts:zones});
    else Object.entries(zones).forEach(([z,acts])=>sections.push({pfx:z==='_default'?tw:`${tw}|${z}`,acts}));
  });
  return sections;
}
const MILESTONE_STATUSES=['planned','critical','unconfirmed','gated'];

function milestoneDayOrd(key){
  const m=/^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(String(key||'').trim());
  if(!m)return null;
  const y=Number(m[1]),mo=Number(m[2]),d=Number(m[3]);
  if(!Number.isFinite(y)||!Number.isFinite(mo)||!Number.isFinite(d))return null;
  return Math.floor(Date.UTC(y,mo-1,d)/86400000);
}

/** Calendar days from today to due (negative = overdue). */
function daysUntilMilestoneDue(dateStr){
  const due=milestoneDayOrd(dateStr);
  if(due==null)return null;
  const today=milestoneDayOrd(dateKey(new Date()));
  if(today==null)return null;
  return due-today;
}

/**
 * Programme-health styling: combines due date, completion %, and workflow status.
 * Returns tier + label + RGB for bar / accent.
 */
function milestoneHealthVisual(m){
  const pct=Math.max(0,Math.min(100,Math.round(Number(m.completion_pct)||0)));
  const st=String(m.status||'planned').toLowerCase();
  const du=daysUntilMilestoneDue(m.date);

  const complete={
    tier:'complete',
    label:'Complete',
    rgb:'46,178,96',
    tint:'rgba(46,178,96,0.14)',
    badgeFg:'rgba(22,72,42,0.95)',
  };
  if(pct>=100)return complete;

  const risk=(label)=>({
    tier:'risk',
    label,
    rgb:'231,76,60',
    tint:'rgba(231,76,60,0.14)',
    badgeFg:'rgba(110,38,30,0.96)',
  });
  const watch=(label)=>({
    tier:'watch',
    label,
    rgb:'230,126,34',
    tint:'rgba(230,126,34,0.14)',
    badgeFg:'rgba(105,55,18,0.95)',
  });
  const ontrack={
    tier:'on_track',
    label:'On track',
    rgb:'39,174,96',
    tint:'rgba(39,174,96,0.10)',
    badgeFg:'rgba(24,90,52,0.92)',
  };

  if(du==null)return ontrack;
  if(du<0)return risk('Overdue');
  if(st==='critical'&&du<=7&&pct<100)return risk('Critical — due soon');
  if(st==='critical'&&pct<55)return watch('Critical — low progress');
  if((st==='gated'||st==='unconfirmed')&&pct<100)return watch('Uncertain');
  if(du<=7&&pct<90)return watch('Due soon');
  if(du<=21&&pct<50)return watch('Behind pace');
  if(du<=45&&pct<30)return watch('Early risk');
  return ontrack;
}

/** One entry per programme item so admin can pick a single line (no auto list). */
function buildProgrammeMilestonePicklist(planRows){
  const rows=Array.isArray(planRows)?planRows:[];
  const out=[];
  for(const r of rows){
    const id=r.id;
    if(id==null||id==='')continue;
    const sd=String(r.start_date||'').trim();
    const ed=String(r.end_date||'').trim();
    if(!sd||!ed)continue;
    const tw=String(r.tower||'').trim();
    const zn=String(r.zone_name||'').trim();
    const act=String(r.activity_name||'').trim();
    const dn=String(r.drawing_name||'').trim();
    const dt=String(r.drawing_tab||'').trim();
    const zonePart=[tw,zn].filter(Boolean).join(' ');
    const label=dn
      ?`${dn} — ${[zonePart,act].filter(Boolean).join(' — ')}`
      :[zonePart,act].filter(Boolean).join(' — ')||`Programme item ${id}`;
    const searchHaystack=[dn,dt,tw,zn,act,sd,ed].join(' ').toLowerCase();
    out.push({programmeItemId:id,start_date:sd,end_date:ed,label,searchHaystack});
  }
  out.sort((a,b)=>String(a.end_date).localeCompare(String(b.end_date))||String(a.label).localeCompare(String(b.label)));
  return out;
}

function overallProjectCompletion(gw,int_s,project_s,comp){
  let total=0,done=0;
  function walk(sched){
    Object.keys(sched||{}).forEach(dk=>{
      flattenDaySections(sched[dk]).forEach(sec=>{
        sec.acts.forEach(act=>{total++;if(comp[dk]?.[`${sec.pfx}|${act}`])done++;});
      });
    });
  }
  walk(gw);walk(int_s);walk(project_s||{});
  const pct=total>0?Math.round((done/total)*100):0;
  return{total,done,pct};
}
/** Human-readable zone line for Update screen section headers (field context). */
function zoneSubtitleForSection(sec,seq,tab){
  if(sec.pfx.includes('|')){
    const rawZone=sec.pfx.split('|').slice(1).join('|');
    const {zoneLabel,linkedActivity}=parseZoneNameForActivity(rawZone,seq);
    const parts=[];
    if(zoneLabel&&zoneLabel.trim())parts.push(zoneLabel.trim());
    if(linkedActivity)parts.push(`Linked in sequence: ${linkedActivity}`);
    return parts.length?parts.join(' — '):rawZone;
  }
  if(tab==='internals')return'Scheduled internals for this tower — tick each activity when complete.';
  if(tab==='groundworks')return`Groundworks at ${sec.label} — check you are on the correct pour / zone before ticking.`;
  if(tab===PROJECT_PROGRAMME_TAB)return'Master / enabling programme — tick when this activity is complete for the day.';
  return null;
}
function CompletionRing({pct,done,total}){
  const clamped=Math.min(100,Math.max(0,pct));
  const r=50,c=2*Math.PI*r,dash=c*(1-clamped/100);
  const arcColor=clamped>=100?'rgba(46,178,96,0.95)':'rgba(66,133,244,0.94)';
  return<div style={{display:'flex',alignItems:'center',gap:24,flexWrap:'wrap'}}>
    <div style={{position:'relative',width:124,height:124,flexShrink:0,filter:'drop-shadow(0 6px 14px rgba(26,26,46,0.08))'}}>
      <svg width="124" height="124" viewBox="0 0 124 124" style={{transform:'rotate(-90deg)'}} aria-hidden>
        <defs>
          <linearGradient id="dashRingGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="rgba(66,133,244,1)"/>
            <stop offset="100%" stopColor="rgba(100,160,255,0.85)"/>
          </linearGradient>
        </defs>
        <circle cx="62" cy="62" r={r} fill="none" stroke="rgba(26,26,46,0.06)" strokeWidth="9"/>
        <circle cx="62" cy="62" r={r} fill="none" stroke={clamped>=100?arcColor:'url(#dashRingGrad)'} strokeWidth="9" strokeLinecap="round"
          strokeDasharray={String(c)} strokeDashoffset={dash}/>
      </svg>
      <div style={{position:'absolute',inset:0,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',pointerEvents:'none'}}>
        <span style={{fontSize:28,fontWeight:800,color:T.text,lineHeight:1,letterSpacing:'-0.02em'}}>{pct}%</span>
        <span style={{fontSize:8,fontWeight:700,color:T.faint,textTransform:'uppercase',letterSpacing:'0.14em',marginTop:4}}>Complete</span>
      </div>
    </div>
    <div style={{flex:1,minWidth:160}}>
      <div style={{fontSize:11,fontWeight:700,color:T.faint,textTransform:'uppercase',letterSpacing:'0.16em',marginBottom:6}}>Overall progress</div>
      <div style={{fontSize:17,fontWeight:700,color:T.text,marginBottom:8,letterSpacing:'-0.02em',lineHeight:1.25}}>Programme completion</div>
      <div style={{fontSize:13,color:T.muted,lineHeight:1.55,maxWidth:340}}>
        {total>0?`${done} of ${total} scheduled activity slots are ticked off across Groundworks, Internals, and Project programme where scheduled (matches Update & Plan).`:'Once activities are scheduled on site days, overall completion appears here.'}
      </div>
      {total===0&&<div style={{fontSize:12,color:T.faint,marginTop:10,lineHeight:1.45}}>Use <strong style={{color:T.muted,fontWeight:600}}>Update</strong> after programme data is in place.</div>}
      {total>0&&<div style={{marginTop:14,height:4,borderRadius:4,background:'rgba(26,26,46,0.06)',overflow:'hidden',maxWidth:280}}>
        <div style={{
          height:'100%',
          width:String(clamped)+'%',
          borderRadius:4,
          background:clamped>=100?'linear-gradient(90deg,rgba(46,178,96,0.88),rgba(80,200,130,0.9))':'linear-gradient(90deg,rgba(66,133,244,0.85),rgba(120,170,255,0.75))',
          transition:'width 0.5s ease',
        }}/>
      </div>}
    </div>
  </div>;
}

function Wordmark119HS({variant='hero'}){
  const nav=variant==='nav';
  return<div className={`logo-wordmark${nav?' logo-wordmark--nav':''}`} aria-label="119HS">
    <span className="logo-number">119</span>
    <span className="logo-letters">HS</span>
  </div>;
}

function LoginPage({onLogin}){
  const[u,setU]=useState('');const[p,setP]=useState('');const[err,setErr]=useState('');const[loading,setLoading]=useState(false);const[photoUrl,setPhotoUrl]=useState(null);
  useEffect(()=>{
    let cancelled=false;
    (async()=>{
      try{
        const d=await api.getSitePhoto();
        if(cancelled)return;
        const path=d?.url||null;
        setPhotoUrl(path?api.absoluteUrl(path):null);
      }catch(_){if(!cancelled)setPhotoUrl(null);}
    })();
    return()=>{cancelled=true};
  },[]);
  async function go(){
    setLoading(true);setErr('');
    try{
      const d=await api.login(u,p);
      if(d?.user)onLogin(d.user);
      else setErr('Invalid credentials');
    }catch(e){
      setErr(e?.message&&e.message!=='Failed to fetch'?e.message:'Cannot reach API. Run npm run server (or npm run dev) from the project root; if the UI is hosted separately, set REACT_APP_API_URL to your API URL when building the client.');
    }
    setLoading(false);
  }
  return<div className="login-landing">
    <div className="login-landing__left">
      <div className="login-landing__brand">
        <Wordmark119HS/>
        <div className="login-landing__tagline">Programme management</div>
      </div>
      <div className="login-landing__form-wrap">
        <div className="login-landing__form">
          <input className="login-landing__field" value={u} onChange={e=>{setU(e.target.value);setErr('')}} onKeyDown={e=>e.key==='Enter'&&go()} placeholder="Username" autoComplete="username"/>
          <input className="login-landing__field" type="password" value={p} onChange={e=>{setP(e.target.value);setErr('')}} onKeyDown={e=>e.key==='Enter'&&go()} placeholder="Password" autoComplete="current-password"/>
          {err&&<div className="login-landing__error">{err}</div>}
          <button type="button" className="login-landing__submit" onClick={()=>void go()} disabled={loading}>{loading?'Signing in...':'Sign In'}</button>
        </div>
      </div>
    </div>
    <div className="login-landing__right" style={photoUrl?{backgroundImage:`url(${photoUrl})`}:undefined}>
      {!photoUrl&&<div className="login-landing__fallback" aria-hidden/>}
    </div>
  </div>;
}

function formatSitePhotoUpdated(iso){
  if(!iso)return null;
  try{return new Date(iso).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'});}catch(_){return null;}
}

function SettingsPage(){
  const[info,setInfo]=useState({url:null,updated_at:null});const[uploading,setUploading]=useState(false);const[err,setErr]=useState('');const fileRef=useRef(null);
  const load=useCallback(async()=>{
    try{
      const d=await api.getSitePhoto();
      setInfo({url:d?.url??null,updated_at:d?.updated_at??null});
    }catch(_){setInfo({url:null,updated_at:null});}
  },[]);
  useEffect(()=>{void load()},[load]);
  async function onPick(e){
    const f=e.target.files?.[0];
    e.target.value='';
    if(!f)return;
    setErr('');
    setUploading(true);
    try{
      const out=await api.uploadSitePhoto(f);
      if(out?.error){setErr(String(out.error));return;}
      if(out?.url)setInfo({url:out.url,updated_at:out.updated_at||null});
      else await load();
    }catch(er){setErr(er?.message||'Upload failed');}
    finally{setUploading(false);}
  }
  const thumbSrc=info.url?`${api.absoluteUrl(info.url)}${info.updated_at?`?v=${encodeURIComponent(info.updated_at)}`:''}`:'';
  const updatedLabel=formatSitePhotoUpdated(info.updated_at);
  const heroBg=info.url&&thumbSrc
    ?{backgroundImage:`url(${thumbSrc})`,backgroundSize:'cover',backgroundPosition:'center'}
    :{
      backgroundColor:'#1e293b',
      backgroundImage:'linear-gradient(rgba(255,255,255,0.06) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,0.06) 1px,transparent 1px)',
      backgroundSize:'24px 24px',
    };
  return<div style={{flex:1,overflowY:'auto',padding:16,background:T.bg}}>
    <h2 style={{margin:'0 0 4px',fontSize:20,fontWeight:700,color:T.text}}>Settings</h2>
    <p style={{fontSize:11,color:T.faint,marginBottom:18}}>Site appearance</p>
    <div style={{maxWidth:520,borderRadius:12,overflow:'hidden',border:`1px solid ${T.hairline}`,boxShadow:'0 8px 28px rgba(26,26,46,0.08)'}}>
      <div style={{position:'relative',minHeight:220,...heroBg}}>
        <div style={{position:'absolute',inset:0,background:'linear-gradient(180deg, rgba(17,24,39,0.5) 0%, rgba(17,24,39,0.82) 100%)',pointerEvents:'none'}} aria-hidden/>
        <div style={{position:'relative',zIndex:1,padding:18,display:'flex',flexDirection:'column',gap:12,minHeight:220,boxSizing:'border-box'}}>
          <div>
            <div style={{fontSize:11,fontWeight:700,color:'rgba(255,255,255,0.95)',letterSpacing:'0.06em',textTransform:'uppercase',marginBottom:6}}>Site photo</div>
            <p style={{fontSize:12,color:'rgba(255,255,255,0.85)',margin:0,lineHeight:1.45,maxWidth:360}}>This image appears on the login page.</p>
          </div>
          <div style={{flex:1,minHeight:4}}/>
          <input ref={fileRef} type="file" accept="image/jpeg,image/png,.jpg,.jpeg,.png" style={{display:'none'}} onChange={onPick}/>
          <div>
            <button type="button" disabled={uploading} onClick={()=>fileRef.current?.click()} style={{...S.btn,padding:'10px 18px',fontSize:12,fontWeight:600,background:'#fff',color:'#111827',border:'none',opacity:uploading?0.55:1,cursor:uploading?'default':'pointer'}}>{uploading?'Uploading…':'Upload new photo'}</button>
            <p style={{fontSize:10,color:'rgba(255,255,255,0.7)',marginTop:10,lineHeight:1.5}}>Recommended: landscape, min 1200px wide.<br/>Accepted: JPG, PNG (max 5MB).</p>
            {err&&<div style={{fontSize:12,color:'#fca5a5',marginTop:10}}>{err}</div>}
            {updatedLabel&&<p style={{fontSize:11,color:'rgba(255,255,255,0.78)',marginTop:10}}>Last updated: {updatedLabel}</p>}
          </div>
        </div>
      </div>
    </div>
  </div>;
}

function TemplatePage({tab,isAdmin,onReload}){
  const[templateTab,setTemplateTab]=useState(tab);
  const[activities,setActivities]=useState([]);
  const[newAct,setNewAct]=useState('');
  const[addingAct,setAddingAct]=useState(false);
  const[templates,setTemplates]=useState([]);const[tName,setTName]=useState('');const[tTower,setTTower]=useState('T2');const[tZone,setTZone]=useState('');
  const[tActs,setTActs]=useState([]);const[tDurs,setTDurs]=useState([]);const[selTpl,setSelTpl]=useState(null);
  const[editingId,setEditingId]=useState(null);
  const[dragActIdx,setDragActIdx]=useState(null);
  const[apTower,setApTower]=useState('T2');const[apZone,setApZone]=useState('');const[apStart,setApStart]=useState('2026-05-01');
  useEffect(()=>{setTemplateTab(tab)},[tab]);
  useEffect(()=>{api.getTemplates().then(t=>setTemplates(t||[]))},[tab]);
  useEffect(()=>{api.getActivities().then(a=>setActivities(a||[]))},[]);
  const defaultSeq=templateTab==='groundworks'?GW_SEQUENCE:templateTab==='internals'?INT_SEQUENCE:[];
  const seq=useMemo(()=>{
    const dbActs=(activities||[])
      .filter(a=>a.type===templateTab)
      .map(a=>a.name);
    const all=[...defaultSeq,...dbActs];
    return [...new Set(all)];
  },[activities,templateTab,defaultSeq]);
  function onTemplateScopeChange(next){
    setEditingId(null);
    setTemplateTab(next);
    setTActs([]);setTDurs([]);setSelTpl(null);setTName('');
  }
  function startEdit(t){
    setTemplateTab(t.tab);
    setEditingId(t.id);
    setTName(t.name||'');
    setTTower(t.tower||'T2');
    setTZone(t.zone_name||'');
    let acts=[],durs=[];
    try{acts=JSON.parse(t.sequence||'[]')}catch(_){}
    try{durs=JSON.parse(t.durations||'[]')}catch(_){}
    setTActs(Array.isArray(acts)?acts:[]);
    setTDurs(Array.isArray(durs)?durs:[]);
    setSelTpl(null);
  }
  function cancelEdit(){
    setEditingId(null);
    setTName('');
    setTActs([]);
    setTDurs([]);
    setDragActIdx(null);
  }
  function togAct(a){if(tActs.includes(a)){setTActs(tActs.filter(x=>x!==a));setTDurs(tDurs.filter((_,i)=>tActs[i]!==a))}else{setTActs([...tActs,a]);setTDurs([...tDurs,1])}}
  function setDur(i,v){
    const d=[...tDurs];
    const n=Number.parseFloat(v);
    d[i]=Number.isFinite(n)?Math.max(0.5,Math.round(n*2)/2):1;
    setTDurs(d);
  }
  function moveAct(fromIdx,toIdx){
    if(fromIdx===toIdx||fromIdx<0||toIdx<0||fromIdx>=tActs.length||toIdx>=tActs.length)return;
    const acts=[...tActs],durs=[...tDurs];
    const [a]=acts.splice(fromIdx,1);
    const [d]=durs.splice(fromIdx,1);
    acts.splice(toIdx,0,a);
    durs.splice(toIdx,0,d);
    setTActs(acts);setTDurs(durs);
  }
  async function addNewActivity(){
    const nm=String(newAct||'').trim();
    if(!nm)return;
    setAddingAct(true);
    try{
      const res=await api.createActivity(nm,templateTab);
      if(res&&res.error){window.alert(String(res.error));return;}
      setActivities(await api.getActivities()||[]);
      setNewAct('');
      if(!tActs.includes(nm)){setTActs([...tActs,nm]);setTDurs([...tDurs,1]);}
    }finally{setAddingAct(false);}
  }
  async function saveTpl(){
    if(!tName||!tActs.length)return;
    if(editingId){
      const res=await api.updateTemplate(editingId,{name:tName,tab:templateTab,tower:tTower,zone_name:tZone,sequence:tActs,durations:tDurs});
      if(res&&res.error){window.alert(String(res.error));return;}
      const syncZ=res?.synced?.zones??0,syncI=res?.synced?.items??0;
      if(syncZ>0)window.alert(`Template updated. Programme refreshed for ${syncZ} linked zone(s) (${syncI} new rows). Rows marked done were kept.`);
      cancelEdit();
    }else{
      await api.createTemplate(tName,templateTab,tTower,tZone,tActs,tDurs);
      setTName('');setTActs([]);setTDurs([]);
    }
    setTemplates(await api.getTemplates()||[]);
    if(onReload)await onReload();
  }
  async function handleApply(){if(!selTpl||!apZone||!apStart)return;const t=templates.find(x=>x.id===selTpl);if(!t)return;await api.applyTemplate(templateTab,apTower,apZone,JSON.parse(t.sequence),JSON.parse(t.durations),apStart);if(onReload)onReload();alert(`Template applied to ${apTower} ${apZone} from ${apStart}`)}
  async function removeTpl(id,name){
    if(!isAdmin)return;
    if(!window.confirm(`Delete template "${name}"? This cannot be undone.`))return;
    const res=await api.deleteTemplate(id);
    if(res&&!res.ok&&res.error){window.alert(String(res.error));return}
    if(selTpl===id)setSelTpl(null);
    if(editingId===id)cancelEdit();
    setTemplates(await api.getTemplates()||[]);
  }
  async function duplicateTpl(t){
    if(!isAdmin)return;
    const defaultName=`${t.name} copy`;
    const nextName=window.prompt('Name for duplicated template:',defaultName);
    if(nextName==null)return;
    const nm=String(nextName).trim();
    if(!nm)return;
    let seq=[],durs=[];
    try{seq=JSON.parse(t.sequence||'[]')}catch(_){}
    try{durs=JSON.parse(t.durations||'[]')}catch(_){}
    const res=await api.createTemplate(nm,t.tab,t.tower,t.zone_name,Array.isArray(seq)?seq:[],Array.isArray(durs)?durs:[]);
    if(res&&res.error){window.alert(String(res.error));return;}
    setTemplates(await api.getTemplates()||[]);
  }
  const scopedTemplates=templates.filter(t=>t.tab===templateTab);

  return<div style={{flex:1,overflowY:'auto',padding:16,background:T.bg}}>
    <h2 style={{margin:'0 0 4px',fontSize:20,fontWeight:700,color:T.text}}>Programme Templates</h2>
    <p style={{fontSize:11,color:T.faint,marginBottom:10}}>Build once, apply to any zone</p>
    <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:16,flexWrap:'wrap'}}>
      <label style={{fontSize:11,fontWeight:600,color:T.text}} htmlFor="tpl-scope">Programme</label>
      <select id="tpl-scope" value={templateTab} onChange={e=>onTemplateScopeChange(e.target.value)} style={{...S.input,width:'auto',minWidth:200,fontSize:12,padding:'8px 12px'}}>
        <option value="groundworks">Groundworks</option>
        <option value="internals">Internals</option>
        <option value="project_programme">Project programme</option>
      </select>
      <span style={{fontSize:10,color:T.muted}}>
        {templateTab==='groundworks'?`${GW_SEQUENCE.length} groundworks activities`:
          templateTab==='internals'?`${INT_SEQUENCE.length} internal activities`:
          'Master programme lines — add named activities below (not tied to floor drawings).'}
      </span>
    </div>
    {isAdmin&&<div style={{padding:10,background:T.surface,border:`1px solid ${T.hairline}`,borderRadius:10,marginBottom:12,display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}>
      <span style={{fontSize:11,fontWeight:600,color:T.text}}>New activity</span>
      <input value={newAct} onChange={e=>setNewAct(e.target.value)} onKeyDown={e=>e.key==='Enter'&&addNewActivity()} placeholder={`Add ${templateTab} activity`} style={{...S.input,width:220,fontSize:12,padding:'7px 10px'}}/>
      <button type="button" disabled={addingAct||!newAct.trim()} onClick={()=>void addNewActivity()} style={{...S.btn,...S.btnAct,padding:'7px 12px',fontSize:11,opacity:addingAct||!newAct.trim()?0.45:1}}>{addingAct?'Adding...':'Add activity'}</button>
      <span style={{fontSize:10,color:T.faint}}>Appears immediately in template options.</span>
    </div>}
    {isAdmin&&<div style={{padding:10,background:T.surface,border:`1px solid ${T.hairline}`,borderRadius:10,marginBottom:14}}>
      <div style={{fontSize:11,fontWeight:700,color:T.text,marginBottom:8}}>Manage activities ({templateTab})</div>
      <div style={{display:'flex',flexWrap:'wrap',gap:6}}>
        {activities.filter(a=>a.type===templateTab).map(a=><div key={a.id} style={{display:'flex',alignItems:'center',gap:4,padding:'4px 6px',border:`1px solid ${T.hairline}`,borderRadius:8,background:'rgba(26,26,46,0.02)'}}>
          <span style={{fontSize:11,color:T.text,fontWeight:600}}>{a.name}</span>
          <button
            type="button"
            style={{...S.btn,padding:'2px 6px',fontSize:10}}
            onClick={async()=>{
              const next=window.prompt('Rename activity:',a.name);
              if(next==null)return;
              const nm=String(next).trim();
              if(!nm||nm===a.name)return;
              const res=await api.renameActivity(a.id,nm);
              if(res&&res.error){window.alert(String(res.error));return;}
              setActivities(await api.getActivities()||[]);
              setTActs(tActs.map(x=>x===a.name?nm:x));
              setTemplates(await api.getTemplates()||[]);
            }}
          >Rename</button>
          <button
            type="button"
            style={{...S.btn,padding:'2px 6px',fontSize:10,color:'#c0392b'}}
            onClick={async()=>{
              if(!window.confirm(`Delete activity "${a.name}"?`))return;
              const res=await api.deleteActivity(a.id);
              if(res&&res.error){window.alert(String(res.error));return;}
              setActivities(await api.getActivities()||[]);
              setTActs(tActs.filter(x=>x!==a.name));
            }}
          >Delete</button>
        </div>)}
        {activities.filter(a=>a.type===templateTab).length===0&&<span style={{fontSize:11,color:T.faint}}>No activities yet</span>}
      </div>
    </div>}
    <h3 style={S.section}>Saved Templates</h3>
    {scopedTemplates.length===0&&<p style={{color:T.faint,fontSize:12,marginBottom:16}}>No templates for this programme yet</p>}
    {scopedTemplates.map(t=>{const acts=JSON.parse(t.sequence),durs=JSON.parse(t.durations),total=durs.reduce((a,b)=>a+b,0);
      return<div key={t.id} style={{padding:14,background:T.surface,borderRadius:12,border:`1px solid ${T.hairline}`,marginBottom:8,boxShadow:'0 1px 3px rgba(26,26,46,0.04)'}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
          <div><span style={{fontSize:14,fontWeight:700,color:T.text}}>{t.name}</span><span style={{fontSize:10,color:T.faint,marginLeft:8}}>{total} days</span></div>
          <div style={{display:'flex',gap:4,flexWrap:'wrap',justifyContent:'flex-end'}}>
            <button type="button" onClick={()=>setSelTpl(selTpl===t.id?null:t.id)} style={{...S.btn,...(selTpl===t.id?S.btnAct:{}),fontSize:10,padding:'4px 10px'}}>Apply</button>
            {isAdmin&&<button type="button" onClick={()=>void duplicateTpl(t)} style={{...S.btn,fontSize:10,padding:'4px 10px'}}>Duplicate</button>}
            {isAdmin&&<button type="button" onClick={()=>startEdit(t)} style={{...S.btn,fontSize:10,padding:'4px 10px'}}>Edit</button>}
            {isAdmin&&<button type="button" onClick={()=>void removeTpl(t.id,t.name)} style={{...S.btn,fontSize:10,padding:'4px 10px',color:'#c0392b'}}>Delete</button>}
          </div>
        </div>
        <div style={{display:'flex',flexWrap:'wrap',gap:3}}>{acts.map((a,i)=><span key={i} style={S.pill(a)}>{a} ({durs[i]}d)</span>)}</div>
        {selTpl===t.id&&<div style={{marginTop:10,padding:10,background:'rgba(66,133,244,0.06)',borderRadius:8,border:'1px solid rgba(66,133,244,0.2)'}}>
          <div style={{fontSize:10,fontWeight:600,color:T.muted,marginBottom:6,textTransform:'uppercase'}}>Apply to:</div>
          <div style={{display:'flex',gap:6,flexWrap:'wrap',alignItems:'center'}}>
            <input value={apTower} onChange={e=>setApTower(e.target.value)} placeholder="Tower" style={{...S.input,width:80,fontSize:12,padding:'6px 10px'}}/>
            <input value={apZone} onChange={e=>setApZone(e.target.value)} placeholder="Zone (Pour 5)" style={{...S.input,width:120,fontSize:12,padding:'6px 10px'}}/>
            <input type="date" value={toHtmlDateInputValue(apStart)} onChange={e=>setApStart(e.target.value)} style={{...S.input,width:140,fontSize:12,padding:'6px 10px'}}/>
            <button onClick={handleApply} style={{...S.btn,...S.btnAct,fontSize:11}}>Apply</button>
          </div>
          <div style={{fontSize:9,color:T.faint,marginTop:4}}>Creates {total} days, skipping Sundays</div>
        </div>}
      </div>})}
    {isAdmin&&<><h3 style={S.section}>{editingId?'Edit template':'Create template'}</h3>
    <div style={{padding:14,background:T.surface,borderRadius:12,border:`1px solid ${T.hairline}`,boxShadow:'0 1px 3px rgba(26,26,46,0.04)'}}>
      {editingId&&<p style={{fontSize:11,color:T.muted,margin:'0 0 10px',lineHeight:1.45}}>Saving applies your changes and refreshes programme dates for any zones that were built from this template (done activities stay fixed).</p>}
      <div style={{display:'flex',gap:8,marginBottom:10,flexWrap:'wrap'}}>
        <input value={tName} onChange={e=>setTName(e.target.value)} style={{...S.input,width:200}} placeholder="Template name"/>
        <input value={tTower} onChange={e=>setTTower(e.target.value)} style={{...S.input,width:80}} placeholder="Tower"/>
        <input value={tZone} onChange={e=>setTZone(e.target.value)} style={{...S.input,width:120}} placeholder="Zone"/>
      </div>
      <div style={{fontSize:10,color:T.muted,marginBottom:6}}>Select activities in order:</div>
      <div style={{display:'flex',flexWrap:'wrap',gap:4,marginBottom:10}}>
        {seq.map(a=>{const on=tActs.includes(a);return<button key={a} onClick={()=>togAct(a)} style={{padding:'5px 10px',borderRadius:6,fontSize:10,fontWeight:600,cursor:'pointer',border:on?`2px solid ${actColor(a,0.9)}`:`1px solid ${T.hairline}`,background:on?actColor(a,0.2):'transparent',color:on?actColor(a,0.95):T.faint}}>{a}</button>})}
      </div>
      {tActs.length>0&&<>
      <div style={{fontSize:10,color:T.muted,marginBottom:6}}>Adjust sequence and durations:</div>
      <div style={{display:'flex',flexDirection:'column',gap:6,marginBottom:12}}>
        {tActs.map((a,i)=><div
          key={i}
          draggable
          onDragStart={()=>setDragActIdx(i)}
          onDragOver={(e)=>e.preventDefault()}
          onDrop={()=>{
            if(dragActIdx==null||dragActIdx===i)return;
            moveAct(dragActIdx,i);
            setDragActIdx(null);
          }}
          onDragEnd={()=>setDragActIdx(null)}
          style={{
            display:'flex',
            alignItems:'center',
            gap:6,
            flexWrap:'wrap',
            padding:'6px 6px',
            borderRadius:8,
            border:dragActIdx===i?'1px dashed rgba(66,133,244,0.55)':'1px dashed transparent',
            background:dragActIdx===i?'rgba(66,133,244,0.06)':'transparent',
            cursor:'grab',
          }}>
          <span style={{fontSize:10,fontWeight:700,color:T.faint,width:24,textAlign:'right'}}>{i+1}.</span>
          <span style={{fontSize:11,color:T.faint}}>⋮⋮</span>
          <span style={{...S.pill(a),fontSize:9}}>{a}</span>
          <input type="number" min="0.5" max="30" step="0.5" value={tDurs[i]} onChange={e=>setDur(i,e.target.value)} style={{...S.input,width:68,fontSize:12,padding:'4px 8px',textAlign:'center'}}/>
          <span style={{fontSize:9,color:T.faint,marginRight:2}}>days</span>
          <button type="button" disabled={i===0} onClick={()=>moveAct(i,i-1)} style={{...S.btn,padding:'4px 8px',fontSize:10,opacity:i===0?0.4:1}}>↑</button>
          <button type="button" disabled={i===tActs.length-1} onClick={()=>moveAct(i,i+1)} style={{...S.btn,padding:'4px 8px',fontSize:10,opacity:i===tActs.length-1?0.4:1}}>↓</button>
        </div>)}
      </div><div style={{fontSize:11,color:T.muted,marginBottom:10}}>Total: {tDurs.reduce((a,b)=>a+b,0)} working days</div></>}
      <div style={{display:'flex',gap:8,flexWrap:'wrap',alignItems:'center'}}>
        <button type="button" onClick={()=>void saveTpl()} disabled={!tName||!tActs.length} style={{...S.btn,...(tName&&tActs.length?S.btnAct:{}),opacity:tName&&tActs.length?1:0.4}}>{editingId?'Save changes':'Save template'}</button>
        {editingId&&<button type="button" onClick={cancelEdit} style={S.btn}>Cancel edit</button>}
      </div>
    </div></>}
  </div>;
}

function DashPage({gw,int_s,project_s,comp,isAdmin}){
  const ov=overallProjectCompletion(gw,int_s,project_s,comp);
  const today=new Date();
  const gwDayCount=Object.keys(gw||{}).length;
  const intDayCount=Object.keys(int_s||{}).length;
  const[milestones,setMilestones]=useState([]);
  const[planRows,setPlanRows]=useState([]);
  const[mLoadErr,setMLoadErr]=useState('');
  const[mBusy,setMBusy]=useState(false);
  const[manualDate,setManualDate]=useState(()=>dateKey(today));
  const[manualLabel,setManualLabel]=useState('');
  const[manualStatus,setManualStatus]=useState('planned');
  const[manualCompletion,setManualCompletion]=useState(0);
  const[pickFilter,setPickFilter]=useState('');
  const[pickSelId,setPickSelId]=useState('');
  const[pickDateEdge,setPickDateEdge]=useState('end');/* start | end */
  const[pickStatus,setPickStatus]=useState('planned');

  const refreshMilestones=useCallback(async()=>{
    setMLoadErr('');
    try{
      const m=await api.getMilestones();
      setMilestones(Array.isArray(m)?m:[]);
    }catch(e){
      setMLoadErr(e?.message||'Failed to load milestones');
      setMilestones([]);
    }
  },[]);

  const compSig=useMemo(()=>JSON.stringify(comp||{}),[comp]);
  useEffect(()=>{void refreshMilestones()},[refreshMilestones,compSig]);

  useEffect(()=>{
    if(!isAdmin)return;
    let cancelled=false;
    (async()=>{
      try{
        const rows=await api.getPlanProgrammeFullExport();
        if(!cancelled)setPlanRows(Array.isArray(rows)?rows:[]);
      }catch(_){
        const rows=await api.getPlanProgramme();
        if(!cancelled)setPlanRows(Array.isArray(rows)?rows:[]);
      }
    })();
    return()=>{cancelled=true};
  },[isAdmin]);

  const pickOptions=useMemo(()=>buildProgrammeMilestonePicklist(planRows),[planRows]);
  const pickFiltered=useMemo(()=>{
    const q=String(pickFilter||'').trim().toLowerCase();
    if(!q)return pickOptions;
    return pickOptions.filter(o=>o.searchHaystack.includes(q));
  },[pickOptions,pickFilter]);

  useEffect(()=>{
    if(!pickSelId)return;
    const ok=pickFiltered.some(o=>String(o.programmeItemId)===String(pickSelId));
    if(!ok)setPickSelId('');
  },[pickFiltered,pickSelId]);

  async function addMilestoneRow(date,label,status,completionPct,programmeItemId=null){
    setMBusy(true);
    try{
      const p=Math.max(0,Math.min(100,Math.round(Number(completionPct)||0)));
      const res=await api.addMilestone(date,label,status||'planned',p,programmeItemId);
      if(res&&res.error){window.alert(String(res.error));return;}
      await refreshMilestones();
    }finally{setMBusy(false);}
  }

  async function patchMilestoneCompletion(id,pct){
    const p=Math.max(0,Math.min(100,Math.round(Number(pct)||0)));
    setMBusy(true);
    try{
      const res=await api.patchMilestone(id,{completion_pct:p});
      if(res&&res.error){window.alert(String(res.error));return;}
      await refreshMilestones();
    }finally{setMBusy(false);}
  }

  async function removeMilestone(id){
    if(!window.confirm('Remove this milestone?'))return;
    setMBusy(true);
    try{
      const res=await api.deleteMilestone(id);
      if(res&&res.error){window.alert(String(res.error));return;}
      await refreshMilestones();
    }finally{setMBusy(false);}
  }

  async function updateMilestoneStatus(id,status){
    setMBusy(true);
    try{
      const res=await api.patchMilestone(id,{status});
      if(res&&res.error){window.alert(String(res.error));return;}
      await refreshMilestones();
    }finally{setMBusy(false);}
  }

  async function unlinkMilestoneProgramme(id){
    setMBusy(true);
    try{
      const res=await api.patchMilestone(id,{programme_item_id:null});
      if(res&&res.error){window.alert(String(res.error));return;}
      await refreshMilestones();
    }finally{setMBusy(false);}
  }
  const metrics=[
    {k:'gw',glyph:'◇',label:'Groundworks days',sub:'Scheduled GW slots',value:String(gwDayCount),accent:'66,133,244',bg:'rgba(66,133,244,0.06)'},
    {k:'int',glyph:'◆',label:'Internals days',sub:'Scheduled INT slots',value:String(intDayCount),accent:'142,68,173',bg:'rgba(142,68,173,0.07)'},
    {k:'act',glyph:'◎',label:'Activities ticked',sub:'Across GW & INT',value:`${ov.done} / ${ov.total}`,accent:'46,178,96',bg:'rgba(46,178,96,0.07)'},
  ];
  return<div style={{
    flex:1,
    overflowY:'auto',
    background:`linear-gradient(165deg,rgba(235,238,245,0.85) 0%,${T.bg} 22%,${T.bg} 100%)`,
  }}>
    <div style={{maxWidth:760,margin:'0 auto',padding:'22px 18px 40px'}}>
      <header style={{marginBottom:22}}>
        <div style={{display:'flex',flexWrap:'wrap',alignItems:'flex-end',justifyContent:'space-between',gap:14}}>
          <div>
            <div style={{fontSize:10,fontWeight:700,color:T.faint,textTransform:'uppercase',letterSpacing:'0.22em',marginBottom:8}}>119 High Street</div>
            <h1 style={{margin:0,fontSize:'clamp(22px, 4.5vw, 28px)',fontWeight:800,color:T.text,letterSpacing:'-0.03em',lineHeight:1.15}}>Dashboard</h1>
            <p style={{margin:'10px 0 0',fontSize:13,color:T.muted,maxWidth:420,lineHeight:1.5}}>
              Programme snapshot — completion across scheduled groundworks and internals.
            </p>
          </div>
          <div style={{
            alignSelf:'flex-start',
            padding:'10px 14px',
            borderRadius:12,
            background:T.surface,
            border:`1px solid ${T.hairline}`,
            boxShadow:'0 2px 10px rgba(26,26,46,0.05)',
          }}>
            <div style={{fontSize:9,fontWeight:700,color:T.faint,textTransform:'uppercase',letterSpacing:'0.12em',marginBottom:4}}>Today</div>
            <div style={{fontSize:13,fontWeight:700,color:T.text,lineHeight:1.35}}>{formatDate(today)}</div>
          </div>
        </div>
      </header>

      <section style={{
        padding:'22px 22px 24px',
        background:T.surface,
        borderRadius:20,
        border:`1px solid rgba(26,26,46,0.08)`,
        boxShadow:'0 4px 24px rgba(26,26,46,0.06), 0 1px 0 rgba(255,255,255,0.8) inset',
        marginBottom:16,
        position:'relative',
        overflow:'hidden',
      }}>
        <div style={{
          position:'absolute',
          top:0,
          right:0,
          width:'42%',
          height:'100%',
          background:'radial-gradient(ellipse at 100% 0%, rgba(66,133,244,0.07) 0%, transparent 55%)',
          pointerEvents:'none',
        }}/>
        <div style={{position:'relative'}}>
          <CompletionRing pct={ov.pct} done={ov.done} total={ov.total}/>
        </div>
      </section>

      <div style={{
        display:'grid',
        gridTemplateColumns:'repeat(auto-fit, minmax(156px, 1fr))',
        gap:12,
        marginBottom:18,
      }}>
        {metrics.map((s)=><div key={s.k} style={{
          position:'relative',
          padding:'16px 16px 16px 18px',
          background:T.surface,
          borderRadius:16,
          border:`1px solid rgba(${s.accent},0.18)`,
          boxShadow:'0 2px 14px rgba(26,26,46,0.04)',
          overflow:'hidden',
        }}>
          <div style={{
            position:'absolute',
            left:0,
            top:12,
            bottom:12,
            width:4,
            borderRadius:'0 4px 4px 0',
            background:`linear-gradient(180deg, rgba(${s.accent},0.85), rgba(${s.accent},0.35))`,
          }}/>
          <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:10}}>
            <span style={{
              width:32,
              height:32,
              borderRadius:10,
              display:'flex',
              alignItems:'center',
              justifyContent:'center',
              fontSize:14,
              background:s.bg,
              color:`rgba(${s.accent},0.92)`,
              fontWeight:700,
            }} aria-hidden>{s.glyph}</span>
            <div style={{minWidth:0}}>
              <div style={{fontSize:10,fontWeight:700,color:T.faint,textTransform:'uppercase',letterSpacing:'0.1em'}}>{s.label}</div>
              <div style={{fontSize:11,color:T.muted,marginTop:2,lineHeight:1.3}}>{s.sub}</div>
            </div>
          </div>
          <div style={{fontSize:22,fontWeight:800,color:`rgba(${s.accent},0.96)`,letterSpacing:'-0.02em',lineHeight:1.2}}>{s.value}</div>
        </div>)}
      </div>

      <section style={{
        padding:'18px 20px',
        borderRadius:16,
        background:T.surface,
        border:`1px solid ${T.hairline}`,
        boxShadow:'0 2px 14px rgba(26,26,46,0.04)',
      }}>
        <div style={{display:'flex',flexWrap:'wrap',alignItems:'baseline',justifyContent:'space-between',gap:10,marginBottom:12}}>
          <div>
            <div style={{fontSize:10,fontWeight:700,color:T.faint,textTransform:'uppercase',letterSpacing:'0.16em',marginBottom:6}}>Milestones</div>
            <div style={{fontSize:14,fontWeight:700,color:T.text}}>Milestone health</div>
            <div style={{fontSize:11,color:T.muted,marginTop:4,lineHeight:1.45}}>Milestone, date due, completion %, and colour band for on track vs risk. Rows linked from the programme picklist take % from daily Update ticks on those scheduled activity days.</div>
          </div>
          {isAdmin&&<button type="button" disabled={mBusy} onClick={()=>void refreshMilestones()} style={{...S.btn,padding:'6px 12px',fontSize:11}}>Refresh</button>}
        </div>
        {milestones.length>0&&<div style={{display:'flex',flexWrap:'wrap',gap:12,fontSize:10,color:T.faint,marginBottom:12,lineHeight:1.5}}>
          <span style={{display:'flex',alignItems:'center',gap:6}}><span style={{width:10,height:10,borderRadius:3,background:'rgb(39,174,96)',flexShrink:0}}/> On track</span>
          <span style={{display:'flex',alignItems:'center',gap:6}}><span style={{width:10,height:10,borderRadius:3,background:'rgb(230,126,34)',flexShrink:0}}/> Watch</span>
          <span style={{display:'flex',alignItems:'center',gap:6}}><span style={{width:10,height:10,borderRadius:3,background:'rgb(231,76,60)',flexShrink:0}}/> At risk</span>
          <span style={{display:'flex',alignItems:'center',gap:6}}><span style={{width:10,height:10,borderRadius:3,background:'rgb(46,178,96)',flexShrink:0}}/> Complete (100%)</span>
        </div>}
        {mLoadErr&&<div style={{fontSize:12,color:'#c0392b',marginBottom:10}}>{mLoadErr}</div>}
        {milestones.length===0&&!mLoadErr&&<p style={{margin:0,fontSize:12,color:T.muted,lineHeight:1.5}}>No milestones yet.{isAdmin?' Add significant dates below or pull one from the programme picker.':''}</p>}
        {milestones.length>0&&<div style={{display:'flex',flexDirection:'column',gap:10,marginBottom:isAdmin?16:0}}>
          {milestones.map(m=>{
            const d=new Date(String(m.date)+'T12:00:00');
            const pct=Math.max(0,Math.min(100,Math.round(Number(m.completion_pct)||0)));
            const health=milestoneHealthVisual(m);
            const du=daysUntilMilestoneDue(m.date);
            const duePhrase=du==null?'Due date':du===0?'Due today':du>0?`Due in ${du}d`:`${Math.abs(du)}d overdue`;
            return<div key={m.id} style={{
              display:'flex',
              borderRadius:12,
              overflow:'hidden',
              border:`1px solid rgba(26,26,46,0.08)`,
              background:health.tint,
              boxShadow:'0 1px 4px rgba(26,26,46,0.04)',
            }}>
              <div style={{width:5,flexShrink:0,background:`rgb(${health.rgb})`}} aria-hidden/>
              <div style={{flex:1,minWidth:0,padding:'12px 14px'}}>
                <div style={{display:'flex',flexWrap:'wrap',alignItems:'flex-start',justifyContent:'space-between',gap:10,marginBottom:8}}>
                  <div style={{flex:'1 1 200px',minWidth:0}}>
                    <div style={{fontSize:13,fontWeight:700,color:T.text,lineHeight:1.35}}>{m.label}</div>
                    <div style={{fontSize:11,color:T.muted,marginTop:4}}>
                      <span style={{fontWeight:600,color:T.text}}>Date due:</span>{' '}{formatShort(d)} {d.getFullYear()} · {duePhrase}
                    </div>
                    {m.tracks_live&&<div style={{fontSize:10,color:T.faint,marginTop:6,lineHeight:1.45}}>
                      {m.live_ticks_total>0
                        ?<>Progress from Update: <strong style={{color:T.muted,fontWeight:600}}>{m.live_ticks_done}</strong> / {m.live_ticks_total} scheduled day-slots ticked</>
                        :<>Linked to programme — no matching schedule rows yet; completion stays at 0% until Plan days exist.</>}
                    </div>}
                  </div>
                  <div style={{display:'flex',flexWrap:'wrap',alignItems:'center',gap:8}}>
                    <span style={{
                      fontSize:10,
                      fontWeight:800,
                      letterSpacing:'0.04em',
                      textTransform:'uppercase',
                      padding:'5px 10px',
                      borderRadius:999,
                      background:`rgba(${health.rgb},0.22)`,
                      color:health.badgeFg,
                      border:`1px solid rgba(${health.rgb},0.35)`,
                    }}>{health.label}</span>
                    <span style={{fontSize:10,fontWeight:700,color:T.faint,textTransform:'uppercase'}}>{m.status||'planned'}</span>
                  </div>
                </div>
                <div style={{display:'flex',flexWrap:'wrap',alignItems:'center',gap:12}}>
                  <div style={{flex:'1 1 160px',minWidth:120,height:10,borderRadius:6,background:'rgba(26,26,46,0.07)',overflow:'hidden'}}>
                    <div style={{
                      width:`${pct}%`,
                      height:'100%',
                      borderRadius:6,
                      background:`linear-gradient(90deg,rgba(${health.rgb},0.95),rgba(${health.rgb},0.65))`,
                      transition:'width 0.25s ease',
                    }}/>
                  </div>
                  <span style={{fontSize:14,fontWeight:800,color:T.text,minWidth:44}}>{pct}%</span>
                  {isAdmin&&!m.tracks_live&&<>
                    <label style={{fontSize:10,color:T.faint,display:'flex',alignItems:'center',gap:6}}>
                      <span>Edit %</span>
                      <input
                        type="number"
                        min={0}
                        max={100}
                        defaultValue={pct}
                        key={`mc-${m.id}-${pct}`}
                        disabled={mBusy}
                        onBlur={(e)=>{
                          const v=Math.max(0,Math.min(100,Math.round(Number(e.target.value)||0)));
                          if(v!==pct)void patchMilestoneCompletion(m.id,v);
                        }}
                        onKeyDown={(e)=>{if(e.key==='Enter')e.target.blur();}}
                        style={{...S.input,width:52,fontSize:12,padding:'4px 8px'}}
                      />
                    </label>
                  </>}
                </div>
                {isAdmin&&<div style={{display:'flex',flexWrap:'wrap',gap:8,marginTop:10,alignItems:'center'}}>
                  <select value={m.status||'planned'} disabled={mBusy} onChange={(e)=>void updateMilestoneStatus(m.id,e.target.value)} style={{...S.input,width:'auto',fontSize:11,padding:'4px 8px'}}>
                    {MILESTONE_STATUSES.map(s=><option key={s} value={s}>{s}</option>)}
                  </select>
                  {m.programme_item_id!=null&&<button type="button" disabled={mBusy} onClick={()=>void unlinkMilestoneProgramme(m.id)} style={{...S.btn,padding:'4px 10px',fontSize:11}} title="Stop using Update ticks for this row; you can then edit % manually">Unlink programme</button>}
                  <button type="button" disabled={mBusy} onClick={()=>void removeMilestone(m.id)} style={{...S.btn,padding:'4px 10px',fontSize:11,color:'#c0392b'}}>Remove</button>
                </div>}
              </div>
            </div>;
          })}
        </div>}

        {isAdmin&&<>
          <div style={{fontSize:11,fontWeight:700,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em',margin:'14px 0 8px'}}>Add manually</div>
          <div style={{display:'flex',flexWrap:'wrap',gap:8,alignItems:'center',marginBottom:14}}>
            <input type="date" value={toHtmlDateInputValue(manualDate)} onChange={(e)=>setManualDate(e.target.value)} style={{...S.input,width:'auto',fontSize:12,padding:'6px 10px'}}/>
            <input value={manualLabel} onChange={(e)=>setManualLabel(e.target.value)} placeholder="e.g. Tower 1 GF complete · Commission · 278 target" style={{...S.input,flex:1,minWidth:200,fontSize:12,padding:'6px 10px'}}/>
            <label style={{fontSize:11,color:T.muted,display:'flex',alignItems:'center',gap:6}}>
              % done
              <input type="number" min={0} max={100} value={manualCompletion} onChange={(e)=>setManualCompletion(Math.max(0,Math.min(100,Math.round(Number(e.target.value)||0))))} style={{...S.input,width:56,fontSize:12,padding:'6px 8px'}}/>
            </label>
            <select value={manualStatus} onChange={(e)=>setManualStatus(e.target.value)} style={{...S.input,width:'auto',fontSize:12,padding:'6px 10px'}}>
              {MILESTONE_STATUSES.map(s=><option key={s} value={s}>{s}</option>)}
            </select>
            <button type="button" disabled={mBusy||!manualLabel.trim()} onClick={()=>void addMilestoneRow(manualDate,manualLabel.trim(),manualStatus,manualCompletion).then(()=>{setManualLabel('');setManualCompletion(0);})} style={{...S.btn,...S.btnAct,padding:'8px 14px',fontSize:11}}>Add milestone</button>
          </div>

          <div style={{fontSize:11,fontWeight:700,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:6}}>From programme (pick one)</div>
          <p style={{margin:'0 0 10px',fontSize:11,color:T.faint,lineHeight:1.5}}>
            Use this only when a scheduled programme line represents a <strong style={{fontWeight:600,color:T.muted}}>major</strong> date — handovers, commission, level completes, module landings, master targets (for example “278 target”). Search, select a row, choose whether the milestone date is the activity start or end, then add.
          </p>
          <input value={pickFilter} onChange={(e)=>setPickFilter(e.target.value)} placeholder="Search drawing, tower, zone, activity…" style={{...S.input,width:'100%',maxWidth:420,fontSize:12,padding:'8px 10px',marginBottom:8,boxSizing:'border-box'}}/>
          <select size={Math.min(8,Math.max(3,pickFiltered.length||3))} value={pickSelId} onChange={(e)=>setPickSelId(e.target.value)} style={{...S.input,width:'100%',maxWidth:520,fontSize:11,padding:6,marginBottom:8,fontFamily:'inherit'}}>
            <option value="">{pickOptions.length===0?'No programme rows loaded — check Programme / drawings':'— Choose a programme line —'}</option>
            {pickFiltered.map((o)=><option key={String(o.programmeItemId)} value={String(o.programmeItemId)}>{formatShort(new Date(o.end_date+'T12:00:00'))} · {o.label}</option>)}
          </select>
          <div style={{display:'flex',flexWrap:'wrap',gap:10,alignItems:'center',marginBottom:10}}>
            <span style={{fontSize:10,fontWeight:700,color:T.faint,textTransform:'uppercase'}}>Date</span>
            <label style={{fontSize:11,color:T.text,display:'flex',alignItems:'center',gap:6,cursor:'pointer'}}>
              <input type="radio" name="msedge" checked={pickDateEdge==='end'} onChange={()=>setPickDateEdge('end')}/> End (typical for “complete”)
            </label>
            <label style={{fontSize:11,color:T.text,display:'flex',alignItems:'center',gap:6,cursor:'pointer'}}>
              <input type="radio" name="msedge" checked={pickDateEdge==='start'} onChange={()=>setPickDateEdge('start')}/> Start
            </label>
            <select value={pickStatus} onChange={(e)=>setPickStatus(e.target.value)} style={{...S.input,width:'auto',fontSize:11,padding:'4px 8px'}}>
              {MILESTONE_STATUSES.map(s=><option key={s} value={s}>{s}</option>)}
            </select>
            <button type="button" disabled={mBusy||!pickSelId} onClick={()=>{
              const o=pickOptions.find(x=>String(x.programmeItemId)===String(pickSelId));
              if(!o)return;
              const d=pickDateEdge==='start'?o.start_date:o.end_date;
              void addMilestoneRow(d,o.label,pickStatus,0,o.programmeItemId);
            }} style={{...S.btn,...S.btnAct,padding:'8px 14px',fontSize:11}}>Add selected</button>
          </div>
        </>}
      </section>
    </div>
  </div>;
}

function csvEscape(v){if(v==null||v===undefined)return'';const s=String(v);return/[",\r\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s;}
function downloadCsv(filename,rows){
  const lines=rows.map(r=>r.map(csvEscape).join(','));
  const blob=new Blob(['\uFEFF'+lines.join('\r\n')],{type:'text/csv;charset=utf-8'});
  const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=filename;a.click();URL.revokeObjectURL(url);
}

function scheduleSliceForLookaheadTab(gw,int_s,project_s,tab,dk){
  if(tab==='groundworks')return gw[dk];
  if(tab===PROJECT_PROGRAMME_TAB)return project_s?.[dk];
  return int_s[dk];
}

/** Tower + zone label from completion prefix (matches Update keys). */
function towerZoneFromPfx(pfx){
  const s=String(pfx||'');
  if(!s.includes('|'))return{tower:s||'—',zone:'—'};
  const i=s.indexOf('|');
  return{tower:s.slice(0,i)||'—',zone:s.slice(i+1)||'—'};
}

/** Rolling ~3-week window: skip Sundays, same as on-screen Ahead list. */
function lookaheadWorkingDays(anchorDate){
  const out=[];
  for(let i=0;i<21;i++){
    const d=new Date(anchorDate);
    d.setDate(d.getDate()+i);
    if(d.getDay()!==0)out.push(d);
  }
  return out;
}

/** One CSV row per scheduled activity; includes ISO date and Update tick status. */
function buildLookAheadExportRows(gw,int_s,project_s,comp,anchorDate,tab){
  const scope=drawingTabLabel(tab);
  const header=[
    'Date_ISO',
    'Date_display',
    'Weekday',
    'Week_chunk',
    'Tower',
    'Zone',
    'Activity',
    'Completion_key',
    'Done',
    'Completed_by',
    'Completed_at',
    'Scope',
  ];
  const rows=[header];
  const days=lookaheadWorkingDays(anchorDate);
  days.forEach((d,idx)=>{
    const dk=dateKey(d);
    const dayData=scheduleSliceForLookaheadTab(gw,int_s,project_s,tab,dk);
    const sections=flattenDaySections(dayData);
    const weekChunk=Math.floor(idx/7)+1;
    const wd=d.toLocaleDateString('en-GB',{weekday:'short'});
    const display=`${formatShort(d)} ${d.getFullYear()}`;
    sections.forEach((sec)=>{
      sec.acts.forEach((act)=>{
        const ck=`${sec.pfx}|${act}`;
        const cm=comp[dk]?.[ck];
        const done=cm?'Yes':'No';
        const {tower,zone}=towerZoneFromPfx(sec.pfx);
        rows.push([
          dk,
          display,
          wd,
          String(weekChunk),
          tower,
          zone,
          act,
          ck,
          done,
          cm?.by||'',
          cm?.at||'',
          scope,
        ]);
      });
    });
  });
  return rows;
}

function UpdPage({date,sched,comp,tab,canTick,userName,onSubmitted}){
  const k=dateKey(date),dayData=sched[k]||{},
    seq=tab===PROJECT_PROGRAMME_TAB?[]:tab==='groundworks'?GW_SEQUENCE:INT_SEQUENCE;
  const compSnap=comp[k]?JSON.stringify(comp[k]):'';
  const[draft,setDraft]=useState(()=>comp[k]?JSON.parse(JSON.stringify(comp[k])):{});
  const[submitting,setSubmitting]=useState(false);
  const[toast,setToast]=useState('');
  useEffect(()=>{setDraft(comp[k]?JSON.parse(JSON.stringify(comp[k])):{});},[k,compSnap]);
  const dc=draft;
  const sections=[];Object.entries(dayData).forEach(([tw,zones])=>{if(Array.isArray(zones))sections.push({label:tw,acts:zones,pfx:tw});else Object.entries(zones).forEach(([z,acts])=>{sections.push({label:z==='_default'?tw:`${tw} ${z}`,acts,pfx:z==='_default'?tw:`${tw}|${z}`})})});
  let tot=0,done=0;sections.forEach(s=>{tot+=s.acts.length;s.acts.forEach(a=>{if(dc[`${s.pfx}|${a}`])done++})});const pct=tot>0?Math.round(done/tot*100):0;
  const baseline=comp[k]?JSON.parse(JSON.stringify(comp[k])):{};
  const allKeys=new Set([...Object.keys(baseline),...Object.keys(dc)]);
  let dirty=false;for(const ck of allKeys){if(!!baseline[ck]!==!!dc[ck]){dirty=true;break}}
  function toggleDraft(ck){if(!canTick)return;setDraft(p=>{const n={...p};if(n[ck])delete n[ck];else n[ck]={by:userName,at:'…'};return n})}
  async function submitDay(){
    if(!canTick||submitting||!dirty)return;
    setSubmitting(true);setToast('');
    try{
      const fresh=await api.getCompletions();if(!fresh)return;
      const cur=fresh[k]||{};
      const want=dc;
      const keys=new Set([...Object.keys(cur),...Object.keys(want)]);
      for(const ck of keys){const w=!!want[ck],h=!!cur[ck];if(w!==h)await api.toggleCompletion(k,ck,userName)}
      if(onSubmitted)await onSubmitted();
      setToast('Locked in — programme updated for everyone');
      setTimeout(()=>setToast(''),2800);
    }catch(_){setToast('Submit failed — try again')}
    finally{setSubmitting(false)}
  }
  return<div style={{overflowY:'auto',flex:1,background:T.bg,paddingBottom:canTick&&dirty?80:12}}>
    {tot>0&&<div style={{margin:12,padding:'14px 16px',background:'linear-gradient(135deg,rgba(66,133,244,0.1),rgba(46,178,96,0.06))',borderRadius:14,border:'1px solid rgba(66,133,244,0.18)',boxShadow:'0 2px 8px rgba(26,26,46,0.04)'}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10}}><span style={{fontSize:14,fontWeight:700,color:T.text}}>Today's Progress</span><span style={{fontSize:28,fontWeight:800,color:pct===100?'rgba(46,178,96,1)':'rgba(66,133,244,1)'}}>{pct}%</span></div>
      <div style={{height:6,background:'rgba(26,26,46,0.08)',borderRadius:3,overflow:'hidden'}}><div style={{height:'100%',width:`${pct}%`,background:pct===100?'rgba(46,178,96,0.85)':'rgba(66,133,244,0.85)',borderRadius:3,transition:'width 0.4s'}}/></div>
      <div style={{fontSize:11,color:T.muted,marginTop:6}}>{done}/{tot} activities</div>
    </div>}
    {sections.length>0&&<div style={{margin:'0 12px 12px',padding:'16px 18px',background:T.surface,borderRadius:14,border:`1px solid ${T.hairline}`,boxShadow:'0 2px 10px rgba(26,26,46,0.05)'}}>
      <div style={{fontSize:13,fontWeight:700,color:T.text,marginBottom:6}}>Lock in for the team</div>
      <p style={{fontSize:11,color:T.muted,margin:'0 0 14px',lineHeight:1.5,maxWidth:'42em'}}>
        Tick scheduled activities on this screen, then submit. Your completions are saved on the server and feed overall programme completion for everyone (dashboard, lookahead, exports).
      </p>
      {canTick?(
        <>
          <button type="button" onClick={submitDay} disabled={!dirty||submitting} style={{width:'100%',...S.btn,...(dirty&&!submitting?S.btnAct:{}),padding:'14px 18px',fontSize:14,fontWeight:700,opacity:!dirty||submitting?0.5:1,cursor:!dirty||submitting?'default':'pointer'}}>{submitting?'Saving…':dirty?'Submit & lock in day’s progress':'No changes to submit yet'}</button>
          {dirty&&!submitting&&<div style={{fontSize:10,color:'rgba(244,165,26,0.95)',marginTop:10,fontWeight:600}}>Unsaved ticks — submit to sync the programme.</div>}
        </>
      ):<div style={{fontSize:11,color:T.muted,lineHeight:1.45}}>Viewer access: you can see progress but cannot submit updates.</div>}
    </div>}
    {sections.map(sec=>{const sd=sec.acts.filter(a=>!!dc[`${sec.pfx}|${a}`]).length;const zSub=zoneSubtitleForSection(sec,seq,tab);
      return<div key={sec.label} style={{margin:'8px 12px',borderRadius:14,overflow:'hidden',border:`1px solid ${T.hairline}`,background:T.surface,boxShadow:'0 1px 4px rgba(26,26,46,0.04)'}}>
        <div style={{padding:'12px 16px',background:'rgba(26,26,46,0.03)',display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:12}}>
          <div style={{flex:1,minWidth:0}}>
            <div style={{fontSize:13,fontWeight:700,color:T.text}}>{sec.label}</div>
            {zSub&&<div style={{fontSize:11,color:T.muted,marginTop:4,lineHeight:1.4}}>{zSub}</div>}
          </div>
          <span style={{fontSize:11,color:sd===sec.acts.length?'rgba(46,178,96,0.85)':T.muted,fontWeight:600,flexShrink:0}}>{sd}/{sec.acts.length}</span>
        </div>
        {sec.acts.map((act,ai)=>{const ck=`${sec.pfx}|${act}`,cm=dc[ck],dn=!!cm,si=seq.indexOf(act);
          return<div key={`${act}-${ai}`} onClick={()=>toggleDraft(ck)} style={{padding:'14px 16px',borderTop:`1px solid ${T.hairline}`,display:'flex',alignItems:'center',gap:14,cursor:canTick?'pointer':'default',background:dn?'rgba(46,178,96,0.06)':'transparent',minHeight:56}}>
            <div style={{width:36,height:36,borderRadius:10,flexShrink:0,border:`2.5px solid ${dn?'rgba(46,178,96,0.65)':'rgba(26,26,46,0.12)'}`,background:dn?'rgba(46,178,96,0.14)':'transparent',display:'flex',alignItems:'center',justifyContent:'center',fontSize:18,color:dn?'rgba(46,178,96,0.95)':'transparent'}}>{dn?'✓':''}</div>
            <div style={{flex:1}}><div style={{display:'flex',alignItems:'center',gap:6,marginBottom:2}}><span style={{width:8,height:8,borderRadius:2,background:actColor(act,0.9),flexShrink:0}}/><span style={{fontSize:14,fontWeight:600,color:dn?'rgba(46,178,96,0.85)':T.text,textDecoration:dn?'line-through':'none'}}>{act}</span></div>
            {si>=0&&<div style={{fontSize:9,color:T.faint,marginLeft:14}}>Step {si+1}/{seq.length}{si>0?` — after ${seq[si-1]}`:''}</div>}
            {dn&&cm&&cm.at!=='…'&&<div style={{fontSize:9,color:T.faint,marginLeft:14,marginTop:1}}>{cm.by} at {cm.at}</div>}
            {dn&&cm&&cm.at==='…'&&<div style={{fontSize:9,color:T.muted,marginLeft:14,marginTop:1}}>Pending submit</div>}</div>
          </div>})}
      </div>})}
    {sections.length===0&&<div style={{textAlign:'center',padding:'60px 20px',color:T.faint}}><div style={{fontSize:15,fontWeight:600}}>No activities scheduled</div></div>}
    {canTick&&dirty&&<div style={{position:'fixed',left:0,right:0,bottom:56,padding:'10px 14px',background:T.surface,borderTop:`1px solid ${T.hairline}`,boxShadow:'0 -4px 20px rgba(26,26,46,0.08)',display:'flex',alignItems:'center',justifyContent:'space-between',gap:12,zIndex:20,maxWidth:560,margin:'0 auto'}}>
      <span style={{fontSize:11,color:T.muted,flex:1}}>Lock in to save today’s ticks and refresh overall programme completion.</span>
      <button type="button" onClick={submitDay} disabled={!dirty||submitting} style={{...S.btn,...S.btnAct,padding:'12px 22px',whiteSpace:'nowrap',opacity:!dirty||submitting?0.45:1}}>{submitting?'Saving…':'Submit & lock in'}</button>
    </div>}
    {toast&&<div style={{position:'fixed',bottom:130,left:'50%',transform:'translateX(-50%)',background:toast.includes('failed')?'rgba(231,76,60,0.95)':'rgba(46,178,96,0.95)',color:'#fff',padding:'8px 16px',borderRadius:10,fontSize:13,fontWeight:600,zIndex:25,boxShadow:'0 4px 16px rgba(0,0,0,0.15)'}}>{toast}</div>}
  </div>;
}

function LAPage({gw,int_s,project_s,comp,date,tab}){
  const todayKey=dateKey(new Date());
  const days=useMemo(()=>lookaheadWorkingDays(date),[date]);
  const weeks=useMemo(()=>{
    const chunks=[];
    for(let i=0;i<days.length;i+=7)chunks.push(days.slice(i,i+7));
    return chunks;
  },[days]);
  const stats=useMemo(()=>{
    let total=0,done=0;
    days.forEach((d)=>{
      const dk=dateKey(d);
      const dayData=scheduleSliceForLookaheadTab(gw,int_s,project_s,tab,dk);
      flattenDaySections(dayData).forEach((sec)=>{
        sec.acts.forEach((act)=>{
          total++;
          if(comp[dk]?.[`${sec.pfx}|${act}`])done++;
        });
      });
    });
    return{total,done,pct:total?Math.round((done/total)*100):0};
  },[days,gw,int_s,project_s,tab,comp]);

  function exportCsv(){
    const rows=buildLookAheadExportRows(gw,int_s,project_s,comp,date,tab);
    const fn=`119hs-lookahead-detail-${tab}-${dateKey(date)}.csv`;
    downloadCsv(fn,rows);
  }

  function renderDayCard(d){
    const k=dateKey(d);
    const dayData=scheduleSliceForLookaheadTab(gw,int_s,project_s,tab,k);
    const sections=flattenDaySections(dayData);
    const isToday=k===todayKey;
    const weekday=d.toLocaleDateString('en-GB',{weekday:'long'});
    const lines=[];
    sections.forEach((sec)=>{
      const {tower,zone}=towerZoneFromPfx(sec.pfx);
      const locLabel=zone&&zone!=='—'?`${tower} · ${zone}`:tower;
      sec.acts.forEach((act)=>lines.push({sec,act,locLabel}));
    });
    return<div key={k} style={{
      borderRadius:14,
      border:`1px solid ${T.hairline}`,
      background:T.surface,
      overflow:'hidden',
      marginBottom:10,
      boxShadow:'0 2px 10px rgba(26,26,46,0.04)',
    }}>
      <div style={{
        display:'flex',
        flexWrap:'wrap',
        alignItems:'baseline',
        justifyContent:'space-between',
        gap:8,
        padding:'12px 14px',
        background:isToday?'rgba(66,133,244,0.10)':'rgba(26,26,46,0.03)',
        borderBottom:`1px solid ${T.hairline}`,
      }}>
        <div style={{display:'flex',flexWrap:'wrap',alignItems:'baseline',gap:10}}>
          <span style={{fontSize:15,fontWeight:800,color:T.text,letterSpacing:'-0.02em'}}>{weekday}</span>
          <span style={{fontSize:13,color:T.muted}}>{formatShort(d)} {d.getFullYear()}</span>
          {isToday&&<span style={{
            fontSize:9,
            fontWeight:800,
            textTransform:'uppercase',
            letterSpacing:'0.08em',
            padding:'3px 8px',
            borderRadius:999,
            background:'rgba(66,133,244,0.20)',
            color:'rgba(36,68,140,0.95)',
          }}>Today</span>}
        </div>
        <span style={{fontSize:11,color:T.faint,fontFamily:'monospace'}}>{k}</span>
      </div>
      <div style={{padding:'4px 14px 14px'}}>
        {lines.length===0&&<p style={{margin:'14px 0 6px',fontSize:13,color:T.muted,lineHeight:1.5}}>No activities scheduled for this scope.</p>}
        {lines.map(({sec,act,locLabel},li)=>{
          const ck=`${sec.pfx}|${act}`;
          const cm=comp[k]?.[ck];
          const ticked=!!cm;
          return<div key={`${k}-${sec.pfx}-${act}-${li}`} style={{
            display:'flex',
            alignItems:'flex-start',
            gap:12,
            padding:'12px 0',
            borderBottom:li<lines.length-1?`1px solid rgba(26,26,46,0.07)`:'none',
          }}>
            <div style={{
              width:28,
              height:28,
              borderRadius:8,
              flexShrink:0,
              display:'flex',
              alignItems:'center',
              justifyContent:'center',
              fontSize:14,
              fontWeight:800,
              color:ticked?'rgba(46,178,96,0.95)':'rgba(26,26,46,0.22)',
              background:ticked?'rgba(46,178,96,0.12)':'rgba(26,26,46,0.05)',
              border:`1px solid ${ticked?'rgba(46,178,96,0.35)':'rgba(26,26,46,0.08)'}`,
            }} aria-hidden>{ticked?'✓':'·'}</div>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontSize:11,fontWeight:700,color:T.faint,textTransform:'uppercase',letterSpacing:'0.06em',marginBottom:4}}>{locLabel}</div>
              <div style={{display:'flex',flexWrap:'wrap',alignItems:'center',gap:8}}>
                <span style={{width:8,height:8,borderRadius:2,background:actColor(act,0.88),flexShrink:0}} aria-hidden/>
                <span style={{fontSize:14,fontWeight:600,color:ticked?'rgba(46,178,96,0.88)':T.text,lineHeight:1.35}}>{act}</span>
                <span style={{fontSize:10,color:ticked?'rgba(46,178,96,0.75)':'rgba(230,126,34,0.9)',fontWeight:700}}>{ticked?'Done':'Open'}</span>
              </div>
              {ticked&&cm?.by&&cm?.at&&cm.at!=='…'&&<div style={{fontSize:10,color:T.faint,marginTop:6}}>{cm.by} · {cm.at}</div>}
            </div>
          </div>;
        })}
      </div>
    </div>;
  }

  return<div style={{overflowY:'auto',flex:1,background:T.bg}}>
    <div style={{maxWidth:640,margin:'0 auto',padding:'16px 14px 28px'}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:14,flexWrap:'wrap',marginBottom:14}}>
        <div style={{minWidth:0}}>
          <h2 style={{margin:0,fontSize:20,fontWeight:800,color:T.text,letterSpacing:'-0.03em'}}>Look ahead</h2>
          <p style={{margin:'8px 0 0',fontSize:12,color:T.muted,lineHeight:1.55,maxWidth:420}}>
            Three-week window from the date above (Sundays skipped). Matches the <strong style={{fontWeight:600,color:T.text}}>{drawingTabLabel(tab)}</strong> scope. Export is one row per activity with tick status for Excel or reports.
          </p>
        </div>
        <button type="button" onClick={exportCsv} style={{...S.btn,...S.btnAct,padding:'10px 16px',fontSize:12,fontWeight:700,whiteSpace:'nowrap'}}>Export CSV</button>
      </div>

      {stats.total>0?<div style={{
        marginBottom:18,
        padding:'14px 16px',
        borderRadius:14,
        border:`1px solid rgba(66,133,244,0.20)`,
        background:'linear-gradient(135deg,rgba(66,133,244,0.08),rgba(46,178,96,0.05))',
      }}>
        <div style={{fontSize:10,fontWeight:700,color:T.faint,textTransform:'uppercase',letterSpacing:'0.12em',marginBottom:6}}>Window summary</div>
        <div style={{fontSize:16,fontWeight:800,color:T.text}}>{stats.done} / {stats.total} complete <span style={{fontSize:13,fontWeight:700,color:T.muted}}>({stats.pct}%)</span></div>
        <div style={{fontSize:11,color:T.muted,marginTop:6,lineHeight:1.45}}>All scheduled slots in this window; ✓ matches locked-in Update ticks.</div>
      </div>:<div style={{
        marginBottom:18,
        padding:'14px 16px',
        borderRadius:14,
        border:`1px dashed ${T.hairline}`,
        background:'rgba(26,26,46,0.02)',
      }}>
        <div style={{fontSize:13,fontWeight:600,color:T.text,marginBottom:4}}>Nothing scheduled in this window</div>
        <div style={{fontSize:11,color:T.muted,lineHeight:1.45}}>Try moving the date with ← → above, or switch Groundworks / Internals / Project programme in the header.</div>
      </div>}

      {weeks.map((chunk,wi)=>{
        const label=chunk.length>=2
          ?`${formatShort(chunk[0])} – ${formatShort(chunk[chunk.length-1])}`
          :chunk.length===1?formatShort(chunk[0]):'';
        return<div key={wi} style={{marginBottom:8}}>
          <div style={{
            fontSize:10,
            fontWeight:800,
            color:T.faint,
            textTransform:'uppercase',
            letterSpacing:'0.14em',
            marginBottom:10,
            paddingLeft:2,
          }}>Week {wi+1}{label?` · ${label}`:''}</div>
          {chunk.map(renderDayCard)}
        </div>;
      })}
    </div>
  </div>;
}

function MainApp({user,onLogout}){
  const[gw,setGw]=useState({});const[int_s,setInt]=useState({});const[project_s,setProjectSched]=useState({});const[comp,setComp]=useState({});const[loading,setLoading]=useState(true);
  const[tab,setTab]=useState(()=>pickInitialScopeTab(user.tabs));const[page,setPage]=useState('dashboard');const[date,setDate]=useState(new Date(2026,4,1));
  const loadData=useCallback(async()=>{
    const tabs=user.tabs||[];
    try{
      const[g,i,c,p]=await Promise.all([
        tabs.includes('groundworks')?api.getSchedule('groundworks'):Promise.resolve({}),
        tabs.includes('internals')?api.getSchedule('internals'):Promise.resolve({}),
        api.getCompletions(),
        tabs.includes(PROJECT_PROGRAMME_TAB)?api.getSchedule(PROJECT_PROGRAMME_TAB):Promise.resolve({}),
      ]);
      setGw(g||{});setInt(i||{});setProjectSched(p||{});setComp(c||{});
    }catch(e){
      console.error(e);
      setGw({});setInt({});setProjectSched({});setComp({});
    }
    setLoading(false);
  },[user.tabs]);
  useEffect(()=>{loadData()},[loadData]);
  useEffect(()=>{
    const allowed=allowedPageIdsForRole(user.role);
    if(!allowed.has(page))setPage('dashboard');
  },[page,user.role]);
  useEffect(()=>{const onKey=e=>{if(['dashboard','zones','programme','templates','settings','plan','gantt'].includes(page))return;if(e.key==='ArrowLeft')setDate(d=>{const n=new Date(d);n.setDate(n.getDate()-1);if(n.getDay()===0)n.setDate(n.getDate()-1);return n});if(e.key==='ArrowRight')setDate(d=>{const n=new Date(d);n.setDate(n.getDate()+1);if(n.getDay()===0)n.setDate(n.getDate()+1);return n})};window.addEventListener('keydown',onKey);return()=>window.removeEventListener('keydown',onKey)},[page]);
  function nav(dir){setDate(d=>{const n=new Date(d);n.setDate(n.getDate()+dir);if(n.getDay()===0)n.setDate(n.getDate()+dir);return n})}
  if(loading)return<div style={{display:'flex',alignItems:'center',justifyContent:'center',height:'100vh',background:T.bg,color:T.muted,fontFamily:'monospace'}}>Loading...</div>;
  const canSee=t=>user.tabs.includes(t);
  const isAdmin=roleIsAdmin(user.role);
  const canTick=roleCanTick(user.role);
  const canEditZp=canEditZonesProgramme(user.role);
  const showDateNav=['update','lookahead'].includes(page);
  const sched=tab==='groundworks'?gw:tab==='internals'?int_s:tab===PROJECT_PROGRAMME_TAB?project_s:{};
  const navItems=bottomNavItemsForRole(user.role);

  return<div style={{background:T.bg,height:'100vh',fontFamily:"'Segoe UI',sans-serif",display:'flex',flexDirection:'column',overflow:'hidden'}}>
    <div className="app-header-bar" style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'8px 14px',borderBottom:`1px solid ${T.hairline}`,flexShrink:0,background:T.surface}}>
      <div style={{display:'flex',alignItems:'center',gap:10}}><Wordmark119HS variant="nav"/>
        {page!=='plan'&&<div style={{display:'flex',gap:2,background:'rgba(26,26,46,0.05)',borderRadius:8,padding:3,flexWrap:'wrap'}}>{MAIN_HEADER_TAB_ORDER.filter(canSee).map(t=><button key={t} onClick={()=>setTab(t)} style={{...S.btn,...(tab===t?S.btnAct:{}),padding:'6px 14px',fontSize:12}}>{drawingTabLabel(t)}</button>)}</div>}</div>
      <div style={{display:'flex',alignItems:'center',gap:6}}><span style={{fontSize:10,color:T.faint}}>{user.name}</span><button onClick={onLogout} style={{...S.btn,fontSize:10,padding:'4px 10px'}}>Logout</button></div>
    </div>
    {showDateNav&&<div className="app-date-nav" style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'6px 14px',borderBottom:`1px solid ${T.hairline}`,flexShrink:0,background:T.nav}}>
      <button onClick={()=>nav(-1)} style={{...S.btn,fontSize:16,padding:'8px 18px'}}>←</button><div style={{fontSize:15,fontWeight:700,color:T.text}}>{formatDate(date)}</div><button onClick={()=>nav(1)} style={{...S.btn,fontSize:16,padding:'8px 18px'}}>→</button>
    </div>}
    <div style={{flex:1,display:'flex',flexDirection:'column',overflow:'hidden'}}>
      {page==='dashboard'&&<DashPage gw={gw} int_s={int_s} project_s={project_s} comp={comp} isAdmin={isAdmin}/>}
      {page==='update'&&<UpdPage date={date} sched={sched} comp={comp} tab={tab} canTick={canTick} userName={user.name} onSubmitted={loadData}/>}
      {page==='lookahead'&&<LAPage gw={gw} int_s={int_s} project_s={project_s} comp={comp} date={date} tab={tab}/>}
      {page==='plan'&&<PlanPage tab={tab} userTabs={user.tabs} isAdmin={isAdmin}/>}
      {page==='gantt'&&roleShowGantt(user.role)&&<GanttPage tab={tab} userTabs={user.tabs} isAdmin={isAdmin}/>}
      {page==='zones'&&<ZoneSetupPage tab={tab} canEdit={canEditZp} isAdmin={isAdmin}/>}
      {page==='programme'&&<ProgrammePage tab={tab} canEdit={canEditZp} isAdmin={isAdmin} onScheduleChanged={loadData} zoneSetupAvailable={canEditZp} onGoToZoneSetup={()=>setPage('zones')}/>}
      {page==='templates'&&isAdmin&&<TemplatePage tab={tab} isAdmin={isAdmin} onReload={loadData}/>}
      {page==='settings'&&isAdmin&&<SettingsPage/>}
    </div>
    <div className="app-bottom-nav" style={{display:'flex',borderTop:`1px solid ${T.hairline}`,flexShrink:0,background:T.nav,boxShadow:'0 -4px 16px rgba(26,26,46,0.04)'}}>
      {navItems.map(p=><button key={p.id} onClick={()=>setPage(p.id)} style={{flex:1,padding:'10px 2px',background:'transparent',border:'none',cursor:'pointer',display:'flex',flexDirection:'column',alignItems:'center',gap:2}}><span style={{fontSize:18,opacity:page===p.id?1:0.35,color:T.text}}>{p.icon}</span><span style={{fontSize:7,fontWeight:600,color:page===p.id?'rgba(66,133,244,1)':T.faint,textTransform:'uppercase',textAlign:'center',lineHeight:1.1}}>{p.label}</span></button>)}
    </div>
  </div>;
}

export default function App(){
  const[user,setUser]=useState(()=>api.getStoredUser());
  return<AppErrorBoundary>
    {!user?<LoginPage onLogin={setUser}/>:<MainApp user={user} onLogout={()=>{api.logout();setUser(null)}}/>}
  </AppErrorBoundary>;
}
