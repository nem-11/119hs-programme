import React,{useState,useEffect,useRef,useCallback,useMemo} from 'react';
import * as api from './api';
import {T,S} from './uiTheme';
import {parseZoneGeometry,svgPolygonPoints,pointInGeom} from './zoneGeom';
import {toHtmlDateInputValue,actColor,dateKey,PROJECT_PROGRAMME_TAB,drawingTabLabel} from './constants';
import {readSavedDrawingId,writeSavedDrawingId} from './drawingSelection';
import {
  buildRowsFromTargetEndDate,
  addCalendarDays,
  buildActivityLookup,
  targetEndParamsFromStartStage,
  interpretScheduleFromTargetResult,
  ANCHOR_METADATA_WARNING,
} from './programmeSchedule';
import ScheduleFromTargetModal from './ScheduleFromTargetModal';
import ProgrammeNlCommand from './ProgrammeNlCommand';
import PageHeader from './PageHeader';
import NonWorkingAnchorDateWarning from './NonWorkingAnchorDateWarning';

function sortZoneActs(z){
  return [...(z?.activities||[])].sort((a,b)=>(a.sequence_order||0)-(b.sequence_order||0));
}

function primaryZoneActivityName(z, idToName){
  const acts=sortZoneActs(z);
  if(acts.length)return acts[0].name;
  if(z.activity_id)return idToName(z.activity_id);
  return '';
}

function clientToPct(e,el){
  if(!el)return[0,0];
  const r=el.getBoundingClientRect();
  if(r.width<=0||r.height<=0)return[0,0];
  return[((e.clientX-r.left)/r.width)*100,((e.clientY-r.top)/r.height)*100];
}

const STATUSES=['planned','active','at_risk','on-hold','done'];

/** Tower then zone name, with numeric chunks sorted naturally (Pour 2 before Pour 10). */
function compareZones(a,b){
  const opt={numeric:true,sensitivity:'base'};
  const tw=String(a.tower||'').localeCompare(String(b.tower||''),undefined,opt);
  if(tw!==0)return tw;
  return String(a.name||'').localeCompare(String(b.name||''),undefined,opt);
}

const tableHead={
  display:'grid',
  gridTemplateColumns:'minmax(0,1.2fr) 88px 88px 72px 52px',
  gap:6,
  alignItems:'center',
  fontSize:9,
  fontWeight:700,
  color:T.faint,
  textTransform:'uppercase',
  letterSpacing:'0.05em',
  marginBottom:6,
};

const ppTableGrid={
  display:'grid',
  gridTemplateColumns:'32px minmax(52px,0.45fr) minmax(0,1.5fr) 88px 88px 64px 76px',
  gap:6,
  alignItems:'center',
};

const ppTableHead={
  ...ppTableGrid,
  fontSize:9,
  fontWeight:700,
  color:T.faint,
  textTransform:'uppercase',
  letterSpacing:'0.05em',
  marginBottom:6,
};

/** MS Project summary/milestone flags normalised to 0 or 1 (handles 0, 1, booleans, and common string values). */
function projectItemFlag(row,key){
  const v=row[key];
  if(v===true||v===1||v==='1'||v==='true'||v==='yes'||v==='Yes')return 1;
  return 0;
}

function projectTaskType(row){
  if(projectItemFlag(row,'is_summary')===1)return 'Summary';
  if(projectItemFlag(row,'is_milestone')===1)return 'Milestone';
  return 'Task';
}

/** Preview import table only — does not mutate parsedXmlTasks or xmlChecked. */
function filterPreviewTableRows(tasks,filterType){
  const mode=String(filterType||'all');
  if(mode==='milestones'){
    return tasks.filter((t)=>projectItemFlag(t,'is_milestone')===1);
  }
  if(mode==='tasks'){
    return tasks.filter(
      (t)=>projectItemFlag(t,'is_summary')===0&&projectItemFlag(t,'is_milestone')===0
    );
  }
  return tasks;
}

