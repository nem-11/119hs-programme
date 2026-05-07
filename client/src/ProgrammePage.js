import React,{useState,useEffect,useRef,useCallback} from 'react';
import * as api from './api';
import {T,S} from './uiTheme';
import {parseZoneGeometry,svgPolygonPoints,pointInGeom} from './zoneGeom';
import {toHtmlDateInputValue} from './constants';

function clientToPct(e,el){
  if(!el)return[0,0];
  const r=el.getBoundingClientRect();
  if(r.width<=0||r.height<=0)return[0,0];
  return[((e.clientX-r.left)/r.width)*100,((e.clientY-r.top)/r.height)*100];
}

const STATUSES=['planned','active','done','on-hold'];

export default function ProgrammePage({tab,canEdit,onScheduleChanged}){
  const typeTab=tab==='groundworks'?'groundworks':'internals';
  const[drawings,setDrawings]=useState([]);
  const[selDraw,setSelDraw]=useState(null);
  const[drawData,setDrawData]=useState(null);
  const[zones,setZones]=useState([]);
  const[activities,setActivities]=useState([]);
  const[selectedId,setSelectedId]=useState(null);
  const[items,setItems]=useState([]);
  const[loadingItems,setLoadingItems]=useState(false);
  const[form,setForm]=useState({activity_id:'',start_date:'',end_date:'',status:'planned',notes:''});
  const[editingId,setEditingId]=useState(null);
  const wrapRef=useRef(null);

  const filteredActs=activities.filter(a=>a.type===typeTab);
  const selectedZone=zones.find(z=>z.id===selectedId);

  const reloadDrawings=useCallback(()=>{
    api.getDrawings().then(d=>{
      setDrawings(d||[]);
      const f=(d||[]).filter(x=>x.tab===tab);
      setSelDraw(p=>{
        if(p&&f.some(x=>x.id===p))return p;
        return f.length?f[0].id:null;
      });
    });
  },[tab]);

  useEffect(()=>{reloadDrawings()},[reloadDrawings]);
  useEffect(()=>{api.getActivities().then(a=>setActivities(a||[]))},[]);
  useEffect(()=>{
    if(!selDraw){setDrawData(null);setZones([]);return}
    api.getDrawing(selDraw).then(d=>setDrawData(d));
    api.getZonesForDrawing(selDraw).then(z=>setZones(z||[]));
  },[selDraw]);

  async function loadItemsForZone(zid){
    if(!zid){setItems([]);return}
    setLoadingItems(true);
    const rows=await api.getProgrammeItemsByZone(zid);
    setItems(Array.isArray(rows)?rows:[]);
    setLoadingItems(false);
  }

  useEffect(()=>{
    setEditingId(null);
    setForm({activity_id:'',start_date:'',end_date:'',status:'planned',notes:''});
    loadItemsForZone(selectedId);
  },[selectedId]);

  function onCanvasClick(e){
    if(!drawData||!wrapRef.current)return;
    const[pctX,pctY]=clientToPct(e,wrapRef.current);
    for(let i=zones.length-1;i>=0;i--){
      const z=zones[i],g=parseZoneGeometry(z);
      if(pointInGeom(pctX,pctY,g)){setSelectedId(z.id);return}
    }
    setSelectedId(null);
  }

  function activityName(id){
    const a=activities.find(x=>Number(x.id)===Number(id));
    return a?a.name:'';
  }

  async function submitItem(e){
    e.preventDefault();
    if(!canEdit||!selectedId||!form.activity_id||!form.start_date||!form.end_date)return;
    if(editingId){
      await api.updateProgrammeItem(editingId,{activity_id:Number(form.activity_id),start_date:form.start_date,end_date:form.end_date,status:form.status,notes:form.notes});
    }else{
      await api.createProgrammeItem(selectedId,Number(form.activity_id),form.start_date,form.end_date,form.status,form.notes);
    }
    if(onScheduleChanged)await onScheduleChanged();
    setEditingId(null);
    setForm({activity_id:'',start_date:'',end_date:'',status:'planned',notes:''});
    await loadItemsForZone(selectedId);
  }

  function startEdit(it){
    setEditingId(it.id);
    setForm({
      activity_id:String(it.activity_id),
      start_date:toHtmlDateInputValue(it.start_date),
      end_date:toHtmlDateInputValue(it.end_date),
      status:it.status||'planned',
      notes:it.notes||'',
    });
  }

  async function removeItem(id){
    if(!canEdit)return;
    await api.deleteProgrammeItem(id);
    if(onScheduleChanged)await onScheduleChanged();
    await loadItemsForZone(selectedId);
    if(editingId===id){setEditingId(null);setForm({activity_id:'',start_date:'',end_date:'',status:'planned',notes:''})}
  }

  return(
    <div style={{flex:1,display:'flex',flexDirection:'column',overflow:'hidden',background:T.bg}}>
      <div style={{padding:'8px 12px',borderBottom:`1px solid ${T.hairline}`,background:T.surface,display:'flex',gap:8,flexWrap:'wrap',alignItems:'center'}}>
        {drawings.filter(d=>d.tab===tab).length>0&&(
          <select value={selDraw||''} onChange={e=>setSelDraw(Number(e.target.value))} style={{...S.input,width:'auto',fontSize:12,padding:'6px 10px'}}>
            {drawings.filter(d=>d.tab===tab).map(d=><option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        )}
        <span style={{fontSize:11,color:T.muted}}>Click a zone on the drawing, then add programme dates below.</span>
      </div>
      <div style={{flex:1,display:'flex',flexDirection:'row',minHeight:0}}>
        <div style={{flex:1,minWidth:0,position:'relative',background:'#e8e8ec',display:'flex',alignItems:'center',justifyContent:'center'}}
          ref={wrapRef}
          onClick={onCanvasClick}
        >
          {drawData?.image_data?(
            <>
              <img alt="Plan" draggable={false} src={`data:image/jpeg;base64,${drawData.image_data}`} style={{maxWidth:'100%',maxHeight:'100%',objectFit:'contain',userSelect:'none',pointerEvents:'none'}}/>
              <svg style={{position:'absolute',inset:0,width:'100%',height:'100%',pointerEvents:'none'}} viewBox="0 0 100 100" preserveAspectRatio="none">
                {zones.map(z=>{
                  const g=parseZoneGeometry(z),sel=z.id===selectedId;
                  const actNm=z.activity_id?activityName(z.activity_id):'';
                  const fill=sel?'rgba(46,178,96,0.12)':'rgba(66,133,244,0.06)';
                  const stroke=sel?'rgba(46,178,96,0.9)':'rgba(66,133,244,0.4)';
                  const bb=g.kind==='rect'?g:{x:z.x,y:z.y,w:z.w,h:z.h};
                  const cx=(bb.x||0)+(bb.w||0)/2,cy=(bb.y||0)+(bb.h||0)/2;
                  const frag=g.kind==='rect'?(
                    <rect x={g.x} y={g.y} width={g.w} height={g.h} fill={fill} stroke={stroke} strokeWidth={0.35}/>
                  ):(
                    <polygon points={svgPolygonPoints(g)} fill={fill} stroke={stroke} strokeWidth={0.35}/>
                  );
                  return<g key={z.id}>{frag}
                    <text x={cx} y={cy} textAnchor="middle" dominantBaseline="middle" fill={T.text} fontSize={2.2} fontWeight="700" style={{pointerEvents:'none',textShadow:'0 0 2px #fff'}}>
                      {z.tower} {z.name}{actNm?` · ${actNm}`:''}
                    </text>
                  </g>;
                })}
              </svg>
            </>
          ):(
            <div style={{padding:24,color:T.faint,fontSize:13}}>No drawing — complete Zone Setup first.</div>
          )}
        </div>
        <div style={{width:320,maxWidth:'42%',flexShrink:0,borderLeft:`1px solid ${T.hairline}`,background:T.surface,overflowY:'auto',padding:12}}>
          {!selectedId&&<div style={{fontSize:13,color:T.muted}}>Select a zone on the plan.</div>}
          {selectedZone&&<>
            <div style={{fontSize:14,fontWeight:700,color:T.text,marginBottom:4}}>{selectedZone.tower} {selectedZone.name}</div>
            {selectedZone.activity_id&&<div style={{marginBottom:12}}><span style={S.pill(activityName(selectedZone.activity_id))}>{activityName(selectedZone.activity_id)}</span></div>}
            <h4 style={{...S.section,marginTop:4}}>Programme items</h4>
            {loadingItems&&<div style={{fontSize:12,color:T.faint}}>Loading…</div>}
            {!loadingItems&&items.length===0&&<div style={{fontSize:12,color:T.faint,marginBottom:10}}>No programme rows yet.</div>}
            {items.map(it=>(
              <div key={it.id} style={{padding:10,borderRadius:10,border:`1px solid ${T.hairline}`,marginBottom:8,background:T.bg}}>
                <div style={{fontSize:12,fontWeight:700,color:T.text}}>{it.activity_name}</div>
                <div style={{fontSize:11,color:T.muted}}>{it.start_date} → {it.end_date}</div>
                <div style={{fontSize:10,color:T.faint,marginTop:4}}>{it.status}{it.notes?` · ${it.notes}`:''}</div>
                {canEdit&&<div style={{marginTop:8,display:'flex',gap:6}}>
                  <button type="button" onClick={()=>startEdit(it)} style={{...S.btn,padding:'4px 10px',fontSize:10}}>Edit</button>
                  <button type="button" onClick={()=>removeItem(it.id)} style={{...S.btn,padding:'4px 10px',fontSize:10,color:'#c0392b'}}>Delete</button>
                </div>}
              </div>
            ))}
            {canEdit&&(
              <form onSubmit={submitItem} style={{marginTop:12,padding:12,borderRadius:12,border:`1px solid rgba(66,133,244,0.25)`,background:'rgba(66,133,244,0.04)'}}>
                <div style={{fontSize:11,fontWeight:700,color:T.text,marginBottom:8}}>{editingId?'Update row':'Add row'}</div>
                <select required value={form.activity_id} onChange={e=>setForm(f=>({...f,activity_id:e.target.value}))} style={{...S.input,fontSize:12,marginBottom:8}}>
                  <option value="">Activity</option>
                  {filteredActs.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
                <input required type="date" value={toHtmlDateInputValue(form.start_date)} onChange={e=>setForm(f=>({...f,start_date:e.target.value}))} style={{...S.input,fontSize:12,marginBottom:8}}/>
                <input required type="date" value={toHtmlDateInputValue(form.end_date)} onChange={e=>setForm(f=>({...f,end_date:e.target.value}))} style={{...S.input,fontSize:12,marginBottom:8}}/>
                <select value={form.status} onChange={e=>setForm(f=>({...f,status:e.target.value}))} style={{...S.input,fontSize:12,marginBottom:8}}>
                  {STATUSES.map(s=><option key={s} value={s}>{s}</option>)}
                </select>
                <input value={form.notes} onChange={e=>setForm(f=>({...f,notes:e.target.value}))} placeholder="Notes" style={{...S.input,fontSize:12,marginBottom:10}}/>
                <div style={{display:'flex',gap:8}}>
                  <button type="submit" style={{...S.btn,...S.btnAct,flex:1}}>{editingId?'Save':'Add'}</button>
                  {editingId&&<button type="button" onClick={()=>{setEditingId(null);setForm({activity_id:'',start_date:'',end_date:'',status:'planned',notes:''})}} style={S.btn}>Cancel</button>}
                </div>
              </form>
            )}
          </>}
        </div>
      </div>
    </div>
  );
}
