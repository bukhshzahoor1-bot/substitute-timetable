/* =========================================================================
   Government School Substitute Teacher Management System
   100% offline. Vanilla JS. All data in a permanent on-disk database
   (D:\SchoolData\database.json, atomic writes, daily backups, auto
   recovery) via window.api — see preload.js / main.js. No browser
   storage (localStorage / sessionStorage / IndexedDB / cookies) is used.
   ========================================================================= */

/* ---------------------------- Constants -------------------------------- */
const DAYS = ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
const LEVELS = ["Primary","Middle","High"];
const STATUSES = ["Present","Absent","Leave","Training","Meeting","Medical Leave"];
const NON_PRESENT = ["Absent","Leave","Training","Meeting","Medical Leave"];
/* No cap on the number of teachers the Admin can add. */

/* Names of every slice of STATE that lives in the permanent database.
   (No longer localStorage keys — kept as a plain list so export/import/
   reset can still loop over "every data slice" exactly as before.) */
const LS = {
  school:  "school",
  teachers:"teachers",
  periods: "periods",
  timetables: "timetables",
  attendance: "attendance",
  substitutes: "substitutes",
  settings: "settings",
  theme: "theme"
};

/* ---------------------------- Defaults ---------------------------------- */
function defaultPeriods(){
  return [
    {name:"Period 1", start:"08:00", end:"08:40"},
    {name:"Period 2", start:"08:40", end:"09:20"},
    {name:"Period 3", start:"09:20", end:"10:00"},
    {name:"Period 4", start:"10:00", end:"10:40"},
    {name:"Period 5", start:"10:40", end:"11:20"},
    {name:"Period 6", start:"11:20", end:"12:00"},
    {name:"Period 7", start:"12:40", end:"13:20"},
    {name:"Period 8", start:"13:20", end:"14:00"}
  ];
}

function uid(prefix){ return prefix + "_" + Math.random().toString(36).slice(2,9) + Date.now().toString(36).slice(-4); }

function defaultClasses(level){
  if(level === "Primary"){
    return [1,2,3,4,5].map(n=>({id:uid("c"), name:"Class "+n, group:null}));
  }
  if(level === "Middle"){
    const out=[];
    [6,7,8].forEach(n=>{ out.push({id:uid("c"), name:"Class "+n, group:"Jinnah"}); out.push({id:uid("c"), name:"Class "+n, group:"Iqbal"}); });
    return out;
  }
  // High
  const out=[];
  [9,10].forEach(n=>{ out.push({id:uid("c"), name:"Class "+n, group:"Jinnah"}); out.push({id:uid("c"), name:"Class "+n, group:"Iqbal"}); });
  return out;
}

function classLabel(c){ return c.group ? (c.name+" "+c.group) : c.name; }

function emptyGrid(classes, periodsCount){
  const grid = {};
  classes.forEach(c=>{
    grid[c.id] = {};
    for(let p=1;p<=periodsCount;p++){
      grid[c.id][p] = {subject:"Free", teacherId:""};
    }
  });
  return grid;
}

function defaultTimetables(periodsCount){
  const tt = {};
  LEVELS.forEach(level=>{
    const classes = defaultClasses(level);
    tt[level] = { classes, grid: emptyGrid(classes, periodsCount) };
  });
  return tt;
}

/* Older saved data may still be keyed by day (Monday, Tuesday, ...).
   Collapse that down to one generic schedule so existing backups keep working. */
function migrateTimetablesIfNeeded(timetables){
  if(!timetables) return;
  LEVELS.forEach(level=>{
    const tt = timetables[level];
    if(!tt || !Array.isArray(tt.classes) || !tt.grid) return;
    tt.classes.forEach(c=>{
      const g = tt.grid[c.id];
      if(!g) return;
      const looksDayKeyed = DAYS.some(d=> g[d] !== undefined);
      if(looksDayKeyed){
        const source = g["Monday"] || g[DAYS.find(d=>g[d])] || {};
        tt.grid[c.id] = source;
      }
    });
  });
}

/* ---------------------------- State -------------------------------------- */
let STATE = {
  school:{}, teachers:[], periods:[], timetables:{}, attendance:{}, substitutes:{}, settings:{}
};

function load(){
  if(!apiIsReady() || typeof window.api.loadAll !== "function"){
    console.error("load(): window.api is unavailable. storage.js must be loaded before script.js.");
    showApiWarningBanner();
    toast("Database connection missing. Make sure storage.js is in the same folder as index.html.", 8000);
    return;
  }
  const locationWarning = window.api.getLocationWarning && window.api.getLocationWarning();
  if (locationWarning) toast(locationWarning, 12000);
  const recoveryMsg = window.api.getRecoveryMessage && window.api.getRecoveryMessage();
  if (recoveryMsg) toast(recoveryMsg);
  const db = window.api.loadAll();
  STATE.school = db.school || {};
  STATE.teachers = db.teachers || [];
  STATE.periods = db.periods || defaultPeriods();
  STATE.timetables = db.timetables || defaultTimetables(STATE.periods.length);
  migrateTimetablesIfNeeded(STATE.timetables);
  STATE.attendance = db.attendance || {};
  STATE.substitutes = db.substitutes || {};
  STATE.settings = db.settings || {start:"08:00", end:"14:00", saturday:"no", session:""};
  ensureCategoryLocks();
  ensureBellSettings();
}

/* ---------------------------- Category Eligibility Locks ------------------
   Independent per-target-category lock matrix. categoryLocks[teacherLevel][targetLevel]
   === true means teachers of teacherLevel are BLOCKED from substituting for
   targetLevel classes. Every (teacherLevel, targetLevel) pair is independent -
   locking Primary teachers out of High does not touch Primary->Middle or
   Primary->Primary, and does not touch Middle or High teachers at all. */
function defaultCategoryLocks(){
  const locks = {};
  LEVELS.forEach(from=>{
    locks[from] = {};
    LEVELS.forEach(to=>{ locks[from][to] = false; });
  });
  return locks;
}
function ensureCategoryLocks(){
  if(!STATE.settings.categoryLocks) STATE.settings.categoryLocks = defaultCategoryLocks();
  // Backfill in case an older/imported settings object is missing a level
  // (e.g. restored from a backup saved before a level existed).
  LEVELS.forEach(from=>{
    if(!STATE.settings.categoryLocks[from]) STATE.settings.categoryLocks[from] = {};
    LEVELS.forEach(to=>{
      if(typeof STATE.settings.categoryLocks[from][to] !== "boolean"){
        STATE.settings.categoryLocks[from][to] = false;
      }
    });
  });
}
function isEligibleCategory(teacherLevel, targetLevel){
  ensureCategoryLocks();
  return !STATE.settings.categoryLocks[teacherLevel][targetLevel];
}

/* ---------------------------- Bell / Ringing Tune -------------------------- */
function defaultBellSettings(){
  return { enabled:true, tune:"classic", volume:0.7, customSound:"" };
}
function ensureBellSettings(){
  if(!STATE.settings.bell) STATE.settings.bell = defaultBellSettings();
  if(typeof STATE.settings.bell.enabled !== "boolean") STATE.settings.bell.enabled = true;
  if(!STATE.settings.bell.tune) STATE.settings.bell.tune = "classic";
  if(typeof STATE.settings.bell.volume !== "number") STATE.settings.bell.volume = 0.7;
  if(typeof STATE.settings.bell.customSound !== "string") STATE.settings.bell.customSound = "";
}

function apiIsReady(){
  return typeof window.api === "object" && window.api !== null;
}

function showApiWarningBanner(){
  const banner = document.getElementById("apiWarningBanner");
  if(!banner) return;
  banner.innerHTML =
    "⚠ This page could not connect to its storage engine (window.api is missing).<br>" +
    "Make sure <b>storage.js</b> is in the same folder as <b>index.html</b> and try reloading the page.";
  banner.classList.add("show");
}

// Check immediately, as soon as the script runs (the script tag sits at the
// very end of <body>, so the DOM - including this banner element - already
// exists by this point).
if(!apiIsReady()){
  console.error("window.api is unavailable at startup - storage.js may not have loaded.");
  showApiWarningBanner();
}

function save(key){
  if(!apiIsReady() || typeof window.api.saveKey !== "function"){
    console.error(`save("${key}"): window.api.saveKey is unavailable - this page is not running inside the desktop app (or its preload script failed to load).`);
    showApiWarningBanner();
    toast("Cannot save: the app's database connection is missing. Please restart the app.", 6000);
    throw new Error("window.api.saveKey is unavailable");
  }
  try{
    window.api.saveKey(key, STATE[key]);
  }catch(err){
    console.error(`save("${key}") failed:`, err);
    throw err;
  }
}

