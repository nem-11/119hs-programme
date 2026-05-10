import React,{useState,useEffect,useRef,useCallback,useMemo} from 'react';
import * as api from './api';
import {T,S} from './uiTheme';
import {parseZoneGeometry,pointInGeom,svgPolygonPoints} from './zoneGeom';
import {isPdfFile,rasterizePdfFirstPageToJpeg} from './pdfDrawing';
import {actColor,PROJECT_PROGRAMME_TAB} from './constants';
import {readSavedDrawingId,writeSavedDrawingId} from './drawingSelection';

function sortZoneActs(z){
  return [...(z?.activities||[])].sort((a,b)=>(a.sequence_order||0)-(b.sequence_order||0));
}

function sameZoneId(a,b){
  if(a==null||b==null)return false;
  return Number(a)===Number(b);
}

/** Top-most zone under cursor (SVG / %-space). */
function findZoneAtPct(zonesList,pctX,pctY){
  for(let i=zonesList.length-1;i>=0;i--){
    const zz=zonesList[i],g=parseZoneGeometry(zz);
    if(pointInGeom(pctX,pctY,g))return zz;
  }
  return null;
}

/** Centre point for zone label (rect centre or polygon centroid). */
function zoneLabelAnchor(g, z){
  if(g?.kind==='rect')return{cx:g.x+g.w/2,cy:g.y+g.h/2};
  if(g?.kind==='poly'&&g.points?.length){
    let sx=0,sy=0;
    for(const p of g.points){sx+=p[0];sy+=p[1]}
    return{cx:sx/g.points.length,cy:sy/g.points.length};
  }
  const x=Number(z.x)||0,y=Number(z.y)||0,w=Number(z.w)||0,h=Number(z.h)||0;
  return{cx:x+w/2,cy:y+h/2};
}

/**
 * Colour + label copy for the active activity layer (aligned with polygon fill).
 * nameForActivityId resolves legacy zones.activity_id when zone_activities is empty.
 */
function zoneLayerDisplay(z, layerActId, nameForActivityId){
  const acts=sortZoneActs(z);
  if(!acts.length){
    const lid=z.activity_id!=null?Number(z.activity_id):null;
    const legacy=lid!=null?nameForActivityId(lid):'';
    if(!legacy)return{colorName:null,muted:true,activityLine:''};
    if(layerActId==null)return{colorName:legacy,muted:false,activityLine:legacy};
    if(Number(layerActId)===lid)return{colorName:legacy,muted:false,activityLine:legacy};
    return{colorName:null,muted:true,activityLine:''};
  }
  if(layerActId==null){
    const first=acts[0];
    const line=acts.length>1?`${first.name} (+${acts.length-1})`:first.name;
    return{colorName:first.name,muted:false,activityLine:line};
  }
  const hit=acts.find(a=>Number(a.activity_id)===Number(layerActId));
  if(hit)return{colorName:hit.name,muted:false,activityLine:hit.name};
  return{colorName:null,muted:true,activityLine:''};
}

function zoneCanvasPaint(z, sel, layerActId, nameForActivityId){
  const disp=zoneLayerDisplay(z,layerActId,nameForActivityId);
  const fa=sel?0.22:0.12;
  const sa=sel?0.95:0.55;
  let fill,stroke;
  if(!disp.colorName||disp.muted){
    fill=sel?'rgba(120,120,130,0.16)':'rgba(120,120,130,0.07)';
    stroke=sel?'rgba(90,90,100,0.88)':'rgba(90,90,100,0.35)';
  }else{
    fill=actColor(disp.colorName,fa);
    stroke=actColor(disp.colorName,sa);
  }
  return{fill,stroke,disp};
}

function buildActivitiesFromTemplate(t, nameToAct){
  let seq=[],durs=[];
  try{seq=JSON.parse(t.sequence)||[]}catch(_){}
  try{durs=JSON.parse(t.durations)||[]}catch(_){}
  const out=[];
  seq.forEach((name,i)=>{
    const a=nameToAct.get(name);
    if(!a)return;
    out.push({
      activity_id:a.id,
      name:a.name,
      sequence_order:i,
      duration_days:Number(durs[i])>0?Number(durs[i]):1,
      start_date:null,
    });
  });
  return out;
}

function toPutPayload(rows){
  return rows.map((r,i)=>({
    activity_id:r.activity_id,
    sequence_order:i,
    duration_days:r.duration_days!=null?Math.max(1,Number(r.duration_days)||1):1,
    start_date:r.start_date||null,
  }));
}

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

function fitPlate(vw,vh,iw,ih){
  if(!vw||!vh||!iw||!ih)return{w:Math.max(vw,1),h:Math.max(vh,1)};
  const r=Math.min(vw/iw,vh/ih);
  return{w:iw*r,h:ih*r};
}

/** Normalized 0–100 coords using transformed plate bounding rect (image space). */
function clientToPct(clientX,clientY,plateEl){
  if(!plateEl)return[0,0];
  const r=plateEl.getBoundingClientRect();
  if(r.width<=0||r.height<=0)return[0,0];
  return[((clientX-r.left)/r.width)*100,((clientY-r.top)/r.height)*100];
}

function touchDistance(t1,t2){
  return Math.hypot(t1.clientX-t2.clientX,t1.clientY-t2.clientY);
}

function touchMidpoint(t1,t2,viewportEl){
  const vr=viewportEl.getBoundingClientRect();
  return{
    x:(t1.clientX+t2.clientX)/2-vr.left,
    y:(t1.clientY+t2.clientY)/2-vr.top,
  };
}

function clampScale(s){return Math.min(5,Math.max(0.3,s))}

/** Distance between two normalized points (0–100) in screen pixels on the plate. */
function distPctAsPx(ax,ay,bx,by,plateRect){
  if(!plateRect?.width||!plateRect?.height)return Infinity;
  return Math.hypot(((ax-bx)/100)*plateRect.width,((ay-by)/100)*plateRect.height);
}

/** Cursor distance in screen px to a normalized point (matches visible vertex). */
function distClientToPctPoint(clientX,clientY,pctX,pctY,plateRect){
  if(!plateRect?.width)return Infinity;
  const px=plateRect.left+(pctX/100)*plateRect.width;
  const py=plateRect.top+(pctY/100)*plateRect.height;
  return Math.hypot(clientX-px,clientY-py);
}

const SNAP_CLOSE_PX=32;

/** Circle radius in viewBox 0–100 units so on-screen size ≈ px (plate may be non-square; use max edge). */
function viewBoxRFromPx(px,plateRect){
  if(!plateRect?.width||!plateRect?.height)return 0.3;
  const m=Math.max(plateRect.width,plateRect.height);
  return(px/m)*100;
}