export default function ProgrammePage({tab,canEdit,onScheduleChanged,onGoToZoneSetup,zoneSetupAvailable=true,isAdmin=false}){
  const typeTab=['groundworks','internals',PROJECT_PROGRAMME_TAB].includes(tab)?tab:'groundworks';
  const[drawings,setDrawings]=useState([]);
  const[selDraw,setSelDraw]=useState(null);
  const[drawData,setDrawData]=useState(null);
  const[zones,setZones]=useState([]);
  const[activities,setActivities]=useState([]);
  const[templates,setTemplates]=useState([]);
  const[selectedId,setSelectedId]=useState(null);
  const[items,setItems]=useState([]);
  const[loadingItems,setLoadingItems]=useState(false);

  const[schedTpl,setSchedTpl]=useState('');
  const[startStageIdx,setStartStageIdx]=useState(0);
  const[anchorDate,setAnchorDate]=useState(()=>dateKey(new Date()));
  const[draftRows,setDraftRows]=useState([]);
  const[reviewMode,setReviewMode]=useState(false);
  const[showManual,setShowManual]=useState(false);
  const[manualNewExpanded,setManualNewExpanded]=useState(false);
  const[newActName,setNewActName]=useState('');
  const[newActType,setNewActType]=useState(typeTab);
  const[manualForm,setManualForm]=useState({activity_id:'',start_date:'',end_date:'',status:'planned',notes:''});
  const[drawingPlanItems,setDrawingPlanItems]=useState([]);
  const[shiftDays,setShiftDays]=useState(0);
  const[bulk,setBulk]=useState({});
  const[saving,setSaving]=useState(false);
  const[targetModalOpen,setTargetModalOpen]=useState(false);
  const[toast,setToast]=useState('');
  const[toastWarning,setToastWarning]=useState(false);

  const[xmlFile,setXmlFile]=useState(null);
  const[xmlParsing,setXmlParsing]=useState(false);
  const[xmlParseErr,setXmlParseErr]=useState('');
  const[parsedXmlTasks,setParsedXmlTasks]=useState([]);
  const[xmlChecked,setXmlChecked]=useState({});
  const[filterType,setFilterType]=useState('tasks');
  const[xmlConfirmMsg,setXmlConfirmMsg]=useState('');
  const[xmlConfirming,setXmlConfirming]=useState(false);
  const[projectItems,setProjectItems]=useState([]);
  const[loadingProjectItems,setLoadingProjectItems]=useState(false);
  const xmlInputRef=useRef(null);

  const wrapRef=useRef(null);

  const filteredActs=activities.filter(a=>a.type===typeTab);
  useEffect(()=>{setNewActType(typeTab)},[typeTab]);
  const selectedZone=zones.find(z=>z.id===selectedId);
  const tabDrawings=(drawings||[]).filter(d=>d.tab===tab);
  const tabTemplates=(templates||[]).filter(t=>t.tab===tab);
  const hasFloorPlan=Boolean(selDraw&&drawData?.image_data);

  const activityLookup=useMemo(()=>buildActivityLookup(filteredActs),[filteredActs]);
  const zonesSorted=useMemo(()=>[...zones].sort(compareZones),[zones]);

  const zonesCta=
    typeof onGoToZoneSetup==='function' ? (
      <button type="button" onClick={onGoToZoneSetup} style={{...S.btn,...S.btnPrimary,padding:'12px 20px',fontSize:13,fontWeight:700}}>
        Go to Zones setup →
      </button>
    ) : null;

  const canvasNoPlan=(
    <div style={{textAlign:'center',padding:32,maxWidth:400,margin:'0 auto'}}>
      <div style={{fontSize:16,fontWeight:700,color:T.text,marginBottom:8}}>No drawing for {drawingTabLabel(tab)}</div>
      <div style={{fontSize:12,color:T.muted,lineHeight:1.5,marginBottom:16}}>
        {tab===PROJECT_PROGRAMME_TAB
          ? (zoneSetupAvailable
              ? 'On Zones, upload a one-page programme PDF or any placeholder image, add logical rows (towers / packages / milestones) as zones, then schedule here. This scope feeds Plan alongside floor drawings.'
              : 'An administrator should upload a drawing for Project programme and define zones.')
          : (zoneSetupAvailable
              ? 'Upload a plan on Zones, mark zones on the drawing, then return here to link programme dates to each zone.'
              : 'An administrator must upload a floor plan and define zones before scheduling here. Use Plan to view the programme by zone.')}
      </div>
      {zonesCta}
    </div>
  );

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
  useEffect(()=>{api.getTemplates().then(t=>setTemplates(t||[]))},[]);

  const reloadProjectItems=useCallback(()=>{
    if(tab!==PROJECT_PROGRAMME_TAB)return;
    setLoadingProjectItems(true);
    api.getProjectProgrammeItems().then((rows)=>{
      setProjectItems(Array.isArray(rows)?rows:[]);
      setLoadingProjectItems(false);
    });
  },[tab]);

  useEffect(()=>{
    if(tab===PROJECT_PROGRAMME_TAB)reloadProjectItems();
  },[tab,reloadProjectItems]);

  const previewTableRows=useMemo(
    ()=>filterPreviewTableRows(parsedXmlTasks,filterType),
    [parsedXmlTasks,filterType]
  );

  const xmlStats=useMemo(()=>{
    const milestones=parsedXmlTasks.filter((t)=>projectItemFlag(t,'is_milestone')===1).length;
    const summary=parsedXmlTasks.filter((t)=>projectItemFlag(t,'is_summary')===1).length;
    const selected=parsedXmlTasks.filter((t)=>xmlChecked[t.uid]).length;
    return {
      milestones,
      summary,
      selected,
      total:parsedXmlTasks.length,
      visible:previewTableRows.length,
    };
  },[parsedXmlTasks,xmlChecked,previewTableRows]);

  useEffect(()=>{
    if(!selDraw){setDrawData(null);setZones([]);return}
    api.getDrawing(selDraw).then(d=>setDrawData(d));
    api.getZonesForDrawing(selDraw).then(z=>setZones(z||[]));
  },[selDraw]);

  useEffect(()=>{
    if(!selDraw){setDrawingPlanItems([]);return}
    let cancelled=false;
    (async()=>{
      const rows=await api.getProgrammeItemsByDrawing(selDraw);
      if(!cancelled)setDrawingPlanItems(Array.isArray(rows)?rows:[]);
    })();
    return()=>{cancelled=true};
  },[selDraw]);

  const primaryProgrammeNameByZone=useMemo(()=>{
    const byZ=new Map();
    for(const row of drawingPlanItems){
      const id=Number(row.zone_id);
      if(!Number.isFinite(id))continue;
      if(!byZ.has(id))byZ.set(id,[]);
      byZ.get(id).push(row);
    }
    const m=new Map();
    for(const[zid,rows]of byZ){
      rows.sort((a,b)=>String(a.start_date).localeCompare(String(b.start_date)));
      const n=rows[0]?.activity_name;
      if(n)m.set(zid,n);
    }
    return m;
  },[drawingPlanItems]);

  useEffect(()=>{
    setSchedTpl('');
    setStartStageIdx(0);
    setAnchorDate(dateKey(new Date()));
    setDraftRows([]);
    setReviewMode(false);
    setShowManual(false);
    setManualNewExpanded(false);
    setNewActName('');
    setManualForm({activity_id:'',start_date:'',end_date:'',status:'planned',notes:''});
    setTargetModalOpen(false);
    loadItemsForZone(selectedId);
  },[selectedId]);

  useEffect(()=>{
    setBulk((prev)=>{
      const next={};
      for(const z of zones){
        next[z.id]=prev[z.id]||{templateId:'',stageIdx:0,startDate:dateKey(new Date())};
      }
      return next;
    });
  },[zones]);

  async function loadItemsForZone(zid){
    if(!zid){setItems([]);return}
    setLoadingItems(true);
    const rows=await api.getProgrammeItemsByZone(zid);
    setItems(Array.isArray(rows)?rows:[]);
    setLoadingItems(false);
  }

  function activityName(id){
    const a=activities.find(x=>Number(x.id)===Number(id));
    return a?a.name:'';
  }

  const selectedTpl=tabTemplates.find(t=>String(t.id)===schedTpl);
  let tplSeq=[],tplDur=[];
  try{tplSeq=JSON.parse(selectedTpl?.sequence||'[]')}catch(_){}
  try{tplDur=JSON.parse(selectedTpl?.durations||'[]')}catch(_){}

  function runGenerate(){
    if(!schedTpl||!selectedTpl)return;
    if(items.length>0&&!window.confirm('Replace all existing programme rows for this zone with the generated schedule?'))return;
    const {anchorIndex,anchorActivityId,anchorEndDateKey}=targetEndParamsFromStartStage({
      sequence:tplSeq,
      durations:tplDur,
      startStageIndex:startStageIdx,
      startDateKey:anchorDate,
      activityLookup,
    });
    if(!anchorActivityId){
      window.alert(`Unknown activity at stage ${startStageIdx+1} — fix template or activity list.`);
      return;
    }
    const rows=buildRowsFromTargetEndDate({
      sequence:tplSeq,
      durations:tplDur,
      anchorIndex,
      anchorEndDateKey,
      activityLookup,
    });
    const missing=rows.filter(r=>!r.activity_id).map(r=>r.activity_name);
    if(missing.length){
      window.alert(`Unknown activities (add them in the database or fix template names): ${missing.join(', ')}`);
    }
    setDraftRows(rows);
    setReviewMode(true);
  }

  function showAnchorMetadataWarning(msg){
    const text=msg||ANCHOR_METADATA_WARNING;
    setToastWarning(true);
    setToast(text);
    window.setTimeout(()=>{
      setToast('');
      setToastWarning(false);
    },5000);
  }

  async function saveDraftRows(){
    if(!canEdit||!selectedId||draftRows.length===0||!schedTpl)return;
    if(draftRows.some(r=>!r.activity_id)){
      window.alert('Every row needs a matching activity. Fix or remove rows with missing activities.');
      return;
    }
    const {anchorActivityId,anchorEndDateKey}=targetEndParamsFromStartStage({
      sequence:tplSeq,
      durations:tplDur,
      startStageIndex:startStageIdx,
      startDateKey:anchorDate,
      activityLookup,
    });
    if(!anchorActivityId||!anchorEndDateKey){
      window.alert('Could not resolve anchor activity for this template stage.');
      return;
    }
    setSaving(true);
    try{
      const res=await api.scheduleZoneFromTarget(selectedId,{
        anchor_activity_id:Number(anchorActivityId),
        anchor_date:anchorEndDateKey,
        template_id:Number(schedTpl),
        programme_stage_idx:startStageIdx,
        programme_anchor_date:anchorDate,
        programme_anchor_activity_id:Number(anchorActivityId),
      });
      const outcome=interpretScheduleFromTargetResult(res);
      if(!outcome.ok){
        window.alert(outcome.hardError);
        return;
      }
      if(outcome.anchorWarning)showAnchorMetadataWarning(outcome.anchorWarning);
      if(onScheduleChanged)await onScheduleChanged();
      setReviewMode(false);
      setDraftRows([]);
      await loadItemsForZone(selectedId);
    }finally{
      setSaving(false);
    }
  }

  async function applyShift(){
    if(!canEdit||!selectedId)return;
    const delta=Number(shiftDays)||0;
    if(delta===0)return;
    const planned=items.filter(it=>it.status==='planned');
    if(planned.length===0)return;
    for(const it of planned){
      await api.updateProgrammeItem(it.id,{
        start_date:addCalendarDays(it.start_date,delta),
        end_date:addCalendarDays(it.end_date,delta),
      });
    }
    if(onScheduleChanged)await onScheduleChanged();
    setShiftDays(0);
    await loadItemsForZone(selectedId);
  }

  async function submitManual(e){
    e.preventDefault();
    if(!canEdit||!selectedId||!manualForm.activity_id||!manualForm.start_date||!manualForm.end_date)return;
    await api.createProgrammeItem(
      selectedId,
      Number(manualForm.activity_id),
      manualForm.start_date,
      manualForm.end_date,
      manualForm.status,
      manualForm.notes
    );
    if(onScheduleChanged)await onScheduleChanged();
    setManualForm({activity_id:'',start_date:'',end_date:'',status:'planned',notes:''});
    setShowManual(false);
    setManualNewExpanded(false);
    setNewActName('');
    await loadItemsForZone(selectedId);
    if(selDraw){
      const rows=await api.getProgrammeItemsByDrawing(selDraw);
      setDrawingPlanItems(Array.isArray(rows)?rows:[]);
    }
  }

  async function createAndSelectActivity(){
    if(!isAdmin)return;
    const name=String(newActName||'').trim();
    if(!name)return;
    const res=await api.createActivity(name,newActType);
    if(res&&typeof res==='object'&&res.error){
      window.alert(String(res.error));
      return;
    }
    const list=await api.getActivities();
    setActivities(list||[]);
    const id=res?.id;
    if(id!=null)setManualForm((f)=>({...f,activity_id:String(id)}));
    setNewActName('');
    setManualNewExpanded(false);
  }

  async function removeItem(id){
    if(!canEdit)return;
    await api.deleteProgrammeItem(id);
    if(onScheduleChanged)await onScheduleChanged();
    await loadItemsForZone(selectedId);
  }

  async function patchItem(id,patch){
    if(!canEdit)return;
    await api.updateProgrammeItem(id,patch);
    if(onScheduleChanged)await onScheduleChanged();
    await loadItemsForZone(selectedId);
  }

  async function generateAllZones(){
    if(!canEdit||zones.length===0)return;
    if(reviewMode&&draftRows.length>0&&!window.confirm('You have an unsaved preview for the selected zone. Continue with Generate all anyway?'))return;
    const todo=[...zones].filter(z=>{
      const b=bulk[z.id];
      return b?.templateId;
    }).sort(compareZones);
    if(todo.length===0){
      window.alert('Choose a template for at least one zone.');
      return;
    }
    if(!window.confirm(`Generate programme for ${todo.length} zone(s)? Existing programme rows for those zones will be replaced.`))return;
    setSaving(true);
    try{
      for(const z of todo){
        const b=bulk[z.id];
        const t=templates.find(x=>String(x.id)===b.templateId);
        if(!t)continue;
        let seq=[],dur=[];
        try{seq=JSON.parse(t.sequence||'[]')}catch(_){}
        try{dur=JSON.parse(t.durations||'[]')}catch(_){}
        const {anchorActivityId,anchorEndDateKey}=targetEndParamsFromStartStage({
          sequence:seq,
          durations:dur,
          startStageIndex:b.stageIdx,
          startDateKey:b.startDate||dateKey(new Date()),
          activityLookup,
        });
        if(!anchorActivityId||!anchorEndDateKey)continue;
        const res=await api.scheduleZoneFromTarget(z.id,{
          anchor_activity_id:Number(anchorActivityId),
          anchor_date:anchorEndDateKey,
          template_id:Number(b.templateId),
          programme_stage_idx:b.stageIdx??0,
          programme_anchor_date:b.startDate||dateKey(new Date()),
          programme_anchor_activity_id:Number(anchorActivityId),
        });
        const outcome=interpretScheduleFromTargetResult(res);
        if(!outcome.ok){
          window.alert(`${z.tower} ${z.name}: ${outcome.hardError}`);
          return;
        }
        if(outcome.anchorWarning)showAnchorMetadataWarning(outcome.anchorWarning);
      }
      if(onScheduleChanged)await onScheduleChanged();
      if(selectedId)await loadItemsForZone(selectedId);
    }finally{
      setSaving(false);
    }
  }

  function patchDraft(i,field,val){
    setDraftRows((r)=>r.map((row,j)=>(j===i?{...row,[field]:val}:row)));
  }

  const plannedCount=items.filter(it=>it.status==='planned').length;

  function discardReviewIfNeeded(){
    if(reviewMode&&draftRows.length>0){
      if(!window.confirm('Discard this generated preview? Your programme on disk is unchanged until you Save all.'))return false;
      setReviewMode(false);
      setDraftRows([]);
    }
    return true;
  }

  function selectZone(id){
    if(id!=null&&Number(id)===Number(selectedId))return;
    if(!discardReviewIfNeeded())return;
    setSelectedId(id);
  }

  function clearZoneSelection(){
    if(!discardReviewIfNeeded())return;
    setSelectedId(null);
  }

  function onCanvasClick(e){
    if(!drawData||!wrapRef.current)return;
    const[pctX,pctY]=clientToPct(e,wrapRef.current);
    for(let i=zonesSorted.length-1;i>=0;i--){
      const z=zonesSorted[i],g=parseZoneGeometry(z);
      if(pointInGeom(pctX,pctY,g)){selectZone(z.id);return}
    }
    clearZoneSelection();
  }

  async function handleXmlUploadPreview(){
    if(!xmlFile)return;
    setXmlParsing(true);
    setXmlParseErr('');
    setXmlConfirmMsg('');
    const res=await api.uploadProjectProgrammeXml(xmlFile);
    setXmlParsing(false);
    if(res&&res.error){
      setXmlParseErr(String(res.error));
      setParsedXmlTasks([]);
      setXmlChecked({});
      return;
    }
    const tasks=Array.isArray(res?.tasks)?res.tasks:[];
    setParsedXmlTasks(tasks);
    const chk={};
    tasks.forEach((t)=>{chk[t.uid]=true});
    setXmlChecked(chk);
    setFilterType('tasks');
  }

  function setXmlCheckAll(visible,on){
    setXmlChecked((prev)=>{
      const next={...prev};
      visible.forEach((t)=>{next[t.uid]=on});
      return next;
    });
  }

  async function handleXmlConfirmImport(){
    const selected=parsedXmlTasks.filter((t)=>xmlChecked[t.uid]);
    if(!selected.length)return;
    setXmlConfirming(true);
    setXmlConfirmMsg('');
    const res=await api.confirmProjectProgrammeImport(selected);
    setXmlConfirming(false);
    if(res&&res.error){
      setXmlParseErr(String(res.error));
      return;
    }
    setXmlConfirmMsg(`Imported ${res.count ?? selected.length} row(s).`);
    setParsedXmlTasks([]);
    setXmlChecked({});
    setXmlFile(null);
    if(xmlInputRef.current)xmlInputRef.current.value='';
    reloadProjectItems();
  }

  function renderProjectRow(row,{showCheckbox,checked,onToggle}){
    const summary=projectItemFlag(row,'is_summary')===1;
    const milestone=projectItemFlag(row,'is_milestone')===1;
    const indent=(Number(row.outline_level)||1)*12;
    const nameStyle={
      fontSize:10,
      fontWeight:summary?600:700,
      fontStyle:summary?'italic':'normal',
      color:summary?T.muted:T.text,
      paddingLeft:indent,
      lineHeight:1.3,
      minWidth:0,
      overflow:'hidden',
      textOverflow:'ellipsis',
    };
    return (
      <div key={showCheckbox?`p-${row.uid}`:row.id} style={{...ppTableGrid,marginBottom:4,fontSize:10,color:T.text}}>
        {showCheckbox?(
          <input type="checkbox" checked={!!checked} onChange={()=>onToggle(row.uid)} style={{width:14,height:14}}/>
        ):(
          <span/>
        )}
        <span style={{fontSize:9,color:T.faint}}>{row.wbs||'—'}</span>
        <span style={nameStyle}>{milestone?'◆ ':''}{row.name}</span>
        <span>{row.start_date||'—'}</span>
        <span>{row.finish_date||'—'}</span>
        <span>{row.duration_days!=null?Number(row.duration_days):'—'}</span>
        <span style={{fontSize:9,color:summary?T.faint:T.muted}}>{projectTaskType(row)}</span>
      </div>
    );
  }

  const projectProgrammePanel=tab===PROJECT_PROGRAMME_TAB?(
    <div style={{padding:'12px 14px',borderBottom:`1px solid ${T.hairline}`,background:T.surface,flexShrink:0}}>
      {isAdmin&&(
        <div style={{marginBottom:16,padding:12,borderRadius:12,border:`1px solid ${T.hairline}`,background:T.bg}}>
          <h3 style={{margin:'0 0 10px',fontSize:14,fontWeight:700,color:T.text}}>Import from MS Project XML</h3>
          <div style={{display:'flex',flexWrap:'wrap',gap:8,alignItems:'center',marginBottom:10}}>
            <input
              ref={xmlInputRef}
              type="file"
              accept=".xml,application/xml,text/xml"
              onChange={(e)=>{setXmlFile(e.target.files?.[0]||null);setXmlParseErr('');setXmlConfirmMsg('')}}
              style={{fontSize:11,maxWidth:280}}
            />
            <button
              type="button"
              disabled={!xmlFile||xmlParsing}
              onClick={()=>void handleXmlUploadPreview()}
              style={{...S.btn,...S.btnPrimary,padding:'6px 14px',fontSize:11}}
            >
              {xmlParsing?'Parsing…':'Upload & Preview'}
            </button>
          </div>
          {xmlParseErr&&<div style={{fontSize:11,color:'#c0392b',marginBottom:8}}>{xmlParseErr}</div>}
          {xmlConfirmMsg&&<div style={{fontSize:11,color:'rgba(46,178,96,0.95)',marginBottom:8}}>{xmlConfirmMsg}</div>}
          {parsedXmlTasks.length>0&&(
            <>
              <div style={{display:'flex',flexWrap:'wrap',gap:6,marginBottom:8}}>
                {[
                  {id:'all',label:'All'},
                  {id:'tasks',label:'Tasks only'},
                  {id:'milestones',label:'Milestones only'},
                ].map((f)=>(
                  <button
                    key={f.id}
                    type="button"
                    onClick={()=>setFilterType(f.id)}
                    style={{...S.btn,...(filterType===f.id?S.btnAct:{}),padding:'4px 10px',fontSize:10}}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
              <div style={{fontSize:10,color:T.muted,marginBottom:8}}>
                Showing {xmlStats.visible} of {xmlStats.total} rows · {xmlStats.selected} selected ({xmlStats.milestones} milestones, {xmlStats.summary} summary rows in file)
              </div>
              <div style={{display:'flex',gap:8,marginBottom:8}}>
                <button type="button" style={{...S.btn,padding:'4px 10px',fontSize:10}} onClick={()=>setXmlCheckAll(previewTableRows,true)}>Select all</button>
                <button type="button" style={{...S.btn,padding:'4px 10px',fontSize:10}} onClick={()=>setXmlCheckAll(previewTableRows,false)}>Deselect all</button>
              </div>
              <div key={`xml-preview-${filterType}`} style={{maxHeight:280,overflowY:'auto',marginBottom:10}}>
                <div style={ppTableHead}>
                  <span/>
                  <span>WBS</span>
                  <span>Name</span>
                  <span>Start</span>
                  <span>Finish</span>
                  <span>Duration</span>
                  <span>Type</span>
                </div>
                {previewTableRows.map((row)=>renderProjectRow(row,{
                  showCheckbox:true,
                  checked:xmlChecked[row.uid],
                  onToggle:(uid)=>setXmlChecked((c)=>({...c,[uid]:!c[uid]})),
                }))}
              </div>
              <button
                type="button"
                disabled={xmlStats.selected<1||xmlConfirming}
                onClick={()=>void handleXmlConfirmImport()}
                style={{...S.btn,...S.btnPrimary,padding:'8px 16px',fontSize:12}}
              >
                {xmlConfirming?'Importing…':'Confirm Import'}
              </button>
            </>
          )}
        </div>
      )}
      <div>
        <div style={{fontSize:13,fontWeight:700,color:T.text,marginBottom:8}}>Project programme</div>
        {loadingProjectItems&&<div style={{fontSize:11,color:T.faint}}>Loading…</div>}
        {!loadingProjectItems&&projectItems.length===0&&(
          <div style={{fontSize:11,color:T.muted}}>No project programme rows yet.{isAdmin?' Import an XML file above.':''}</div>
        )}
        {!loadingProjectItems&&projectItems.length>0&&(
          <div style={{maxHeight:360,overflowY:'auto'}}>
            <div style={ppTableHead}>
              <span/>
              <span>WBS</span>
              <span>Name</span>
              <span>Start</span>
              <span>Finish</span>
              <span>Duration</span>
              <span>Type</span>
            </div>
            {projectItems.map((row)=>renderProjectRow(row,{showCheckbox:false}))}
          </div>
        )}
      </div>
    </div>
  ):null;

  return(
    <div style={{flex:1,display:'flex',flexDirection:'column',overflow:'hidden',background:T.bg}}>
      {isAdmin&&<ProgrammeNlCommand onApplied={onScheduleChanged}/>}
      {projectProgrammePanel}
      <PageHeader
        title={tab === PROJECT_PROGRAMME_TAB ? 'Project programme' : 'Programme'}
        description={hasFloorPlan ? 'Click a zone on the plan for single-zone scheduling, or use Schedule all zones below.' : zoneSetupAvailable ? 'Add a plan on Zones to use this screen.' : 'Ask an administrator to add a floor plan and zones. Use Plan for the zone programme overview.'}
        filters={
          tabDrawings.length > 0 ? (
            <select value={selDraw || ''} onChange={e => { const id = Number(e.target.value); writeSavedDrawingId(tab, id); setSelDraw(id); }} style={{ ...S.input, width: 'auto', fontSize: 12, padding: '6px 10px' }}>
              {tabDrawings.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          ) : null
        }
      />
      <div style={{flex:1,display:'flex',flexDirection:'row',minHeight:0}}>
        <div style={{flex:1,minWidth:0,position:'relative',background:'#e8e8ec',minHeight:0,overflow:'auto'}}>
          {drawData?.image_data?(
            <div ref={wrapRef} onClick={onCanvasClick} style={{position:'relative',width:'100%'}}>
                <img alt="Plan" draggable={false} src={`data:image/jpeg;base64,${drawData.image_data}`} style={{display:'block',width:'100%',height:'auto',userSelect:'none',pointerEvents:'none'}}/>
                <svg style={{position:'absolute',left:0,top:0,right:0,bottom:0,width:'100%',height:'100%',pointerEvents:'none'}} viewBox="0 0 100 100" preserveAspectRatio="none">
                {zonesSorted.map(z=>{
                  const g=parseZoneGeometry(z),sel=z.id===selectedId;
                  const stackNm=primaryZoneActivityName(z,activityName);
                  const planNm=primaryProgrammeNameByZone.get(Number(z.id))||'';
                  const actNm=stackNm||planNm;
                  const hasProg=Boolean(planNm);
                  const fill=sel?(actNm?actColor(actNm,0.44):'rgba(95,95,105,0.2)'):(actNm?actColor(actNm,hasProg?0.42:0.38):'rgba(115,115,125,0.1)');
                  const stroke=sel?(actNm?actColor(actNm,0.98):'rgba(55,55,65,0.88)'):(actNm?actColor(actNm,0.92):'rgba(75,75,85,0.45)');
                  const bb=g.kind==='rect'?g:{x:z.x,y:z.y,w:z.w,h:z.h};
                  const cx=(bb.x||0)+(bb.w||0)/2,cy=(bb.y||0)+(bb.h||0)/2;
                  const sw=sel?0.48:0.42;
                  const frag=g.kind==='rect'?(
                    <rect x={g.x} y={g.y} width={g.w} height={g.h} fill={fill} stroke={stroke} strokeWidth={sw}/>
                  ):(
                    <polygon points={svgPolygonPoints(g)} fill={fill} stroke={stroke} strokeWidth={sw}/>
                  );
                  const nActs=sortZoneActs(z).length;
                  const tip=`${z.tower||''} ${z.name||''}`.trim();
                  const sub=actNm?`${actNm}${nActs>1?` (+${nActs-1})`:''}${hasProg&&!stackNm?' · scheduled':''}`:'';
                  return<g key={z.id}>
                    <title>{sub?`${tip}: ${sub}`:tip}</title>
                    {frag}
                    <text x={cx} y={cy} textAnchor="middle" dominantBaseline="middle" fill={T.text} fontSize={2.2} fontWeight="700" style={{pointerEvents:'none',textShadow:'0 0 2px #fff'}}>
                      {z.tower} {z.name}{actNm?` · ${actNm}${nActs>1?` (+${nActs-1})`:''}`:''}
                    </text>
                  </g>;
                })}
              </svg>
            </div>
          ):canvasNoPlan}
        </div>
        <div style={{width:'min(440px,46vw)',minWidth:280,maxWidth:'100%',flexShrink:0,borderLeft:`1px solid ${T.hairline}`,background:T.surface,overflowY:'auto',padding:12}}>
          {!hasFloorPlan&&(
            <div>
              <p style={{fontSize:12,color:T.muted,lineHeight:1.45,margin:'0 0 12px'}}>{zoneSetupAvailable?'Zones defines the drawing and shapes. Programme links dates to each zone.':'Programme links dates to each zone once a floor plan exists. Coordinate with an administrator to upload drawings and zones — use Plan to see the programme layout.'}</p>
              {zonesCta}
            </div>
          )}

          {hasFloorPlan&&!selectedId&&zones.length>0&&canEdit&&tabTemplates.length>0&&(
            <div style={{marginBottom:16,padding:12,borderRadius:12,border:`1px solid ${T.hairline}`,background:T.bg}}>
              <div style={{fontSize:13,fontWeight:700,color:T.text,marginBottom:8}}>Schedule all zones</div>
              <p style={{fontSize:11,color:T.muted,margin:'0 0 10px',lineHeight:1.45}}>Set template and start stage per zone, then generate every programme in one pass.</p>
              <div style={{overflowX:'auto'}}>
                <table style={{width:'100%',borderCollapse:'collapse',fontSize:11,color:T.text}}>
                  <thead>
                    <tr style={{textAlign:'left',color:T.muted,fontSize:9,textTransform:'uppercase'}}>
                      <th style={{padding:'6px 4px'}}>Zone</th>
                      <th style={{padding:'6px 4px'}}>Template</th>
                      <th style={{padding:'6px 4px'}}>Stage #</th>
                      <th style={{padding:'6px 4px'}}>Start date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {zonesSorted.map(z=>{
                      const b=bulk[z.id]||{templateId:'',stageIdx:0,startDate:dateKey(new Date())};
                      const tpl=b.templateId?tabTemplates.find(t=>String(t.id)===b.templateId):null;
                      let bulkSeq=[];
                      try{
                        bulkSeq=JSON.parse(tpl?.sequence||'[]');
                        if(!Array.isArray(bulkSeq))bulkSeq=[];
                      }catch(_){bulkSeq=[]}
                      return<tr key={z.id}>
                        <td style={{padding:'6px 4px',verticalAlign:'middle',color:T.text,fontWeight:600,fontSize:12}}>{z.tower} {z.name}</td>
                        <td style={{padding:'4px',verticalAlign:'middle'}}>
                          <select value={b.templateId} onChange={e=>setBulk(o=>({...o,[z.id]:{...b,templateId:e.target.value,stageIdx:0}}))} style={{...S.input,fontSize:10,padding:'4px 6px',width:'100%',minWidth:100}}>
                            <option value="">—</option>
                            {tabTemplates.map(t=><option key={t.id} value={String(t.id)}>{t.name}</option>)}
                          </select>
                        </td>
                        <td style={{padding:'4px',verticalAlign:'middle'}}>
                          <select value={Math.min(b.stageIdx,Math.max(0,bulkSeq.length-1))} disabled={!bulkSeq.length} onChange={e=>setBulk(o=>({...o,[z.id]:{...b,stageIdx:Number(e.target.value)}}))} style={{...S.input,fontSize:10,padding:'4px',width:'100%',minWidth:120}}>
                            {!bulkSeq.length&&<option value={0}>—</option>}
                            {bulkSeq.map((name,i)=><option key={i} value={i}>{i+1}. {name}</option>)}
                          </select>
                        </td>
                        <td style={{padding:'4px',verticalAlign:'middle'}}>
                          <input type="date" value={toHtmlDateInputValue(b.startDate)} onChange={e=>setBulk(o=>({...o,[z.id]:{...b,startDate:e.target.value}}))} style={{...S.input,fontSize:10,padding:'4px'}}/>
                          <NonWorkingAnchorDateWarning dateKey={b.startDate} />
                        </td>
                      </tr>;
                    })}
                  </tbody>
                </table>
              </div>
              <button type="button" disabled={saving} onClick={()=>void generateAllZones()} style={{...S.btn,...S.btnPrimary,marginTop:10,width:'100%',padding:'10px',fontSize:12}}>{saving?'Working…':'Generate all'}</button>
            </div>
          )}

          {hasFloorPlan&&!selectedId&&<div style={{fontSize:13,color:T.muted}}>Select a zone on the plan for single-zone scheduling.</div>}

          {selectedZone&&<>
            <div style={{fontSize:14,fontWeight:700,color:T.text,marginBottom:4}}>{selectedZone.tower} {selectedZone.name}</div>
            {sortZoneActs(selectedZone).length>0?(
              <div style={{marginBottom:12,display:'flex',flexWrap:'wrap',gap:4}}>
                {sortZoneActs(selectedZone).map(a=><span key={a.id} style={S.pill(a.name)}>{a.name}</span>)}
              </div>
            ):selectedZone.activity_id?(
              <div style={{marginBottom:12}}><span style={S.pill(activityName(selectedZone.activity_id))}>{activityName(selectedZone.activity_id)}</span></div>
            ):null}

            {!reviewMode&&(
              <>
                <div style={{padding:12,borderRadius:12,border:`1px solid rgba(66,133,244,0.25)`,background:'rgba(66,133,244,0.04)',marginBottom:12}}>
                  <div style={{fontSize:11,fontWeight:700,color:T.text,marginBottom:10}}>Template schedule</div>
                  <label style={{fontSize:10,color:T.muted,display:'block',marginBottom:4}}>Template</label>
                  <select value={schedTpl} onChange={e=>{setSchedTpl(e.target.value);setStartStageIdx(0)}} style={{...S.input,fontSize:12,marginBottom:10,width:'100%'}}>
                    <option value="">Choose template…</option>
                    {tabTemplates.map(t=><option key={t.id} value={String(t.id)}>{t.name}</option>)}
                  </select>
                  {schedTpl&&tplSeq.length>0&&(
                    <>
                      <label style={{fontSize:10,color:T.muted,display:'block',marginBottom:6}}>Start from stage</label>
                      <div style={{display:'flex',flexWrap:'wrap',gap:6,marginBottom:10,maxHeight:120,overflowY:'auto'}}>
                        {tplSeq.map((name,i)=>(
                          <button key={i} type="button" onClick={()=>setStartStageIdx(i)} style={{
                            ...S.btn,padding:'6px 10px',fontSize:10,maxWidth:'100%',textAlign:'left',
                            ...(i===startStageIdx?S.btnAct:{}),
                            opacity:i===startStageIdx?1:0.85,
                          }}>
                            <span style={{fontWeight:700,marginRight:6,color:T.faint}}>{i+1}.</span>{name}
                          </button>
                        ))}
                      </div>
                      <label style={{fontSize:10,color:T.muted,display:'block',marginBottom:4}}>Start date (first weekday of selected stage)</label>
                      <input type="date" value={toHtmlDateInputValue(anchorDate)} onChange={e=>setAnchorDate(e.target.value)} style={{...S.input,fontSize:12,marginBottom:4,width:'100%'}}/>
                      <NonWorkingAnchorDateWarning dateKey={anchorDate} />
                      <button type="button" disabled={!schedTpl||saving} onClick={runGenerate} style={{...S.btn,...S.btnPrimary,width:'100%',padding:'10px',fontSize:12,marginTop:6}}>Generate programme</button>
                      {isAdmin&&(
                        <button type="button" disabled={saving} onClick={()=>setTargetModalOpen(true)} style={{...S.btn,marginTop:10,width:'100%',padding:'10px',fontSize:12,border:`1px solid rgba(66,133,244,0.35)`,background:'rgba(66,133,244,0.08)'}}>
                          Schedule from target date
                        </button>
                      )}
                    </>
                  )}
                </div>

                {loadingItems&&<div style={{fontSize:12,color:T.faint}}>Loading…</div>}

                {isAdmin&&!reviewMode&&schedTpl&&tplSeq.length>0&&(
                  <ScheduleFromTargetModal
                    open={targetModalOpen}
                    onClose={()=>setTargetModalOpen(false)}
                    zoneId={selectedId}
                    zoneTitle={selectedZone?`${selectedZone.tower} ${selectedZone.name}`:''}
                    templateId={schedTpl?Number(schedTpl):null}
                    templateName={selectedTpl?.name||''}
                    sequence={tplSeq}
                    durations={tplDur}
                    activityLookup={activityLookup}
                    existingItems={items}
                    onApplied={async()=>{
                      if(onScheduleChanged)await onScheduleChanged();
                      await loadItemsForZone(selectedId);
                    }}
                    onAnchorWarning={showAnchorMetadataWarning}
                  />
                )}

                {!loadingItems&&items.length>0&&canEdit&&plannedCount>0&&(
                  <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:12,flexWrap:'wrap'}}>
                    <span style={{fontSize:11,fontWeight:600,color:T.text}}>Shift planned dates</span>
                    <input type="number" value={shiftDays} onChange={e=>setShiftDays(Number(e.target.value))} style={{...S.input,width:64,padding:'6px',fontSize:12}} placeholder="±"/>
                    <span style={{fontSize:11,color:T.muted}}>calendar days</span>
                    <button type="button" onClick={()=>void applyShift()} style={{...S.btn,padding:'6px 12px',fontSize:11}}>Apply</button>
                    <span style={{fontSize:10,color:T.faint}}>({plannedCount} planned)</span>
                  </div>
                )}

                {!loadingItems&&items.length>0&&!reviewMode&&(
                  <div style={{marginBottom:12}}>
                    <div style={tableHead}>
                      <span>Activity</span><span>Start</span><span>End</span><span>Status</span><span/>
                    </div>
                    {items.map(it=>(
                      <div key={it.id} style={{...tableHead,gridTemplateColumns:'minmax(0,1.2fr) 88px 88px 72px 52px',fontSize:10,fontWeight:400,color:T.text,marginBottom:4}}>
                        <span style={{fontWeight:600}}>{it.activity_name}</span>
                        {canEdit?(
                          <>
                            <input type="date" value={toHtmlDateInputValue(it.start_date)} onChange={e=>patchItem(it.id,{start_date:e.target.value})} style={{...S.input,padding:'4px',fontSize:10}}/>
                            <input type="date" value={toHtmlDateInputValue(it.end_date)} onChange={e=>patchItem(it.id,{end_date:e.target.value})} style={{...S.input,padding:'4px',fontSize:10}}/>
                            <select value={it.status||'planned'} onChange={e=>patchItem(it.id,{status:e.target.value})} style={{...S.input,padding:'4px',fontSize:10}}>
                              {STATUSES.map(s=><option key={s} value={s}>{s}</option>)}
                            </select>
                          </>
                        ):(
                          <>
                            <span>{it.start_date}</span><span>{it.end_date}</span><span>{it.status}</span>
                          </>
                        )}
                        {canEdit&&<button type="button" onClick={()=>removeItem(it.id)} style={{...S.btn,...S.btnDanger,padding:'4px',fontSize:10}}>×</button>}
                      </div>
                    ))}
                  </div>
                )}

                {!loadingItems&&items.length===0&&!reviewMode&&<div style={{fontSize:12,color:T.faint,marginBottom:10}}>No programme rows yet — pick a template above or add manually.</div>}
              </>
            )}

            {reviewMode&&draftRows.length>0&&(
              <div style={{marginBottom:12}}>
                <div style={{fontSize:12,fontWeight:700,color:T.text,marginBottom:8}}>Review schedule</div>
                <div style={tableHead}>
                  <span>Activity</span><span>Start</span><span>End</span><span>Status</span><span/>
                </div>
                {draftRows.map((row,i)=>(
                  <div key={row.idx} style={{...tableHead,marginBottom:4}}>
                    <span style={{fontSize:10,fontWeight:600}}>{row.activity_name}{!row.activity_id?' (!)':''}</span>
                    <input type="date" value={toHtmlDateInputValue(row.start_date)} onChange={e=>patchDraft(i,'start_date',e.target.value)} style={{...S.input,padding:'4px',fontSize:10}}/>
                    <input type="date" value={toHtmlDateInputValue(row.end_date)} onChange={e=>patchDraft(i,'end_date',e.target.value)} style={{...S.input,padding:'4px',fontSize:10}}/>
                    <select value={row.status} onChange={e=>patchDraft(i,'status',e.target.value)} style={{...S.input,padding:'4px',fontSize:10}}>
                      {STATUSES.map(s=><option key={s} value={s}>{s}</option>)}
                    </select>
                    <span/>
                  </div>
                ))}
                <div style={{display:'flex',gap:8,marginTop:10}}>
                  <button type="button" disabled={saving} onClick={()=>void saveDraftRows()} style={{...S.btn,...S.btnPrimary,flex:1,padding:'10px',fontSize:12}}>{saving?'Saving…':'Save all'}</button>
                  <button type="button" onClick={()=>{setReviewMode(false);setDraftRows([])}} style={{...S.btn,flex:1}}>Cancel</button>
                </div>
              </div>
            )}

            {canEdit&&!reviewMode&&(
              <>
                {!showManual&&(
                  <button type="button" onClick={()=>setShowManual(true)} style={{...S.btn,padding:'8px 0',fontSize:11,background:'transparent',color:'rgba(66,133,244,0.95)',marginTop:8}}>
                    + Add individual row
                  </button>
                )}
                {showManual&&(
                  <form onSubmit={submitManual} style={{marginTop:12,padding:12,borderRadius:12,border:`1px solid ${T.hairline}`,background:T.bg}}>
                    <div style={{fontSize:11,fontWeight:700,color:T.text,marginBottom:8}}>Manual row</div>
                    {isAdmin&&(
                      <div style={{marginBottom:10}}>
                        <button type="button" onClick={()=>setManualNewExpanded((v)=>!v)} style={{...S.btn,padding:'6px 10px',fontSize:10}}>
                          {manualNewExpanded?'− Hide':'+ New activity'}
                        </button>
                        {manualNewExpanded&&(
                          <div style={{marginTop:8,padding:10,borderRadius:8,border:`1px dashed ${T.hairline}`,background:T.surface}}>
                            <input value={newActName} onChange={(e)=>setNewActName(e.target.value)} placeholder="Activity name" style={{...S.input,fontSize:12,marginBottom:8,width:'100%'}}/>
                            <select value={newActType} onChange={(e)=>setNewActType(e.target.value)} style={{...S.input,fontSize:12,marginBottom:8,width:'100%'}}>
                              <option value="groundworks">Groundworks</option>
                              <option value="internals">Internals</option>
                              <option value={PROJECT_PROGRAMME_TAB}>Project programme</option>
                            </select>
                            <button type="button" onClick={()=>void createAndSelectActivity()} style={{...S.btn,...S.btnPrimary,width:'100%',fontSize:11}} disabled={!String(newActName||'').trim()}>
                              Create &amp; select
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                    <select required value={manualForm.activity_id} onChange={e=>setManualForm(f=>({...f,activity_id:e.target.value}))} style={{...S.input,fontSize:12,marginBottom:8}}>
                      <option value="">Activity ({drawingTabLabel(typeTab)})</option>
                      {filteredActs.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}
                    </select>
                    <input required type="date" value={toHtmlDateInputValue(manualForm.start_date)} onChange={e=>setManualForm(f=>({...f,start_date:e.target.value}))} style={{...S.input,fontSize:12,marginBottom:8}}/>
                    <input required type="date" value={toHtmlDateInputValue(manualForm.end_date)} onChange={e=>setManualForm(f=>({...f,end_date:e.target.value}))} style={{...S.input,fontSize:12,marginBottom:8}}/>
                    <select value={manualForm.status} onChange={e=>setManualForm(f=>({...f,status:e.target.value}))} style={{...S.input,fontSize:12,marginBottom:8}}>
                      {STATUSES.map(s=><option key={s} value={s}>{s}</option>)}
                    </select>
                    <input value={manualForm.notes} onChange={e=>setManualForm(f=>({...f,notes:e.target.value}))} placeholder="Notes" style={{...S.input,fontSize:12,marginBottom:10}}/>
                    <div style={{display:'flex',gap:8}}>
                      <button type="submit" style={{...S.btn,...S.btnPrimary,flex:1}}>Add row</button>
                      <button type="button" onClick={()=>{setShowManual(false);setManualNewExpanded(false);setNewActName('')}} style={S.btn}>Close</button>
                    </div>
                  </form>
                )}
              </>
            )}
          </>}
        </div>
      </div>
      {toast&&(
        <div
          style={{
            position:'fixed',
            bottom:88,
            left:'50%',
            transform:'translateX(-50%)',
            background:toastWarning?'rgba(241,196,15,0.96)':'rgba(46,178,96,0.95)',
            color:toastWarning?'rgba(26,26,46,0.92)':'#fff',
            padding:'8px 16px',
            borderRadius:10,
            fontSize:13,
            fontWeight:600,
            zIndex:25,
            boxShadow:'0 4px 16px rgba(0,0,0,0.15)',
            maxWidth:'min(92vw, 420px)',
            textAlign:'center',
            lineHeight:1.35,
          }}
        >
          {toast}
        </div>
      )}
    </div>
  );
}
