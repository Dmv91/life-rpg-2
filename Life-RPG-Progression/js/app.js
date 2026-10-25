/**
 * Life RPG — application controller
 * ----------------------------------
 * This file connects the page (index.html), styling (styles.css), game content
 * (config.js), and saved browser data (localStorage).
 *
 * Main areas in this file:
 *   1. Helpers and saved state
 *   2. Rendering / dashboard updates
 *   3. Daily objective, planner, rewards, and weekly stats
 *   4. Learning Review Arena
 *   5. Focus timer, workouts, time tracking, and XP
 *   6. Event handlers and page navigation
 *
 * Quiz questions are loaded from the local SQLite database when the Python
 * server is running. QB from config.js is the offline fallback, so the app can
 * still open if the database API is unavailable.
 */
import { MIN, LV, KEY, ST, POOL, BOSS, EXS, STARTER, QB } from './config.js';

// The built-in question bank is the safe fallback; the server can replace it.
let QUESTION_BANK = QB;
// SQL-backed editable catalogs. The config.js values remain fallbacks if the server is offline.
let QUEST_POOL = structuredClone(POOL);
let EXERCISES = EXS.slice();
let LEARNING_RESOURCES = [];
let ADAPTIVE_QUESTS = []; // SQLite-backed templates used to assemble a realistic plan.
let SKILL_NODES = [], CAMPAIGNS = [], ACHIEVEMENTS = [], COSMETICS = []; // RPG progression content from SQLite.
let CURRENT_PLAN = [];   // Temporary suggestions; only selected items become active quests.
let saveTimer = null;


// ===== 1. SMALL HELPERS =====
// Keep reusable, low-level functions near the top so the rest of the app can use them.
// day(o) returns a date string YYYY-MM-DD; o = days from today (-1 = yesterday)
const day=(o=0)=>{const d=new Date();d.setDate(d.getDate()+o);return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')};
const $=id=>document.getElementById(id);
// ===== 2. SAVED GAME STATE =====
// S is the in-memory snapshot of player progress. save() mirrors it locally and syncs it to SQLite.
// S holds ALL saved data. xp=XP per stat, act=active quests, cnt=main quests done per day, boss=bosses beaten per day,
// fit=workout history, wo=workout being built, run=currently running task, tl=time log, inc=income log. cm=chosen chart metric.
let S,cm='vol';
const fresh=()=>({xp:{code:0,re:0,fit:0,fin:0,side:0,boss:0},act:[],cnt:{},boss:{},fit:[],wo:[],wd:'',run:null,inc:[],tl:{},cur:0,best:0,last:'',objective:{},plan:[],rewardClaims:[],skillUnlocks:[],campaignProgress:{},achievementUnlocks:[],inventory:['campfire'],equippedDecorations:['campfire'],coins:0,xpHistory:[],questHistory:[],quizStats:{correct:0,total:0},savings:{target:1000,balance:0},equippedTheme:'theme_default',equippedIcon:'⚔️'});
// Load saved data from this browser (and migrate XP/streak from the very first version if found)
try{S=JSON.parse(localStorage.getItem(KEY))}catch(e){}
if(!S||!S.xp){S=fresh();try{const o=JSON.parse(localStorage.getItem('liferpg1'));if(o&&o.xp){Object.assign(S.xp,o.xp);S.cur=o.cur||0;S.best=o.best||0;S.last=o.last||''}}catch(e){}}
if(!S.tl)S.tl={}; // older saves had no time log
if(!S.objective)S.objective={};if(!Array.isArray(S.plan))S.plan=[];if(!Array.isArray(S.rewardClaims))S.rewardClaims=[];
if(!S.rev)S.rev=[];if(!S.ad)S.ad={};if(typeof S.bw!='number')S.bw=0; // rev=missed arena questions, ad=arena wins per day, bw=battles won
// Add new RPG fields when opening an older save; existing XP, quests, and history are preserved.
if(!Array.isArray(S.skillUnlocks))S.skillUnlocks=[];if(!S.campaignProgress)S.campaignProgress={};if(!Array.isArray(S.achievementUnlocks))S.achievementUnlocks=[];if(!Array.isArray(S.inventory))S.inventory=['campfire'];if(!Array.isArray(S.equippedDecorations))S.equippedDecorations=['campfire'];if(!Number.isFinite(S.coins))S.coins=0;if(!Array.isArray(S.xpHistory))S.xpHistory=[];if(!Array.isArray(S.questHistory))S.questHistory=[];if(!S.quizStats)S.quizStats={correct:0,total:0};if(!S.savings)S.savings={target:1000,balance:0};if(!S.equippedTheme)S.equippedTheme='theme_default';if(!S.equippedIcon)S.equippedIcon='⚔️';
// Migrate the old single 'hob' category into Reading / Gaming
S.act.forEach(q=>{if(q.s=='hob')q.s=/read/i.test(q.n)?'read':'game'});
Object.values(S.tl).forEach(d=>{if(d.hob){d.read=(d.read||0)+d.hob;delete d.hob}});
// Save locally immediately for resilience, then sync to SQLite after a short pause.
// Debouncing avoids sending a database request for every keystroke while editing a workout.
const save=()=>{
 try{localStorage.setItem(KEY,JSON.stringify(S))}catch(e){}
 if(saveTimer)clearTimeout(saveTimer);
 saveTimer=setTimeout(async()=>{
  try{const response=await fetch('/api/state',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({state:S})});
   if(!response.ok)throw new Error('Save API returned '+response.status);
  }catch(error){console.warn('Life RPG: SQL save unavailable; browser backup is still saved.',error)}
 },250);
};
// Level math: lvl(xp)=level, prog(xp)=[level, % progress to next, XP remaining]
const lvl=x=>{let n=1;while(x>=LV(n+1))n++;return n};
const prog=x=>{const n=lvl(x);return[n,(x-LV(n))/(LV(n+1)-LV(n))*100,LV(n+1)-x]};
// total()=all XP, md()=main quests completed today
const total=()=>Object.values(S.xp).reduce((a,b)=>a+b,0);
const md=()=>S.cnt[day()]||0;
// ===== 3. QUEST GENERATION =====
// These functions create active quests from the templates in config.js.
// spawn(k) adds a random quest from category k, avoiding names already active
function spawn(k){const pool=QUEST_POOL[k]||POOL[k]||[['Do a useful task',10]],used=S.act.map(q=>q.n),p=pool.filter(x=>!used.includes(x[0])),a=p.length?p:pool,x=a[Math.floor(Math.random()*a.length)];
 S.act.push({id:'q'+Date.now()+Math.random().toString(36).slice(2,6),t:ST[k]?'m':(k=='read'||k=='game')?'h':'c',s:k,n:x[0],x:x[1]})}
// ensure() keeps at least 2 active quests in every category so new tasks never run out
function ensure(){Object.keys(QUEST_POOL).forEach(k=>{while(S.act.filter(q=>q.s==k).length<2)spawn(k)})}
// STREAK: when today's main-quest goal is first met, extend (or restart) the streak and update the best
function streak(){if(md()>=MIN&&S.last!=day()){S.cur=S.last==day(-1)?S.cur+1:1;S.last=day();S.best=Math.max(S.best,S.cur)}}
// Floating '+XP' animation over the hero panel
function pop(x){const e=$('xp');e.textContent='+'+x+' XP';e.classList.remove('go');void e.offsetWidth;e.classList.add('go')}
// ===== ANIMATION MAPPING =====
// kindOf(quest) -> [animation kind, prop emoji]. Add a new kind here, then add CSS for .a-<kind>.
const kindOf=q=>q.s=='code'?['type','']:q.s=='fin'?['count','']:q.s=='re'?['house','']:q.s=='fit'?['walk','👟']:q.s=='chr'?['sweep','🧹']:q.s=='read'?['read','📖']:['game','🎮'];
// Position [x,y] of the prop emoji inside the SVG for each animation kind
const POS={type:[150,100],count:[150,100],house:[150,100],walk:[168,140],lift:[100,30],squat:[165,140],read:[122,100],game:[122,100],sweep:[140,140],idle:[160,40]};
// SCENES: which SVG scene groups (props drawn in the SVG) are visible for each animation kind
const SCN={type:['desk','laptop'],count:['desk','cash'],house:['house'],game:['tv']};
// HERO PANEL: sets the stick-figure animation class, prop, label and End button from S.run
function hero(){const r=S.run;let k='idle',p='💤',l='Idle: pick a quest and press Start';
 if(r){if(r.id=='workout'){const e=S.wo[S.wo.length-1];[k,p]=e&&/squat|lunge/i.test(e[0])?['squat','🦵']:['lift','🏋️'];l='Workout'}else if(r.id=='focus'){[k,p]=kindOf({s:r.st,n:''});l='Focus: '+(ST[r.st]?ST[r.st][0]:'Reading')+(r.left?' ⚠️ distracted':'')}else{const q=S.act.find(x=>x.id==r.id);if(q){[k,p]=kindOf(q);l=q.n}}}
 $('guy').setAttribute('class','guy a-'+k);const pr=$('prop');pr.textContent=p;pr.setAttribute('x',POS[k][0]);pr.setAttribute('y',POS[k][1]);
 ['desk','laptop','cash','house','tv'].forEach(g=>$(g).style.display=(SCN[k]||[]).includes(g)?'':'none'); // show only this activity's scene
 $('hl').textContent=l;$('hend').style.display=r?'':'none';tick()}