function saveAll(){
  const failed = [];
  Object.keys(LS).forEach(k=>{
    if(k==="theme") return;
    try{ save(k); }
    catch(err){ failed.push(k); }
  });
  if(failed.length){
    toast(`Saved everything except: ${failed.join(", ")} (see console for details).`, 6000);
  }
  return failed;
}

/* ---------------------------- Utilities ----------------------------------- */
function todayISO(){
  const d = new Date();
  return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0");
}
function dayNameFromISO(iso){
  const d = new Date(iso+"T00:00:00");
  const names = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
  return names[d.getDay()];
}
function isSunday(iso){
  const d = new Date(iso+"T00:00:00");
  return d.getDay() === 0;
}
function fmtDateLong(iso){
  const d = new Date(iso+"T00:00:00");
  const months = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  return d.getDate()+" "+months[d.getMonth()]+" "+d.getFullYear();
}
function toast(msg, durationMs){
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toast._h);
  toast._h = setTimeout(()=>t.classList.remove("show"), durationMs || 2200);
}
function fileToDataURL(file){
  return new Promise((res,rej)=>{
    const r = new FileReader();
    r.onload = ()=>res(r.result);
    r.onerror = rej;
    r.readAsDataURL(file);
  });
}
function statusClass(s){
  if(s==="Present") return "present";
  if(s==="Absent") return "absent";
  if(s==="Medical Leave") return "medical";
  if(s==="Leave") return "leave";
  if(s==="Training") return "training";
  if(s==="Meeting") return "meeting";
  return "";
}
function teacherById(id){ return STATE.teachers.find(t=>t.id===id); }
function statusOf(date, teacherId){
  return (STATE.attendance[date] && STATE.attendance[date][teacherId]) || "Present";
}

/* ---------------------------- Live Clock ----------------------------------- */
function tickClock(){
  const now = new Date();
  const dayNames = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
  document.getElementById("clockDay").textContent = dayNames[now.getDay()];
  const months = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  document.getElementById("clockDate").textContent = now.getDate()+" "+months[now.getMonth()]+" "+now.getFullYear();
  let h = now.getHours();
  const ampm = h>=12 ? "PM" : "AM";
  h = h%12; if(h===0) h=12;
  const time = String(h).padStart(2,"0")+":"+String(now.getMinutes()).padStart(2,"0")+":"+String(now.getSeconds()).padStart(2,"0")+" "+ampm;
  document.getElementById("clockTime").textContent = time;
}
setInterval(tickClock, 1000);

function currentPeriodNumber(){
  const now = new Date();
  const mins = now.getHours()*60+now.getMinutes()+now.getSeconds()/60;
  for(let i=0;i<STATE.periods.length;i++){
    const p = STATE.periods[i];
    const [sh,sm] = p.start.split(":").map(Number);
    const [eh,em] = p.end.split(":").map(Number);
    const s = sh*60+sm, e = eh*60+em;
    if(mins>=s && mins<e) return i+1;
  }
  return null;
}

/* The next period to start after "now" (or after the currently running
   one), used for the live Dashboard "Next Period" block. Returns null once
   the school day's periods are all done. */
function nextPeriodNumber(){
  const now = new Date();
  const mins = now.getHours()*60+now.getMinutes()+now.getSeconds()/60;
  let best = null, bestStart = Infinity;
  STATE.periods.forEach((p, idx)=>{
    const [sh,sm] = p.start.split(":").map(Number);
    const s = sh*60+sm;
    if(s > mins && s < bestStart){ bestStart = s; best = idx+1; }
  });
  return best;
}

/* -------------------- Live period tick: bell + auto refresh -------------- */
let _lastPeriodSeen = undefined; // undefined = not checked yet this session
let _lastDateSeen = todayISO();
function livePeriodTick(){
  const date = todayISO();
  if(date !== _lastDateSeen){
    // A new school day has begun - reset tracking and auto-run the
    // substitute engine for the new date so the dashboard is live.
    _lastDateSeen = date;
    _lastPeriodSeen = currentPeriodNumber();
    generateSubstitutesForDate(date);
  }

  const cur = currentPeriodNumber();
  if(_lastPeriodSeen === undefined){
    _lastPeriodSeen = cur; // first tick this session: just record, don't ring
  } else if(cur !== _lastPeriodSeen){
    _lastPeriodSeen = cur;
    ensureBellSettings();
    if(STATE.settings.bell.enabled){
      playBellTune(STATE.settings.bell.tune, STATE.settings.bell.volume);
    }
  }

  const activePage = document.querySelector(".navbtn.active")?.dataset.page;
  if(activePage === "dashboard") renderDashboard();
}
setInterval(livePeriodTick, 1000);

/* ---------------------------- Navigation ------------------------------------ */
function showPage(name){
  document.querySelectorAll(".page").forEach(p=>p.classList.remove("active"));
  document.getElementById("page-"+name).classList.add("active");
  document.querySelectorAll(".navbtn").forEach(b=>b.classList.toggle("active", b.dataset.page===name));
  document.getElementById("mainNav").classList.remove("open");
  const renderers = {
    dashboard: renderDashboard, profile: renderProfile, teachers: renderTeachers,
    timetable: renderTimetable, attendance: renderAttendance, substitute: renderSubstitutePage,
    sheet: renderSheet, reports: renderReports, search: renderSearch, settings: renderSettings
  };
  if(renderers[name]) renderers[name]();
}

document.querySelectorAll(".navbtn").forEach(b=>{
  b.addEventListener("click", ()=>showPage(b.dataset.page));
});
document.getElementById("menuToggle").addEventListener("click", ()=>{
  document.getElementById("mainNav").classList.toggle("open");
});

/* ---------------------------- Theme ------------------------------------------ */
function applyTheme(){
  const t = window.api.getTheme() || "light";
  document.documentElement.setAttribute("data-theme", t);
}
document.getElementById("themeToggle").addEventListener("click", ()=>{
  const cur = window.api.getTheme() || "light";
  window.api.setTheme(cur==="light" ? "dark" : "light");
  applyTheme();
});

/* ============================================================================
   SCHOOL PROFILE
   ============================================================================ */
function renderProfile(){
  const s = STATE.school;
  document.getElementById("p_name").value = s.name || "";
  document.getElementById("p_emis").value = s.emis || "";
  document.getElementById("p_district").value = s.district || "";
  document.getElementById("p_tehsil").value = s.tehsil || "";
  document.getElementById("p_address").value = s.address || "";
  document.getElementById("p_phone").value = s.phone || "";
  document.getElementById("p_email").value = s.email || "";
  document.getElementById("p_session").value = s.session || "";
  document.getElementById("p_htname").value = s.htName || "";
  document.getElementById("p_htdesig").value = s.htDesig || "";

  const preview = document.getElementById("profilePreview");
  preview.innerHTML = "";
  [["logo","Logo"],["signature","Signature"],["stamp","Stamp"]].forEach(([key,label])=>{
    if(s[key]){
      const wrap = document.createElement("div");
      wrap.innerHTML = `<div class="muted" style="margin-bottom:4px;">${label}</div><img src="${s[key]}" alt="${label}">`;
      preview.appendChild(wrap);
    }
  });
  document.getElementById("brandName").textContent = s.name || "Government School";
  document.getElementById("brandLogo").src = s.logo || "";
}

async function collectFile(id){
  const inp = document.getElementById(id);
  if(inp.files && inp.files[0]) return await fileToDataURL(inp.files[0]);
  return null;
}

document.getElementById("saveProfileBtn").addEventListener("click", async ()=>{
  const s = STATE.school;
  s.name = document.getElementById("p_name").value.trim();
  s.emis = document.getElementById("p_emis").value.trim();
  s.district = document.getElementById("p_district").value.trim();
  s.tehsil = document.getElementById("p_tehsil").value.trim();
  s.address = document.getElementById("p_address").value.trim();
  s.phone = document.getElementById("p_phone").value.trim();
  s.email = document.getElementById("p_email").value.trim();
  s.session = document.getElementById("p_session").value.trim();
  s.htName = document.getElementById("p_htname").value.trim();
  s.htDesig = document.getElementById("p_htdesig").value.trim();

  const logo = await collectFile("p_logo"); if(logo) s.logo = logo;
  const sig = await collectFile("p_signature"); if(sig) s.signature = sig;
  const stamp = await collectFile("p_stamp"); if(stamp) s.stamp = stamp;

  save("school");
  renderProfile();
  toast("School profile saved.");
});

/* ============================================================================
   TEACHERS
   ============================================================================ */
let teacherFilterState = {q:"", level:"", sort:"name"};

