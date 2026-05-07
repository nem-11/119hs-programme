import React,{useState,useEffect,useRef,useCallback} from 'react';
import * as api from './api';
import {actColor} from './constants';
import {T,S} from './uiTheme';
import {parseZoneGeometry,pointInGeom,svgPolygonPoints} from './zoneGeom';
import {isPdfFile,rasterizePdfFirstPageToJpeg} from './pdfDrawing';

function readFileAsDataURL(file){
  return new Promise((resolve,reject)=>{
    const reader=new FileReader();
    reader.onload=()=>resolve(reader.result);
    reader.onerror=()=>reject(new Error('Could not read this file.'));
    reader.readAsDataURL(file);
  });
}

function loadImage(src){
  return new Promise((resolve,reject)=>{
    const img=new Image();
    img.onload=()=>resolve(img);
    img.onerror=()=>reject(new Error('This image could not be loaded.'));
    img.src=src;
  });
}

async function rasterizeImageFile(file){
  const dataUrl=await readFileAsDataURL(file);
  const img=await loadImage(dataUrl);
  const c=document.createElement('canvas');
  const s=Math.min(1920/img.width,1);
  c.width=img.width*s;
  c.height=img.height*s;
  c.getContext('2d').drawImage(img,0,0,c.width,c.height);
  const b64=c.toDataURL('image/jpeg',0.85).split(',')[1];
  return{width:c.width,height:c.height,b64};
}

function clientToPct(e,el){
  if(!el)return[0,0];
  const r=el.getBoundingClientRect();
  if(r.width<=0||r.height<=0)return[0,0];
  return[((e.clientX-r.left)/r.width)*100,((e.clientY-r.top)/r.height)*100];
}