function hitVertexHandle(px,py,g,thresholdPct){
  if(!g)return null;
  if(g.kind==='rect'){
    const{x,y,w,h}=g;
    const corners=[
      ['nw',x,y],
      ['ne',x+w,y],
      ['sw',x,y+h],
      ['se',x+w,y+h],
    ];
    for(const[c,cx,cy]of corners){
      if(Math.hypot(px-cx,py-cy)<=thresholdPct)return{type:'rect',corner:c};
    }
    return null;
  }
  if(g.kind==='poly'&&g.points?.length){
    for(let i=0;i<g.points.length;i++){
      const[cx,cy]=g.points[i];
      if(Math.hypot(px-cx,py-cy)<=thresholdPct)return{type:'poly',index:i};
    }
  }
  return null;
}

function rectFromCorners(x,y,w,h){
  let nx=x,ny=y,nw=w,nh=h;
  if(nw<0){nx+=nw;nw=-nw}
  if(nh<0){ny+=nh;nh=-nh}
  if(nw<0.25||nh<0.25)return null;
  return{kind:'rect',x:nx,y:ny,w:nw,h:nh};
}

function dragRectCorner(corner,px,py,g){
  const{x,y,w,h}=g;
  const right=x+w,bottom=y+h;
  if(corner==='nw')return rectFromCorners(px,py,right-px,bottom-py);
  if(corner==='ne')return rectFromCorners(x,py,px-x,bottom-py);
  if(corner==='sw')return rectFromCorners(px,y,right-px,py-y);
  if(corner==='se')return rectFromCorners(x,y,px-x,py-y);
  return g;
}