function renderTeachers(){
  document.getElementById("teacherCount").textContent = `(${STATE.teachers.length})`;
  let list = STATE.teachers.slice();
  const {q, level, sort} = teacherFilterState;
  if(q) list = list.filter(t => (t.name+" "+t.subject).toLowerCase().includes(q.toLowerCase()));
  if(level) list = list.filter(t => t.level===level);
  list.sort((a,b)=> (a[sort]||"").localeCompare(b[sort]||""));

  const tbody = document.querySelector("#teacherTable tbody");
  tbody.innerHTML = "";
  list.forEach(t=>{
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${t.photo ? `<img src="${t.photo}" style="width:32px;height:32px;border-radius:50%;object-fit:cover;">` : ""}</td>
      <td>${t.name}</td>
      <td>${t.designation||""}</td>
      <td>${t.subject||""}</td>
      <td>${t.level}</td>
      <td>${t.mobile||""}</td>
      <td>${t.classTeacherOf||""}</td>
      <td>${t.locked ? "🔒" : ""}</td>
      <td>
        <button class="btn small" data-edit="${t.id}">Edit</button>
        <button class="btn small danger" data-del="${t.id}">Delete</button>
      </td>`;
    tbody.appendChild(tr);
  });

  tbody.querySelectorAll("[data-edit]").forEach(b=>b.addEventListener("click", ()=>openTeacherModal(b.dataset.edit)));
  tbody.querySelectorAll("[data-del]").forEach(b=>b.addEventListener("click", ()=>{
    if(confirm("Delete this teacher? This cannot be undone.")){
      STATE.teachers = STATE.teachers.filter(t=>t.id!==b.dataset.del);
      save("teachers");
      renderTeachers();
      regenerateTodayAuto();
      toast("Teacher deleted.");
    }
  }));
}

document.getElementById("teacherSearch").addEventListener("input", e=>{teacherFilterState.q=e.target.value; renderTeachers();});
document.getElementById("teacherFilterLevel").addEventListener("change", e=>{teacherFilterState.level=e.target.value; renderTeachers();});
document.getElementById("teacherSort").addEventListener("change", e=>{teacherFilterState.sort=e.target.value; renderTeachers();});
document.getElementById("addTeacherBtn").addEventListener("click", ()=>{
  openTeacherModal(null);
});

function openTeacherModal(id){
  const existing = id ? teacherById(id) : null;
  const html = `
    <div class="modal-overlay">
      <div class="modal-box">
        <div class="modal-head"><h3>${existing?"Edit Teacher":"Add Teacher"}</h3><button class="modal-close" id="mClose">&times;</button></div>
        <div class="modal-body">
          <div class="form-grid">
            <label>Full Name<input id="m_name" type="text" value="${existing?.name||""}"></label>
            <label>Designation<input id="m_desig" type="text" value="${existing?.designation||""}"></label>
            <label>Subject<input id="m_subject" type="text" value="${existing?.subject||""}"></label>
            <label>Mobile Number<input id="m_mobile" type="text" value="${existing?.mobile||""}"></label>
            <label>Level
              <select id="m_level">${LEVELS.map(l=>`<option ${existing?.level===l?"selected":""}>${l}</option>`).join("")}</select>
            </label>
            <label>Class Teacher Of (optional)<input id="m_ct" type="text" value="${existing?.classTeacherOf||""}"></label>
            <label>Locked from Substitute Duty
              <select id="m_locked"><option value="no" ${!existing?.locked?"selected":""}>No</option><option value="yes" ${existing?.locked?"selected":""}>Yes</option></select>
            </label>
            <label>Teacher Photo (optional)<input id="m_photo" type="file" accept="image/*"></label>
          </div>
        </div>
        <div class="modal-foot">
          <button class="btn" id="mCancel">Cancel</button>
          <button class="btn primary" id="mSave">Save Teacher</button>
        </div>
      </div>
    </div>`;
  document.getElementById("modalRoot").innerHTML = html;
  const close = ()=>{ document.getElementById("modalRoot").innerHTML=""; };
  document.getElementById("mClose").addEventListener("click", close);
  document.getElementById("mCancel").addEventListener("click", close);
  document.getElementById("mSave").addEventListener("click", async ()=>{
    const name = document.getElementById("m_name").value.trim();
    if(!name){ toast("Teacher name is required."); return; }
    const dup = STATE.teachers.find(t=>t.name.toLowerCase()===name.toLowerCase() && t.id!==id);
    if(dup){ toast("A teacher with this name already exists."); return; }

    let photo = existing?.photo || "";
    const photoFile = document.getElementById("m_photo").files[0];
    if(photoFile) photo = await fileToDataURL(photoFile);

    const rec = {
      id: existing?.id || uid("t"),
      name,
      designation: document.getElementById("m_desig").value.trim(),
      subject: document.getElementById("m_subject").value.trim(),
      mobile: document.getElementById("m_mobile").value.trim(),
      level: document.getElementById("m_level").value,
      classTeacherOf: document.getElementById("m_ct").value.trim(),
      locked: document.getElementById("m_locked").value === "yes",
      photo
    };
    if(existing){
      STATE.teachers = STATE.teachers.map(t=>t.id===id ? rec : t);
    } else {
      STATE.teachers.push(rec);
    }
    save("teachers");
    renderTeachers();
    regenerateTodayAuto();
    close();
    toast("Teacher saved.");
  });
}

/* ============================================================================
   TIMETABLE
   ============================================================================ */
let ttState = {level:"Primary", classId:null};

function renderTimetable(){
  const tt = STATE.timetables[ttState.level];
  if(!ttState.classId || !tt.classes.find(c=>c.id===ttState.classId)){
    ttState.classId = tt.classes[0]?.id || null;
  }
  document.querySelectorAll("#ttLevelSeg .seg-btn").forEach(b=>b.classList.toggle("active", b.dataset.level===ttState.level));

  const classSel = document.getElementById("ttClass");
  classSel.innerHTML = tt.classes.map(c=>`<option value="${c.id}" ${c.id===ttState.classId?"selected":""}>${classLabel(c)}</option>`).join("");

  const tbody = document.querySelector("#ttTable tbody");
  tbody.innerHTML = "";
  if(!ttState.classId){ return; }
  STATE.periods.forEach((p, idx)=>{
    const pn = idx+1;
    const cell = tt.grid[ttState.classId][pn] || {subject:"Free", teacherId:""};
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${p.name}</td>
      <td>${p.start} - ${p.end}</td>
      <td><input type="text" class="tt-subject" data-period="${pn}" value="${cell.subject}"></td>
      <td class="select-cell"><select class="tt-teacher" data-period="${pn}">
        <option value="">-- none / free --</option>
        ${STATE.teachers.map(t=>`<option value="${t.id}" ${cell.teacherId===t.id?"selected":""}>${t.name}</option>`).join("")}
      </select></td>`;
    tbody.appendChild(tr);
  });

  tbody.querySelectorAll(".tt-subject").forEach(inp=>{
    inp.addEventListener("change", ()=>{
      const pn = inp.dataset.period;
      tt.grid[ttState.classId][pn].subject = inp.value.trim() || "Free";
      save("timetables");
    });
  });
  tbody.querySelectorAll(".tt-teacher").forEach(sel=>{
    sel.addEventListener("change", ()=>{
      const pn = sel.dataset.period;
      tt.grid[ttState.classId][pn].teacherId = sel.value;
      save("timetables");
      regenerateTodayAuto();
    });
  });
}

document.querySelectorAll("#ttLevelSeg .seg-btn").forEach(b=>{
  b.addEventListener("click", ()=>{ ttState.level = b.dataset.level; ttState.classId=null; renderTimetable(); });
});
document.getElementById("ttClass").addEventListener("change", e=>{ ttState.classId = e.target.value; renderTimetable(); });