export default function ZoneSetupPage({tab,canEdit,isAdmin}){
  const typeTab=tab==='groundworks'?'groundworks':'internals';
  const[drawings,setDrawings]=useState([]);
  const[selDraw,setSelDraw]=useState(null);
  const[drawData,setDrawData]=useState(null);
  const[zones,setZones]=useState([]);
  const[activities,setActivities]=useState([]);
  const[tool,setTool]=useState('select');
  const[rectDraft,setRectDraft]=useState(null);
  const[polyPts,setPolyPts]=useState([]);
  const[selectedId,setSelectedId]=useState(null);
  const[zName,setZName]=useState('');
  const[zTower,setZTower]=useState('T2');
  const[zAct,setZAct]=useState('');
  const[uploadErr,setUploadErr]=useState('');
  const wrapRef=useRef(null);
  const dragging=useRef(false);

  const filteredActs=activities.filter(a=>a.type===typeTab);

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

  useEffect(()=>{
    if(!selectedId){setZName('');setZTower('T2');setZAct('');return}
    const z=zones.find(x=>x.id===selectedId);
    if(!z)return;
    setZName(z.name||'');
    setZTower(z.tower||'T2');
    setZAct(z.activity_id!=null?String(z.activity_id):'');
  },[selectedId,zones]);

  async function handleUpload(e){
    const input=e.target;
    const file=input.files?.[0];
    input.value='';
    if(!file)return;
    setUploadErr('');
    try{
      let width,height,b64;
      if(isPdfFile(file)){
        const buf=await file.arrayBuffer();
        const out=await rasterizePdfFirstPageToJpeg(buf,{maxWidth:1920,jpegQuality:0.85});
        width=out.width;height=out.height;b64=out.base64;
      }else{
        const out=await rasterizeImageFile(file);
        width=out.width;height=out.height;b64=out.b64;
      }
      const r=await api.uploadDrawing(file.name,tab,'ground',b64,width,height,null);
      if(r?.ok){reloadDrawings();setSelDraw(Number(r.id))}
      else setUploadErr(typeof r?.error==='string'?r.error:'Upload failed.');
    }catch(err){
      setUploadErr(err?.message||'Upload failed.');
    }
  }

  function onMouseDown(e){
    if(!canEdit||!drawData||!wrapRef.current)return;
    const[pctX,pctY]=clientToPct(e,wrapRef.current);
    if(tool==='select'){
      for(let i=zones.length-1;i>=0;i--){
        const z=zones[i],g=parseZoneGeometry(z);
        if(pointInGeom(pctX,pctY,g)){setSelectedId(z.id);return}
      }
      setSelectedId(null);
      return;
    }
    if(tool==='rect'){
      dragging.current=true;
      setRectDraft({x:pctX,y:pctY,w:0,h:0});
      setSelectedId(null);
      return;
    }
    if(tool==='poly'){
      setPolyPts(p=>[...p,[pctX,pctY]]);
      setSelectedId(null);
    }
  }

  function onMouseMove(e){
    if(tool!=='rect'||!dragging.current||!rectDraft||!wrapRef.current)return;
    const[pctX,pctY]=clientToPct(e,wrapRef.current);
    setRectDraft(d=>({...d,w:pctX-d.x,h:pctY-d.y}));
  }

  function onMouseUp(){
    if(tool!=='rect')return;
    dragging.current=false;
    if(!rectDraft)return;
    let z={...rectDraft};
    if(z.w<0){z.x+=z.w;z.w=-z.w}
    if(z.h<0){z.y+=z.h;z.h=-z.h}
    if(z.w<1||z.h<1){setRectDraft(null);return}
    setRectDraft(z);
  }

  function cancelDraft(){
    setRectDraft(null);setPolyPts([]);
  }

  async function saveNewZone(geometry){
    if(!canEdit||!selDraw||!zName.trim())return;
    const aid=zAct?Number(zAct):null;
    await api.addZone(selDraw,zName.trim(),zTower.trim(),geometry,aid);
    setZones(await api.getZonesForDrawing(selDraw)||[]);
    cancelDraft();
    setTool('select');
  }

  async function saveEditZone(){
    if(!canEdit||!selectedId)return;
    const z=zones.find(x=>x.id===selectedId);if(!z)return;
    const g=parseZoneGeometry(z);
    const aid=zAct?Number(zAct):null;
    await api.updateZone(selectedId,{name:zName.trim(),tower:zTower.trim(),geometry:g,activity_id:aid});
    setZones(await api.getZonesForDrawing(selDraw)||[]);
  }

  async function removeZone(){
    if(!canEdit||!selectedId)return;
    await api.deleteZone(selectedId);
    setSelectedId(null);
    setZones(await api.getZonesForDrawing(selDraw)||[]);
  }

  async function removeDrawing(){
    if(!isAdmin||!selDraw)return;
    if(!window.confirm('Delete this drawing and all its zones and programme links?'))return;
    await api.deleteDrawing(selDraw);
    setSelectedId(null);setSelDraw(null);reloadDrawings();
  }

  function finishPolygon(){
    if(polyPts.length<3)return;
    const geometry={kind:'poly',points:polyPts.map(p=>[p[0],p[1]])};
    saveNewZone(geometry);
  }

  const pendingRect=rectDraft&&Math.abs(rectDraft.w)>=1&&Math.abs(rectDraft.h)>=1;

  return(
    <div style={{flex:1,display:'flex',flexDirection:'column',overflow:'hidden',background:T.bg}}>
      <div style={{display:'flex',gap:8,padding:'8px 12px',borderBottom:`1px solid ${T.hairline}`,flexWrap:'wrap',alignItems:'center',background:T.surface}}>
        {drawings.filter(d=>d.tab===tab).length>0&&(
          <select value={selDraw||''} onChange={e=>setSelDraw(Number(e.target.value))} style={{...S.input,width:'auto',fontSize:12,padding:'6px 10px'}}>
            {drawings.filter(d=>d.tab===tab).map(d=><option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        )}
        {canEdit&&<label style={{...S.btn,padding:'6px 12px',fontSize:11,cursor:'pointer'}}>Upload plan<input type="file" accept="image/png,image/jpeg,image/*,application/pdf,.pdf" onChange={handleUpload} style={{display:'none'}}/></label>}
        {canEdit&&<>
          {(['select','rect','poly']).map(t=><button key={t} type="button" onClick={()=>{setTool(t);cancelDraft()}} style={{...S.btn,...(tool===t?S.btnAct:{}),padding:'6px 10px',fontSize:11,textTransform:'capitalize'}}>{t==='poly'?'Polygon':t}</button>)}
          {tool==='poly'&&polyPts.length>0&&<>
            <button type="button" onClick={finishPolygon} disabled={polyPts.length<3} style={{...S.btn,...S.btnAct,padding:'6px 10px',fontSize:11}}>Finish polygon</button>
            <button type="button" onClick={()=>setPolyPts([])} style={{...S.btn,padding:'6px 10px',fontSize:11}}>Clear</button>
          </>}
        </>}
        {isAdmin&&selDraw&&<button type="button" onClick={removeDrawing} style={{...S.btn,padding:'6px 10px',fontSize:11,color:'#c0392b'}}>Delete drawing</button>}
      </div>
      {uploadErr&&(
        <div style={{padding:'8px 12px',fontSize:12,color:'#c0392b',background:'rgba(231,76,60,0.08)',borderBottom:`1px solid ${T.hairline}`,display:'flex',justifyContent:'space-between',alignItems:'center',gap:10}}>
          <span>{uploadErr}</span>
          <button type="button" onClick={()=>setUploadErr('')} style={{...S.btn,padding:'4px 10px',fontSize:11,flexShrink:0}}>Dismiss</button>
        </div>
      )}
      <div style={{padding:'8px 12px',fontSize:11,color:T.muted,lineHeight:1.45,borderBottom:`1px solid ${T.hairline}`,background:'rgba(66,133,244,0.05)'}}>
        <strong style={{color:T.text}}>Zone Setup</strong> — draw rectangles or polygons on the plan, then name each zone and link an activity. This data is reused on the Programme tab.
      </div>
      <div style={{flex:1,position:'relative',minHeight:200,background:'#e8e8ec',overflow:'hidden',display:'flex',alignItems:'center',justifyContent:'center'}}
        ref={wrapRef}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={()=>{if(tool==='rect')dragging.current=false}}
      >
        {drawData?.image_data?(
          <>
            <img alt="Plan" draggable={false} src={`data:image/jpeg;base64,${drawData.image_data}`} style={{maxWidth:'100%',maxHeight:'100%',objectFit:'contain',userSelect:'none',pointerEvents:'none'}}/>
            <svg style={{position:'absolute',inset:0,width:'100%',height:'100%',pointerEvents:'none'}} viewBox="0 0 100 100" preserveAspectRatio="none">
              {zones.map(z=>{
                const g=parseZoneGeometry(z),sel=z.id===selectedId;
                const fill=sel?'rgba(66,133,244,0.14)':'rgba(66,133,244,0.06)';
                const stroke=sel?'rgba(66,133,244,0.95)':'rgba(66,133,244,0.45)';
                if(g.kind==='rect')
                  return<rect key={z.id} x={g.x} y={g.y} width={g.w} height={g.h} fill={fill} stroke={stroke} strokeWidth={0.35}/>;
                return<polygon key={z.id} points={svgPolygonPoints(g)} fill={fill} stroke={stroke} strokeWidth={0.35}/>;
              })}
              {tool==='poly'&&polyPts.length>0&&(
                <>
                  <polyline points={polyPts.map(p=>`${p[0]},${p[1]}`).join(' ')} fill="none" stroke="rgba(66,133,244,0.9)" strokeWidth={0.4}/>
                  {polyPts.map((p,i)=><circle key={i} cx={p[0]} cy={p[1]} r={0.7} fill="rgba(66,133,244,0.95)"/>)}
                </>
              )}
              {pendingRect&&rectDraft&&(
                <rect x={Math.min(rectDraft.x,rectDraft.x+rectDraft.w)} y={Math.min(rectDraft.y,rectDraft.y+rectDraft.h)}
                  width={Math.abs(rectDraft.w)} height={Math.abs(rectDraft.h)} fill="rgba(66,133,244,0.12)" stroke="rgba(66,133,244,0.85)" strokeWidth={0.35}/>
              )}
            </svg>
          </>
        ):(
          <div style={{textAlign:'center',color:'#888',padding:40}}><div style={{fontSize:16,fontWeight:600}}>No drawing for this tab</div><div style={{fontSize:12,color:'#aaa'}}>{canEdit?'Upload a plan to begin.':'Ask an editor to upload a plan.'}</div></div>
        )}
      </div>
      {pendingRect&&canEdit&&(
        <div style={{padding:12,borderTop:`1px solid ${T.hairline}`,background:T.nav,display:'flex',gap:8,flexWrap:'wrap',alignItems:'center'}}>
          <input value={zTower} onChange={e=>setZTower(e.target.value)} placeholder="Tower" style={{...S.input,width:72,fontSize:12,padding:'8px 10px'}}/>
          <input value={zName} onChange={e=>setZName(e.target.value)} placeholder="Zone name" style={{...S.input,flex:1,minWidth:120,fontSize:12,padding:'8px 10px'}} autoFocus/>
          <select value={zAct} onChange={e=>setZAct(e.target.value)} style={{...S.input,width:160,fontSize:12,padding:'8px 10px'}}>
            <option value="">Activity (optional)</option>
            {filteredActs.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          <button type="button" onClick={()=>{
            let z={...rectDraft};if(z.w<0){z.x+=z.w;z.w=-z.w}if(z.h<0){z.y+=z.h;z.h=-z.h};
            saveNewZone({kind:'rect',x:z.x,y:z.y,w:z.w,h:z.h});
          }} style={{...S.btn,...S.btnAct}}>Save zone</button>
          <button type="button" onClick={cancelDraft} style={S.btn}>Cancel</button>
        </div>
      )}
      {tool==='poly'&&polyPts.length>=3&&!pendingRect&&canEdit&&(
        <div style={{padding:12,borderTop:`1px solid ${T.hairline}`,background:T.nav,display:'flex',gap:8,flexWrap:'wrap',alignItems:'center'}}>
          <span style={{fontSize:11,color:T.muted}}>{polyPts.length} points — Finish polygon, then save.</span>
          <input value={zTower} onChange={e=>setZTower(e.target.value)} placeholder="Tower" style={{...S.input,width:72,fontSize:12,padding:'8px 10px'}}/>
          <input value={zName} onChange={e=>setZName(e.target.value)} placeholder="Zone name" style={{...S.input,flex:1,minWidth:120,fontSize:12,padding:'8px 10px'}}/>
          <select value={zAct} onChange={e=>setZAct(e.target.value)} style={{...S.input,width:160,fontSize:12,padding:'8px 10px'}}>
            <option value="">Activity (optional)</option>
            {filteredActs.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          <button type="button" onClick={finishPolygon} style={{...S.btn,...S.btnAct}}>Save polygon zone</button>
        </div>
      )}
      {selectedId&&canEdit&&!pendingRect&&tool!=='poly'&&(
        <div style={{padding:12,borderTop:`1px solid ${T.hairline}`,background:T.surface,display:'flex',gap:8,flexWrap:'wrap',alignItems:'center'}}>
          <span style={{fontSize:11,fontWeight:700,color:T.text}}>Edit zone</span>
          <input value={zTower} onChange={e=>setZTower(e.target.value)} placeholder="Tower" style={{...S.input,width:72,fontSize:12,padding:'8px 10px'}}/>
          <input value={zName} onChange={e=>setZName(e.target.value)} placeholder="Zone name" style={{...S.input,flex:1,minWidth:120,fontSize:12,padding:'8px 10px'}}/>
          <select value={zAct} onChange={e=>setZAct(e.target.value)} style={{...S.input,width:170,fontSize:12,padding:'8px 10px'}}>
            <option value="">Activity (optional)</option>
            {filteredActs.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          <button type="button" onClick={saveEditZone} style={{...S.btn,...S.btnAct}}>Save changes</button>
          <button type="button" onClick={removeZone} style={{...S.btn,color:'#c0392b'}}>Delete zone</button>
        </div>
      )}
      {selectedId&&!canEdit&&(
        <div style={{padding:12,borderTop:`1px solid ${T.hairline}`,background:T.surface,fontSize:12,color:T.muted}}>
          Selected zone — switch to an editor account to change geometry or metadata.
        </div>
      )}
    </div>
  );
}
