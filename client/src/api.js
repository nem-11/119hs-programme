const BASE='';
function getToken(){return localStorage.getItem('119hs-token')}
async function api(method,path,body){
  const opts={method,headers:{'Content-Type':'application/json'}};
  const token=getToken();if(token)opts.headers['Authorization']='Bearer '+token;
  if(body)opts.body=JSON.stringify(body);
  let res;
  try{
    res=await fetch(BASE+path,opts);
  }catch(e){
    const msg=e&&e.message?String(e.message):'Network error';
    const err=new Error(
      msg==='Failed to fetch'||/network|load failed|fetch/i.test(msg)
        ?'Cannot reach API (is the server running on port 3001? From project root run: npm run server, or npm run dev for client + server together.)'
        :msg
    );
    err.cause=e;
    throw err;
  }
  if(res.status===401&&path!=='/api/login'){
    localStorage.removeItem('119hs-token');
    window.location.reload();
    return null;
  }
  let data;
  try{
    data=await res.json();
  }catch(_){
    data={};
  }
  if(!res.ok)return data;
  return data;
}
export async function login(u,p){const d=await api('POST','/api/login',{username:u,password:p});if(d?.token){localStorage.setItem('119hs-token',d.token);localStorage.setItem('119hs-user',JSON.stringify(d.user))}return d}
export function logout(){localStorage.removeItem('119hs-token');localStorage.removeItem('119hs-user')}
export function getStoredUser(){const t=getToken(),u=localStorage.getItem('119hs-user');return t&&u?JSON.parse(u):null}
export const getActivities=()=>api('GET','/api/activities');
export const getSchedule=(tab)=>api('GET',`/api/schedule/${tab}`);
export const updateScheduleDay=(tab,date,data)=>api('PUT',`/api/schedule/${tab}/${date}`,{data});
export const addScheduleActivity=(tab,date,tower,zone_name,activity)=>api('POST','/api/schedule/activity',{tab,date,tower,zone_name,activity});
export const removeScheduleActivity=(tab,date,tower,zone_name,activity)=>api('DELETE','/api/schedule/activity',{tab,date,tower,zone_name,activity});
export const getCompletions=()=>api('GET','/api/completions');
export const toggleCompletion=(date,key,by)=>api('POST','/api/completions',{date,key,by});
export const getMilestones=()=>api('GET','/api/milestones');
export const getUsers=()=>api('GET','/api/users');
export const addUser=(user)=>api('POST','/api/users',user);
export const deleteUser=(id)=>api('DELETE',`/api/users/${id}`);
export const getDrawings=()=>api('GET','/api/drawings');
export const getDrawing=(id)=>api('GET',`/api/drawings/${id}`);
export const uploadDrawing=(name,tab,floor,image_data,width,height,file_url)=>api('POST','/api/drawings',{name,tab,floor,image_data,width,height,file_url:file_url||null});
export const deleteDrawing=(id)=>api('DELETE',`/api/drawings/${id}`);
export const getZonesForDrawing=(id)=>api('GET',`/api/zones/${id}`);
export const addZone=(drawing_id,name,tower,geometry,activity_id)=>api('POST','/api/zones',{drawing_id,name,tower,geometry,activity_id:activity_id??null});
export const updateZone=(id,patch)=>api('PUT',`/api/zones/${id}`,patch);
export const deleteZone=(id)=>api('DELETE',`/api/zones/${id}`);
export const getProgrammeItemsByDrawing=(drawingId)=>api('GET',`/api/programme-items/drawing/${drawingId}`);
export const getProgrammeItemsByZone=(zoneId)=>api('GET',`/api/programme-items/zone/${zoneId}`);
export const createProgrammeItem=(zone_id,activity_id,start_date,end_date,status,notes)=>api('POST','/api/programme-items',{zone_id,activity_id,start_date,end_date,status,notes});
export const updateProgrammeItem=(id,patch)=>api('PUT',`/api/programme-items/${id}`,patch);
export const deleteProgrammeItem=(id)=>api('DELETE',`/api/programme-items/${id}`);
export const getTemplates=()=>api('GET','/api/templates');
export const createTemplate=(name,tab,tower,zone_name,sequence,durations)=>api('POST','/api/templates',{name,tab,tower,zone_name,sequence,durations});
export const deleteTemplate=(id)=>api('DELETE',`/api/templates/${id}`);
export const applyTemplate=(tab,tower,zone_name,sequence,durations,startDate)=>api('POST','/api/templates/apply',{tab,tower,zone_name,sequence,durations,startDate});