document.getElementById("manageClassesBtn").addEventListener("click", ()=>{
  const tt = STATE.timetables[ttState.level];
  const rows = tt.classes.map(c=>`
    <tr>
      <td><input type="text" class="cls-name" data-id="${c.id}" value="${c.name}"></td>
      <td><input type="text" class="cls-group" data-id="${c.id}" value="${c.group||""}" placeholder="e.g. Jinnah"></td>
      <td><button class="btn small danger" data-delcls="${c.id}">Remove</button></td>
    </tr>`).join("");
  const html = `
    <div class="modal-overlay"><div class="modal-box">
      <div class="modal-head"><h3>Manage ${ttState.level} Classes</h3><button class="modal-close" id="mClose">&times;</button></div>
      <div class="modal-body">
        <table class="data-table" id="clsTable"><thead><tr><th>Class Name</th><th>Group</th><th></th></tr></thead>
        <tbody>${rows}</tbody></table>
        <div class="actions-row"><button class="btn" id="addClsBtn">+ Add Class Section</button></div>
      </div>
      <div class="modal-foot"><button class="btn primary" id="mDone">Done</button></div>
    </div></div>`;
  document.getElementById("modalRoot").innerHTML = html;
  const close = ()=>{ document.getElementById("modalRoot").innerHTML=""; ttState.classId=null; renderTimetable(); };
  document.getElementById("mClose").addEventListener("click", close);
  document.getElementById("mDone").addEventListener("click", close);
  document.querySelectorAll(".cls-name").forEach(inp=>inp.addEventListener("change", ()=>{
    const c = tt.classes.find(x=>x.id===inp.dataset.id); c.name = inp.value.trim(); save("timetables");
  }));
  document.querySelectorAll(".cls-group").forEach(inp=>inp.addEventListener("change", ()=>{
    const c = tt.classes.find(x=>x.id===inp.dataset.id); c.group = inp.value.trim()||null; save("timetables");
  }));
  document.querySelectorAll("[data-delcls]").forEach(b=>b.addEventListener("click", ()=>{
    const cid = b.dataset.delcls;
    tt.classes = tt.classes.filter(c=>c.id!==cid);
    delete tt.grid[cid];
    save("timetables");
    document.getElementById("manageClassesBtn").click();
  }));
  document.getElementById("addClsBtn").addEventListener("click", ()=>{
    const nc = {id:uid("c"), name:"New Class", group:null};
    tt.classes.push(nc);
    tt.grid[nc.id] = {};
    STATE.periods.forEach((p,i)=>{ tt.grid[nc.id][i+1]={subject:"Free", teacherId:""}; });
    save("timetables");
    document.getElementById("manageClassesBtn").click();
  });
});

/* Every period needs a stable id so that adding/removing rows can be
   told apart from just renumbering — old data may not have one yet. */
function ensurePeriodIds(){
  STATE.periods.forEach(p=>{ if(!p.id) p.id = uid("per"); });
}

function periodRowHtml(p){
  return `
    <tr data-id="${p.id}">
      <td><input type="text" class="per-name" value="${p.name}"></td>
      <td><input type="time" class="per-start" value="${p.start}"></td>
      <td><input type="time" class="per-end" value="${p.end}"></td>
      <td style="text-align:center;"><input type="checkbox" class="per-break" ${p.isBreak?"checked":""} title="Mark this as a break / recess (no substitute duty is generated for it)"></td>
      <td style="text-align:center;"><button type="button" class="btn danger per-remove" title="Remove this period">&times;</button></td>
    </tr>`;
}

document.getElementById("managePeriodsBtn").addEventListener("click", ()=>{
  ensurePeriodIds();
  const rows = STATE.periods.map(periodRowHtml).join("");
  const html = `
    <div class="modal-overlay"><div class="modal-box">
      <div class="modal-head"><h3>Manage Periods</h3><button class="modal-close" id="mClose">&times;</button></div>
      <div class="modal-body">
        <p class="muted" style="margin-top:0;">Tick "Break" for a recess/lunch period - the bell still rings for it, but it never gets a substitute assignment.</p>
        <table class="data-table" id="periodsTable"><thead><tr><th>Period Name</th><th>Start</th><th>End</th><th>Break</th><th></th></tr></thead>
        <tbody>${rows}</tbody></table>
        <div class="actions-row" style="margin-top:10px;"><button type="button" class="btn" id="mAddPeriod">+ Add Period</button></div>
      </div>
      <div class="modal-foot"><button class="btn primary" id="mDone">Save & Close</button></div>
    </div></div>`;
  document.getElementById("modalRoot").innerHTML = html;

  const tbody = document.querySelector("#periodsTable tbody");

  function bindRemove(){
    tbody.querySelectorAll(".per-remove").forEach(btn=>{
      btn.onclick = ()=>{
        if(tbody.querySelectorAll("tr").length <= 1){
          toast("At least one period is required.");
          return;
        }
        btn.closest("tr").remove();
      };
    });
  }
  bindRemove();

  document.getElementById("mAddPeriod").addEventListener("click", ()=>{
    const n = tbody.querySelectorAll("tr").length + 1;
    const newPeriod = { id: uid("per"), name: `Period ${n}`, start: "14:00", end: "14:40" };
    tbody.insertAdjacentHTML("beforeend", periodRowHtml(newPeriod));
    bindRemove();
  });

  const close = ()=>{
    // Read the current rows (in DOM order) into a fresh periods list,
    // keeping each row's id so we can tell which periods were removed,
    // which are unchanged, and which are brand new.
    const rowEls = Array.from(tbody.querySelectorAll("tr"));
    if(rowEls.length === 0){ toast("At least one period is required."); return; }

    const oldById = {};
    STATE.periods.forEach((p,i)=>{ oldById[p.id] = i+1; }); // old period number, 1-based

    const newPeriods = [];
    let hadInvalid = false;
    rowEls.forEach((tr, idx)=>{
      const id = tr.dataset.id;
      const name = tr.querySelector(".per-name").value.trim() || `Period ${idx+1}`;
      const s = tr.querySelector(".per-start").value;
      const e = tr.querySelector(".per-end").value;
      const isBreak = tr.querySelector(".per-break").checked;
      let start = s, end = e;
      if(!s || !e || s >= e){
        hadInvalid = true;
        const prev = STATE.periods.find(p=>p.id===id);
        start = prev ? prev.start : "08:00";
        end = prev ? prev.end : "08:40";
      }
      newPeriods.push({ id, name, start, end, isBreak });
    });
    if(hadInvalid) toast("Some periods had an invalid time range; those were kept unchanged.");

    // Map old period number -> new period number for every id that still exists.
    const oldToNew = {};
    newPeriods.forEach((p, i)=>{
      const newNum = i+1;
      if(oldById[p.id]) oldToNew[oldById[p.id]] = newNum;
    });

    // Rebuild every level's grid with the new period numbering, carrying
    // forward subject/teacher assignments for periods that still exist
    // and leaving brand-new period columns empty ("Free").
    LEVELS.forEach(level=>{
      const tt = STATE.timetables[level];
      if(!tt) return;
      tt.classes.forEach(c=>{
        const oldGrid = tt.grid[c.id] || {};
        const newGrid = {};
        for(let newNum=1; newNum<=newPeriods.length; newNum++){
          const oldNum = Object.keys(oldToNew).find(k=>oldToNew[k]===newNum);
          newGrid[newNum] = (oldNum && oldGrid[oldNum]) ? oldGrid[oldNum] : {subject:"Free", teacherId:""};
        }
        tt.grid[c.id] = newGrid;
      });
    });

    STATE.periods = newPeriods;
    save("periods");
    save("timetables");
    document.getElementById("modalRoot").innerHTML = "";
    renderTimetable();
    regenerateTodayAuto();
    toast("Periods updated.");
  };
  document.getElementById("mClose").addEventListener("click", close);
  document.getElementById("mDone").addEventListener("click", close);
});

/* ============================================================================
   ATTENDANCE
   ============================================================================ */