// Timer display, refreshed every second
function tick(){const r=S.run;if(!r){$('tmr').textContent='';return}const s=Math.floor((Date.now()-r.t0)/1000),f=n=>String(n).padStart(2,'0');
 if(r.id=='focus'){const left=r.dur*60-s;if(left<=0){finishFocus(true);render();return} // time is up: pay out
  $('tmr').textContent='⏳ '+f(Math.floor(left/60))+':'+f(left%60);return} // focus shows a countdown
 $('tmr').textContent=f(Math.floor(s/60))+':'+f(s%60)} // other tasks count up
setInterval(tick,1000);
// STATS WHEEL: 6-axis radar chart; each spoke is the level of that stat (scale grows with your highest level)
function wheel(){const ks=['code','re','fit','fin','boss','side'],lb=['Code','Real Est.','Fitness','Finance','Bonds','Life'],lv=ks.map(k=>lvl(S.xp[k])),mx=Math.max(5,...lv);
 const P=(i,f)=>{const a=-Math.PI/2+i*Math.PI/3;return[110+Math.cos(a)*70*f,110+Math.sin(a)*70*f]};let s='';
 [.25,.5,.75,1].forEach(f=>s+=`<polygon points="${ks.map((_,i)=>P(i,f).join(',')).join(' ')}" fill="none" stroke="var(--bd)"/>`);
 ks.forEach((_,i)=>{const[x,y]=P(i,1);s+=`<line x1="110" y1="110" x2="${x}" y2="${y}" stroke="var(--bd)"/>`});
 s+=`<polygon points="${ks.map((_,i)=>P(i,lv[i]/mx).join(',')).join(' ')}" fill="var(--ac)" fill-opacity=".4" stroke="var(--ac)" stroke-width="2"/>`;
 ks.forEach((_,i)=>{const[x,y]=P(i,1.3);s+=`<text x="${x}" y="${y}" text-anchor="middle" style="fill:var(--tx);font-size:11px">${lb[i]} ${lv[i]}</text>`});
 $('wheel').innerHTML=s}
// ===== MAIN RENDER =====
// Rebuilds the whole page from state S, then saves. Call render() after changing any state.
// render() refreshes the visible game UI from S, then saves the latest state.
function render(){ensure();
 // Player level bar + streak + boss gate text
 const t=total(),[pl,pp]=prog(t);$('plv').textContent='Level '+pl+' Adventurer · '+t+' XP';$('pbar').style.width=pp+'%';
 $('cur').textContent=(S.last==day()||S.last==day(-1))?S.cur:0;$('best').textContent=S.best;
 $('gate').textContent='Main quests today: '+md()+'/'+MIN+(md()>=MIN?' ✅ bosses unlocked':' to unlock bosses');
 // Stat cards
 $('stats').innerHTML=Object.keys(ST).map(k=>{const[n,i,c]=ST[k],[l,p,nx]=prog(S.xp[k]);
  return`<div class="card"><span style="font-size:28px">${i}</span><span class="lv" style="color:${c}">Lv ${l}</span><br><b>${n}</b><div class="bar" style="margin:6px 0"><i style="width:${p}%;background:${c}"></i></div><small class="lock">${S.xp[k]} XP · ${nx} to next</small></div>`}).join('');
 // row(q) builds one quest line: shows End (and highlights) if it is the running task, otherwise Start and reroll
 const R=S.run,row=q=>{const on=R&&R.id==q.id;return`<div class="q ${on?'run':''}"><span>${ST[q.s]?ST[q.s][1]+' ':''}${q.n} <small>+${q.x} XP${q.mins?' · '+q.mins+' min':''}</small></span><span class="row">${on?`<button class="end" data-en="${q.id}">End</button>`:`<button data-st="${q.id}" ${R?'disabled':''}>Start</button><button class="ghost" data-rr="${q.id}" ${R?'disabled':''}>↻</button>`}</span></div>`};
 // Main quests grouped by category, then hobbies and chores
 $('main').innerHTML=Object.keys(ST).map(k=>`<div class="card"><div class="top"><b>${ST[k][1]} ${ST[k][0]}</b><span class="lock">⏱ ${fmt(tDay(k))} today · ${fmt(tAll(k))}</span><button class="ghost" data-new="${k}">＋</button></div>${S.act.filter(q=>q.s==k).map(row).join('')}</div>`).join('');$('read').innerHTML=S.act.filter(q=>q.s=='read').map(row).join('');$('game').innerHTML=S.act.filter(q=>q.s=='game').map(row).join('');$('trd').textContent=fmt(tDay('read'))+' today · '+fmt(tAll('read'));$('tgm').textContent=fmt(tDay('game'))+' today · '+fmt(tAll('game'));$('chr').innerHTML=S.act.filter(q=>q.t=='c').map(row).join('');
 // Boss cards: locked until the daily minimum is met
 const bd=S.boss[day()]||[];
 $('bosses').innerHTML=BOSS.map(b=>{const d=bd.includes(b[0]),ok=md()>=MIN&&!d;return`<div class="card boss"><div class="em">${b[1]}</div><b>${b[2]}</b><div class="lock">${b[3]} · +${b[4]} XP</div><button data-b="${b[0]}" ${ok?'':'disabled'} style="margin-top:8px">${d?'Defeated today ✔':md()>=MIN?'Fight!':'🔒 Locked'}</button></div>`}).join('');
 // Workout builder rows (editable inputs)
 $('wst').disabled=!!R;$('wst').textContent=R&&R.id=='workout'?'Workout running…':'Start workout';
 $('wex').innerHTML=S.wo.map((e,i)=>`<div class="q ex row"><input list="exl" value="${e[0]}" data-i="${i}" data-f="0" style="flex:1;min-width:110px"><input type="number" value="${e[1]}" data-i="${i}" data-f="1"> sets <input type="number" value="${e[2]}" data-i="${i}" data-f="2"> reps <input type="number" value="${e[3]||''}" placeholder="0" data-i="${i}" data-f="3"> lb <button class="ghost" data-rm="${i}">✕</button></div>`).join('')||'<span class="lock">No exercises yet. Load the starter or add one.</span>';
 // Fitness chart dropdown: volume, reps, plus every exercise you have logged
 const names=[...new Set(S.fit.flatMap(f=>f.ex.map(e=>e[0])))];
 $('cm').innerHTML=`<option value="vol">Total volume (sets×reps×lb)</option><option value="reps">Total reps</option>`+names.map(n=>`<option value="${n}">${n}: best weight/reps</option>`).join('');$('cm').value=cm;
 wheel();chart();income();times();focusInfo();hero();dailyObjective();planner();consistencyRewards();weeklyStats();renderRPGFeatures();save()}
