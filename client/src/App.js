import React,{useState,useEffect,useCallback,Component} from 'react';
import * as api from './api';
import {actColor,GW_SEQUENCE,INT_SEQUENCE,dateKey,formatDate,formatShort,toHtmlDateInputValue} from './constants';
import {T,S} from './uiTheme';
import ZoneSetupPage from './ZoneSetupPage';
import ProgrammePage from './ProgrammePage';

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
function overallProjectCompletion(gw,int_s,comp){
  let total=0,done=0;
  function walk(sched){
    Object.keys(sched||{}).forEach(dk=>{
      flattenDaySections(sched[dk]).forEach(sec=>{
        sec.acts.forEach(act=>{total++;if(comp[dk]?.[`${sec.pfx}|${act}`])done++;});
      });
    });
  }
  walk(gw);walk(int_s);
  const pct=total>0?Math.round((done/total)*100):0;
  return{total,done,pct};
}
function CompletionRing({pct,done,total}){
  const r=46,c=2*Math.PI*r,stroke=c*(1-Math.min(100,Math.max(0,pct))/100);
  return<div style={{display:'flex',alignItems:'center',gap:20,flexWrap:'wrap'}}>
    <div style={{position:'relative',width:112,height:112,flexShrink:0}}>
      <svg width="112" height="112" viewBox="0 0 112 112" style={{transform:'rotate(-90deg)'}}>
        <circle cx="56" cy="56" r={r} fill="none" stroke="rgba(26,26,46,0.08)" strokeWidth="10"/>
        <circle cx="56" cy="56" r={r} fill="none" stroke="rgba(66,133,244,0.92)" strokeWidth="10" strokeLinecap="round"
          strokeDasharray={String(c)} strokeDashoffset={stroke}/>
      </svg>
      <div style={{position:'absolute',inset:0,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',pointerEvents:'none'}}>
        <span style={{fontSize:26,fontWeight:800,color:T.text,lineHeight:1}}>{pct}%</span>
        <span style={{fontSize:9,fontWeight:600,color:T.faint,textTransform:'uppercase',letterSpacing:'0.06em'}}>complete</span>
      </div>
    </div>
    <div style={{flex:1,minWidth:140}}>
      <div style={{fontSize:14,fontWeight:700,color:T.text,marginBottom:4}}>Overall programme completion</div>
      <div style={{fontSize:12,color:T.muted,lineHeight:1.5}}>{done} of {total} scheduled activities ticked off across Groundworks and Internals.</div>
      {total===0&&<div style={{fontSize:11,color:T.faint,marginTop:6}}>Add programme activities to track progress here.</div>}
    </div>
  </div>;
}

function LoginPage({onLogin}){
  const[u,setU]=useState('');const[p,setP]=useState('');const[err,setErr]=useState('');const[loading,setLoading]=useState(false);
  async function go(){
    setLoading(true);setErr('');
    try{
      const d=await api.login(u,p);
      if(d?.user)onLogin(d.user);
      else setErr('Invalid credentials');
    }catch(e){
      setErr(e?.message&&e.message!=='Failed to fetch'?e.message:'Cannot reach API. From the project root run npm run server (port 3001) while using npm start in client, or run npm run dev to start both.');
    }
    setLoading(false);
  }
  return<div style={{minHeight:'100vh',background:T.bg,display:'flex',alignItems:'center',justifyContent:'center'}}>
    <div style={{width:320,padding:36,background:T.surface,borderRadius:16,border:`1px solid ${T.hairline}`,boxShadow:'0 8px 32px rgba(26,26,46,0.06)'}}>
      <div style={{textAlign:'center',marginBottom:28}}><div style={{fontSize:32,fontWeight:800,color:T.text}}>119<span style={{color:'rgba(66,133,244,0.95)'}}>HS</span></div><div style={{fontSize:10,color:T.faint,textTransform:'uppercase',letterSpacing:'0.2em',marginTop:6}}>Programme Management</div></div>
      <input value={u} onChange={e=>{setU(e.target.value);setErr('')}} onKeyDown={e=>e.key==='Enter'&&go()} placeholder="Username" style={{...S.input,marginBottom:10}}/>
      <input type="password" value={p} onChange={e=>{setP(e.target.value);setErr('')}} onKeyDown={e=>e.key==='Enter'&&go()} placeholder="Password" style={{...S.input,marginBottom:14}}/>
      {err&&<div style={{fontSize:12,color:'#e74c3c',marginBottom:10,textAlign:'center'}}>{err}</div>}
      <button onClick={go} disabled={loading} style={{width:'100%',padding:14,background:'rgba(66,133,244,0.92)',border:'none',borderRadius:10,color:'#fff',fontSize:15,fontWeight:700,cursor:'pointer',opacity:loading?0.5:1}}>{loading?'Signing in...':'Sign In'}</button>
    </div>
  </div>;
}

function TemplatePage({tab,isAdmin,onReload}){
  const[templates,setTemplates]=useState([]);const[tName,setTName]=useState('');const[tTower,setTTower]=useState('T2');const[tZone,setTZone]=useState('');
  const[tActs,setTActs]=useState([]);const[tDurs,setTDurs]=useState([]);const[selTpl,setSelTpl]=useState(null);
  const[apTower,setApTower]=useState('T2');const[apZone,setApZone]=useState('');const[apStart,setApStart]=useState('2026-05-01');
  useEffect(()=>{api.getTemplates().then(t=>setTemplates(t||[]))},[]);
  const seq=tab==='groundworks'?GW_SEQUENCE:INT_SEQUENCE;
  function togAct(a){if(tActs.includes(a)){setTActs(tActs.filter(x=>x!==a));setTDurs(tDurs.filter((_,i)=>tActs[i]!==a))}else{setTActs([...tActs,a]);setTDurs([...tDurs,1])}}
  function setDur(i,v){const d=[...tDurs];d[i]=parseInt(v)||1;setTDurs(d)}
  async function saveTpl(){if(!tName||!tActs.length)return;await api.createTemplate(tName,tab,tTower,tZone,tActs,tDurs);setTemplates(await api.getTemplates()||[]);setTName('');setTActs([]);setTDurs([])}
  async function handleApply(){if(!selTpl||!apZone||!apStart)return;const t=templates.find(x=>x.id===selTpl);if(!t)return;await api.applyTemplate(tab,apTower,apZone,JSON.parse(t.sequence),JSON.parse(t.durations),apStart);if(onReload)onReload();alert(`Template applied to ${apTower} ${apZone} from ${apStart}`)}

  return<div style={{flex:1,overflowY:'auto',padding:16,background:T.bg}}>
    <h2 style={{margin:'0 0 4px',fontSize:20,fontWeight:700,color:T.text}}>Programme Templates</h2>
    <p style={{fontSize:11,color:T.faint,marginBottom:16}}>Build once, apply to any zone</p>
    <h3 style={S.section}>Saved Templates</h3>
    {templates.length===0&&<p style={{color:T.faint,fontSize:12,marginBottom:16}}>No templates yet</p>}
    {templates.map(t=>{const acts=JSON.parse(t.sequence),durs=JSON.parse(t.durations),total=durs.reduce((a,b)=>a+b,0);
      return<div key={t.id} style={{padding:14,background:T.surface,borderRadius:12,border:`1px solid ${T.hairline}`,marginBottom:8,boxShadow:'0 1px 3px rgba(26,26,46,0.04)'}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
          <div><span style={{fontSize:14,fontWeight:700,color:T.text}}>{t.name}</span><span style={{fontSize:10,color:T.faint,marginLeft:8}}>{total} days</span></div>
          <div style={{display:'flex',gap:4}}><button onClick={()=>setSelTpl(selTpl===t.id?null:t.id)} style={{...S.btn,...(selTpl===t.id?S.btnAct:{}),fontSize:10,padding:'4px 10px'}}>Apply</button></div>
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
    {isAdmin&&<><h3 style={S.section}>Create Template</h3>
    <div style={{padding:14,background:T.surface,borderRadius:12,border:`1px solid ${T.hairline}`,boxShadow:'0 1px 3px rgba(26,26,46,0.04)'}}>
      <div style={{display:'flex',gap:8,marginBottom:10,flexWrap:'wrap'}}>
        <input value={tName} onChange={e=>setTName(e.target.value)} style={{...S.input,width:200}} placeholder="Template name"/>
        <input value={tTower} onChange={e=>setTTower(e.target.value)} style={{...S.input,width:80}} placeholder="Tower"/>
        <input value={tZone} onChange={e=>setTZone(e.target.value)} style={{...S.input,width:120}} placeholder="Zone"/>
      </div>
      <div style={{fontSize:10,color:T.muted,marginBottom:6}}>Select activities in order:</div>
      <div style={{display:'flex',flexWrap:'wrap',gap:4,marginBottom:10}}>
        {seq.map(a=>{const on=tActs.includes(a);return<button key={a} onClick={()=>togAct(a)} style={{padding:'5px 10px',borderRadius:6,fontSize:10,fontWeight:600,cursor:'pointer',border:on?`2px solid ${actColor(a,0.9)}`:`1px solid ${T.hairline}`,background:on?actColor(a,0.2):'transparent',color:on?actColor(a,0.95):T.faint}}>{a}</button>})}
      </div>
      {tActs.length>0&&<><div style={{display:'flex',flexWrap:'wrap',gap:6,marginBottom:12}}>
        {tActs.map((a,i)=><div key={i} style={{display:'flex',alignItems:'center',gap:4}}><span style={{...S.pill(a),fontSize:9}}>{a}</span><input type="number" min="1" max="30" value={tDurs[i]} onChange={e=>setDur(i,e.target.value)} style={{...S.input,width:50,fontSize:12,padding:'4px 8px',textAlign:'center'}}/><span style={{fontSize:9,color:T.faint}}>days</span></div>)}
      </div><div style={{fontSize:11,color:T.muted,marginBottom:10}}>Total: {tDurs.reduce((a,b)=>a+b,0)} working days</div></>}
      <button onClick={saveTpl} disabled={!tName||!tActs.length} style={{...S.btn,...(tName&&tActs.length?S.btnAct:{}),opacity:tName&&tActs.length?1:0.4}}>Save Template</button>
    </div></>}
  </div>;
}

function DashPage({gw,int_s,comp,ms,date}){
  const today=dateKey(date);let totalComp=0;Object.values(comp).forEach(d=>{totalComp+=Object.keys(d).length});const pastMs=ms.filter(m=>m.date<=today).length;
  const ov=overallProjectCompletion(gw,int_s,comp);
  return<div style={{padding:16,overflowY:'auto',flex:1,background:T.bg}}>
    <h2 style={{margin:'0 0 4px',fontSize:20,fontWeight:700,color:T.text}}>Programme Overview</h2>
    <p style={{fontSize:11,color:T.faint,marginBottom:16}}>119 High Street</p>
    <div style={{padding:18,background:T.surface,borderRadius:16,border:`1px solid ${T.hairline}`,marginBottom:16,boxShadow:'0 2px 12px rgba(26,26,46,0.05)'}}>
      <CompletionRing pct={ov.pct} done={ov.done} total={ov.total}/>
    </div>
    <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(100px,1fr))',gap:8,marginBottom:20}}>
      {[{l:'GW',v:Object.keys(gw).length+' days',c:'66,133,244'},{l:'INT',v:Object.keys(int_s).length+' days',c:'142,68,173'},{l:'Done',v:totalComp,c:'46,178,96'},{l:'Milestones',v:`${pastMs}/${ms.length}`,c:'228,57,57'}].map((s,i)=><div key={i} style={{padding:14,background:T.surface,borderRadius:12,border:`1px solid rgba(${s.c},0.22)`,boxShadow:'0 1px 3px rgba(26,26,46,0.04)'}}><div style={{fontSize:20,fontWeight:800,color:`rgba(${s.c},0.95)`}}>{s.v}</div><div style={{fontSize:9,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em',marginTop:2}}>{s.l}</div></div>)}
    </div>
    <h3 style={S.section}>Milestones</h3>
    {ms.map((m,i)=>{const past=m.date<=today,crit=m.status==='critical',unconf=m.status==='unconfirmed';
      return<div key={i} style={{padding:'10px 14px',borderRadius:8,marginBottom:4,display:'flex',justifyContent:'space-between',alignItems:'center',background:past?'rgba(46,178,96,0.08)':crit?'rgba(228,57,57,0.06)':T.surface,border:`1px solid ${past?'rgba(46,178,96,0.25)':crit?'rgba(228,57,57,0.2)':T.hairline}`}}>
        <div style={{display:'flex',alignItems:'center',gap:8}}><span style={{width:20,height:20,borderRadius:6,display:'flex',alignItems:'center',justifyContent:'center',fontSize:11,background:past?'rgba(46,178,96,0.18)':'rgba(26,26,46,0.06)',color:past?'rgba(46,178,96,0.95)':T.faint}}>{past?'✓':'○'}</span><div><div style={{fontSize:12,fontWeight:600,color:past?'rgba(46,178,96,0.85)':T.text}}>{m.label}</div>{unconf&&<span style={{fontSize:8,color:'rgba(244,165,26,0.95)',fontWeight:700}}>UNCONFIRMED</span>}{crit&&!past&&<span style={{fontSize:8,color:'rgba(228,57,57,0.9)',fontWeight:700}}>CRITICAL</span>}</div></div>
        <span style={{fontSize:11,color:T.muted,fontFamily:'monospace'}}>{m.date.slice(5)}</span>
      </div>})}
  </div>;
}

function csvEscape(v){if(v==null||v===undefined)return'';const s=String(v);return/[",\r\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s;}
function downloadCsv(filename,rows){
  const lines=rows.map(r=>r.map(csvEscape).join(','));
  const blob=new Blob(['\uFEFF'+lines.join('\r\n')],{type:'text/csv;charset=utf-8'});
  const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=filename;a.click();URL.revokeObjectURL(url);
}
function buildLookAheadRows(gw,int_s,startDate,tab){
  const rows=[['Date','Tower','Zone','Activities','Tab']];
  const days=[];for(let i=0;i<21;i++){const d=new Date(startDate);d.setDate(d.getDate()+i);if(d.getDay()!==0)days.push(d)}
  for(const d of days){
    const dk=dateKey(d),ds=`${formatShort(d)} ${d.getFullYear()}`;
    if(tab==='groundworks'){
      const gwD=gw[dk];
      if(gwD)Object.entries(gwD).forEach(([tw,zones])=>{
        if(typeof zones==='object'&&!Array.isArray(zones))Object.entries(zones).forEach(([z,a])=>{if(Array.isArray(a))rows.push([ds,tw,z,a.join('; '),tab])});
        else if(Array.isArray(zones))rows.push([ds,tw,'_default',zones.join('; '),tab]);
      });
    }else{
      const intD=int_s[dk];
      if(intD)Object.entries(intD).forEach(([tw,data])=>{
        const acts=Array.isArray(data)?data:Object.values(data).flat();
        rows.push([ds,tw,'—',acts.join('; '),tab]);
      });
    }
  }
  return rows;
}

function UpdPage({date,sched,comp,tab,canTick,userName,onSubmitted}){
  const k=dateKey(date),dayData=sched[k]||{},seq=tab==='groundworks'?GW_SEQUENCE:INT_SEQUENCE;
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
      setToast('Submitted');
      setTimeout(()=>setToast(''),2500);
    }catch(_){setToast('Submit failed — try again')}
    finally{setSubmitting(false)}
  }
  return<div style={{overflowY:'auto',flex:1,background:T.bg,paddingBottom:canTick&&dirty?80:12}}>
    {tot>0&&<div style={{margin:12,padding:'14px 16px',background:'linear-gradient(135deg,rgba(66,133,244,0.1),rgba(46,178,96,0.06))',borderRadius:14,border:'1px solid rgba(66,133,244,0.18)',boxShadow:'0 2px 8px rgba(26,26,46,0.04)'}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10}}><span style={{fontSize:14,fontWeight:700,color:T.text}}>Today's Progress</span><span style={{fontSize:28,fontWeight:800,color:pct===100?'rgba(46,178,96,1)':'rgba(66,133,244,1)'}}>{pct}%</span></div>
      <div style={{height:6,background:'rgba(26,26,46,0.08)',borderRadius:3,overflow:'hidden'}}><div style={{height:'100%',width:`${pct}%`,background:pct===100?'rgba(46,178,96,0.85)':'rgba(66,133,244,0.85)',borderRadius:3,transition:'width 0.4s'}}/></div>
      <div style={{fontSize:11,color:T.muted,marginTop:6}}>{done}/{tot} activities</div>
    </div>}
    {sections.map(sec=>{const sd=sec.acts.filter(a=>!!dc[`${sec.pfx}|${a}`]).length;
      return<div key={sec.label} style={{margin:'8px 12px',borderRadius:14,overflow:'hidden',border:`1px solid ${T.hairline}`,background:T.surface,boxShadow:'0 1px 4px rgba(26,26,46,0.04)'}}>
        <div style={{padding:'12px 16px',background:'rgba(26,26,46,0.03)',display:'flex',justifyContent:'space-between',alignItems:'center'}}><span style={{fontSize:13,fontWeight:700,color:T.text}}>{sec.label}</span><span style={{fontSize:11,color:sd===sec.acts.length?'rgba(46,178,96,0.85)':T.muted,fontWeight:600}}>{sd}/{sec.acts.length}</span></div>
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
      <span style={{fontSize:11,color:T.muted,flex:1}}>Submit to save today’s activity updates to the programme.</span>
      <button type="button" onClick={submitDay} disabled={!dirty||submitting} style={{...S.btn,...S.btnAct,padding:'12px 22px',opacity:!dirty||submitting?0.45:1}}>{submitting?'Submitting…':'Submit day'}</button>
    </div>}
    {toast&&<div style={{position:'fixed',bottom:130,left:'50%',transform:'translateX(-50%)',background:toast.includes('failed')?'rgba(231,76,60,0.95)':'rgba(46,178,96,0.95)',color:'#fff',padding:'8px 16px',borderRadius:10,fontSize:13,fontWeight:600,zIndex:25,boxShadow:'0 4px 16px rgba(0,0,0,0.15)'}}>{toast}</div>}
  </div>;
}

function LAPage({gw,int_s,date,tab}){
  const days=[];for(let i=0;i<21;i++){const d=new Date(date);d.setDate(d.getDate()+i);if(d.getDay()!==0)days.push(d)}
  function exportCsv(){
    const rows=buildLookAheadRows(gw,int_s,date,tab);
    const fn=`119hs-lookahead-${tab}-${dateKey(date)}.csv`;
    downloadCsv(fn,rows);
  }
  return<div style={{overflowY:'auto',flex:1,padding:12,background:T.bg}}>
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:12,flexWrap:'wrap',marginBottom:12}}>
      <h2 style={{margin:0,fontSize:18,fontWeight:700,color:T.text}}>3-Week Look Ahead</h2>
      <button type="button" onClick={exportCsv} style={{...S.btn,...S.btnAct,padding:'8px 14px',fontSize:12}}>Export CSV</button>
    </div>
    {days.map(d=>{const k=dateKey(d),gwD=gw[k],intD=int_s[k],has=tab==='groundworks'?gwD&&Object.keys(gwD).length>0:intD&&Object.keys(intD).length>0,isMon=d.getDay()===1;
      return<div key={k} style={{marginBottom:3,padding:'8px 12px',borderRadius:8,background:has?T.surface:'transparent',opacity:has?1:0.35,border:`1px solid ${has?T.hairline:'transparent'}`,borderLeft:isMon?'3px solid rgba(66,133,244,0.55)':undefined}}>
        <span style={{fontSize:12,fontWeight:700,color:T.text,fontFamily:'monospace'}}>{formatShort(d)}</span>
        {tab==='groundworks'&&gwD&&Object.entries(gwD).map(([tw,zones])=>Object.entries(zones).map(([z,a])=><div key={tw+z} style={{display:'flex',gap:4,alignItems:'center',marginTop:2,marginLeft:4}}><span style={{fontSize:9,color:T.muted,fontFamily:'monospace',minWidth:48}}>{tw} {z.replace('Pour ','P').replace('Zone ','Z')}</span>{a.map((x,i)=><span key={i} style={S.pill(x)}>{x}</span>)}</div>))}
        {tab==='internals'&&intD&&Object.entries(intD).map(([tw,data])=>{const acts=Array.isArray(data)?data:Object.values(data).flat();return<div key={tw} style={{marginLeft:4,marginTop:2}}><span style={{fontSize:9,color:T.muted,fontFamily:'monospace'}}>{tw}: </span>{acts.slice(0,4).map((x,i)=><span key={i} style={{...S.pill(x),marginRight:2}}>{x}</span>)}{acts.length>4&&<span style={{fontSize:8,color:T.faint}}>+{acts.length-4}</span>}</div>})}
      </div>})}
  </div>;
}

function MainApp({user,onLogout}){
  const[gw,setGw]=useState({});const[int_s,setInt]=useState({});const[comp,setComp]=useState({});const[ms,setMs]=useState([]);const[loading,setLoading]=useState(true);
  const[tab,setTab]=useState(user.tabs[0]||'groundworks');const[page,setPage]=useState('dashboard');const[date,setDate]=useState(new Date(2026,4,1));
  const loadData=useCallback(async()=>{const[g,i,c,m]=await Promise.all([api.getSchedule('groundworks'),api.getSchedule('internals'),api.getCompletions(),api.getMilestones()]);setGw(g||{});setInt(i||{});setComp(c||{});setMs(m||[]);setLoading(false)},[]);
  useEffect(()=>{loadData()},[loadData]);
  useEffect(()=>{const onKey=e=>{if(['dashboard','zones','programme','templates'].includes(page))return;if(e.key==='ArrowLeft')setDate(d=>{const n=new Date(d);n.setDate(n.getDate()-1);if(n.getDay()===0)n.setDate(n.getDate()-1);return n});if(e.key==='ArrowRight')setDate(d=>{const n=new Date(d);n.setDate(n.getDate()+1);if(n.getDay()===0)n.setDate(n.getDate()+1);return n})};window.addEventListener('keydown',onKey);return()=>window.removeEventListener('keydown',onKey)},[page]);
  function nav(dir){setDate(d=>{const n=new Date(d);n.setDate(n.getDate()+dir);if(n.getDay()===0)n.setDate(n.getDate()+dir);return n})}
  if(loading)return<div style={{display:'flex',alignItems:'center',justifyContent:'center',height:'100vh',background:T.bg,color:T.muted,fontFamily:'monospace'}}>Loading...</div>;
  const canSee=t=>user.tabs.includes(t),isAdmin=user.role==='admin',canTick=user.role!=='viewer',canEdit=canTick;
  const showDateNav=['update','lookahead'].includes(page);const sched=tab==='groundworks'?gw:int_s;

  return<div style={{background:T.bg,height:'100vh',fontFamily:"'Segoe UI',sans-serif",display:'flex',flexDirection:'column',overflow:'hidden'}}>
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'8px 14px',borderBottom:`1px solid ${T.hairline}`,flexShrink:0,background:T.surface}}>
      <div style={{display:'flex',alignItems:'center',gap:10}}><span style={{fontSize:16,fontWeight:800,color:T.text}}>119<span style={{color:'rgba(66,133,244,0.95)'}}>HS</span></span>
        <div style={{display:'flex',gap:2,background:'rgba(26,26,46,0.05)',borderRadius:8,padding:3}}>{['groundworks','internals'].filter(canSee).map(t=><button key={t} onClick={()=>setTab(t)} style={{...S.btn,...(tab===t?S.btnAct:{}),textTransform:'capitalize',padding:'6px 14px'}}>{t}</button>)}</div></div>
      <div style={{display:'flex',alignItems:'center',gap:6}}><span style={{fontSize:10,color:T.faint}}>{user.name}</span><button onClick={onLogout} style={{...S.btn,fontSize:10,padding:'4px 10px'}}>Logout</button></div>
    </div>
    {showDateNav&&<div style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'6px 14px',borderBottom:`1px solid ${T.hairline}`,flexShrink:0,background:T.nav}}>
      <button onClick={()=>nav(-1)} style={{...S.btn,fontSize:16,padding:'8px 18px'}}>←</button><div style={{fontSize:15,fontWeight:700,color:T.text}}>{formatDate(date)}</div><button onClick={()=>nav(1)} style={{...S.btn,fontSize:16,padding:'8px 18px'}}>→</button>
    </div>}
    <div style={{flex:1,display:'flex',flexDirection:'column',overflow:'hidden'}}>
      {page==='dashboard'&&<DashPage gw={gw} int_s={int_s} comp={comp} ms={ms} date={date}/>}
      {page==='update'&&<UpdPage date={date} sched={sched} comp={comp} tab={tab} canTick={canTick} userName={user.name} onSubmitted={loadData}/>}
      {page==='lookahead'&&<LAPage gw={gw} int_s={int_s} date={date} tab={tab}/>}
      {page==='zones'&&<ZoneSetupPage tab={tab} canEdit={canEdit} isAdmin={isAdmin}/>}
      {page==='programme'&&<ProgrammePage tab={tab} canEdit={canEdit} onScheduleChanged={loadData}/>}
      {page==='templates'&&<TemplatePage tab={tab} isAdmin={isAdmin} onReload={loadData}/>}
    </div>
    <div style={{display:'flex',borderTop:`1px solid ${T.hairline}`,flexShrink:0,background:T.nav,boxShadow:'0 -4px 16px rgba(26,26,46,0.04)'}}>
      {[{id:'dashboard',label:'Dash',icon:'▣'},{id:'update',label:'Update',icon:'✓'},{id:'lookahead',label:'Ahead',icon:'▶'},{id:'zones',label:'Zones',icon:'◇'},{id:'programme',label:'Programme',icon:'◎'},...(isAdmin?[{id:'templates',label:'Templates',icon:'⧉'}]:[])].map(p=><button key={p.id} onClick={()=>setPage(p.id)} style={{flex:1,padding:'10px 2px',background:'transparent',border:'none',cursor:'pointer',display:'flex',flexDirection:'column',alignItems:'center',gap:2}}><span style={{fontSize:18,opacity:page===p.id?1:0.35,color:T.text}}>{p.icon}</span><span style={{fontSize:7,fontWeight:600,color:page===p.id?'rgba(66,133,244,1)':T.faint,textTransform:'uppercase',textAlign:'center',lineHeight:1.1}}>{p.label}</span></button>)}
    </div>
  </div>;
}

export default function App(){
  const[user,setUser]=useState(()=>api.getStoredUser());
  return<AppErrorBoundary>
    {!user?<LoginPage onLogin={setUser}/>:<MainApp user={user} onLogout={()=>{api.logout();setUser(null)}}/>}
  </AppErrorBoundary>;
}