function renderAttendance(){
  const dateInp = document.getElementById("attDate");
  if(!dateInp.value) dateInp.value = todayISO();
  const date = dateInp.value;
  const tbody = document.querySelector("#attTable tbody");
  tbody.innerHTML = "";
  STATE.teachers.forEach(t=>{
    const st = statusOf(date, t.id);
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${t.name}</td><td>${t.level}</td>
      <td class="select-cell">
        <select data-tid="${t.id}">
          ${STATUSES.map(s=>`<option ${st===s?"selected":""}>${s}</option>`).join("")}
        </select>
        <span class="badge ${statusClass(st)}" style="margin-left:8px;">${st}</span>
      </td>`;
    tbody.appendChild(tr);
  });
  tbody.querySelectorAll("select").forEach(sel=>{
    sel.addEventListener("change", ()=>{
      const d = document.getElementById("attDate").value;
      STATE.attendance[d] = STATE.attendance[d] || {};
      STATE.attendance[d][sel.dataset.tid] = sel.value;
      save("attendance");
      renderAttendance();
      if(d === todayISO()) regenerateTodayAuto();
    });
  });
}
document.getElementById("attDate").addEventListener("change", renderAttendance);
document.getElementById("markAllPresentBtn").addEventListener("click", ()=>{
  const d = document.getElementById("attDate").value || todayISO();
  STATE.attendance[d] = {};
  STATE.teachers.forEach(t=> STATE.attendance[d][t.id] = "Present");
  save("attendance");
  renderAttendance();
  if(d === todayISO()) regenerateTodayAuto();
  toast("All teachers marked present.");
});

/* ============================================================================
   SUBSTITUTE DUTY ENGINE
   ============================================================================ */
/* ----------------------------------------------------------------------
   Category eligibility rules (critical, never to be violated):
   Every teacher category (Primary / Middle / High) has its OWN independent
   lock against every target class category, configured by the Admin in
   Settings -> Substitute Eligibility Rules (STATE.settings.categoryLocks).
   Locking, say, Primary teachers out of High classes does NOT touch
   Primary->Middle, Primary->Primary, or any Middle/High rule - see
   isEligibleCategory() above. This must never be collapsed back into a
   single Primary+Middle-vs-High group toggle.
   ---------------------------------------------------------------------- */

function isTeacherBusy(period, teacherId){
  for(const level of LEVELS){
    const tt = STATE.timetables[level];
    for(const c of tt.classes){
      const cell = tt.grid[c.id]?.[period];
      if(cell && cell.teacherId === teacherId) return true;
    }
  }
  return false;
}

function substituteCountSoFar(teacherId){
  let count = 0;
  Object.values(STATE.substitutes).forEach(list=>{
    list.forEach(r=>{ if(r.substituteTeacherId === teacherId) count++; });
  });
  return count;
}

/* alreadyUsedToday: a Set of teacherIds already given ONE automatic
   substitute duty today - the automatic engine gives each present teacher
   at most one substitute period per day, so duties spread out fairly.
   (The Admin can still manually assign a free teacher to more than one
   period in the same day from the Substitute Duty page - that limit only
   applies to the automatic picker.) */
function findBestSubstitute(date, level, period, alreadyUsedToday, absentTeacherId){
  let candidates = STATE.teachers.filter(t=>{
    if(t.id === absentTeacherId) return false;            // never their own substitute
    if(t.locked) return false;                              // individually locked from all substitute duty
    if(statusOf(date, t.id) !== "Present") return false;     // only free, present teachers
    if(alreadyUsedToday.has(t.id)) return false;              // one automatic substitute period per day
    if(isTeacherBusy(period, t.id)) return false;             // not already teaching another class this period
    if(!isEligibleCategory(t.level, level)) return false;     // must be eligible for this target category
    return true;
  });
  if(candidates.length === 0) return null;

  // Fair, random rotation. Prefer whoever has done the fewest substitute
  // duties so far, but when several teachers are tied for that minimum,
  // pick randomly among just those so the same person isn't unnecessarily
  // selected repeatedly when other eligible teachers are available.
  const minCount = Math.min(...candidates.map(t=>substituteCountSoFar(t.id)));
  const leastUsed = candidates.filter(t=>substituteCountSoFar(t.id) === minCount);
  return leastUsed[Math.floor(Math.random() * leastUsed.length)];
}

function generateSubstitutesForDate(date){
  const day = dayNameFromISO(date);
  const records = [];
  // Automatic picker: each teacher gets at most ONE substitute period per
  // day, tracked across the whole day (not per period).
  const alreadyUsedToday = new Set();

  // Preserve manual overrides keyed by absentTeacherId+level+classId+period
  const prevManual = {};
  (STATE.substitutes[date] || []).forEach(r=>{
    if(r.manual) prevManual[r.absentTeacherId+"|"+r.level+"|"+r.classId+"|"+r.period] = r;
  });

  const absentTeachers = STATE.teachers.filter(t => NON_PRESENT.includes(statusOf(date, t.id)));

  absentTeachers.forEach(at=>{
    LEVELS.forEach(level=>{
      const tt = STATE.timetables[level];
      tt.classes.forEach(cls=>{
        STATE.periods.forEach((p, idx)=>{
          const pn = idx+1;
          if(p.isBreak) return; // no class runs during a break - nothing to substitute
          const cell = tt.grid[cls.id][pn];
          if(!cell || cell.teacherId !== at.id) return; // this class/period is not this absent teacher's

          const key = at.id+"|"+level+"|"+cls.id+"|"+pn;
          if(prevManual[key]){
            const r = prevManual[key];
            records.push(r);
            if(r.substituteTeacherId) alreadyUsedToday.add(r.substituteTeacherId);
            return;
          }

          const sub = findBestSubstitute(date, level, pn, alreadyUsedToday, at.id);
          const rec = {
            id: uid("sub"),
            date, day,
            absentTeacherId: at.id,
            reason: statusOf(date, at.id),
            level, classId: cls.id, className: classLabel(cls),
            period: pn, periodTiming: p.start+" - "+p.end,
            subject: cell.subject,
            substituteTeacherId: sub ? sub.id : "",
            remarks: sub ? "" : "No eligible substitute available.",
            manual: false
          };
          if(sub) alreadyUsedToday.add(sub.id);
          records.push(rec);
        });
      });
    });
  });

  STATE.substitutes[date] = records;
  save("substitutes");
}

/* Every teacher currently on substitute duty for a given period, across
   every level/class - used so a substitute never double-books a period
   and never shows up in the Free Teachers list for that period. */
function substituteTeacherIdsForPeriod(date, period){
  const ids = new Set();
  (STATE.substitutes[date] || []).forEach(r=>{
    if(r.period === period && r.substituteTeacherId) ids.add(r.substituteTeacherId);
  });
  return ids;
}

/* Teachers who are Present, not teaching their own class this period, and
   not already assigned as a substitute this period. */
function freeTeachersForPeriod(date, period){
  if(!period) return [];
  const onSubDuty = substituteTeacherIdsForPeriod(date, period);
  return STATE.teachers.filter(t=>{
    if(statusOf(date, t.id) !== "Present") return false;
    if(isTeacherBusy(period, t.id)) return false;
    if(onSubDuty.has(t.id)) return false;
    return true;
  });
}

/* Re-runs the automatic substitute engine for TODAY only, so eligibility
   changes (category locks, teacher list, periods, attendance) apply live
   without the Admin needing to remember to press "Generate Substitute
   Duty" again. Any manual override made today is preserved (see
   generateSubstitutesForDate's prevManual handling). Past/other dates are
   left untouched. */
function regenerateTodayAuto(){
  const date = todayISO();
  generateSubstitutesForDate(date);
  const activePage = document.querySelector(".navbtn.active")?.dataset.page;
  if(activePage === "dashboard") renderDashboard();
  if(activePage === "substitute" && document.getElementById("subDate").value === date) paintSubTable();
}

/* ---------------------------- Substitute Duty Page --------------------------- */
function renderSubstitutePage(){
  const dateInp = document.getElementById("subDate");
  if(!dateInp.value) dateInp.value = todayISO();
  paintSubTable();
}

function paintSubTable(){
  const date = document.getElementById("subDate").value;
  const records = STATE.substitutes[date] || [];
  const tbody = document.querySelector("#subTable tbody");
  tbody.innerHTML = "";
  if(records.length === 0){
    const absentToday = STATE.teachers.filter(t => NON_PRESENT.includes(statusOf(date, t.id)));
    let msg;
    if(!Object.prototype.hasOwnProperty.call(STATE.substitutes, date)){
      msg = `Click "Generate Substitute Duty" to build today's list.`;
    } else if(absentToday.length === 0){
      msg = `No teacher is marked Absent / Leave / Training / Meeting / Medical for ${date}. Go to the Attendance tab, pick this same date, and mark someone absent first.`;
    } else {
      const day = dayNameFromISO(date);
      msg = `${absentToday.map(t=>t.name).join(", ")} ${absentToday.length>1?"are":"is"} marked absent on ${day}, but no timetable cell has ${absentToday.length>1?"them":"that teacher"} selected in the "Teacher" dropdown. Open the Timetable tab, find their period, and choose their name in the Teacher column (not just the Subject box).`;
    }
    tbody.innerHTML = `<tr><td colspan="9" class="muted" style="text-align:center;padding:18px;">${msg}</td></tr>`;
    return;
  }
  records.forEach(r=>{
    const at = teacherById(r.absentTeacherId);
    const tr = document.createElement("tr");
    const subOptions = STATE.teachers.map(t=>`<option value="${t.id}" ${r.substituteTeacherId===t.id?"selected":""}>${t.name}</option>`).join("");
    tr.innerHTML = `
      <td>${at?at.name:"?"}</td>
      <td><span class="badge ${statusClass(r.reason)}">${r.reason}</span></td>
      <td>${r.level}</td>
      <td>${r.className}</td>
      <td>P${r.period}</td>
      <td>${r.periodTiming}</td>
      <td>${r.subject}</td>
      <td class="select-cell"><select data-id="${r.id}"><option value="">-- No Teacher Available --</option>${subOptions}</select></td>
      <td>${r.remarks||""}</td>`;
    tbody.appendChild(tr);
  });
  tbody.querySelectorAll("select").forEach(sel=>{
    sel.addEventListener("change", ()=>{
      const date = document.getElementById("subDate").value;
      const rec = STATE.substitutes[date].find(r=>r.id===sel.dataset.id);
      // validation: prevent assigning a teacher already on substitute duty
      // this SAME period, or one who is busy teaching their own class then.
      const usedThisPeriod = STATE.substitutes[date].some(r=>r.id!==rec.id && r.period===rec.period && r.substituteTeacherId===sel.value);
      if(sel.value && usedThisPeriod){ toast("That teacher already has a substitute duty in this period."); renderSubstitutePage(); return; }
      if(sel.value && isTeacherBusy(rec.period, sel.value)){ toast("That teacher is not free during this period."); renderSubstitutePage(); return; }
      if(sel.value){
        const chosen = teacherById(sel.value);
        if(chosen && !isEligibleCategory(chosen.level, rec.level)){
          toast(`${chosen.level} teachers are currently locked out from substituting ${rec.level} classes. Change this in Settings if needed.`, 5000);
          renderSubstitutePage();
          return;
        }
      }
      rec.substituteTeacherId = sel.value;
      rec.manual = true;
      rec.remarks = sel.value ? "Manually assigned" : "No eligible substitute available.";
      save("substitutes");
      paintSubTable();
      toast("Substitute updated.");
    });
  });
}
document.getElementById("subDate").addEventListener("change", paintSubTable);
document.getElementById("generateSubBtn").addEventListener("click", ()=>{
  const date = document.getElementById("subDate").value || todayISO();
  generateSubstitutesForDate(date);
  paintSubTable();
  toast("Substitute duty generated.");
});