// ===== RPG PROGRESSION SYSTEMS =====
// Attributes are derived from real activity rather than arbitrary random increases.
function attributeValues(){
 const mainCount=S.questHistory.filter(q=>q.main).length;
 return [
  {id:'strength',name:'Strength',icon:'💪',value:S.xp.fit||0,detail:'Fitness XP and workout progress'},
  {id:'intelligence',name:'Intelligence',icon:'🧠',value:(S.xp.code||0)+(S.xp.re||0),detail:'Coding, real estate, and learning XP'},
  {id:'discipline',name:'Discipline',icon:'🛡️',value:mainCount*10+(S.cur||0)*15+(S.best||0)*5,detail:`${mainCount} completed main quests · best streak ${S.best} days`},
  {id:'wealth',name:'Wealth',icon:'💰',value:S.xp.fin||0,detail:'Finance XP and financial habits'},
  {id:'social',name:'Social',icon:'🤝',value:(S.xp.side||0)+Math.floor(mainCount/3)*10,detail:'Side quests and community habits'}
 ];
}
function unlockedSkillPoints(){return Math.max(0,Math.floor(total()/100));}
function spentSkillPoints(){return S.skillUnlocks.reduce((sum,id)=>sum+(SKILL_NODES.find(n=>n.id===id)?.cost||1),0);}
function mainQuestCount(){return S.questHistory.filter(q=>q.main).length;}
function resourceCompletedCount(){return LEARNING_RESOURCES.filter(r=>r.completed).length;}
function achievementValue(rule){
 switch(rule.rule_type){case'main_quests':return mainQuestCount();case'total_xp':return total();case'best_streak':return S.best||0;case'workouts':return S.fit.length;case'resources_completed':return resourceCompletedCount();case'finance_xp':return S.xp.fin||0;case'campaigns_completed':return Object.values(S.campaignProgress).filter(c=>c&&c.completed).length;default:return 0}
}
function syncAchievements(){
 // Mark eligible achievements once. Rewards are coins only, so XP history doesn't recurse.
 ACHIEVEMENTS.forEach(a=>{if(!S.achievementUnlocks.includes(a.id)&&achievementValue(a)>=a.rule_target){S.achievementUnlocks.push(a.id);S.coins=(S.coins||0)+(a.reward_coins||0)}});
}
function renderRPGFeatures(){
 if(!$('skillTree'))return;
 syncAchievements();
 const attrs=attributeValues();
 $('attributesGrid').innerHTML=attrs.map(a=>{const score=Math.floor(a.value/25)+1;return `<div class="card attribute-card"><span class="attribute-icon">${a.icon}</span><b>${escapeHTML(a.name)}</b><div class="attribute-score">Lv ${score}</div><div class="bar"><i style="width:${a.value%25/25*100}%;background:var(--ac)"></i></div><small class="lock">${a.value} growth points · ${escapeHTML(a.detail)}</small></div>`}).join('');
 const earned=unlockedSkillPoints(),spent=spentSkillPoints(),available=Math.max(0,earned-spent);
 $('skillPoints').textContent=`Skill points: ${available} available · ${spent} spent`;
 $('attributeSummary').textContent=`${attrs.length} attributes · ${total()} total XP`;
 $('skillTree').innerHTML=SKILL_NODES.map(n=>{const isUnlocked=S.skillUnlocks.includes(n.id);const attr=attrs.find(a=>a.name===n.attribute);const eligible=available>=n.cost&&((attr?.value||0)>=n.required_xp)&&(n.id!=='discipline_2'||mainQuestCount()>=10);const label=isUnlocked?'Unlocked':eligible?`Unlock · ${n.cost} point${n.cost===1?'':'s'}`:'Locked';return `<div class="card skill-node ${isUnlocked?'unlocked':eligible?'':'locked'}"><div class="top"><span class="skill-icon">${n.icon}</span><span class="lock">${escapeHTML(n.attribute)}</span></div><b>${escapeHTML(n.title)}</b><div class="lock">${escapeHTML(n.description)} <b>Effect: +5% ${n.attribute==='Discipline'?'XP from all activities':n.attribute+' XP'} per unlocked node.</b></div><div class="top" style="margin-top:auto"><small class="lock">${n.required_xp?`${n.required_xp} attribute XP required`:n.id==='discipline_2'?'10 main quests required':'Available to begin'}</small><button data-skill-unlock="${escapeHTML(n.id)}" ${(!eligible||isUnlocked)?'disabled':''}>${label}</button></div></div>`}).join('');
 // Campaign steps are player progress, while campaign definitions stay editable in SQLite.
 $('campaignGrid').innerHTML=CAMPAIGNS.map(c=>{const progress=S.campaignProgress[c.id]||{steps:[],completed:false};const done=progress.steps||[];const count=c.steps.filter((_,i)=>done.includes(i)).length;const tierOneDone=CAMPAIGNS.filter(x=>x.tier===1&&(S.campaignProgress[x.id]?.completed)).length;const locked=c.tier>1&&tierOneDone<2;return `<div class="card campaign-card ${locked?'locked':''}"><div class="top"><b>${escapeHTML(c.title)}</b><span class="lock">Tier ${c.tier}</span></div><p class="lock">${escapeHTML(c.description)}</p>${c.steps.map((step,i)=>`<label class="campaign-step ${done.includes(i)?'done':''}"><input type="checkbox" data-campaign-step="${escapeHTML(c.id)}" data-step-index="${i}" ${done.includes(i)?'checked':''} ${(progress.completed||locked)?'disabled':''}><span>${escapeHTML(step)}</span></label>`).join('')}<div class="bar" style="margin:10px 0"><i style="width:${count/Math.max(1,c.steps.length)*100}%;background:var(--ac)"></i></div><div class="top"><small class="lock">${progress.completed?'Campaign complete':locked?`Unlock after ${2-tierOneDone} more Tier 1 campaign(s)`: `${count}/${c.steps.length} steps`}</small><small class="lock">+${c.reward_xp} XP · 🪙 ${c.reward_coins}</small></div></div>`}).join('');
 $('achievementGrid').innerHTML=ACHIEVEMENTS.map(a=>{const unlocked=S.achievementUnlocks.includes(a.id);const value=achievementValue(a);return `<div class="card achievement-card ${unlocked?'unlocked':'locked'}"><div class="achievement-icon">${unlocked?a.icon:'🔒'}</div><b>${escapeHTML(a.title)}</b><div class="lock">${escapeHTML(a.description)}</div><div class="bar" style="margin:8px 0"><i style="width:${Math.min(100,value/Math.max(1,a.rule_target)*100)}%;background:var(--ac)"></i></div><small class="lock">${unlocked?'Unlocked':`${Math.min(value,a.rule_target)} / ${a.rule_target}`} · 🪙 ${a.reward_coins}</small></div>`}).join('');
 $('coinBalance').textContent=S.coins||0;
 const decor=S.equippedDecorations||['campfire'];
 $('hqRoom').innerHTML=decor.map(id=>{const item=COSMETICS.find(c=>c.id===id);return item?`<div class="hq-item"><span class="hq-icon">${item.icon}</span><b>${escapeHTML(item.title)}</b></div>`:''}).join('')||'<div class="lock">Your hall is empty. Unlock a decoration below.</div>';
 $('cosmeticShop').innerHTML=COSMETICS.map(c=>{const owned=S.inventory.includes(c.id);const equipped=c.kind==='theme'?S.equippedTheme===c.id:c.kind==='avatar'?S.equippedIcon===c.icon:decor.includes(c.id);const canBuy=(S.coins||0)>=c.cost;const actionLabel=equipped?'Equipped':owned?(c.kind==='theme'?'Apply':c.kind==='avatar'?'Use avatar':'Display'):'Unlock';return `<div class="card"><div style="font-size:28px">${c.icon}</div><b>${escapeHTML(c.title)}</b><div class="lock">${escapeHTML(c.description)}</div><div class="top" style="margin-top:8px"><small class="lock">${c.cost===0?'Free':`🪙 ${c.cost}`}</small><button data-cosmetic="${escapeHTML(c.id)}" ${equipped||(!owned&&!canBuy)?'disabled':''}>${actionLabel}</button></div></div>`}).join('');
 const title=([...S.achievementUnlocks].reverse().map(id=>ACHIEVEMENTS.find(a=>a.id===id)?.title).find(Boolean))||'Novice Adventurer';
 const titleEl=$('currentTitle');if(titleEl)titleEl.textContent=title;
 if(S.equippedTheme==='theme_ember')document.documentElement.dataset.theme='ember';else if(S.equippedTheme==='theme_arcane')document.documentElement.dataset.theme='arcane';else document.documentElement.removeAttribute('data-theme');
 const avatar=$('avatarBadge');if(avatar)avatar.textContent=S.equippedIcon||'⚔️';
 renderAnalytics();renderSavings();
}
function renderAnalytics(){
 const history=S.xpHistory||[];const last7=Array.from({length:7},(_,i)=>day(i-6));
 const xpDays=last7.map(d=>({d,x:history.filter(h=>h.d===d).reduce((sum,h)=>sum+(+h.x||0),0)}));
 const weekXP=xpDays.reduce((sum,x)=>sum+x.x,0);const main=mainQuestCount();const completedCampaigns=Object.values(S.campaignProgress).filter(c=>c&&c.completed).length;
 const completedResources=resourceCompletedCount();const dailyGoal=Math.min(100,Math.round(md()/MIN*100));const savings=S.savings||{target:1000,balance:0};const savingsProgress=savings.target>0?Math.min(100,Math.round(savings.balance/savings.target*100)):0;const learningSeconds=Object.values(S.tl||{}).reduce((sum,d)=>sum+(d.code||0)+(d.re||0)+(d.read||0),0);const quiz=S.quizStats||{correct:0,total:0};const accuracy=quiz.total?Math.round(quiz.correct/quiz.total*100):0;
 $('analyticsCards').innerHTML=[['XP this week',weekXP,'⭐'],['Main quests completed',main,'⚔️'],['Workouts logged',S.fit.length,'💪'],['Learning time',fmt(learningSeconds),'📚'],['Quiz accuracy',quiz.total?accuracy+'%':'—','🧠'],['Daily quest goal',dailyGoal+'%','📊'],['Savings goal',`${savingsProgress}%`,'💰']].map(x=>`<div class="card"><div class="top"><span class="lock">${x[0]}</span><span>${x[2]}</span></div><div class="summary-number">${x[1]}</div></div>`).join('');
 const max=Math.max(1,...xpDays.map(x=>x.x));
 $('xpTrend').innerHTML=xpDays.map(x=>`<div class="trend-day"><b>${x.x}</b><div class="trend-bar" style="height:${Math.max(3,x.x/max*76)}px" title="${x.x} XP"></div><span>${new Date(x.d+'T12:00:00').toLocaleDateString(undefined,{weekday:'short'})}</span></div>`).join('');
}
// Savings goal is a lightweight progress tracker; it does not connect to bank accounts.
function renderSavings(){const goal=S.savings||{target:1000,balance:0};if($('savingsTarget'))$('savingsTarget').value=goal.target;if($('savingsBalance'))$('savingsBalance').value=goal.balance;const pct=goal.target>0?Math.min(100,goal.balance/goal.target*100):0;if($('savingsProgressBar'))$('savingsProgressBar').style.width=pct+'%';if($('savingsProgressLabel'))$('savingsProgressLabel').textContent=`$${Number(goal.balance||0).toLocaleString()} of $${Number(goal.target||0).toLocaleString()} · ${Math.round(pct)}%`;}
$('saveSavings').onclick=()=>{const target=Math.max(0,+$('savingsTarget').value||0),balance=Math.max(0,+$('savingsBalance').value||0);if(target<=0){$('savingsTarget').focus();return}S.savings={target,balance};render();};

