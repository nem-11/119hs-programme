export const COLORS={"Verts":"46,178,96","Blind Concrete":"244,97,37","Blinding":"244,97,37","Insulation":"6,188,208","Drainage":"102,194,165","Waterproofing":"142,68,173","Pour":"66,133,244","Reinforcement - Shuttering":"244,165,26","Podium Pour":"228,57,57","Cage Pile Cap":"149,208,235","Pour Pile Cap":"235,149,208","Break Pile Cap":"208,235,149","Form Pile Cap":"149,208,235","Pile Caps":"149,208,235","Pile Mat":"180,180,180","Piling":"120,120,120","Crop Piles":"160,140,100","Cure":"200,200,200","Riser Stitching":"244,165,26","Service Riser stitching":"244,165,26","Corridor Ceiling Stitch":"66,133,244","Modular Ceiling Stitch":"102,194,165","Modular Floor Stitch":"142,68,173","Form Door Aperture":"160,120,80","Corridor Floor Stitch":"6,188,208","Stair Core Stitching":"228,57,57","MEP Riser":"244,97,37","MEP Corridor":"244,130,37","Ceiling Install":"100,180,220","Install Ceiling Panels":"80,160,200","Modular Linear Stitch":"180,120,200","Install Fire Doors":"120,80,60","Paint":"200,200,220","Commission":"46,178,96","Stud Walls":"180,140,100","Dryline":"149,208,235"};
export function actColor(n,o){return`rgba(${COLORS[n]||"150,150,150"},${o})`}
export const GW_SEQUENCE=["Pile Mat","Piling","Crop Piles","Cure","Form Pile Cap","Cage Pile Cap","Pour Pile Cap","Blinding","Drainage","Insulation","Waterproofing","Reinforcement - Shuttering","Pour","Verts","Podium Pour"];
export const INT_SEQUENCE=["Riser Stitching","Corridor Ceiling Stitch","Modular Ceiling Stitch","Modular Floor Stitch","Form Door Aperture","Corridor Floor Stitch","Stair Core Stitching","MEP Riser","MEP Corridor","Ceiling Install","Install Ceiling Panels","Modular Linear Stitch","Install Fire Doors","Paint","Commission"];
export function dateKey(d){return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')}
/** Safari rejects <input type="date"> values that are not exactly YYYY-MM-DD or "". */
export function toHtmlDateInputValue(v){
  if(v==null)return'';
  const s=String(v).trim();
  if(!s)return'';
  const m=/^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if(!m)return'';
  const y=m[1],mo=String(m[2]).padStart(2,'0'),da=String(m[3]).padStart(2,'0');
  return`${y}-${mo}-${da}`;
}
export function matchActivityInText(text,sequence){
  if(!text||!sequence?.length)return null;
  const t=String(text).toLowerCase();
  const sorted=[...sequence].sort((a,b)=>b.length-a.length);
  for(const act of sorted)if(t.includes(act.toLowerCase()))return act;
  return null;
}
export function parseZoneNameForActivity(raw,sequence){
  const r=(raw||'').trim();
  if(!r)return{zoneLabel:'',linkedActivity:null};
  let zoneLabel=r;
  let linkedActivity=null;
  if(r.includes('|')){
    const parts=r.split('|').map(x=>x.trim());
    zoneLabel=parts[0]||r;
    const right=parts.slice(1).join('|').trim();
    linkedActivity=matchActivityInText(right,sequence);
  }
  if(!linkedActivity)linkedActivity=matchActivityInText(r,sequence);
  if(linkedActivity&&!r.includes('|')){
    const esc=linkedActivity.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    const stripped=r.replace(new RegExp(esc,'gi'),'').replace(/^[\s—–.\-]+|[\s—–.\-]+$/g,'').trim();
    if(stripped.length>=1)zoneLabel=stripped;
  }
  return{zoneLabel:zoneLabel||r,linkedActivity};
}
export function formatDate(d){const D=["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"],M=["January","February","March","April","May","June","July","August","September","October","November","December"];return`${D[d.getDay()]} ${d.getDate()} ${M[d.getMonth()]}`}
export function formatShort(d){const D=["Sun","Mon","Tue","Wed","Thu","Fri","Sat"],M=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];return`${D[d.getDay()]} ${d.getDate()} ${M[d.getMonth()]}`}