/* ============================================================================
   DASHBOARD
   ============================================================================ */
function periodLabel(pn){
  if(!pn) return null;
  const p = STATE.periods[pn-1];
  if(!p) return null;
  return `${p.name} (${p.start} - ${p.end})${p.isBreak?" — Break":""}`;
}

function renderLiveDashboardSections(){
  const date = todayISO();
  const cur = currentPeriodNumber();
  const nxt = nextPeriodNumber();

  document.getElementById("liveCurrentPeriod").textContent = periodLabel(cur) || "No period running now";
  document.getElementById("liveNextPeriod").textContent = periodLabel(nxt) || "No more periods today";

  // Live class table: every class, this period, across all levels.
  const rows = [];
  if(cur && !STATE.periods[cur-1]?.isBreak){
    LEVELS.forEach(level=>{
      const tt = STATE.timetables[level];
      tt.classes.forEach(cls=>{
        const cell = tt.grid[cls.id]?.[cur];
        if(!cell) return;
        const teacher = teacherById(cell.teacherId);
        const status = teacher ? statusOf(date, teacher.id) : "";
        let subName = "-";
        if(teacher && status !== "Present"){
          const rec = (STATE.substitutes[date]||[]).find(r=>r.level===level && r.classId===cls.id && r.period===cur);
          const sub = rec ? teacherById(rec.substituteTeacherId) : null;
          subName = sub ? sub.name : "No Teacher Available";
        }
        rows.push(`<tr>
          <td>${level}</td><td>${classLabel(cls)}</td><td>${cell.subject}</td>
          <td>${teacher?teacher.name:"-"}</td>
          <td>${teacher?`<span class="badge ${statusClass(status)}">${status}</span>`:""}</td>
          <td>${teacher && status!=="Present" ? subName : "-"}</td>
        </tr>`);
      });
    });
  }
  const liveBody = document.querySelector("#liveClassTable tbody");
  liveBody.innerHTML = rows.length ? rows.join("") :
    `<tr><td colspan="6" class="muted" style="text-align:center;padding:16px;">${cur ? "This is a break period." : "No period is currently running."}</td></tr>`;

  // Free teachers this period.
  const freeWrap = document.getElementById("liveFreeTeachersWrap");
  if(!cur){
    freeWrap.innerHTML = `<p class="muted" style="padding:8px 0;">No period is currently running.</p>`;
  } else {
    const free = freeTeachersForPeriod(date, cur);
    freeWrap.innerHTML = free.length
      ? `<table class="data-table"><thead><tr><th>Name</th><th>Level</th><th>Subject</th></tr></thead><tbody>${
          free.map(t=>`<tr><td>${t.name}</td><td>${t.level}</td><td>${t.subject||""}</td></tr>`).join("")
        }</tbody></table>`
      : `<p class="muted" style="padding:8px 0;">No free teachers this period.</p>`;
  }
}

function renderDashboard(){
  const date = todayISO();
  renderLiveDashboardSections();
  const total = STATE.teachers.length;
  const counts = {Present:0, Absent:0, Leave:0, Training:0, Meeting:0, "Medical Leave":0};
  STATE.teachers.forEach(t=> counts[statusOf(date,t.id)]++ );

  const period = currentPeriodNumber();
  const presentCount = STATE.teachers.filter(t=>statusOf(date,t.id)==="Present").length;
  const free = period ? freeTeachersForPeriod(date, period).length : 0;
  const busy = period ? Math.max(0, presentCount - free) : 0;

  const subToday = (STATE.substitutes[date]||[]).length;

  const stats = [
    ["Total Teachers", total],
    ["Present Today", counts.Present],
    ["Absent Today", counts.Absent],
    ["On Leave", counts.Leave],
    ["In Training", counts.Training],
    ["In Meeting", counts.Meeting],
    ["Medical Leave", counts["Medical Leave"]],
    ["Busy This Period", period?busy:"-"],
    ["Free This Period", period?free:"-"],
    ["Substitute Duties Today", subToday]
  ];
  const grid = document.getElementById("statGrid");
  grid.innerHTML = stats.map(([lbl,num])=>`<div class="stat-card"><div class="num">${num}</div><div class="lbl">${lbl}</div></div>`).join("");

  const tbody = document.querySelector("#dashSubTable tbody");
  const records = STATE.substitutes[date] || [];
  tbody.innerHTML = records.length ? records.map(r=>{
    const at = teacherById(r.absentTeacherId);
    const sub = teacherById(r.substituteTeacherId);
    return `<tr><td>${at?at.name:"?"}</td><td>${r.reason}</td><td>${r.className}</td><td>P${r.period}</td><td>${r.subject}</td><td>${sub?sub.name:"No Teacher Available"}</td></tr>`;
  }).join("") : `<tr><td colspan="6" class="muted" style="text-align:center;padding:16px;">No substitute duties recorded for today yet.</td></tr>`;
}

/* ============================================================================
   PRINT SHEET
   ============================================================================ */
function renderSheet(){
  const dateInp = document.getElementById("sheetDate");
  if(!dateInp.value) dateInp.value = todayISO();
  paintSheet();
}
function paintSheet(){
  const date = document.getElementById("sheetDate").value;
  const s = STATE.school;
  document.getElementById("ps_logo").src = s.logo || "";
  document.getElementById("ps_schoolname").textContent = s.name || "School Name";
  document.getElementById("ps_meta1").textContent = `${s.district||"-"} | ${s.tehsil||"-"} | EMIS: ${s.emis||"-"}`;
  document.getElementById("ps_meta2").textContent = s.address || "";
  document.getElementById("ps_date").textContent = fmtDateLong(date);
  document.getElementById("ps_day").textContent = dayNameFromISO(date);
  document.getElementById("ps_time").textContent = document.getElementById("clockTime").textContent;
  document.getElementById("ps_ht_desig").textContent = s.htDesig || "Head Teacher";
  document.getElementById("ps_ht_name").textContent = s.htName || "";
  document.getElementById("ps_signature").src = s.signature || "";
  document.getElementById("ps_stamp").src = s.stamp || "";

  const records = STATE.substitutes[date] || [];
  const body = document.getElementById("ps_body");
  body.innerHTML = records.length ? records.map((r,i)=>{
    const at = teacherById(r.absentTeacherId);
    const sub = teacherById(r.substituteTeacherId);
    return `<tr><td>${i+1}</td><td>${at?at.name:"?"}</td><td>${r.reason}</td><td>${r.className}</td><td>${r.subject}</td><td>P${r.period}</td><td>${r.periodTiming}</td><td>${sub?sub.name:"No Teacher Available"}</td><td>${r.remarks||""}</td></tr>`;
  }).join("") : `<tr><td colspan="9" style="text-align:center;padding:14px;">No substitute duties recorded for this date.</td></tr>`;
}
document.getElementById("sheetDate").addEventListener("change", paintSheet);
document.getElementById("printSheetBtn").addEventListener("click", ()=>{ paintSheet(); window.print(); });

/* ============================================================================
   REPORTS
   ============================================================================ */
let repState = {type:"daily"};
function renderReports(){
  const dateInp = document.getElementById("repDate");
  if(!dateInp.value) dateInp.value = todayISO();
  const teacherSel = document.getElementById("repTeacher");
  teacherSel.innerHTML = STATE.teachers.map(t=>`<option value="${t.id}">${t.name}</option>`).join("");
  document.getElementById("repTeacher").style.display = repState.type==="teacher" ? "" : "none";
  paintReport();
}
document.querySelectorAll("#repTypeSeg .seg-btn").forEach(b=>{
  b.addEventListener("click", ()=>{
    repState.type = b.dataset.rep;
    document.querySelectorAll("#repTypeSeg .seg-btn").forEach(x=>x.classList.toggle("active", x===b));
    document.getElementById("repTeacher").style.display = repState.type==="teacher" ? "" : "none";
    paintReport();
  });
});
document.getElementById("repDate").addEventListener("change", paintReport);
document.getElementById("repTeacher").addEventListener("change", paintReport);
document.getElementById("repPrintBtn").addEventListener("click", ()=>window.print());