// Complete a skill unlock by spending one-time earned skill points, never existing XP.
document.addEventListener('click',e=>{
 const skillId=e.target.dataset?.skillUnlock;
 if(skillId){const node=SKILL_NODES.find(n=>n.id===skillId);if(!node||S.skillUnlocks.includes(skillId))return;const available=unlockedSkillPoints()-spentSkillPoints();const attr=attributeValues().find(a=>a.name===node.attribute);if(available<node.cost||(attr?.value||0)<node.required_xp||(skillId==='discipline_2'&&mainQuestCount()<10))return;S.skillUnlocks.push(skillId);render();}
 const cosmeticId=e.target.dataset?.cosmetic;
 if(cosmeticId){const item=COSMETICS.find(c=>c.id===cosmeticId);if(!item)return;if(!S.inventory.includes(cosmeticId)){if((S.coins||0)<item.cost)return;S.coins-=item.cost;S.inventory.push(cosmeticId)}if(item.kind==='theme')S.equippedTheme=item.id;else if(item.kind==='avatar')S.equippedIcon=item.icon;else S.equippedDecorations=[cosmeticId];render();}
});
document.addEventListener('change',e=>{
 const campaignId=e.target.dataset?.campaignStep;if(!campaignId)return;
 const campaign=CAMPAIGNS.find(c=>c.id===campaignId);if(!campaign)return;
 const progress=S.campaignProgress[campaignId]||(S.campaignProgress[campaignId]={steps:[],completed:false});if(progress.completed)return;const tierOneDone=CAMPAIGNS.filter(x=>x.tier===1&&(S.campaignProgress[x.id]?.completed)).length;if(campaign.tier>1&&tierOneDone<2){e.target.checked=false;return}
 const index=+e.target.dataset.stepIndex;progress.steps=progress.steps||[];
 if(e.target.checked){if(!progress.steps.includes(index))progress.steps.push(index)}else progress.steps=progress.steps.filter(i=>i!==index);
 if(campaign.steps.every((_,i)=>progress.steps.includes(i))){progress.completed=true;award(campaign.category,campaign.reward_xp);S.coins=(S.coins||0)+campaign.reward_coins;play('🧭',campaign.title+' completed!',campaign.reward_xp)}
 render();
});

// FITNESS CHART: plots the selected metric across your last 30 workouts
function chart(){const L=S.fit.slice(-30),W=600,H=130;let pts=[];
 L.forEach(f=>{let v=null;if(cm=='vol')v=f.ex.reduce((a,e)=>a+e[1]*e[2]*e[3],0);else if(cm=='reps')v=f.ex.reduce((a,e)=>a+e[1]*e[2],0);else{const m=f.ex.filter(e=>e[0]==cm);if(m.length)v=Math.max(...m.map(e=>e[3]>0?e[3]:e[2]))}
  if(v!==null)pts.push([f.d,v])});
 let s=`<line x1="0" y1="${H}" x2="${W}" y2="${H}" stroke="var(--bd)"/>`;
 if(pts.length){const vs=pts.map(p=>p[1]),hi=Math.max(...vs,1),lo=Math.min(...vs,0),r=hi-lo||1,X=i=>pts.length>1?20+i*(W-40)/(pts.length-1):W/2,Y=v=>H-8-(v-lo)/r*(H-30);
  s+=`<polyline fill="none" stroke="#81c784" stroke-width="2.5" points="${pts.map((p,i)=>X(i)+','+Y(p[1])).join(' ')}"/>`;
  pts.forEach((p,i)=>s+=`<circle cx="${X(i)}" cy="${Y(p[1])}" r="4" fill="#81c784"/>`);
  s+=`<text x="4" y="12">max ${hi}</text><text x="20" y="${H+14}">${pts[0][0]}</text><text x="${W-70}" y="${H+14}">${pts[pts.length-1][0]}</text>`}
 else s+=`<text x="20" y="70">Finish a workout to see progress</text>`;$('chart').innerHTML=s;
 $('flist').innerHTML=`<b>${S.fit.length}</b> workouts · <b>${S.fit.reduce((a,f)=>a+f.ex.reduce((b,e)=>b+e[1],0),0)}</b> total sets<br>`+S.fit.slice(-3).reverse().map(f=>`${f.d}: ${f.ex.map(e=>`${e[0]} ${e[1]}×${e[2]}${e[3]?' @'+e[3]:''}`).join(', ')}`).join('<br>')}
// ===== DAILY OBJECTIVE =====
// The objective text is saved by date. Progress is based on the main-quest goal.
// The objective text is saved per date; main-quest progress comes from the existing daily goal.
function dailyObjective(){
 const saved=S.objective[day()]||'';
 const input=$('objectiveText');
 if(document.activeElement!==input)input.value=saved;
 $('objectiveLabel').textContent=saved||"Today's main quests";
 $('objectiveProgress').textContent=`${Math.min(md(),MIN)} / ${MIN} main quests`;
 $('objectiveBar').style.width=Math.min(100,md()/MIN*100)+'%';
}
$('saveObjective').onclick=()=>{S.objective[day()]=$('objectiveText').value.trim();save();dailyObjective()};