export default function ZoneSetupPage({tab,canEdit,isAdmin}){
  const typeTab=['groundworks','internals',PROJECT_PROGRAMME_TAB].includes(tab)?tab:'groundworks';
  const[drawings,setDrawings]=useState([]);
  const[selDraw,setSelDraw]=useState(null);
  const[drawData,setDrawData]=useState(null);
  const[zones,setZones]=useState([]);
  const[activities,setActivities]=useState([]);
  const[templates,setTemplates]=useState([]);
  const[selTemplate,setSelTemplate]=useState('');
  const[tool,setTool]=useState('select');
  const[rectDraft,setRectDraft]=useState(null);
  const[polyPts,setPolyPts]=useState([]);
  const[polyHover,setPolyHover]=useState(null);
  const[selectedId,setSelectedId]=useState(null);
  const[zName,setZName]=useState('');
  const[zTower,setZTower]=useState('T2');
  const[draftZoneActs,setDraftZoneActs]=useState([]);
  const[layerFilterActId,setLayerFilterActId]=useState(null);
  const[addActPick,setAddActPick]=useState('');
  const[uploadErr,setUploadErr]=useState('');
  const viewportRef=useRef(null);
  const plateRef=useRef(null);
  const zoneNameInputRef=useRef(null);
  const fileInputRef=useRef(null);
  const dragging=useRef(false);
  const spaceDown=useRef(false);
  const panDrag=useRef(null);
  const pinchRef=useRef(null);
  const handleDragRef=useRef(null);
  const moveHandlerRef=useRef(()=>{});
  const upHandlerRef=useRef(()=>{});
  const toolRef=useRef('select');
  const[plateFit,setPlateFit]=useState({w:400,h:300});
  const[view,setView]=useState({scale:1,tx:0,ty:0});
  const[panning,setPanning]=useState(false);
  const[focusZoneEditorNonce,setFocusZoneEditorNonce]=useState(0);

  const filteredActs=activities.filter(a=>a.type===typeTab);
  const tabTemplates=(templates||[]).filter(t=>t.tab===tab);
  const nameToAct=useMemo(()=>new Map(filteredActs.map(a=>[a.name,a])),[filteredActs]);
  const drawingActivityStrip=useMemo(()=>{
    const seen=new Map();
    for(const z of zones){
      for(const a of sortZoneActs(z)){
        if(!seen.has(a.activity_id))seen.set(a.activity_id,{activity_id:a.activity_id,name:a.name});
      }
    }
    return[...seen.values()];
  },[zones]);
  const selectedZone=useMemo(()=>zones.find(z=>sameZoneId(z.id,selectedId)),[zones,selectedId]);

  useEffect(()=>{toolRef.current=tool},[tool]);

  const reloadDrawings=useCallback(()=>{
    api.getDrawings().then(d=>{
      setDrawings(d||[]);
      const f=(d||[]).filter(x=>x.tab===tab);
      setSelDraw((p)=>{
        const saved=readSavedDrawingId(tab,f);
        if(saved!=null)return saved;
        if(p&&f.some(x=>x.id===p))return p;
        return f.length?f[0].id:null;
      });
    });
  },[tab]);

  useEffect(()=>{reloadDrawings()},[reloadDrawings]);
  useEffect(()=>{api.getActivities().then(a=>setActivities(a||[]))},[]);
  useEffect(()=>{api.getTemplates().then(t=>setTemplates(t||[]))},[tab]);
  useEffect(()=>{
    if(!selDraw){setDrawData(null);setZones([]);return}
    api.getDrawing(selDraw).then(d=>setDrawData(d));
    api.getZonesForDrawing(selDraw).then(z=>setZones(z||[]));
  },[selDraw]);

  useEffect(()=>{
    if(selectedId!=null){
      const z=zones.find(x=>sameZoneId(x.id,selectedId));
      if(z){
        setZName(z.name||'');
        setZTower(z.tower||'T2');
      }
      return;
    }
    const draftingPoly=tool==='poly'&&polyPts.length>0;
    const draftingRect=Boolean(rectDraft);
    if(draftingPoly||draftingRect)return;
    setZName('');
    setZTower('T2');
  },[selectedId,zones,tool,polyPts.length,rectDraft]);

  const imgW=drawData?.width||1;
  const imgH=drawData?.height||1;

  useEffect(()=>{
    const el=viewportRef.current;
    if(!el)return;
    const ro=new ResizeObserver(()=>{
      const r=el.getBoundingClientRect();
      setPlateFit(fitPlate(r.width,r.height,imgW,imgH));
    });
    ro.observe(el);
    const r=el.getBoundingClientRect();
    setPlateFit(fitPlate(r.width,r.height,imgW,imgH));
    return()=>ro.disconnect();
  },[imgW,imgH,drawData?.image_data]);

  useEffect(()=>{
    if(focusZoneEditorNonce===0)return;
    const t=window.setTimeout(()=>{
      const el=zoneNameInputRef.current;
      if(el&&!el.disabled){el.focus();if(canEdit)el.select();}
    },0);
    return()=>window.clearTimeout(t);
  },[focusZoneEditorNonce,canEdit]);

  function cancelDraft(){
    setRectDraft(null);setPolyPts([]);setPolyHover(null);setDraftZoneActs([]);dragging.current=false;
  }

  useEffect(()=>{
    function onKeyDown(e){
      if(e.key==='Escape'){
        setTool('select');
        cancelDraft();
        handleDragRef.current=null;
        return;
      }
      if(e.code!=='Space'||e.repeat)return;
      if(['INPUT','SELECT','TEXTAREA'].includes(e.target?.tagName))return;
      if(viewportRef.current&&(e.target===viewportRef.current||viewportRef.current.contains(e.target))){
        e.preventDefault();
        spaceDown.current=true;
      }
    }
    function onKeyUp(e){
      if(e.code==='Space')spaceDown.current=false;
    }
    window.addEventListener('keydown',onKeyDown);
    window.addEventListener('keyup',onKeyUp);
    return()=>{window.removeEventListener('keydown',onKeyDown);window.removeEventListener('keyup',onKeyUp)};
  },[]);

  const applyWheelZoom=useCallback((e)=>{
    e.preventDefault();
    if(!viewportRef.current)return;
    const vr=viewportRef.current.getBoundingClientRect();
    const mx=e.clientX-vr.left;
    const my=e.clientY-vr.top;
    const delta=e.deltaY>0?-0.1:0.1;
    setView(v=>{
      const nextScale=clampScale(v.scale+delta);
      const cx=(mx-v.tx)/v.scale;
      const cy=(my-v.ty)/v.scale;
      return{scale:nextScale,tx:mx-cx*nextScale,ty:my-cy*nextScale};
    });
  },[]);

  useEffect(()=>{
    const vp=viewportRef.current;
    if(!vp||!drawData?.image_data)return;
    const opts={passive:false};
    const w=e=>applyWheelZoom(e);
    vp.addEventListener('wheel',w,opts);
    return()=>vp.removeEventListener('wheel',w,opts);
  },[drawData?.image_data,applyWheelZoom]);

  useEffect(()=>{
    const vp=viewportRef.current;
    if(!vp||!drawData?.image_data)return;
    const tm=e=>{
      if(e.touches.length===2)pinchRef.current&&e.preventDefault();
    };
    vp.addEventListener('touchmove',tm,{passive:false});
    return()=>vp.removeEventListener('touchmove',tm);
  },[drawData?.image_data]);

  function resetView(){
    setView({scale:1,tx:0,ty:0});
  }

  function zoomBy(delta){
    if(!viewportRef.current)return;
    const vr=viewportRef.current.getBoundingClientRect();
    const mx=vr.width/2,my=vr.height/2;
    setView(v=>{
      const nextScale=clampScale(v.scale+delta);
      const cx=(mx-v.tx)/v.scale;
      const cy=(my-v.ty)/v.scale;
      return{scale:nextScale,tx:mx-cx*nextScale,ty:my-cy*nextScale};
    });
  }

  const pendingRect=rectDraft&&Math.abs(rectDraft.w)>=0.5&&Math.abs(rectDraft.h)>=0.5;
  const showSidebar=Boolean(drawData?.image_data&&(pendingRect||(tool==='poly'&&polyPts.length>0)||selectedId));
  const hasFloorPlan=Boolean(drawData?.image_data);

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
      if(r?.ok){const nid=Number(r.id);writeSavedDrawingId(tab,nid);reloadDrawings();setSelDraw(nid)}
      else setUploadErr(typeof r?.error==='string'?r.error:'Upload failed.');
    }catch(err){
      setUploadErr(err?.message||'Upload failed.');
    }
  }

  function onMouseDownViewport(e){
    if(!plateRef.current){
      if(e.button===1)e.preventDefault();
      return;
    }
    const plate=plateRef.current;
    const[pctX,pctY]=clientToPct(e.clientX,e.clientY,plate);
    const pr=plate.getBoundingClientRect();
    const thresholdPct=(10/Math.max(pr.width,1))*100;

    if(e.button===1){e.preventDefault();panDrag.current={lastX:e.clientX,lastY:e.clientY,touch:false};setPanning(true);return}
    if(spaceDown.current&&e.button===0){e.preventDefault();panDrag.current={lastX:e.clientX,lastY:e.clientY,touch:false};setPanning(true);return}
    if(tool==='pan'&&e.button===0&&drawData?.image_data){
      e.preventDefault();
      panDrag.current={lastX:e.clientX,lastY:e.clientY,touch:false};
      setPanning(true);
      return;
    }

    if(!drawData?.image_data)return;

    if(canEdit&&tool==='select'&&selectedId!=null){
      const z=zones.find(x=>sameZoneId(x.id,selectedId));
      if(z){
        const g=parseZoneGeometry(z);
        const hit=hitVertexHandle(pctX,pctY,g,thresholdPct);
        if(hit){
          e.preventDefault();
          handleDragRef.current={zoneId:Number(selectedId),...hit};
          return;
        }
      }
    }

    if(tool==='select'){
      const hitZ=findZoneAtPct(zones,pctX,pctY);
      if(hitZ){setSelectedId(Number(hitZ.id));return}
      setSelectedId(null);
      return;
    }

    if(tool==='pan')return;

    if(!canEdit)return;

    if(tool==='rect'){
      e.preventDefault();
      const hitZ=findZoneAtPct(zones,pctX,pctY);
      if(hitZ){
        setTool('select');
        setSelectedId(Number(hitZ.id));
        return;
      }
      dragging.current=true;
      setRectDraft({x:pctX,y:pctY,w:0,h:0});
      setSelectedId(null);
      return;
    }
    if(tool==='poly'){
      e.preventDefault();
      if(polyPts.length===0){
        const hitZ=findZoneAtPct(zones,pctX,pctY);
        if(hitZ){
          setTool('select');
          setSelectedId(Number(hitZ.id));
          return;
        }
      }
      if(polyPts.length>=3&&polyPts[0]){
        const [fx,fy]=polyPts[0];
        if(distClientToPctPoint(e.clientX,e.clientY,fx,fy,pr)<=SNAP_CLOSE_PX){
          void commitPolygonZone();
          return;
        }
      }
      setPolyPts(p=>[...p,[pctX,pctY]]);
      setSelectedId(null);
    }
  }

  function onDoubleClickViewport(e){
    e.preventDefault();
    if(!plateRef.current||!drawData?.image_data)return;
    if(tool==='rect'||tool==='poly')return;
    const plate=plateRef.current;
    const[pctX,pctY]=clientToPct(e.clientX,e.clientY,plate);
    for(let i=zones.length-1;i>=0;i--){
      const zz=zones[i],g=parseZoneGeometry(zz);
      if(pointInGeom(pctX,pctY,g)){
        setTool('select');
        setSelectedId(Number(zz.id));
        setFocusZoneEditorNonce(n=>n+1);
        return;
      }
    }
  }

  function onMouseMoveViewport(e){
    const plate=plateRef.current;
    if(!plate)return;
    const[pctX,pctY]=clientToPct(e.clientX,e.clientY,plate);

    if(tool==='poly')setPolyHover([pctX,pctY]);

    if(panDrag.current){
      const dx=e.clientX-panDrag.current.lastX;
      const dy=e.clientY-panDrag.current.lastY;
      panDrag.current.lastX=e.clientX;
      panDrag.current.lastY=e.clientY;
      setView(v=>({...v,tx:v.tx+dx,ty:v.ty+dy}));
      return;
    }

    const hd=handleDragRef.current;
    if(hd&&canEdit){
      if(hd.type==='rect'){
        setZones(zs=>zs.map(z=>{
          if(z.id!==hd.zoneId)return z;
          const g=parseZoneGeometry(z);
          const ng=dragRectCorner(hd.corner,pctX,pctY,g);
          if(!ng||ng.kind!=='rect')return z;
          return{...z,geometry:JSON.stringify(ng)};
        }));
        Object.assign(hd,{geomDirty:true});
      }else if(hd.type==='poly'){
        setZones(zs=>zs.map(z=>{
          if(z.id!==hd.zoneId)return z;
          const g=parseZoneGeometry(z);
          if(g.kind!=='poly'||!g.points)return z;
          const pts=g.points.map((p,i)=>i===hd.index?[pctX,pctY]:p);
          return{...z,geometry:JSON.stringify({...g,points:pts})};
        }));
        Object.assign(hd,{geomDirty:true});
      }
      return;
    }

    if(tool!=='rect'||!dragging.current||!rectDraft)return;
    setRectDraft(d=>({...d,w:pctX-d.x,h:pctY-d.y}));
  }

  function onMouseUpViewport(){
    if(panDrag.current){
      panDrag.current=null;
      setPanning(false);
      return;
    }
    const hd=handleDragRef.current;
    if(hd?.geomDirty&&selDraw){
      const z=zones.find(x=>sameZoneId(x.id,hd.zoneId));
      if(z){
        const g=parseZoneGeometry(z);
        api.updateZone(Number(hd.zoneId),{geometry:g}).then((r)=>{
          if(r&&typeof r==='object'&&r.error)setUploadErr(String(r.error));
          else void api.getZonesForDrawing(selDraw).then(setZones);
        });
      }
      handleDragRef.current=null;
      return;
    }
    handleDragRef.current=null;

    if(tool!=='rect')return;
    dragging.current=false;
    if(!rectDraft)return;
    let z={...rectDraft};
    if(z.w<0){z.x+=z.w;z.w=-z.w}
    if(z.h<0){z.y+=z.h;z.h=-z.h}
    if(z.w<0.5||z.h<0.5){setRectDraft(null);return}
    setRectDraft(z);
  }

  function onMouseLeaveViewport(){
    if(tool==='rect')dragging.current=false;
    setPolyHover(null);
  }

  moveHandlerRef.current=onMouseMoveViewport;
  upHandlerRef.current=onMouseUpViewport;

  useEffect(()=>{
    function mm(e){moveHandlerRef.current(e)}
    function mu(){upHandlerRef.current()}
    window.addEventListener('mousemove',mm);
    window.addEventListener('mouseup',mu);
    return()=>{window.removeEventListener('mousemove',mm);window.removeEventListener('mouseup',mu)};
  },[]);

  async function saveNewZone(geometry){
    if(!canEdit||!selDraw)return;
    const name=(zName||'').trim()||'New zone';
    const tower=(zTower||'').trim()||'T2';
    const actPayload=draftZoneActs.length?toPutPayload(draftZoneActs):undefined;
    try{
      const out=await api.addZone(selDraw,name,tower,geometry,actPayload);
      if(out&&typeof out==='object'&&out.error){
        setUploadErr(String(out.error));
        return;
      }
      setZones(await api.getZonesForDrawing(selDraw)||[]);
      cancelDraft();
      setTool('select');
      setSelTemplate('');
      setZName('');
      setZTower('T2');
      setUploadErr('');
    }catch(err){
      setUploadErr(err?.message||'Could not save zone.');
    }
  }

  async function saveEditZone(){
    if(!canEdit||selectedId==null)return;
    const zid=Number(selectedId);
    if(!Number.isFinite(zid))return;
    const z=zones.find(x=>sameZoneId(x.id,zid));
    if(!z)return;
    const g=parseZoneGeometry(z);
    setUploadErr('');
    const r=await api.updateZone(zid,{name:zName.trim(),tower:zTower.trim(),geometry:g});
    if(r&&typeof r==='object'&&r.error){
      setUploadErr(String(r.error));
      return;
    }
    setZones(await api.getZonesForDrawing(selDraw)||[]);
  }

  async function persistSelectedZoneActs(rows){
    if(!canEdit||selectedId==null)return;
    const zid=Number(selectedId);
    if(!Number.isFinite(zid))return;
    setUploadErr('');
    const r=await api.putZoneActivities(zid,toPutPayload(rows));
    if(r&&typeof r==='object'&&r.error){
      setUploadErr(String(r.error));
      return;
    }
    setZones(await api.getZonesForDrawing(selDraw)||[]);
  }

  async function removeLinkedActivity(activityId){
    if(!canEdit||selectedId==null)return;
    const zid=Number(selectedId);
    if(!Number.isFinite(zid))return;
    setUploadErr('');
    const r=await api.deleteZoneActivity(zid,activityId);
    if(r&&typeof r==='object'&&r.error){
      setUploadErr(String(r.error));
      return;
    }
    setZones(await api.getZonesForDrawing(selDraw)||[]);
  }

  async function appendLinkedActivity(){
    if(!canEdit||selectedId==null||!addActPick)return;
    const zid=Number(selectedId);
    if(!Number.isFinite(zid))return;
    setUploadErr('');
    const r=await api.addZoneActivity(zid,{activity_id:Number(addActPick)});
    if(r&&typeof r==='object'&&r.error){
      setUploadErr(String(r.error));
      return;
    }
    setAddActPick('');
    setZones(await api.getZonesForDrawing(selDraw)||[]);
  }

  async function moveLinkedActivity(index, dir){
    if(!selectedZone)return;
    const sorted=sortZoneActs(selectedZone);
    const j=index+dir;
    if(j<0||j>=sorted.length)return;
    const next=[...sorted];
    const t=next[index];next[index]=next[j];next[j]=t;
    await persistSelectedZoneActs(next);
  }

  async function updateLinkedDuration(index, raw){
    if(!selectedZone)return;
    const sorted=sortZoneActs(selectedZone);
    const n=Number(raw);
    const dur=Number.isFinite(n)&&n>0?Math.floor(n):1;
    const next=sorted.map((r,i)=>(i===index?{...r,duration_days:dur}:r));
    await persistSelectedZoneActs(next);
  }

  function appendDraftActivity(){
    if(!addActPick)return;
    const a=filteredActs.find(x=>String(x.id)===addActPick);
    if(!a)return;
    if(draftZoneActs.some(d=>Number(d.activity_id)===Number(a.id)))return;
    setDraftZoneActs((d)=>[
      ...d,
      {
        activity_id:a.id,
        name:a.name,
        sequence_order:d.length,
        duration_days:1,
        start_date:null,
      },
    ]);
    setAddActPick('');
  }

  async function removeZone(){
    if(!canEdit||selectedId==null)return;
    const zid=Number(selectedId);
    if(!Number.isFinite(zid))return;
    setUploadErr('');
    const r=await api.deleteZone(zid);
    if(r&&typeof r==='object'&&r.error){
      setUploadErr(String(r.error));
      return;
    }
    setSelectedId(null);
    setZones(await api.getZonesForDrawing(selDraw)||[]);
  }

  async function removeDrawing(){
    if(!isAdmin||!selDraw)return;
    if(!window.confirm('Delete this drawing and all its zones and programme links?'))return;
    await api.deleteDrawing(selDraw);
    setSelectedId(null);setSelDraw(null);reloadDrawings();
  }

  async function commitPolygonZone(){
    if(polyPts.length<3)return;
    const geometry={kind:'poly',points:polyPts.map(p=>[p[0],p[1]])};
    await saveNewZone(geometry);
  }

  function finishPolygon(){
    void commitPolygonZone();
  }

  async function applySelectedTemplateTowerZone(){
    const t=tabTemplates.find(x=>String(x.id)===selTemplate);
    if(!t)return;
    if(t.tower)setZTower(String(t.tower));
    if(t.zone_name)setZName(t.zone_name);
    const built=buildActivitiesFromTemplate(t,nameToAct);
    if(!built.length)return;
    if(selectedId!=null){
      if(!canEdit)return;
      const zid=Number(selectedId);
      if(!Number.isFinite(zid))return;
      setUploadErr('');
      const r=await api.putZoneActivities(zid,toPutPayload(built));
      if(r&&typeof r==='object'&&r.error){
        setUploadErr(String(r.error));
        return;
      }
      setZones(await api.getZonesForDrawing(selDraw)||[]);
    }else{
      setDraftZoneActs(built);
    }
  }

  const zoomBtnStyle={...S.btn,padding:'6px 10px',fontSize:14,fontWeight:700,minWidth:36,lineHeight:1};

  let canvasCursor='default';
  if(panning||(spaceDown.current&&panDrag.current))canvasCursor='grabbing';
  else if(tool==='pan'||spaceDown.current)canvasCursor='grab';
  else if(tool==='rect'||tool==='poly')canvasCursor='crosshair';

  const plateW=plateFit.w;
  const plateH=plateFit.h;

  const prSnap=plateRef.current?.getBoundingClientRect();
  const snapHoverClose=Boolean(
    polyHover&&polyPts.length>=3&&polyPts[0]&&prSnap?.width&&
    distPctAsPx(polyHover[0],polyHover[1],polyPts[0][0],polyPts[0][1],prSnap)<=SNAP_CLOSE_PX
  );
  const handleR=viewBoxRFromPx(5,prSnap);
  const rPolyDot=viewBoxRFromPx(2.5,prSnap);
  const rPolyFirst=viewBoxRFromPx(3.5,prSnap);
  const rSnapRing=viewBoxRFromPx(12,prSnap);

  const {scale,tx,ty}=view;

  return(
    <div style={{flex:1,display:'flex',flexDirection:'column',overflow:'hidden',background:T.bg,minHeight:0}}>
      <div className="app-page-header" style={{display:'flex',gap:8,flexWrap:'wrap',alignItems:'center'}}>
        {drawings.filter(d=>d.tab===tab).length>0&&(
          <select value={selDraw||''} onChange={e=>{const id=Number(e.target.value);writeSavedDrawingId(tab,id);setSelDraw(id)}} style={{...S.input,width:'auto',fontSize:12,padding:'6px 10px'}}>
            {drawings.filter(d=>d.tab===tab).map(d=><option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        )}
        {canEdit&&<label style={{...S.btn,padding:'6px 12px',fontSize:11,cursor:'pointer'}}>Upload plan<input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/*,application/pdf,.pdf" onChange={handleUpload} style={{display:'none'}}/></label>}
        {drawData?.image_data&&<>
          <button type="button" title="Select zones" onClick={()=>{setTool('select')}} style={{...S.btn,...(tool==='select'?S.btnAct:{}),padding:'6px 10px',fontSize:11}}>Select</button>
          <button type="button" title="Drag to pan the plan" onClick={()=>{setTool('pan')}} style={{...S.btn,...(tool==='pan'?S.btnAct:{}),padding:'6px 10px',fontSize:11}}>Pan</button>
        </>}
        {canEdit&&<>
          {(['rect','poly']).map(t=><button key={t} type="button" onClick={()=>{setTool(t);cancelDraft()}} style={{...S.btn,...(tool===t?S.btnAct:{}),padding:'6px 10px',fontSize:11,textTransform:'capitalize'}}>{t==='poly'?'Polygon':t}</button>)}
          {tool==='poly'&&polyPts.length>0&&<>
            <button type="button" onClick={finishPolygon} disabled={polyPts.length<3} style={{...S.btn,...S.btnPrimary,padding:'6px 10px',fontSize:11}}>Finish polygon</button>
            <button type="button" onClick={()=>setPolyPts([])} style={{...S.btn,padding:'6px 10px',fontSize:11}}>Clear</button>
          </>}
        </>}
        {isAdmin&&selDraw&&<button type="button" onClick={removeDrawing} style={{...S.btn,...S.btnDanger,padding:'6px 10px',fontSize:11}}>Delete drawing</button>}
      </div>
      {uploadErr&&(
        <div style={{padding:'8px 12px',fontSize:12,color:'#c0392b',background:'rgba(231,76,60,0.08)',borderBottom:`1px solid ${T.hairline}`,display:'flex',justifyContent:'space-between',alignItems:'center',gap:10}}>
          <span>{uploadErr}</span>
          <button type="button" onClick={()=>setUploadErr('')} style={{...S.btn,padding:'4px 10px',fontSize:11,flexShrink:0}}>Dismiss</button>
        </div>
      )}
      <div style={{padding:'8px 12px',fontSize:11,color:T.muted,lineHeight:1.45,borderBottom:`1px solid ${T.hairline}`,background:'rgba(66,133,244,0.05)'}}>
        <strong style={{color:T.text}}>Zone Setup</strong> — scroll to zoom · <strong>Pan</strong> tool or middle-click drag or Space+drag to pan · <strong>double-click a zone</strong> to edit in the panel · Esc cancels drawing
      </div>

      {drawData?.image_data&&drawingActivityStrip.length>0&&(
        <div style={{display:'flex',alignItems:'center',gap:8,padding:'6px 12px',borderBottom:`1px solid ${T.hairline}`,background:T.surface,overflowX:'auto',flexShrink:0,flexWrap:'nowrap'}}>
          <span style={{fontSize:10,color:T.muted,flexShrink:0,fontWeight:600}}>Activity layers</span>
          <button type="button" onClick={()=>setLayerFilterActId(null)} style={{...S.btn,padding:'4px 10px',fontSize:10,flexShrink:0,whiteSpace:'nowrap',...(layerFilterActId==null?S.btnAct:{})}} title="Colour zones by first activity in sequence">Default</button>
          {drawingActivityStrip.map((a)=>(
            <button key={a.activity_id} type="button" onClick={()=>setLayerFilterActId(Number(layerFilterActId)===Number(a.activity_id)?null:a.activity_id)} style={{...S.btn,padding:'4px 10px',fontSize:10,whiteSpace:'nowrap',flexShrink:0,maxWidth:220,overflow:'hidden',textOverflow:'ellipsis',...(Number(layerFilterActId)===Number(a.activity_id)?S.btnAct:{})}} title={a.name}>{a.name}</button>
          ))}
        </div>
      )}

      <div style={{flex:1,display:'flex',flexDirection:'row',minHeight:0,overflow:'hidden'}}>
        <div
          ref={viewportRef}
          tabIndex={-1}
          style={{flex:1,minWidth:0,position:'relative',background:'#e8e8ec',overflow:'hidden',cursor:canvasCursor}}
          onMouseDown={onMouseDownViewport}
          onDoubleClick={onDoubleClickViewport}
          onMouseMove={e=>tool==='poly'&&setPolyHover(clientToPct(e.clientX,e.clientY,plateRef.current))}
          onMouseLeave={onMouseLeaveViewport}
          onTouchStart={e=>{
            if(toolRef.current==='pan'&&e.touches.length===1&&drawData?.image_data){
              const t=e.touches[0];
              panDrag.current={lastX:t.clientX,lastY:t.clientY,touch:true};
              setPanning(true);
              return;
            }
            if(e.touches.length===2&&viewportRef.current){
              const[t1,t2]=[e.touches[0],e.touches[1]];
              pinchRef.current={
                dist:touchDistance(t1,t2),
                view0:{...view},
                mid:touchMidpoint(t1,t2,viewportRef.current),
              };
            }
          }}
          onTouchMove={e=>{
            if(panDrag.current?.touch&&e.touches.length>=1){
              const t=e.touches[0];
              const dx=t.clientX-panDrag.current.lastX;
              const dy=t.clientY-panDrag.current.lastY;
              panDrag.current.lastX=t.clientX;
              panDrag.current.lastY=t.clientY;
              setView(v=>({...v,tx:v.tx+dx,ty:v.ty+dy}));
              e.preventDefault();
              return;
            }
            if(e.touches.length===2&&pinchRef.current&&viewportRef.current){
              const[t1,t2]=[e.touches[0],e.touches[1]];
              const newDist=touchDistance(t1,t2);
              const ratio=newDist/pinchRef.current.dist;
              const{v0,mid}=pinchRef.current;
              const nextScale=clampScale(v0.scale*ratio);
              const cx=(mid.x-v0.tx)/v0.scale;
              const cy=(mid.y-v0.ty)/v0.scale;
              setView({scale:nextScale,tx:mid.x-cx*nextScale,ty:mid.y-cy*nextScale});
            }
          }}
          onTouchEnd={()=>{
            if(panDrag.current?.touch){panDrag.current=null;setPanning(false)}
            pinchRef.current=null;
          }}
        >
          {drawData?.image_data?(
            <>
              <div style={{position:'absolute',top:10,right:10,zIndex:15,display:'flex',flexDirection:'column',gap:6,alignItems:'stretch'}}>
                <button type="button" style={zoomBtnStyle} onClick={e=>{e.stopPropagation();zoomBy(0.1)}}>+</button>
                <button type="button" style={zoomBtnStyle} onClick={e=>{e.stopPropagation();zoomBy(-0.1)}}>−</button>
                <button type="button" style={{...zoomBtnStyle,fontSize:11}} onClick={e=>{e.stopPropagation();resetView()}}>Reset</button>
              </div>
              <div
                ref={plateRef}
                style={{
                  position:'absolute',
                  left:0,
                  top:0,
                  width:plateW,
                  height:plateH,
                  transform:`translate(${tx}px,${ty}px) scale(${scale})`,
                  transformOrigin:'0 0',
                  willChange:'transform',
                }}
              >
                <img alt="Plan" draggable={false} src={`data:image/jpeg;base64,${drawData.image_data}`} style={{width:'100%',height:'100%',objectFit:'fill',display:'block',userSelect:'none',pointerEvents:'none'}}/>
                <svg style={{position:'absolute',left:0,top:0,width:'100%',height:'100%',pointerEvents:'none'}} viewBox="0 0 100 100" preserveAspectRatio="none">
                  {zones.map(z=>{
                    const g=parseZoneGeometry(z),sel=sameZoneId(z.id,selectedId);
                    const resolveAct=id=>{
                      const a=activities.find(x=>Number(x.id)===Number(id));
                      return a?.name||'';
                    };
                    const paint=zoneCanvasPaint(z,sel,layerFilterActId,resolveAct);
                    const {cx,cy}=zoneLabelAnchor(g,z);
                    const d=paint.disp;
                    const hasSub=Boolean(d.activityLine);
                    const title=`${z.tower||''} ${z.name||''}`.trim();
                    const subFill=d.muted||!d.colorName?'rgba(100,100,110,0.95)':actColor(d.colorName,0.93);
                    return<g key={z.id}>
                      {g.kind==='rect'?(
                        <rect x={g.x} y={g.y} width={g.w} height={g.h} fill={paint.fill} stroke={paint.stroke} strokeWidth={0.35}/>
                      ):(
                        <polygon points={svgPolygonPoints(g)} fill={paint.fill} stroke={paint.stroke} strokeWidth={0.35}/>
                      )}
                      <text x={cx} y={cy+(hasSub?-0.95:0)} textAnchor="middle" dominantBaseline="middle" fill="rgba(26,26,46,0.94)" fontSize={1.85} fontWeight={700} style={{pointerEvents:'none',textShadow:'0 0 4px #fff,0 0 8px #fff,0 0 2px #fff'}}>{title}</text>
                      {hasSub&&(
                        <text x={cx} y={cy+1.05} textAnchor="middle" dominantBaseline="middle" fill={subFill} fontSize={1.42} fontWeight={600} style={{pointerEvents:'none',textShadow:'0 0 3px #fff,0 0 6px #fff'}}>{d.activityLine}</text>
                      )}
                    </g>;
                  })}
                  {tool==='select'&&selectedId!=null&&(()=>{
                    const z=zones.find(x=>sameZoneId(x.id,selectedId));
                    if(!z)return null;
                    const g=parseZoneGeometry(z);
                    if(g.kind==='rect'){
                      const{x,y,w,h}=g,corners=[[x,y],[x+w,y],[x,y+h],[x+w,y+h]];
                      return corners.map((p,i)=><circle key={i} cx={p[0]} cy={p[1]} r={handleR} fill="rgba(66,133,244,0.95)" stroke="#fff" strokeWidth={0.15}/>);
                    }
                    if(g.kind==='poly'&&g.points)return g.points.map((p,i)=><circle key={i} cx={p[0]} cy={p[1]} r={handleR} fill="rgba(66,133,244,0.95)" stroke="#fff" strokeWidth={0.15}/>);
                    return null;
                  })()}
                  {tool==='poly'&&polyPts.length>0&&(
                    <>
                      <polyline points={polyPts.map(p=>`${p[0]},${p[1]}`).join(' ')} fill="none" stroke="rgba(66,133,244,0.9)" strokeWidth={0.28}/>
                      {polyPts.map((p,i)=>{
                        const r=i===0&&polyPts.length>=3?rPolyFirst:rPolyDot;
                        const fill=i===0&&polyPts.length>=3?'rgba(46,178,96,0.92)':'rgba(66,133,244,0.88)';
                        const stroke=i===0&&polyPts.length>=3?'rgba(255,255,255,0.85)':'rgba(255,255,255,0.6)';
                        return<circle key={i} cx={p[0]} cy={p[1]} r={r} fill={fill} stroke={stroke} strokeWidth={0.12}/>;
                      })}
                      {polyHover&&polyPts.length>0&&(
                        <>
                          <line x1={polyPts[polyPts.length-1][0]} y1={polyPts[polyPts.length-1][1]} x2={polyHover[0]} y2={polyHover[1]} stroke="rgba(66,133,244,0.45)" strokeWidth={0.2} strokeDasharray="0.8 0.8"/>
                          {snapHoverClose&&(
                            <circle cx={polyPts[0][0]} cy={polyPts[0][1]} r={rSnapRing} fill="rgba(46,178,96,0.12)" stroke="rgba(46,178,96,0.85)" strokeWidth={0.15}/>
                          )}
                        </>
                      )}
                    </>
                  )}
                  {pendingRect&&rectDraft&&(
                    <rect x={Math.min(rectDraft.x,rectDraft.x+rectDraft.w)} y={Math.min(rectDraft.y,rectDraft.y+rectDraft.h)}
                      width={Math.abs(rectDraft.w)} height={Math.abs(rectDraft.h)} fill="rgba(66,133,244,0.12)" stroke="rgba(66,133,244,0.85)" strokeWidth={0.35}/>
                  )}
                </svg>
              </div>
            </>
          ):(
            <div style={{textAlign:'center',color:T.muted,padding:36,maxWidth:340,margin:'0 auto'}}>
              <div style={{fontSize:16,fontWeight:700,color:T.text,marginBottom:8}}>No floor plan yet</div>
              <div style={{fontSize:12,lineHeight:1.5,marginBottom:16}}>{canEdit?'Upload a drawing (image or PDF) to draw zones on the plan.':'Ask an editor to upload a plan so zones can be marked up.'}</div>
              {canEdit&&<button type="button" onClick={()=>fileInputRef.current?.click()} style={{...S.btn,...S.btnPrimary,padding:'12px 20px',fontSize:13,fontWeight:700}}>Upload floor plan</button>}
            </div>
          )}
        </div>

        {hasFloorPlan&&(
          <aside style={{
            width:252,
            flexShrink:0,
            borderLeft:'1px solid rgba(26,26,46,0.06)',
            background:'rgba(252,252,254,0.92)',
            overflowY:'auto',
            overflowX:'hidden',
            display:'flex',
            flexDirection:'column',
            minHeight:0,
            boxShadow:'inset 1px 0 0 rgba(255,255,255,0.7)',
          }}>
            {!showSidebar?(
              <div style={{padding:'16px 14px',display:'flex',flexDirection:'column',gap:8,justifyContent:'flex-start'}}>
                <span style={{fontSize:11,fontWeight:600,color:T.muted,letterSpacing:'0.02em'}}>Zone details</span>
                <span style={{fontSize:10,color:T.faint,lineHeight:1.45}}>Appear here when you select a zone or finish a shape. The map size stays fixed.</span>
              </div>
            ):(
            <div style={{padding:12,display:'flex',flexDirection:'column',gap:10}}>
            <div style={{fontSize:12,fontWeight:600,color:T.text,opacity:0.92}}>
              {pendingRect?'New rectangle zone':tool==='poly'&&polyPts.length>0?'New polygon zone':selectedId?'Selected zone':'Zone'}
            </div>
            {canEdit&&tabTemplates.length>0&&(
              <div>
                <label style={{fontSize:10,color:T.muted,display:'block',marginBottom:4}}>Sequence template (optional)</label>
                <select value={selTemplate} onChange={e=>setSelTemplate(e.target.value)} style={{...S.input,fontSize:12,width:'100%',marginBottom:6}}>
                  <option value="">— None —</option>
                  {tabTemplates.map(t=><option key={t.id} value={String(t.id)}>{t.name}</option>)}
                </select>
                {selTemplate&&<button type="button" style={{...S.btn,padding:'6px 10px',fontSize:11}} onClick={()=>void applySelectedTemplateTowerZone()}>Apply from template</button>}
                {selTemplate&&(()=>{
                  const t=tabTemplates.find(x=>String(x.id)===selTemplate);
                  if(!t)return null;
                  let acts=[],durs=[];
                  try{acts=JSON.parse(t.sequence)||[]}catch(_){}
                  try{durs=JSON.parse(t.durations)||[]}catch(_){}
                  return<div style={{marginTop:8,display:'flex',flexWrap:'wrap',gap:4}}>
                    {acts.map((a,i)=><span key={i} style={{...S.pill(a),fontSize:9}}>{a}{durs[i]?` (${durs[i]}d)`:''}</span>)}
                  </div>;
                })()}
              </div>
            )}
            <label style={{fontSize:9,color:T.faint,textTransform:'uppercase',letterSpacing:'0.06em'}}>Tower</label>
            <input value={zTower} onChange={e=>setZTower(e.target.value)} placeholder="Tower" disabled={!canEdit||(!pendingRect&&tool!=='poly'&&!selectedId)} style={{...S.input,fontSize:12,padding:'8px 10px',background:'rgba(255,255,255,0.75)',border:`1px solid rgba(26,26,46,0.08)`}}/>
            <label style={{fontSize:9,color:T.faint,textTransform:'uppercase',letterSpacing:'0.06em'}}>Zone name</label>
            <input ref={zoneNameInputRef} value={zName} onChange={e=>setZName(e.target.value)} placeholder="e.g. Pour 5" disabled={!canEdit||(!pendingRect&&tool!=='poly'&&!selectedId)} style={{...S.input,fontSize:12,padding:'8px 10px',background:'rgba(255,255,255,0.75)',border:`1px solid rgba(26,26,46,0.08)`}} autoFocus={Boolean(pendingRect||(tool==='poly'&&polyPts.length))}/>
            <label style={{fontSize:9,color:T.faint,textTransform:'uppercase',letterSpacing:'0.06em'}}>Activity layers</label>
            <div style={{fontSize:10,color:T.muted,lineHeight:1.4,marginBottom:6}}>Stack sequence (Ahead / Update colours). Reorder with arrows or apply a template.</div>
            {(()=>{
              const panelActs=selectedId?sortZoneActs(selectedZone):draftZoneActs;
              const showActEditor=canEdit&&(selectedId||pendingRect||(tool==='poly'&&polyPts.length>0));
              return<>
                {panelActs.length===0&&<div style={{fontSize:10,color:T.faint,marginBottom:4}}>No activities linked.</div>}
                <div style={{display:'flex',flexDirection:'column',gap:8}}>
                  {panelActs.map((row,i)=>{
                    const nm=row.name||(activities.find(x=>Number(x.id)===Number(row.activity_id))?.name)||'';
                    const list=panelActs;
                    return<div key={selectedId?`${row.id ?? row.activity_id}-${i}`:`draft-${row.activity_id}-${i}`} style={{display:'flex',alignItems:'center',gap:6,flexWrap:'wrap'}}>
                      <span style={{...S.pill(nm),flex:'1 1 120px',minWidth:0,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}} title={nm}>{nm}</span>
                      <span style={{fontSize:10,color:T.muted}}>—</span>
                      {selectedId?(
                        <input key={`dur-${selectedId}-${row.id ?? row.activity_id}-${row.duration_days}`} type="number" min={1} defaultValue={row.duration_days??1} style={{...S.input,width:52,padding:'4px 6px',fontSize:11}} onBlur={e=>{if(showActEditor)void updateLinkedDuration(i,e.target.value)}}/>
                      ):(
                        <input type="number" min={1} value={row.duration_days??1} onChange={e=>setDraftZoneActs(d=>d.map((x,j)=>j===i?{...x,duration_days:Math.max(1,Number(e.target.value)||1)}:x))} style={{...S.input,width:52,padding:'4px 6px',fontSize:11}}/>
                      )}
                      <span style={{fontSize:10,color:T.muted}}>d</span>
                      {showActEditor&&<>
                        <button type="button" disabled={i===0} onClick={()=>selectedId?void moveLinkedActivity(i,-1):setDraftZoneActs(d=>{if(i<1)return d;const n=[...d];[n[i-1],n[i]]=[n[i],n[i-1]];return n})} style={{...S.btn,padding:'2px 8px',fontSize:12,lineHeight:1}} aria-label="Move up">↑</button>
                        <button type="button" disabled={i===list.length-1} onClick={()=>selectedId?void moveLinkedActivity(i,1):setDraftZoneActs(d=>{if(i>=d.length-1)return d;const n=[...d];[n[i],n[i+1]]=[n[i+1],n[i]];return n})} style={{...S.btn,padding:'2px 8px',fontSize:12,lineHeight:1}} aria-label="Move down">↓</button>
                        <button type="button" onClick={()=>selectedId?void removeLinkedActivity(row.activity_id):setDraftZoneActs(d=>d.filter((_,j)=>j!==i))} style={{...S.btn,...S.btnDanger,padding:'2px 10px',fontSize:13,lineHeight:1}} title="Remove" aria-label="Remove">×</button>
                      </>}
                    </div>;
                  })}
                </div>
                {showActEditor&&(
                  <div style={{display:'flex',gap:6,marginTop:4,alignItems:'center'}}>
                    <select value={addActPick} onChange={e=>setAddActPick(e.target.value)} style={{...S.input,flex:1,fontSize:12,padding:'6px 8px'}}>
                      <option value="">Choose activity…</option>
                      {filteredActs.filter(a=>!panelActs.some(x=>Number(x.activity_id)===Number(a.id))).map(a=><option key={a.id} value={String(a.id)}>{a.name}</option>)}
                    </select>
                    <button type="button" onClick={()=>selectedId?void appendLinkedActivity():appendDraftActivity()} disabled={!addActPick} style={{...S.btn,padding:'6px 10px',fontSize:11,flexShrink:0}}>Add activity</button>
                  </div>
                )}
              </>;
            })()}

            {canEdit&&pendingRect&&(
              <div style={{display:'flex',gap:8,flexWrap:'wrap',marginTop:4}}>
                <button type="button" onClick={()=>{
                  let z={...rectDraft};if(z.w<0){z.x+=z.w;z.w=-z.w}if(z.h<0){z.y+=z.h;z.h=-z.h};
                  saveNewZone({kind:'rect',x:z.x,y:z.y,w:z.w,h:z.h});
                }} style={{...S.btn,...S.btnPrimary,flex:1}}>Save zone</button>
                <button type="button" onClick={cancelDraft} style={S.btn}>Cancel</button>
              </div>
            )}
            {canEdit&&tool==='poly'&&polyPts.length>=3&&!pendingRect&&(
              <button type="button" onClick={finishPolygon} style={{...S.btn,...S.btnPrimary,width:'100%'}}>Save polygon zone</button>
            )}
            {canEdit&&selectedId!=null&&!pendingRect&&!(tool==='poly'&&polyPts.length>0)&&(
              <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
                <button type="button" onClick={()=>void saveEditZone()} style={{...S.btn,...S.btnPrimary,flex:1}}>Save changes</button>
                <button type="button" onClick={()=>void removeZone()} style={{...S.btn,...S.btnDanger,flex:1}}>Delete zone</button>
              </div>
            )}
            {!canEdit&&selectedId!=null&&(
              <p style={{fontSize:11,color:T.muted,margin:0,lineHeight:1.4}}>Viewer — switch to an editor account to change zones.</p>
            )}
            </div>
            )}
          </aside>
        )}
      </div>
    </div>
  );
}