function datesInRange(centerISO, daysBack, daysFwd){
  const out = [];
  const center = new Date(centerISO+"T00:00:00");
  for(let i=-daysBack;i<=daysFwd;i++){
    const d = new Date(center); d.setDate(d.getDate()+i);
    out.push(d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0"));
  }
  return out;
}

function paintReport(){
  const out = document.getElementById("reportOutput");
  const date = document.getElementById("repDate").value || todayISO();
  let dates = [date];
  if(repState.type === "weekly") dates = datesInRange(date, 6, 0);
  if(repState.type === "monthly"){
    const d = new Date(date+"T00:00:00");
    dates = [];
    const daysInMonth = new Date(d.getFullYear(), d.getMonth()+1, 0).getDate();
    for(let day=1; day<=daysInMonth; day++){
      dates.push(d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(day).padStart(2,"0"));
    }
  }

  if(repState.type === "teacher"){
    const tid = document.getElementById("repTeacher").value;
    const rows = [];
    Object.keys(STATE.substitutes).sort().forEach(d=>{
      STATE.substitutes[d].forEach(r=>{
        if(r.absentTeacherId===tid || r.substituteTeacherId===tid){
          const at = teacherById(r.absentTeacherId), sub = teacherById(r.substituteTeacherId);
          rows.push(`<tr><td>${d}</td><td>${r.absentTeacherId===tid?"Was Absent":"Covered Duty"}</td><td>${at?at.name:"?"}</td><td>${r.className}</td><td>P${r.period}</td><td>${sub?sub.name:"—"}</td></tr>`);
        }
      });
    });
    out.innerHTML = `<table class="data-table"><thead><tr><th>Date</th><th>Role</th><th>Absent Teacher</th><th>Class</th><th>Period</th><th>Substitute</th></tr></thead><tbody>${rows.join("")||`<tr><td colspan="6" class="muted" style="text-align:center;padding:16px;">No records found.</td></tr>`}</tbody></table>`;
    return;
  }

  const rows = [];
  dates.forEach(d=>{
    (STATE.substitutes[d]||[]).forEach(r=>{
      const at = teacherById(r.absentTeacherId), sub = teacherById(r.substituteTeacherId);
      rows.push(`<tr><td>${d}</td><td>${at?at.name:"?"}</td><td>${r.reason}</td><td>${r.className}</td><td>P${r.period}</td><td>${r.subject}</td><td>${sub?sub.name:"No Teacher Available"}</td></tr>`);
    });
  });
  out.innerHTML = `<table class="data-table"><thead><tr><th>Date</th><th>Absent Teacher</th><th>Reason</th><th>Class</th><th>Period</th><th>Subject</th><th>Substitute</th></tr></thead><tbody>${rows.join("")||`<tr><td colspan="7" class="muted" style="text-align:center;padding:16px;">No substitute duty records in this range.</td></tr>`}</tbody></table>`;
}

/* ============================================================================
   SEARCH
   ============================================================================ */
function renderSearch(){ paintSearch(); }
document.getElementById("searchType").addEventListener("change", ()=>{
  const type = document.getElementById("searchType").value;
  document.getElementById("searchDate").style.display = type==="date" ? "" : "none";
  document.getElementById("searchText").style.display = type==="date" ? "none" : "";
  paintSearch();
});
document.getElementById("searchText").addEventListener("input", paintSearch);
document.getElementById("searchDate").addEventListener("change", paintSearch);

function paintSearch(){
  const type = document.getElementById("searchType").value;
  const q = document.getElementById("searchText").value.trim().toLowerCase();
  const qDate = document.getElementById("searchDate").value;
  const tbody = document.querySelector("#searchResults tbody");
  const rows = [];
  Object.keys(STATE.substitutes).sort().reverse().forEach(d=>{
    STATE.substitutes[d].forEach(r=>{
      const at = teacherById(r.absentTeacherId), sub = teacherById(r.substituteTeacherId);
      let match = true;
      if(type==="teacher") match = q ? (at && at.name.toLowerCase().includes(q)) : true;
      else if(type==="class") match = q ? r.className.toLowerCase().includes(q) : true;
      else if(type==="subject") match = q ? r.subject.toLowerCase().includes(q) : true;
      else if(type==="date") match = qDate ? d===qDate : true;
      else if(type==="substitute") match = q ? (sub && sub.name.toLowerCase().includes(q)) : true;
      if(match && (q || qDate)) rows.push(`<tr><td>${d}</td><td>${at?at.name:"?"}</td><td>${r.className}</td><td>${r.subject}</td><td>P${r.period}</td><td>${sub?sub.name:"No Teacher Available"}</td></tr>`);
    });
  });
  tbody.innerHTML = rows.length ? rows.join("") : `<tr><td colspan="6" class="muted" style="text-align:center;padding:16px;">Type a search term to see results.</td></tr>`;
}

/* ============================================================================
   SETTINGS
   ============================================================================ */
function renderSettings(){
  document.getElementById("s_start").value = STATE.settings.start || "08:00";
  document.getElementById("s_end").value = STATE.settings.end || "14:00";
  document.getElementById("s_saturday").value = STATE.settings.saturday || "no";
  document.getElementById("s_session").value = STATE.settings.session || "";
  renderLockMatrix();
  renderBellSettings();
  if(typeof populateBackupList === "function") populateBackupList();
}
document.getElementById("saveSettingsBtn").addEventListener("click", ()=>{
  STATE.settings.start = document.getElementById("s_start").value;
  STATE.settings.end = document.getElementById("s_end").value;
  STATE.settings.saturday = document.getElementById("s_saturday").value;
  STATE.settings.session = document.getElementById("s_session").value;
  save("settings");
  toast("Settings saved.");
});

/* ---------------------------- Substitute Eligibility Lock Matrix ---------- */
function renderLockMatrix(){
  ensureCategoryLocks();
  const tbody = document.querySelector("#lockMatrixTable tbody");
  tbody.innerHTML = LEVELS.map(from=>{
    const cells = LEVELS.map(to=>
      `<td style="text-align:center;"><input type="checkbox" class="lock-cell" data-from="${from}" data-to="${to}" ${STATE.settings.categoryLocks[from][to]?"checked":""}></td>`
    ).join("");
    return `<tr><td><b>${from}</b></td>${cells}</tr>`;
  }).join("");
}
document.getElementById("saveLocksBtn").addEventListener("click", ()=>{
  ensureCategoryLocks();
  document.querySelectorAll("#lockMatrixTable .lock-cell").forEach(cb=>{
    STATE.settings.categoryLocks[cb.dataset.from][cb.dataset.to] = cb.checked;
  });
  save("settings");
  regenerateTodayAuto();
  toast("Eligibility rules saved. Future substitute assignments will use these rules.");
});

/* ---------------------------- Bell / Ringing Tune -------------------------- */
function renderBellSettings(){
  ensureBellSettings();
  const b = STATE.settings.bell;
  document.getElementById("bell_enabled").value = b.enabled ? "yes" : "no";
  document.getElementById("bell_tune").value = b.tune || "classic";
  document.getElementById("bell_volume").value = typeof b.volume==="number" ? b.volume : 0.7;
}
document.getElementById("saveBellBtn").addEventListener("click", async ()=>{
  ensureBellSettings();
  const b = STATE.settings.bell;
  b.enabled = document.getElementById("bell_enabled").value === "yes";
  b.tune = document.getElementById("bell_tune").value;
  b.volume = parseFloat(document.getElementById("bell_volume").value);
  const file = document.getElementById("bell_custom").files[0];
  if(file) b.customSound = await fileToDataURL(file);
  save("settings");
  toast("Bell settings saved.");
});
document.getElementById("bellTestBtn").addEventListener("click", ()=>{
  const enabledSel = document.getElementById("bell_enabled").value;
  const tune = document.getElementById("bell_tune").value;
  const volume = parseFloat(document.getElementById("bell_volume").value);
  if(enabledSel === "no"){ toast("Bell is set to Disabled - enable it first to hear a test."); return; }
  playBellTune(tune, volume);
});

/* Plays the configured tune using the Web Audio API (no external sound
   files, works fully offline) unless a custom upload is set. */
let _bellAudioCtx = null;
function playBellTune(tune, volume){
  if(tune === "custom" && STATE.settings.bell.customSound){
    try{
      const audio = new Audio(STATE.settings.bell.customSound);
      audio.volume = typeof volume==="number" ? volume : 0.7;
      audio.play().catch(()=>{});
    }catch(e){ /* ignore playback errors */ }
    return;
  }
  try{
    if(!_bellAudioCtx) _bellAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const ctx = _bellAudioCtx;
    const vol = typeof volume==="number" ? volume : 0.7;
    const now = ctx.currentTime;

    function tone(freq, start, dur, type, peak){
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type || "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, now+start);
      gain.gain.linearRampToValueAtTime(peak, now+start+0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now+start+dur);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now+start);
      osc.stop(now+start+dur+0.05);
    }

    if(tune === "digital"){
      tone(880, 0, 0.15, "square", vol*0.4);
      tone(1046, 0.18, 0.15, "square", vol*0.4);
      tone(880, 0.36, 0.15, "square", vol*0.4);
    } else if(tune === "buzzer"){
      tone(220, 0, 0.5, "sawtooth", vol*0.5);
      tone(220, 0.55, 0.5, "sawtooth", vol*0.5);
    } else {
      // classic ding-dong
      tone(784, 0, 0.7, "sine", vol*0.5);
      tone(659, 0.6, 0.9, "sine", vol*0.5);
    }
  }catch(e){ /* AudioContext unavailable - fail silently, never block the app */ }
}