// ===== DAILY / WEEKLY PLANNER =====
// Planner tasks live in S.plan; each task has text, cadence, and a checked-date list.
function weekKey(dateString=day()){
 const d=new Date(dateString+'T12:00:00');
 const weekday=(d.getDay()+6)%7;d.setDate(d.getDate()-weekday);
 return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
}
function planner(){
 const el=$('plannerList');if(!el)return;
 if(!S.plan.length){el.innerHTML='<p class="lock">No planner tasks yet. Add a daily or weekly task above.</p>';return}
 el.innerHTML=S.plan.map((task,index)=>{
  const done=task.cadence==='weekly'?task.doneWeek===weekKey():task.doneDate===day();
  return `<div class="q ${done?'planner-done':''}"><label class="planner-label"><input type="checkbox" data-plan-done="${index}" ${done?'checked':''}> <span>${escapeHTML(task.text)}</span> <small>${task.cadence==='weekly'?'Weekly':'Daily'}</small></label><button class="ghost" data-plan-remove="${index}" aria-label="Remove ${escapeHTML(task.text)}">✕</button></div>`;
 }).join('');
}
function escapeHTML(value){return String(value).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));}
$('addPlan').onclick=()=>{
 const input=$('planText'),text=input.value.trim();if(!text)return;
 S.plan.push({id:'p'+Date.now()+Math.random().toString(36).slice(2,5),text,cadence:$('planCadence').value});
 input.value='';save();planner();
};
document.addEventListener('change',e=>{
 const index=e.target.dataset.planDone;if(index===undefined)return;
 const task=S.plan[+index];if(!task)return;
 if(task.cadence==='weekly'){if(e.target.checked)task.doneWeek=weekKey();else task.doneWeek=''}
 else{if(e.target.checked)task.doneDate=day();else task.doneDate=''}
 save();planner();
});
document.addEventListener('click',e=>{
 const index=e.target.dataset.planRemove;if(index===undefined)return;
 S.plan.splice(+index,1);save();planner();
});

// ===== ADAPTIVE DAILY QUEST PLANNER =====
// Suggestions are templates in SQLite. They do not alter the save until the user adds them.
const ENERGY_LABELS={1:'Low',2:'Normal',3:'High'};
function buildAdaptivePlan(){
 const minutes=+$('plannerMinutes').value||60;
 const energy=+$('plannerEnergy').value||2;
 const focus=$('plannerFocus').value||'balanced';
 // Prefer the requested focus. Balanced suggestions fill spare time, but never exceed the time budget.
 const candidates=ADAPTIVE_QUESTS.filter(q=>q.min_energy<=energy&&(q.focus===focus||q.focus==='balanced'))
  .sort((a,b)=>{const ap=a.focus===focus?0:1,bp=b.focus===focus?0:1;return ap-bp||a.priority-b.priority||a.minutes-b.minutes});
 const chosen=[],used=new Set();let totalMinutes=0;
 for(const q of candidates){
  if(chosen.length>=4)break;
  if(used.has(q.title)||totalMinutes+q.minutes>minutes)continue;
  chosen.push({...q,selected:true});used.add(q.title);totalMinutes+=q.minutes;
 }
 CURRENT_PLAN=chosen;renderAdaptivePlan();
}
function renderAdaptivePlan(){
 const list=$('adaptivePlanList');if(!list)return;
 const budget=+$('plannerMinutes').value||60;
 const totalMinutes=CURRENT_PLAN.filter(q=>q.selected).reduce((sum,q)=>sum+q.minutes,0);
 $('planSummary').textContent=`${budget}-minute ${({fin:'Finance & business',fit:'Fitness',learn:'Learning & career',balanced:'Balanced life'})[$('plannerFocus').value]||'Daily'} plan · ${ENERGY_LABELS[+$('plannerEnergy').value]||'Normal'} energy`;
 $('planTime').textContent=`${totalMinutes} / ${budget} min selected`;
 if(!CURRENT_PLAN.length){list.innerHTML='<p class="lock">No matching quests fit this time and energy combination. Try more time or a different focus.</p>';return}
 list.innerHTML=CURRENT_PLAN.map((q,index)=>`<div class="q"><label class="planner-label"><input type="checkbox" data-adaptive-select="${index}" ${q.selected?'checked':''}><span><b>${escapeHTML(q.title)}</b><small> · ${q.minutes} min · +${q.xp} XP</small><div class="lock">${escapeHTML(q.description)}</div></span></label></div>`).join('');
}
$('generatePlan').addEventListener('click',buildAdaptivePlan);
['plannerMinutes','plannerEnergy','plannerFocus'].forEach(id=>$(id).addEventListener('change',buildAdaptivePlan));
document.addEventListener('change',event=>{const raw=event.target.dataset?.adaptiveSelect;if(raw===undefined)return;const item=CURRENT_PLAN[+raw];if(!item)return;const budget=+$('plannerMinutes').value||60;const proposed=CURRENT_PLAN.filter((q,index)=>index===+raw?event.target.checked:q.selected).reduce((sum,q)=>sum+q.minutes,0);if(proposed>budget){event.target.checked=false;$('plannerFeedback').textContent='That would exceed your available time. Increase the time budget or unselect another quest.';return}item.selected=event.target.checked;$('plannerFeedback').textContent='';renderAdaptivePlan()});
$('addSelectedPlan').addEventListener('click',()=>{
 const selected=CURRENT_PLAN.filter(q=>q.selected);if(!selected.length){$('plannerFeedback').textContent='Select at least one quest first.';return}
 let added=0;
 for(const q of selected){
  // Avoid duplicating a quest if it is already active; preserve the player's existing quests.
  if(S.act.some(active=>active.n===q.title))continue;
  S.act.push({id:'adaptive-'+q.id+'-'+Date.now()+'-'+Math.random().toString(36).slice(2,6),t:ST[q.category]?'m':(q.category==='read'||q.category==='game')?'h':'c',s:q.category,n:q.title,x:q.xp,mins:q.minutes,adaptive:true});added++;
 }
 if(added){render();$('plannerFeedback').textContent=`Added ${added} quest${added===1?'':'s'} to Quests. Start and finish them there to earn XP.`;showPage('quests')}
 else $('plannerFeedback').textContent='Those quests are already active; no duplicates added.';
});
async function loadAdaptiveQuestTemplates(){
 try{const response=await fetch('/api/adaptive-quests');if(!response.ok)throw new Error('Planner API returned '+response.status);
  const rows=await response.json();if(Array.isArray(rows))ADAPTIVE_QUESTS=rows;
 }catch(error){console.warn('Life RPG: could not load adaptive planner templates from SQLite.',error)}
 buildAdaptivePlan();
}

// ===== CONSISTENCY REWARDS =====
// Milestones are based on the best streak. rewardClaims prevents awarding a milestone twice.
const REWARD_MILESTONES=[
 {days:3,emoji:'🌱',name:'Building Momentum',detail:'3-day streak'},
 {days:7,emoji:'🔥',name:'One-Week Warrior',detail:'7-day streak'},
 {days:14,emoji:'🛡️',name:'Fortnight Defender',detail:'14-day streak'},
 {days:30,emoji:'👑',name:'Consistency Legend',detail:'30-day streak'}
];
function consistencyRewards(){
 const el=$('rewards');if(!el)return;
 const current=(S.last===day()||S.last===day(-1))?S.cur:0;
 el.innerHTML=REWARD_MILESTONES.map(r=>{
  const unlocked=S.best>=r.days;
  return `<div class="card reward-card ${unlocked?'unlocked':''}"><div class="reward-emoji">${unlocked?r.emoji:'🔒'}</div><b>${r.name}</b><div class="lock">${r.detail}</div><div class="bar" style="margin-top:8px"><i style="width:${Math.min(100,S.best/r.days*100)}%;background:var(--ac)"></i></div><small class="lock">${unlocked?'Unlocked!':`${Math.min(S.best,r.days)} / ${r.days} best streak days`}</small></div>`;
 }).join('')+`<div class="card"><b>Current streak</b><div style="font-size:28px;margin:4px 0">🔥 ${current} day${current===1?'':'s'}</div><div class="lock">Best streak: ${S.best} day${S.best===1?'':'s'}</div></div>`;
}

// ===== LAST-SEVEN-DAYS SUMMARY =====
function weeklyStats(){
 const days=Array.from({length:7},(_,i)=>day(i-6));
 const rows=days.map(d=>({date:d,count:S.cnt[d]||0,seconds:Object.values(S.tl[d]||{}).reduce((sum,value)=>sum+value,0)}));
 const totalQuests=rows.reduce((sum,r)=>sum+r.count,0);
 const totalSeconds=rows.reduce((sum,r)=>sum+r.seconds,0);
 $('weeklyStats').innerHTML=`<div class="grid"><div><div class="lock">Main quests completed</div><div class="summary-number">${totalQuests}</div></div><div><div class="lock">Time tracked</div><div class="summary-number">${fmt(totalSeconds)}</div></div><div><div class="lock">Days goal met</div><div class="summary-number">${rows.filter(r=>r.count>=MIN).length} / 7</div></div></div><div style="margin-top:12px">${rows.map(r=>`<div class="week-row"><span>${new Date(r.date+'T12:00:00').toLocaleDateString(undefined,{weekday:'short',month:'short',day:'numeric'})}</span><span class="lock">${r.count} / ${MIN} quests · ${fmt(r.seconds)}</span><div class="bar"><i style="width:${Math.min(100,r.count/MIN*100)}%;background:${r.count>=MIN?'var(--ac)':'var(--bd)'}"></i></div></div>`).join('')}</div>`;
}

// Income tracker totals (this month + all time)
function income(){const m=day().slice(0,7),tot=S.inc.reduce((a,i)=>a+i.a,0),mo=S.inc.filter(i=>i.d.startsWith(m)).reduce((a,i)=>a+i.a,0);
 $('ilist').innerHTML=`This month <b>$${mo}</b> · All time <b>$${tot}</b><br>`+S.inc.slice(-3).reverse().map(i=>`${i.d}: $${i.a} ${i.s}`).join('<br>')}

// Helpers: rnd(a,b)=random integer, shuf(arr)=shuffled copy
const rnd=(a,b)=>Math.floor(a+Math.random()*(b-a+1)),shuf=a=>a.map(x=>[Math.random(),x]).sort((p,q)=>p[0]-q[0]).map(x=>x[1]);
// mk(): builds a math question with 4 numeric options around the correct answer (spread = typical distractor gap)
function mk(q,c,f,spread,e){const set=new Set([c]);let g=0;while(set.size<4&&g++<60)set.add(+(c+(Math.random()<.5?-1:1)*spread*rnd(1,4)).toFixed(1));const o=shuf([...set]);return[q,o.map(f),o.indexOf(c),e]}
const $f=x=>x<0?'-$'+(-x):'$'+x; // money formatter
// GEN = generated real-estate math questions, so the numbers are different every time
const GEN=[
()=>{const n=rnd(15,60)*1000,p=rnd(20,60)*10000,c=+(n/p*100).toFixed(1);return mk(`NOI is $${n.toLocaleString()} and the price is $${p.toLocaleString()}. What is the cap rate?`,c,x=>x+'%',.8,`Cap rate = NOI ÷ price = ${c}%.`)},
()=>{const r=rnd(12,30)*100,m=rnd(8,20)*100,e=rnd(2,5)*100,c=r-m-e;return mk(`Rent is $${r}/mo, mortgage $${m}/mo, other expenses $${e}/mo. What is the monthly cash flow?`,c,$f,50,`${r} − ${m} − ${e} = ${$f(c)} per month.`)},
()=>{const cf=rnd(2,8)*1200,i=rnd(4,12)*10000,c=+(cf/i*100).toFixed(1);return mk(`Annual cash flow is $${cf.toLocaleString()} on $${i.toLocaleString()} cash invested. Cash-on-cash return?`,c,x=>x+'%',1.2,`Annual cash flow ÷ cash invested = ${c}%.`)},
()=>{const p=rnd(15,50)*10000,r=rnd(15,45)*1000,g=+(p/r).toFixed(1);return mk(`Price is $${p.toLocaleString()} and annual rent is $${r.toLocaleString()}. What is the gross rent multiplier (GRM)?`,g,x=>x+'x',1.5,`GRM = price ÷ annual rent = ${g}.`)}];
let AR=null; // current battle (not saved): {st,max,hp,hearts,list,i,ok,ans,right,over,won,xp,t0}
const wrap=(st,x)=>{const o=shuf(x[1].map((t,i)=>[t,i==x[2]]));return{st,q:x[0],o:o.map(p=>p[0]),a:o.findIndex(p=>p[1]),e:x[3]}}; // shuffle options, remember the correct one
// Start a battle: 2 questions you previously missed (review queue) + new ones. Monster HP = 3 + your level in that stat (max 8)
// Start a quiz battle. Previously missed questions are prioritized for spaced review.
function arenaStart(st){const max=Math.min(8,3+lvl(S.xp[st])),list=S.rev.filter(q=>q.st==st).slice(0,2),used=new Set(list.map(q=>q.q));let g=0;
 while(list.length<max+2&&g++<200){const x=(st=='re'&&Math.random()<.45)?GEN[rnd(0,GEN.length-1)]():QUESTION_BANK[st][rnd(0,QUESTION_BANK[st].length-1)];if(used.has(x[0]))continue;used.add(x[0]);list.push(wrap(st,x))}
 AR={st,max,hp:max,hearts:3,list:shuf(list),i:0,ok:0,ans:null,t0:Date.now()};arenaRender()}
// Answer: right = damage the monster, wrong = lose a heart and the question goes to your review queue
// Grade the selected answer, apply damage/hearts, and add misses to the review queue.
function arenaAnswer(i){if(!AR||AR.ans!==null||AR.over)return;const q=AR.list[AR.i];AR.ans=i;AR.right=i==q.a;
 S.quizStats=S.quizStats||{correct:0,total:0};S.quizStats.total++;if(AR.right){S.quizStats.correct++;AR.hp--;AR.ok++;S.rev=S.rev.filter(r=>r.q!=q.q)}else{AR.hearts--;if(!S.rev.some(r=>r.q==q.q))S.rev.push(q)}
 save();arenaRender()}
function arenaNext(){if(AR.hp<=0)return arenaEnd(true);if(AR.hearts<=0)return arenaEnd(false);AR.i++;AR.ans=null;arenaRender()}
// End: XP = 8 per correct answer (+30 for a win). Time is logged. First win per stat per day counts as a main quest.
function arenaEnd(won){AR.over=true;AR.won=won;AR.xp=AR.ok*8+(won?30:0);if(AR.xp)award(AR.st,AR.xp);addTime(AR.st,(Date.now()-AR.t0)/1000);
 if(won){S.bw++;const a=S.ad[day()]=S.ad[day()]||[];if(!a.includes(AR.st)){a.push(AR.st);S.cnt[day()]=md()+1;streak()}}
 render();arenaRender()}
// Draws the arena card: menu, battle, or result screen
function arenaRender(){const el=$('arena');
 if(!AR){el.innerHTML=`<div class="row"><button data-ar="code">💻 Code battle</button><button data-ar="re">🏠 Real estate battle</button></div><div class="lock" style="margin-top:6px">Battles won: <b>${S.bw}</b> · Review queue: <b>${S.rev.length}</b> missed question(s) come back in battles. Bigger monsters as you level up.</div>`;return}
 const mon={code:'🐛',re:'🏚️'}[AR.st];
 if(AR.over){el.innerHTML=`<div style="text-align:center"><div class="mon ${AR.won?'die':''}">${AR.won?mon:'💀'}</div><b>${AR.won?'Victory!':'Defeated'}</b> +${AR.xp} XP<div class="lock">${AR.ok} correct. Missed questions are saved to your review queue.</div><button data-ax style="margin-top:8px">Back</button></div>`;return}
 const q=AR.list[AR.i],a=AR.ans;
 el.innerHTML=`<div class="top"><span>${'❤️'.repeat(AR.hearts)+'🖤'.repeat(3-AR.hearts)}</span><span class="lock">Monster HP ${AR.hp}/${AR.max}</span><button class="ghost" data-ax>Retreat</button></div>
 <div class="mon ${a!==null?(AR.right?'hit':'atk'):''}">${mon}</div><div class="bar" style="width:60%;margin:0 auto 10px"><i style="width:${AR.hp/AR.max*100}%;background:var(--bad)"></i></div>
 <p><b>${q.q}</b>${S.rev.some(r=>r.q==q.q)&&a===null?' <small class="lock">(review)</small>':''}</p>
 ${q.o.map((t,i)=>`<button class="ghost opt ${a!==null?(i==q.a?'ok':i==a?'no':''):''}" data-ao="${i}">${t}</button>`).join('')}
 ${a!==null?`<p>${AR.right?'✅ Direct hit!':'❌ Miss.'} ${q.e}</p><button data-an>${AR.hp<=0||AR.hearts<=0?'Finish':'Next'}</button>`:''}`}