document.getElementById("exportBtn").addEventListener("click", async ()=>{
  if(!apiIsReady() || typeof window.api.exportBackup !== "function"){
    toast("Cannot export: the app's database connection is missing. Please restart the app.", 6000);
    return;
  }
  const backup = {};
  Object.keys(LS).forEach(k=>{ if(k!=="theme") backup[k] = STATE[k]; });
  try{
    const result = await window.api.exportBackup(JSON.stringify(backup, null, 2));
    if(result.canceled) return; // user closed the Save As dialog, nothing to report
    if(result.ok){
      toast(`Backup exported to: ${result.filePath}`, 6000);
    }else{
      toast("Export failed: " + result.error, 6000);
    }
  }catch(err){
    console.error("Export failed:", err);
    toast("Export failed: " + err.message, 6000);
  }
});

/* Names of every slice a backup file can contain (everything except the
   UI-only "theme" key), used to validate a file before touching STATE. */
const BACKUP_KEYS = Object.keys(LS).filter(k=>k!=="theme");

function applyImportedBackup(raw){
  // Step 1: the file must be valid JSON at all. This is the ONLY case
  // that should ever be reported as "Invalid backup file" — any error
  // that happens later (while saving or refreshing the screen) is a
  // different problem and must not be reported with this same message,
  // otherwise a perfectly good backup looks like it "failed" to import.
  let data;
  try{
    data = JSON.parse(raw);
  }catch(err){
    toast("Import failed: that file is not valid JSON.");
    return;
  }

  if(!data || typeof data !== "object" || Array.isArray(data)){
    toast("Import failed: that file is not a valid SSMS backup file.");
    return;
  }

  const matchedKeys = BACKUP_KEYS.filter(k => data[k] !== undefined);
  if(matchedKeys.length === 0){
    toast("Import failed: this file doesn't contain any recognizable school data.");
    return;
  }

  // Step 2: apply and persist what was found, one section at a time.
  // Each section is saved independently so that if one of them fails
  // (e.g. a huge logo image, or a malformed value) it doesn't stop the
  // other, perfectly good sections from being saved too.
  const savedKeys = [];
  const failedKeys = [];
  matchedKeys.forEach(k=>{
    try{
      STATE[k] = data[k];
      save(k);
      savedKeys.push(k);
    }catch(err){
      console.error(`Import: failed to save "${k}":`, err);
      failedKeys.push(k);
    }
  });

  if(savedKeys.length === 0){
    toast(`Import failed while saving to disk (${failedKeys.join(", ")}). See console for details.`, 6000);
    return;
  }

  if(failedKeys.length){
    toast(`Imported ${savedKeys.length} of ${matchedKeys.length} sections. Failed: ${failedKeys.join(", ")}.`, 8000);
  }else{
    toast(`Backup imported and saved (${savedKeys.length} section${savedKeys.length===1?"":"s"} restored).`);
  }

  // Step 3: refresh the screen from what was just saved. A problem here
  // does NOT mean the import failed — the data is already safely on
  // disk — so this gets its own, separate message.
  try{
    load();
    showPage("dashboard");
  }catch(err){
    console.error("Import: data was saved, but refreshing the screen failed:", err);
    toast("Data was imported and saved. Please restart the app to see it.", 6000);
  }
}

document.getElementById("importBtn").addEventListener("click", async ()=>{
  if(!apiIsReady() || typeof window.api.importBackup !== "function"){
    toast("Cannot import: the app's database connection is missing. Please restart the app.", 6000);
    return;
  }
  try{
    const result = await window.api.importBackup();
    if(result.canceled) return; // user closed the Open dialog
    if(!result.ok){
      toast("Import failed: could not read the selected file.");
      return;
    }
    applyImportedBackup(result.content);
  }catch(err){
    console.error("Import failed:", err);
    toast("Import failed: " + err.message, 6000);
  }
});

document.getElementById("resetBtn").addEventListener("click", ()=>{
  if(confirm("This will permanently erase ALL data. Continue?")){
    if(confirm("Are you absolutely sure? This cannot be undone.")){
      window.api.resetAll();
      load();
      showPage("dashboard");
      toast("All data has been reset.");
    }
  }
});

/* ============================================================================
   RESTORE FROM AN OLDER BACKUP
   Gives a real recovery path when teachers/timetables/attendance look
   missing today but may still exist in an earlier daily/manual snapshot.
   ============================================================================ */
function formatBackupLabel(b){
  const when = new Date(b.mtime);
  const whenStr = isNaN(when) ? b.mtime : when.toLocaleString();
  const sizeKB = Math.round((b.sizeBytes || 0) / 1024);
  return `${whenStr} — ${b.name} (${sizeKB} KB)`;
}

async function populateBackupList(){
  const select = document.getElementById("backupList");
  if(!select) return;
  select.innerHTML = `<option value="">Loading backups…</option>`;
  if(!apiIsReady() || typeof window.api.listBackups !== "function"){
    select.innerHTML = `<option value="">Backup list unavailable (restart the app)</option>`;
    return;
  }
  try{
    const backups = await window.api.listBackups();
    if(!backups || backups.length === 0){
      select.innerHTML = `<option value="">No backups found yet</option>`;
      return;
    }
    select.innerHTML = backups.map(b =>
      `<option value="${b.name}">${formatBackupLabel(b)}</option>`
    ).join("");
  }catch(err){
    console.error("Could not list backups:", err);
    select.innerHTML = `<option value="">Could not load backups (see console)</option>`;
  }
}

const refreshBackupsBtn = document.getElementById("refreshBackupsBtn");
if(refreshBackupsBtn) refreshBackupsBtn.addEventListener("click", populateBackupList);

const restoreBackupBtn = document.getElementById("restoreBackupBtn");
if(restoreBackupBtn) restoreBackupBtn.addEventListener("click", async ()=>{
  const select = document.getElementById("backupList");
  const chosen = select && select.value;
  if(!chosen){
    toast("Pick a backup from the list first.");
    return;
  }
  if(!confirm(`Replace ALL current data with the backup "${chosen}"? Anything saved since that backup will be lost.`)) return;
  if(!confirm("Are you absolutely sure? This cannot be undone.")) return;

  restoreBackupBtn.disabled = true;
  const originalLabel = restoreBackupBtn.textContent;
  restoreBackupBtn.textContent = "⏳ Restoring...";
  try{
    if(!apiIsReady() || typeof window.api.restoreBackup !== "function"){
      toast("Cannot restore: the app's database connection is missing. Please restart the app.", 6000);
      return;
    }
    const result = await window.api.restoreBackup(chosen);
    if(result && result.ok){
      load();
      showPage("dashboard");
      toast(`Restored from "${chosen}". Check your teachers/timetables/attendance now.`, 6000);
      populateBackupList();
    }else{
      toast("Restore failed: " + (result && result.error || "unknown error"), 6000);
    }
  }catch(err){
    console.error("Restore failed:", err);
    toast("Restore failed: " + err.message, 6000);
  }finally{
    restoreBackupBtn.disabled = false;
    restoreBackupBtn.textContent = originalLabel;
  }
});

/* ============================================================================
   INIT
   ============================================================================ */
function init(){
  applyTheme();
  load();
  tickClock();
  document.getElementById("brandName").textContent = STATE.school.name || "Government School";
  document.getElementById("brandLogo").src = STATE.school.logo || "";
  // Automatic daily substitute generation: make sure today's list already
  // reflects current attendance/eligibility rules the moment the app opens.
  generateSubstitutesForDate(todayISO());
  _lastDateSeen = todayISO();
  _lastPeriodSeen = currentPeriodNumber();
  renderDashboard();
  showPage("dashboard");
}
init();