// ===== FOCUS MODE =====
// A focus session is stored as S.run = {id:'focus', st:category, dur:minutes, t0, left:false}. Leaving the browser tab sets left=true.
// Finish a full session: XP = minutes × 1.5 (×1 if you left the tab), plus 10% per earlier clean session today (max +50%). Give up: no XP, time is still logged.
function finishFocus(done){const r=S.run;if(!r)return;addTime(r.st,Math.min(r.dur*60,(Date.now()-r.t0)/1000));S.run=null;
 if(done){const clean=!r.left,n=clean?((S.fc&&S.fc.d==day()?S.fc.n:0)+1):0;S.fc={d:day(),n};
  award(ST[r.st]?r.st:'side',Math.round(r.dur*(clean?1.5:1)*(1+.1*Math.min(5,Math.max(0,n-1)))));
  if(ST[r.st]){S.cnt[day()]=md()+1;streak()}}else S.fc={d:day(),n:0}}
// Combo text under the focus controls
function focusInfo(){const n=S.fc&&S.fc.d==day()?S.fc.n:0;$('fcb').disabled=!!S.run;$('fcn').textContent='Focus combo today: '+n+' (next session ×'+(1+.1*Math.min(5,n)).toFixed(1)+'). Finish without leaving this tab for +50% XP; leaving breaks the bonus and resets the combo.'}

// ===== TIME TRACKING =====
// S.tl = { 'YYYY-MM-DD': { code: seconds, re: seconds, ... } }. Time is logged when you press End.
const CATS=[['code','💻 Code','#4fc3f7'],['re','🏠 Real Estate','#ffb74d'],['fit','💪 Fitness','#81c784'],['fin','💰 Finance','#ffd54f'],['read','📖 Reading','#ba68c8'],['game','🎮 Gaming','#f06292'],['chr','🧹 Chores','#90a4ae']];
const fmt=s=>{s=Math.round(s);const h=Math.floor(s/3600),m=Math.floor(s%3600/60);return h?h+'h '+m+'m':m?m+'m':s+'s'}; // seconds -> '1h 5m'
const tAll=k=>Object.values(S.tl).reduce((a,d)=>a+(d[k]||0),0), tDay=k=>(S.tl[day()]||{})[k]||0; // all-time / today seconds
function addTime(k,secs){S.tl[day()]=S.tl[day()]||{};S.tl[day()][k]=(S.tl[day()][k]||0)+secs}
// Draws the Time tracked card: bars are relative to your most-used category
function times(){const mx=Math.max(1,...CATS.map(c=>tAll(c[0])));
 $('times').innerHTML=CATS.map(c=>`<div style="margin:6px 0"><div class="top"><span>${c[1]}</span><span class="lock">today <b>${fmt(tDay(c[0]))}</b> · total <b>${fmt(tAll(c[0]))}</b></span></div><div class="bar"><i style="width:${tAll(c[0])/mx*100}%;background:${c[2]}"></i></div></div>`).join('')+`<div class="lock" style="margin-top:6px">All categories today: <b>${fmt(CATS.reduce((a,c)=>a+tDay(c[0]),0))}</b></div>`}
// Ends the running task: log elapsed time to its category, then pay out XP and spawn a replacement quest
function endRun(){const r=S.run;if(!r)return;
 if(r.id=='focus'){finishFocus(false);return} // ending a focus session early = give up
 if(r.id=='workout'){finishWorkout();return} // workouts log their own time
 const q=S.act.find(x=>x.id==r.id);if(q)addTime(q.s,(Date.now()-r.t0)/1000);
 S.run=null;complete(r.id)}
// award() is the shared XP entry point so rewards stay consistent across features.
function award(k,x){const base=Math.max(0,Math.round(+x||0));const bonusNodes=S.skillUnlocks.filter(id=>{if(id.startsWith('strength_'))return k==='fit';if(id.startsWith('intelligence_'))return k==='code'||k==='re';if(id.startsWith('wealth_'))return k==='fin';if(id.startsWith('social_'))return k==='side';if(id.startsWith('discipline_'))return true;return false}).length;const amount=Math.max(0,Math.round(base*(1+bonusNodes*0.05)));S.xp[k]=(S.xp[k]||0)+amount;if(amount){S.xpHistory.push({d:day(),k,x:amount,at:Date.now()});if(S.xpHistory.length>2000)S.xpHistory=S.xpHistory.slice(-2000);pop(amount)}}
// complete(id): remove a finished quest, award XP to its stat, count it toward today's goal if it's a main quest
function complete(id){const q=S.act.find(x=>x.id==id);if(!q)return;S.act=S.act.filter(x=>x.id!=id);
 award(ST[q.s]?q.s:'side',q.x);S.coins=(S.coins||0)+Math.max(1,Math.floor((+q.x||0)/5));S.questHistory.push({d:day(),id:q.id,name:q.n,category:q.s,xp:+q.x||0,main:q.t=='m'});if(S.questHistory.length>2000)S.questHistory=S.questHistory.slice(-2000);if(q.t=='m'){S.cnt[day()]=md()+1;streak()}}
// Boss fight overlay animation
function play(em,t,xp){$('stage').innerHTML=`<div class="bs">${em}</div><div class="bar hp"><i></i></div><div class="cap">${t} +${xp} XP</div>`;$('ov').style.display='flex';setTimeout(()=>$('ov').style.display='none',2400)}
$('ov').onclick=()=>$('ov').style.display='none';
// Save the workout being built: Fitness XP = 20 + 3 per set; first workout of the day counts as a main quest
function finishWorkout(){if(!S.wo.length)return;const ex=S.wo.filter(e=>e[0]),sets=ex.reduce((a,e)=>a+(+e[1]||0),0);if(!ex.length)return;
 S.fit.push({d:day(),ex:ex.map(e=>[e[0],+e[1]||0,+e[2]||0,+e[3]||0])});S.wo=[];if(S.run&&S.run.id=='workout'){addTime('fit',(Date.now()-S.run.t0)/1000);S.run=null} // log workout time
 if(S.wd!=day()){S.wd=day();S.cnt[day()]=md()+1;streak()}award('fit',20+sets*3);render()}
// ===== 6. EVENT HANDLERS =====
// Event delegation lets buttons created later by render() keep working without rebinding every button.
// One click listener handles every button through data-* attributes: st=start, en=end, rr=reroll, new=new quest, b=boss fight, rm=remove exercise
document.addEventListener('click',e=>{const d=e.target.dataset;if(!d)return;
 if(d.ar)arenaStart(d.ar); // arena: start a battle
 if(d.ao!==undefined)arenaAnswer(+d.ao); // arena: pick an answer
 if(d.an!==undefined)arenaNext(); // arena: next question / finish
 if(d.ax!==undefined){AR=null;arenaRender()} // arena: back / retreat
 if(d.st&&!S.run){S.run={id:d.st,t0:Date.now()};render()}
 if(d.en){endRun();render()}
 if(d.rr){S.act=S.act.filter(q=>q.id!=d.rr);render()}
 if(d.new){if(S.act.filter(q=>q.s==d.new).length<6)spawn(d.new);render()} // ＋ adds a quest in that category (max 6)
 if(d.b){const B=BOSS.find(x=>x[0]==d.b),a=S.boss[day()]||(S.boss[day()]=[]);if(md()<MIN||a.includes(d.b))return;a.push(d.b);award('boss',B[4]);render();play(B[1],B[2]+' defeated!',B[4])}
 if(d.rm){S.wo.splice(+d.rm,1);render()}});
$('hend').onclick=()=>{endRun();render()}; // End button in the hero panel
// Editing workout inputs saves straight into S.wo (no re-render so typing isn't interrupted)
document.addEventListener('change',e=>{const d=e.target.dataset;if(d&&d.f!==undefined){S.wo[+d.i][+d.f]=d.f=='0'?e.target.value:+e.target.value;save();hero()}});
// Workout builder buttons: start timer, load starter, add exercise, finish & save
$('wst').onclick=()=>{if(!S.run){S.run={id:'workout',t0:Date.now()};render()}};
$('wsd').onclick=()=>{S.wo=STARTER.map(x=>x.slice());render()};
$('wadd').onclick=()=>{S.wo.push(['',3,10,0]);render()};
$('wfin').onclick=finishWorkout;
$('cm').onchange=e=>{cm=e.target.value;chart()};
// Log income: gives Finance XP (10 + $/10, capped at 100)
$('ilog').onclick=()=>{const a=+$('ia').value;if(!a)return;S.inc.push({d:day(),a,s:$('is').value||''});$('ia').value=$('is').value='';award('fin',10+Math.min(90,Math.round(a/10)));render()};
// Focus mode: start a session, and mark it distracted if you leave the tab
$('fcb').onclick=()=>{if(S.run)return;S.run={id:'focus',st:$('fcs').value,dur:+$('fcd').value,t0:Date.now(),left:false};render()};
document.addEventListener('visibilitychange',()=>{if(document.hidden&&S.run&&S.run.id=='focus'){S.run.left=true;save();hero()}});
$('exl').innerHTML=EXERCISES.map(x=>`<option value="${escapeHTML(x)}">`).join('');
// ===== SQL-BACKED LEARNING LIBRARY =====
// Resources are stored as rows in SQLite, not mixed into the player's game-state JSON.
function renderResources(){
 const el=$('resourceList');if(!el)return;
 if(!LEARNING_RESOURCES.length){el.innerHTML='<p class="lock">No resources yet. Add a course, article, or tutorial above.</p>';return}
 el.innerHTML=LEARNING_RESOURCES.map(r=>`<div class="q resource-row ${r.completed?'planner-done':''}"><label class="planner-label"><input type="checkbox" data-resource-toggle="${r.id}" ${r.completed?'checked':''}><span><b>${escapeHTML(r.title)}</b><small class="lock"> · ${escapeHTML(r.category)}${r.resource_type?' · '+escapeHTML(r.resource_type):''}</small>${r.notes?'<div class="lock">'+escapeHTML(r.notes)+'</div>':''}${r.url?'<div><a href="'+escapeHTML(r.url)+'" target="_blank" rel="noopener noreferrer">Open resource ↗</a></div>':''}</span></label><button class="ghost" data-resource-delete="${r.id}" aria-label="Delete ${escapeHTML(r.title)}">✕</button></div>`).join('');
}
async function resourceAction(payload){
 const response=await fetch('/api/resources',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
 if(!response.ok){const data=await response.json().catch(()=>({}));throw new Error(data.error||'Resource update failed')}
 LEARNING_RESOURCES=await response.json();renderResources();if($('skillTree'))renderRPGFeatures();save();
}
$('addResource').onclick=async()=>{const title=$('resourceTitle').value.trim();if(!title){$('resourceTitle').focus();return}
 try{await resourceAction({action:'add',title,category:$('resourceCategory').value,url:$('resourceUrl').value.trim(),notes:$('resourceNotes').value.trim()});$('resourceTitle').value=$('resourceUrl').value=$('resourceNotes').value=''}catch(error){alert('Could not save resource to SQLite. Is server.py running?\n'+error.message)}
};
document.addEventListener('change',async e=>{const d=e.target.dataset;if(!d)return;
 if(d.resourceToggle){try{await resourceAction({action:'toggle',id:+d.resourceToggle,completed:e.target.checked})}catch(error){alert('Could not update resource: '+error.message)}}
});
document.addEventListener('click',async e=>{const id=e.target.dataset?.resourceDelete;if(id){try{await resourceAction({action:'delete',id:+id})}catch(error){alert('Could not delete resource: '+error.message)}}});

// Custom quest form: pick a category, name and XP
$('ac').innerHTML=Object.keys(ST).map(k=>`<option value="m|${k}">Main · ${ST[k][0]}</option>`).join('')+'<option value="h|read">Reading</option><option value="h|game">Gaming</option><option value="c|chr">Chore</option>';
$('aadd').onclick=()=>{const n=$('an').value.trim();if(!n)return;const[t,s]=$('ac').value.split('|');S.act.push({id:'c'+Date.now(),t,s,n,x:+$('ax').value||10});$('an').value='';render()};
// Reset wipes all progress
$('rst').onclick=async()=>{if(confirm('Erase all progress?')){S=fresh();render();try{await fetch('/api/state',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({state:S})})}catch(e){console.warn('Could not sync reset to SQLite',e)}}};

// ===== 7. PAGE NAVIGATION =====
// Navigation only changes which section is visible; it does not reset or reload the game state.
function showPage(pageName) {
  document.querySelectorAll('[data-page]').forEach((page) => {
    const active = page.dataset.page === pageName;
    page.classList.toggle('active', active);
    page.hidden = !active;
  });
  document.querySelectorAll('[data-page-target]').forEach((button) => {
    const active = button.dataset.pageTarget === pageName;
    button.classList.toggle('active', active);
    button.setAttribute('aria-current', active ? 'page' : 'false');
  });
  try { history.replaceState(null, '', `#${pageName}`); } catch {}
}
document.querySelectorAll('[data-page-target]').forEach((button) => {
  button.addEventListener('click', () => showPage(button.dataset.pageTarget));
});
const initialPage = location.hash.slice(1);
showPage(document.querySelector(`[data-page="${initialPage}"]`) ? initialPage : 'dashboard');

// ===== 8. DATABASE CONNECTION =====
// Fetch the SQL-backed question bank. If the server is unavailable, keep using QB.
// The database API returns the same [question, options, correctIndex, explanation]
// shape used by the original quiz code, so the battle system does not need to change.
async function loadQuestionBank() {
  try {
    const response = await fetch('/api/questions');
    if (!response.ok) throw new Error(`Question API returned ${response.status}`);
    const data = await response.json();
    if (data && Array.isArray(data.code) && Array.isArray(data.re)) {
      QUESTION_BANK = data;
      console.info('Life RPG: loaded quiz questions from SQLite.');
    }
  } catch (error) {
    console.info('Life RPG: using built-in quiz questions. Start server.py to use SQLite.', error);
  }
}

// START THE APP. Load SQLite catalogs and saved progress before the first full render.
// If this server is unavailable, the browser-local save and config.js defaults still work.
async function bootstrap(){
 try{
  const [stateResponse,catalogResponse]=await Promise.all([fetch('/api/state'),fetch('/api/catalog')]);
  if(stateResponse.ok){
   const payload=await stateResponse.json();
   if(payload.state){S={...fresh(),...payload.state,xp:{...fresh().xp,...(payload.state.xp||{})}};try{localStorage.setItem(KEY,JSON.stringify(S))}catch{}}
   else { // First SQL launch: copy any existing browser progress into SQLite.
    await fetch('/api/state',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({state:S})});
   }
   
  }
  if(catalogResponse.ok){
   const catalog=await catalogResponse.json();
   if(catalog.quests){QUEST_POOL={...QUEST_POOL,...catalog.quests}}
   if(Array.isArray(catalog.exercises)&&catalog.exercises.length)EXERCISES=catalog.exercises;
   if(Array.isArray(catalog.resources))LEARNING_RESOURCES=catalog.resources;
   if(Array.isArray(catalog.skills))SKILL_NODES=catalog.skills;if(Array.isArray(catalog.campaigns))CAMPAIGNS=catalog.campaigns;if(Array.isArray(catalog.achievements))ACHIEVEMENTS=catalog.achievements;if(Array.isArray(catalog.cosmetics))COSMETICS=catalog.cosmetics;
   $('exl').innerHTML=EXERCISES.map(x=>`<option value="${escapeHTML(x)}">`).join('');
  }
 }catch(error){console.warn('Life RPG: starting with local browser backup and built-in catalogs.',error)}
 render();arenaRender();renderResources();
 await Promise.all([loadQuestionBank(),loadAdaptiveQuestTemplates()]);
}
bootstrap();
