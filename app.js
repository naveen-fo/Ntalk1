const app = document.getElementById("app");
const cfg = window.NTALK_CONFIG || {};
const hasSupabase = !!(cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY && window.supabase);
const sb = hasSupabase ? window.supabase.createClient(cfg.SUPABASE_URL.replace(/\/rest\/v1\/?$/,""), cfg.SUPABASE_ANON_KEY) : null;
let recoveryMode = location.hash.includes("type=recovery");
if(sb) sb.auth.onAuthStateChange(ev=>{ if(ev==="PASSWORD_RECOVERY"){ recoveryMode=true; render(); } });

const state = {
  user: JSON.parse(localStorage.getItem("ntalk_user") || "null"),
  page: "chats",
  activeChat: null,
  chatTab: "chats",
  chats: [],
  people: [],
  messages: [],
  channel: null,
  presence: null,
  signal: null,
  typingTimer: null,
  theme: localStorage.getItem("ntalk_theme") || "dark",
  call: null
};
let peer = null, localStream = null, remoteStream = null, pendingIce = [];

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
const uid = () => state.user?.id || "";
const meName = () => state.user?.name || "NTalk User";
const saveUser = () => localStorage.setItem("ntalk_user", JSON.stringify(state.user));
const avatarName = n => (String(n || "N").trim()[0] || "N").toUpperCase();
const fmt = d => d ? new Date(d).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"}) : "";

function ico(name,filled){
  const p={
    chat:'<path d="M20 11.5a7.5 7.5 0 0 1-7.5 7.5H6l-3 2v-9.5A7.5 7.5 0 0 1 10.5 4h2A7.5 7.5 0 0 1 20 11.5Z"/>',
    phone:'<path d="M7 4h3l1.5 4-2 1.5a15 15 0 0 0 5 5l1.5-2 4 1.5v3c0 1-1 1.5-2 1.5C11 18.5 5.5 13 5.5 6c0-1 .5-2 1.5-2Z"/>',
    video:'<rect x="3" y="6" width="12" height="12" rx="3"/><path d="m15 10 6-3v10l-6-3Z"/>',
    users:'<path d="M16 20v-1.5A3.5 3.5 0 0 0 12.5 15h-5A3.5 3.5 0 0 0 4 18.5V20"/><circle cx="10" cy="8" r="3"/><path d="M17 11a3 3 0 1 0-1-5.8M17 15h1.5A3.5 3.5 0 0 1 22 18.5V20"/>',
    user:'<circle cx="12" cy="8" r="3"/><path d="M5 20a7 7 0 0 1 14 0"/>',
    plus:'<path d="M12 5v14M5 12h14"/>',
    search:'<circle cx="11" cy="11" r="6"/><path d="m16 16 4 4"/>',
    more:'<circle cx="5" cy="12" r="1" fill="currentColor"/><circle cx="12" cy="12" r="1" fill="currentColor"/><circle cx="19" cy="12" r="1" fill="currentColor"/>',
    smile:'<circle cx="12" cy="12" r="9"/><path d="M8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01"/>',
    attach:'<path d="m21 11-8.5 8.5a5 5 0 0 1-7-7L14 4a3.5 3.5 0 0 1 5 5l-8.5 8.5a2 2 0 0 1-3-3L15 7"/>',
    send:'<path d="m4 4 17 8-17 8 3-8-3-8Z"/><path d="M7 12h14"/>',
    mic:'<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3M8 21h8"/>',
    camera:'<path d="M4 7h3l2-2h6l2 2h3a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2Z"/><circle cx="12" cy="13" r="3"/>',
    x:'<path d="m6 6 12 12M18 6 6 18"/>',
    check:'<path d="m5 12 4 4L19 6"/>',
    theme:'<path d="M12 3v2M12 19v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M3 12h2M19 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4"/><circle cx="12" cy="12" r="4"/>',
    download:'<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>'
  };
  return `<svg class="ui-icon${filled?" filled":""}" viewBox="0 0 24 24" aria-hidden="true">${p[name] || EXTRA_ICONS[name] || p.chat}</svg>`;
}

function loginView(){
 return `<main class="auth"><section class="auth-card">
 <div class="brand"><div class="logo">N</div><div><h1>NTalk</h1><p>Private. Real-time. Simple.</p></div></div>
 <div class="auth-tabs"><button class="active">Login</button><button onclick="registerMode()">Create account</button></div>
 <label>Email</label><input id="email" type="email" autocomplete="email" placeholder="you@example.com">
 <label>Password</label><input id="password" type="password" autocomplete="current-password" placeholder="Your password">
 <button class="primary wide" onclick="doLogin()">Login</button>
 <button class="ghost wide" onclick="forgotPassword()">Forgot password?</button>
 <div class="auth-or">or</div>
 <button class="ghost wide g-btn" onclick="googleLogin()">${GOOGLE_SVG}<span>Continue with Google</span></button>
 <p class="muted center">${hasSupabase?"Connected to NTalk backend":"Supabase configuration missing"}</p>
 </section></main>`;
}
function registerMode(){
 app.innerHTML=`<main class="auth"><section class="auth-card">
 <div class="brand"><div class="logo">N</div><div><h1>NTalk</h1><p>Create your account</p></div></div>
 <label>Display name</label><input id="name" placeholder="Your name">
 <label>Username</label><input id="username" placeholder="@yourname">
 <label>Email</label><input id="email" type="email" placeholder="you@example.com">
 <label>Password</label><input id="password" type="password" placeholder="At least 6 characters">
 <button class="primary wide" onclick="doRegister()">Create account</button>
 <div class="auth-or">or</div>
 <button class="ghost wide g-btn" onclick="googleLogin()">${GOOGLE_SVG}<span>Continue with Google</span></button>
 <button class="ghost wide" onclick="render()">Back to login</button>
 </section></main>`;
}
async function forgotPassword(){
 if(!hasSupabase)return alert("Supabase configuration missing.");
 const typed=document.getElementById("email")?.value.trim()||"";
 const email=(prompt("Enter your account email:",typed)||"").trim();
 if(!email)return;
 const {error}=await sb.auth.resetPasswordForEmail(email,{redirectTo:location.origin+location.pathname});
 if(error)return alert(error.message);
 alert("If this email has an account, a password reset link was sent. Open the link on this device.");
}
function resetView(){
 return `<main class="auth"><section class="auth-card">
 <div class="brand"><div class="logo">N</div><div><h1>NTalk</h1><p>Set a new password</p></div></div>
 <label>New password</label><input id="newPass" type="password" autocomplete="new-password" placeholder="At least 6 characters">
 <label>Confirm password</label><input id="newPass2" type="password" autocomplete="new-password" placeholder="Repeat password">
 <button class="primary wide" onclick="doResetPassword()">Save new password</button>
 </section></main>`;
}
async function doResetPassword(){
 const p1=document.getElementById("newPass").value,p2=document.getElementById("newPass2").value;
 if(p1.length<6)return alert("Password must be at least 6 characters.");
 if(p1!==p2)return alert("Passwords do not match.");
 const {error}=await sb.auth.updateUser({password:p1});
 if(error)return alert(error.message);
 recoveryMode=false;
 history.replaceState(null,"",location.pathname);
 const {data}=await sb.auth.getSession();
 if(data.session){await loadProfile(data.session.user);await initBackend()}
 alert("Password updated.");
 render();
}
async function doLogin(){
 const email=document.getElementById("email").value.trim(), password=document.getElementById("password").value;
 if(!email||!password)return alert("Enter email and password.");
 if(!hasSupabase)return alert("Supabase is not configured.");
 const {data,error}=await sb.auth.signInWithPassword({email,password});
 if(error)return alert(error.message);
 await loadProfile(data.user); await initBackend(); render();
}
async function doRegister(){
 const name=document.getElementById("name").value.trim()||"NTalk User";
 const username=(document.getElementById("username").value.trim()||"ntalkuser").replace(/^@/,"").toLowerCase();
 const email=document.getElementById("email").value.trim(), password=document.getElementById("password").value;
 if(!email||password.length<6)return alert("Enter a valid email and a password of 6+ characters.");
 if(!/^[a-z0-9_.]{3,24}$/.test(username))return alert("Username: 3-24 characters, letters, numbers, _ or . only.");
 {const av=await sb.rpc("username_available",{u:username});if(!av.error&&av.data===false)return alert("This username is already taken. Please choose another.")}
 const {data,error}=await sb.auth.signUp({email,password,options:{data:{full_name:name,display_name:name,username}}});
 if(error)return alert(error.message);
 if(!data.user)return;
 if(data.session){
   const {error:pe}=await sb.from("profiles").upsert({id:data.user.id,username,full_name:name});
   if(pe)return alert(pe.message);
   await loadProfile(data.user);await initBackend();render();
 }
 else alert("Account created. Email confirmation is currently enabled in Supabase, so confirm the email before login.");
}
async function loadProfile(user){
 const {data}=await sb.from("profiles").select("*").eq("id",user.id).maybeSingle();
 state.user={id:user.id,email:user.email,name:data?.full_name||data?.display_name||user.user_metadata?.full_name||user.user_metadata?.name||user.user_metadata?.display_name||user.email.split("@")[0],username:"@"+(data?.username||user.user_metadata?.username||"user"),avatar_url:data?.avatar_url||user.user_metadata?.avatar_url||null,needsSetup:!!data?.needs_setup};
 saveUser();
}
async function logout(){
 try{if(state.channel)await sb.removeChannel(state.channel);if(state.presence)await sb.removeChannel(state.presence);if(state.signal)await sb.removeChannel(state.signal);if(state.typingCh)await sb.removeChannel(state.typingCh);await unregisterPush();await sb.auth.signOut();}catch{}
 clearInterval(state.lsTimer);state.lsTimer=null;state.pushActive=false;state.replyTo=null;state.statuses=[];state.statusMine=null;stopRing();
 state.channel=null;state.channelUser=null;state.typingCh=null;state.typingUser=null;state.presence=null;state.signal=null;state.activeChat=null;state.page="chats";state.chatTab="chats";
 state.user=null; state.chats=[]; state.people=[]; state.messages=[]; localStorage.removeItem("ntalk_user"); endCall(false); leaveGroupCall(false); dismissGroupInvite(); state.callLogs=[]; state.notes=new Map(); state.secretIds=new Set(); state.secretUnlocked=false; state.secretOpen=false; state.hasSecretPin=null; state.shortsMounted=false; state.searchResults=[]; state.peopleQuery=""; render();
}
function setTheme(t){state.theme=t;localStorage.setItem("ntalk_theme",t);render()}
function toggleTheme(){setTheme(state.theme==="dark"?"light":"dark")}

function sidebar(){
 return `<aside class="sidebar"><div class="side-brand"><div class="logo small">N</div><b>NTalk</b><button class="icon-btn" onclick="toggleTheme()">${ico("theme")}</button></div>
 <nav>
 <button class="${state.page==="chats"?"selected":""}" onclick="state.page='chats';state.activeChat=null;render()">${ico("chat")}<span>Chats</span></button>
 <button class="${state.page==="calls"?"selected":""}" onclick="state.page='calls';state.activeChat=null;render()">${ico("phone")}<span>Calls</span></button>
 <button class="${state.page==="groups"?"selected":""}" onclick="state.page='groups';state.activeChat=null;render()">${ico("users")}<span>Groups</span></button>
 <button class="${state.page==="shorts"?"selected":""}" onclick="openShorts()">${ico("film")}<span>Shorts</span></button>
 <button class="${state.page==="profile"?"selected":""}" onclick="state.page='profile';state.activeChat=null;render()">${ico("user")}<span>Profile</span></button>
 </nav>
 <div class="side-user">${avatarBox(meName(),state.user?.avatar_url)}<div><b>${esc(meName())}</b><small>${esc(state.user?.username||"@user")}</small></div></div></aside>`;
}

function visibleChats(){return state.chats.filter(c=>!c.is_group&&c.hasMsg&&!isSecret(c.id))}
const normProfile=r=>({id:r.id,username:r.username,full_name:r.full_name,display_name:r.full_name||r.username,avatar_url:r.avatar_url||null,online:(state.onlineUsers||[]).includes(r.id)});
function personRow(p){
 const existing=state.chats.find(c=>!c.is_group&&c.user_id===p.id&&c.hasMsg);
 return `<button class="chat-row${state.notes&&state.notes.has(p.id)?" has-note":""}" onclick="startChatWith('${p.id}')">${state.notes&&state.notes.has(p.id)?noteBubble(p.id):""}${avatarBox((nickOf(p.id)||p.display_name||p.username),p.avatar_url,p.online?"online":"")}<div class="chat-info"><b>${esc((nickOf(p.id)||p.display_name||p.username))}</b><span>@${esc(p.username)}${p.online?" · Online":""}</span></div><div class="chat-meta"><small>${existing?"Chat":"New"}</small></div></button>`;
}
function peopleBody(){
 const q=(state.peopleQuery||"").trim();
 if(q.length<2)return `<div class="empty-small">Search by name or username to find people.<br>Nobody is shown until you search.</div>`;
 if(state.searching)return `<div class="empty-small">Searching…</div>`;
 const rows=(state.searchResults||[]).map(personRow).join("");
 return rows||`<div class="empty-small">No users found for “${esc(q)}”.</div>`;
}
let peopleTimer=null;
function filterDirectory(v){state.dirQuery=v;const el=document.getElementById("directoryRows");if(el)el.innerHTML=directoryHtml()}
async function refreshDirectory(){await loadPeople();await loadChats();render()}
async function loadPeople(){
 if(!hasSupabase||!uid())return;
 const {data,error}=await sb.from("profiles").select("*").neq("id",uid());
 if(error){console.warn(error);return;}
 state.people=(data||[]).map(p=>({...p,display_name:p.display_name||p.full_name||p.username,online:false})).sort((x,y)=>(x.display_name||"").localeCompare(y.display_name||""));
 updatePresenceFlags();
}
async function loadChats(){
 if(!hasSupabase||!uid())return;
 await loadPeople();
 const [pc,gc]=await Promise.all([sb.rpc("my_chats"),sb.rpc("my_groups")]);
 if(pc.error)console.warn(pc.error);
 if(gc.error)console.warn(gc.error);
 const old=new Map(state.chats.map(c=>[c.id,c]));
 const lastMsg=async id=>{const {data}=await sb.from("messages").select("content,message_type,created_at").eq("chat_id",id).order("created_at",{ascending:false}).limit(1).maybeSingle();return data};
 const label=l=>l?(l.content||(l.message_type==="image"?"Photo":l.message_type==="video"?"Video":"File")):"";
 const seen=new Set(), priv=[];
 for(const r of (pc.data||[])){if(seen.has(r.other_user_id))continue;seen.add(r.other_user_id);priv.push(r)}
 const groups=gc.data||[];
 const lasts=await Promise.all([...priv.map(r=>lastMsg(r.chat_id)),...groups.map(g=>lastMsg(g.chat_id))]);
 const result=[];
 priv.forEach((r,i)=>{
   const person=state.people.find(p=>p.id===r.other_user_id), last=lasts[i], o=old.get(r.chat_id);
   result.push({id:r.chat_id,is_group:false,user_id:r.other_user_id,avatar_url:person?.avatar_url||null,name:nickOf(r.other_user_id)||person?.display_name||"NTalk User",username:person?"@"+person.username:"",online:false,msg:label(last)||"Tap to chat",time:last?.created_at||"",hasMsg:!!last||!!o?.hasMsg,unread:o?.unread||0});
 });
 groups.forEach((g,gi)=>{
   const last=lasts[priv.length+gi], o=old.get(g.chat_id);
   result.push({id:g.chat_id,is_group:true,name:g.name,members:Number(g.member_count)||0,created_by:g.created_by,msg:label(last)||"Group created",time:last?.created_at||"",hasMsg:true,unread:o?.unread||0});
 });
 result.sort((a,b)=>String(b.time||"").localeCompare(String(a.time||"")));
 const activeId=state.chats[state.activeChat]?.id;
 state.chats=result;
 if(activeId){const k=result.findIndex(c=>c.id===activeId);state.activeChat=k>=0?k:null}
 updatePresenceFlags();updateBadge();
}
function updatePresenceFlags(){
 const online=new Set(state.onlineUsers||[]);
 state.chats.forEach(c=>c.online=online.has(c.user_id));
 state.people.forEach(p=>p.online=online.has(p.id));
}
async function startChatWith(userId){
 let c=state.chats.find(x=>!x.is_group&&x.user_id===userId);
 if(c&&isSecret(c.id)&&!state.secretUnlocked){const ok=await unlockSecret();if(!ok)return}
 if(!c){
   const found=state.people.find(x=>x.id===userId)||(state.searchResults||[]).find(x=>x.id===userId)||(state.callCandidates||[]).find(x=>x.id===userId);
   const {data:chatId,error}=await sb.rpc("get_or_create_private_chat",{other_user:userId});
   if(error)return alert(error.message);
   await loadPeople();
   const p=state.people.find(x=>x.id===userId)||found;
   c=state.chats.find(x=>x.id===chatId);
   if(!c){
     c={id:chatId,is_group:false,user_id:userId,avatar_url:p?.avatar_url||null,name:p?.display_name||"NTalk User",username:p?"@"+p.username:"",online:p?.online||false,msg:"Tap to chat",time:"",hasMsg:false,unread:0};
     state.chats.unshift(c);
   }
 }
 state.page="chats";
 state.activeChat=state.chats.indexOf(c);
 state.chatTab="chats";
 state.replyTo=null;state.forceScroll=true;state.stickUntil=Date.now()+2500;
 await loadMessages(c);
 fetchLastSeen(c);
 subscribeMessageChannel();
 render(); scrollMessages();
}
async function openChat(i){const c=state.chats[i];if(!c)return;c.unread=0;state.activeChat=i;state.replyTo=null;state.forceScroll=true;state.stickUntil=Date.now()+2500;await loadMessages(c);fetchLastSeen(c);subscribeMessageChannel();updateBadge();render();scrollMessages()}
function openChatById(id){const i=state.chats.findIndex(c=>c.id===id);if(i<0)return;if(isSecret(id)&&!state.secretUnlocked){unlockSecret().then(ok=>{if(ok)openChatById(id)});return}state.page=state.chats[i].is_group?"groups":"chats";state.chatTab="chats";openChat(i)}
const avatarBox=(name,url,cls="")=>`<div class="avatar ${cls}">${url?`<img src="${esc(url)}" alt="" loading="lazy">`:esc(avatarName(name))}</div>`;
const senderName=id=>state.people.find(p=>p.id===id)?.display_name||"Member";

function conversation(){
 const c=state.chats[state.activeChat];
 if(!c)return `<div class="empty"><div class="logo">N</div><h2>Choose a chat</h2><p>Open People to start a private chat.</p></div>`;
 const sub=convStatusText(c);
 const calls=c.is_group?`<button onclick="startGroupCall('voice')" title="Group voice call">${ico("phone")}</button><button onclick="startGroupCall('video')" title="Group video call">${ico("video")}</button>`:`<button onclick="startCall('voice')">${ico("phone")}</button><button onclick="startCall('video')">${ico("video")}</button>`;
 const rb=state.replyTo?`<div class="reply-bar"><div class="rb-body"><b>${esc(state.replyTo.name)}</b><span>${esc(state.replyTo.text)}</span></div><button type="button" onclick="cancelReply()">✕</button></div>`:"";
 return `<section class="conversation"><header class="chat-head" onclick="headClick(event)"><button class="mobile-back" onclick="state.activeChat=null;render()">‹</button>
 ${c.is_group?`<div class="avatar group">${ico("users")}</div>`:avatarBox(c.name,c.avatar_url,c.online?"online":"")}<div class="hd-name"><b>${esc(c.name)}</b><small>${esc(sub)}</small></div>
 <div class="head-actions">${calls}<button onclick="chatInfo()">${ico("more")}</button></div></header>
 <div id="messages" class="messages">${state.messages.map(messageBubble).join("")||`<div class="empty-chat">No messages yet. Say hello 👋</div>`}</div>
 ${rb}<form class="composer" onsubmit="sendMessage(event)"><button type="button" onclick="emoji()">${ico("smile")}</button><input id="msg" autocomplete="off" placeholder="Type a message..." oninput="typingChanged(this.value)"><label class="attach" title="Attach">${ico("attach")}<input id="file" type="file" hidden onchange="uploadMedia(this.files[0])"></label><button class="send" type="submit">${ico("send")}</button></form>
 </section>`;
}
function messageBubble(m){
 const mine=m.sender_id===uid();
 const c=state.chats[state.activeChat];
 let body=esc(m.content||"");
 if(m.file_path){
   const label=esc(m.file_name||"Attachment"), mime=m.mime_type||"";
   if(!m._url) body=`<button class="media-load" onclick="loadMedia('${m.id}')">⚠ ${label}<small>Tap to load</small></button>`;
   else if(mime.startsWith("image/")) body=`<img class="media" src="${esc(m._url)}" alt="${label}" onclick="openMedia('${m.id}')" onload="imgLoaded()" onerror="refreshMedia('${m.id}')">`;
   else if(mime.startsWith("video/")) body=`<video class="media" src="${esc(m._url)}" controls playsinline preload="metadata"></video>`;
   else if(mime.startsWith("audio/")) body=`<audio controls src="${esc(m._url)}"></audio>`;
   else body=`<a href="${esc(m._url)}" target="_blank" rel="noopener" download="${label}">${ico("attach")} ${label}</a>`;
 }
 const who=(!mine&&c?.is_group)?`<b class="sender-name">${esc(senderName(m.sender_id))}</b>`:"";
 let quote="";
 if(m.reply_to){
   const o=state.messages.find(x=>x.id===m.reply_to);
   quote=`<div class="quote" onclick="jumpToMsg('${m.reply_to}')"><b>${o?esc(o.sender_id===uid()?"You":senderName(o.sender_id)):"Message"}</b><span>${o?esc(msgSnippet(o)):"Original message unavailable"}</span></div>`;
 }
 let tick="";
 if(mine)tick=c?.is_group?`<span class="tick">✓</span>`:m.seen_at?`<span class="tick seen">✓✓</span>`:m.delivered_at?`<span class="tick">✓✓</span>`:`<span class="tick">✓</span>`;
 return `<div class="bubble ${mine?"me":"them"}" data-mid="${m.id}">${who}${quote}${body}<small>${fmt(m.created_at)}${tick}</small></div>`;
}
async function loadMedia(id){
 const m=state.messages.find(x=>x.id===id);if(!m)return;
 m._url=await signedUrl(m.file_path);
 if(!m._url)alert("Could not load this file. The 'ntalk-media' storage bucket may be missing (run supabase_ntalk_final.sql in Supabase SQL Editor).");
 render();
}
async function refreshMedia(id){
 const m=state.messages.find(x=>x.id===id);if(!m||m._retried)return;
 m._retried=true;m._url=await signedUrl(m.file_path);render();
}
function openMedia(id){
 const m=state.messages.find(x=>x.id===id);if(!m?._url)return;
 document.getElementById("mediaView")?.remove();
 document.body.insertAdjacentHTML("beforeend",`<div id="mediaView" class="media-view" onclick="if(event.target===this)closeMedia()"><button class="mv-close" onclick="closeMedia()">✕</button><img src="${esc(m._url)}" alt=""><a class="mv-save" href="${esc(m._url)}" download="${esc(m.file_name||"photo")}" target="_blank" rel="noopener">Download</a></div>`);
}
function closeMedia(){document.getElementById("mediaView")?.remove()}
async function signedUrl(path){
 const {data,error}=await sb.storage.from("ntalk-media").createSignedUrl(path,3600);
 return error?null:data?.signedUrl||null;
}
async function loadMessages(c){
 if(!hasSupabase||!c)return;
 const {data,error}=await sb.from("messages").select("*").eq("chat_id",c.id).order("created_at",{ascending:true});
 if(error){console.warn(error);state.messages=[];return;}
 state.messages=data||[];
 await Promise.all(state.messages.filter(m=>m.file_path).map(async m=>{m._url=await signedUrl(m.file_path)}));
 if(!c.is_group)markSeen(c.id);
}
async function sendMessage(e){
 e.preventDefault();
 const input=document.getElementById("msg"), text=input.value.trim(), c=state.chats[state.activeChat];
 if(!text||!c)return;
 const reply=state.replyTo;
 const {data,error}=await sb.from("messages").insert({chat_id:c.id,sender_id:uid(),receiver_id:c.is_group?null:c.user_id,content:text,message_type:"text",reply_to:reply?reply.id:null}).select().single();
 if(error)return alert(error.message);
 state.replyTo=null;state.forceScroll=true;
 state.messages.push(data); c.msg=text;c.time=data.created_at;c.hasMsg=true;input.value="";
 await notifyTyping(false);render();scrollMessages();
 pushNotify({type:"message",message_id:data.id});
}
function scrollMessages(){setTimeout(()=>{const m=document.getElementById("messages");if(m)m.scrollTop=m.scrollHeight},40)}
function emoji(){const i=document.getElementById("msg");if(i){i.value+=" 😊";i.focus();typingChanged(i.value)}}

async function uploadMedia(file){
 const c=state.chats[state.activeChat];if(!file||!c)return;
 const path=`${uid()}/${crypto.randomUUID()}-${file.name.replace(/[^a-zA-Z0-9._-]/g,"_")}`;
 const {error}=await sb.storage.from("ntalk-media").upload(path,file,{contentType:file.type||"application/octet-stream",upsert:false});
 if(error)return alert(error.message);
 const type=file.type.startsWith("image/")?"image":file.type.startsWith("video/")?"video":file.type.startsWith("audio/")?"audio":"file";
 const reply=state.replyTo;
 const {data,error:me}=await sb.from("messages").insert({chat_id:c.id,sender_id:uid(),receiver_id:c.is_group?null:c.user_id,content:"",message_type:type,file_path:path,file_name:file.name,file_size:file.size,mime_type:file.type,reply_to:reply?reply.id:null}).select().single();
 if(me)return alert(me.message);
 state.replyTo=null;state.forceScroll=true;state.stickUntil=Date.now()+2500;
 data._url=await signedUrl(path);state.messages.push(data);c.msg=type==="image"?"Photo":type==="video"?"Video":"File";c.time=data.created_at;c.hasMsg=true;render();scrollMessages();
 pushNotify({type:"message",message_id:data.id});
}
async function subscribeMessageChannel(){
 if(!hasSupabase||!uid())return;
 if(state.channel&&state.channelUser===uid())return;
 if(state.channel)await sb.removeChannel(state.channel);
 state.channelUser=uid();
 state.channel=sb.channel("ntalk-messages-"+uid())
 .on("postgres_changes",{event:"INSERT",schema:"public",table:"messages"},onNewMessage)
 .on("postgres_changes",{event:"UPDATE",schema:"public",table:"messages"},onMessageUpdate)
 .on("postgres_changes",{event:"INSERT",schema:"public",table:"statuses"},()=>{
   clearTimeout(state._stT);
   state._stT=setTimeout(async()=>{await loadStatuses();if(state.page==="chats"&&!state.story)render()},400);
 })
 .on("postgres_changes",{event:"*",schema:"public",table:"notes"},()=>{
   clearTimeout(state._ntT);
   state._ntT=setTimeout(async()=>{await loadNotes();if(state.page==="chats")render()},400);
 })
 .subscribe();
}
async function onNewMessage(payload){
 const m=payload.new;
 if(m.sender_id===uid())return;
 let c=state.chats.find(x=>x.id===m.chat_id);
 if(!c){await loadChats();c=state.chats.find(x=>x.id===m.chat_id)}
 if(!c)return;
 c.hasMsg=true;
 const isOpen=state.activeChat!==null&&state.chats[state.activeChat]?.id===c.id;
 const visible=isOpen&&!document.hidden;
 if(m.file_path)m._url=await signedUrl(m.file_path);
 if(isOpen&&!state.messages.some(x=>x.id===m.id))state.messages.push(m);
 c.msg=m.content||(m.message_type==="image"?"Photo":m.message_type==="video"?"Video":"File");
 c.time=m.created_at;
 if(!c.is_group){
   const now=new Date().toISOString();
   sb.from("messages").update(visible?{delivered_at:now,seen_at:now}:{delivered_at:now}).eq("id",m.id).then(()=>{},()=>{});
 }
 if(!visible){c.unread=(c.unread||0)+1;notifyIncoming(c,m)}
 updateBadge();render();
}
function onMessageUpdate(payload){
 const m=payload.new;
 const i=state.messages.findIndex(x=>x.id===m.id);
 if(i<0)return;
 const o=state.messages[i];
 if(o.delivered_at===m.delivered_at&&o.seen_at===m.seen_at)return;
 state.messages[i]={...o,delivered_at:m.delivered_at,seen_at:m.seen_at};
 render();
}
async function setupTyping(){
 if(!hasSupabase||!uid())return;
 if(state.typingCh&&state.typingUser===uid())return;
 if(state.typingCh)await sb.removeChannel(state.typingCh);
 state.typingUser=uid();
 state.typingCh=sb.channel("ntalk-typing",{config:{broadcast:{self:false}}})
 .on("broadcast",{event:"typing"},({payload})=>{
   if(!payload||payload.from===uid())return;
   const c=state.chats.find(x=>x.id===payload.chat_id&&!x.is_group);
   if(!c)return;
   c.typing=!!payload.value;
   clearTimeout(c._tt);if(c.typing)c._tt=setTimeout(()=>{c.typing=false;if(state.chats[state.activeChat]?.id===c.id)render()},3000);
   if(state.activeChat!==null&&state.chats[state.activeChat]?.id===c.id)render();
 })
 .subscribe();
}
async function notifyTyping(value){
 const c=state.chats[state.activeChat];if(!state.typingCh||!c||c.is_group)return;
 try{await state.typingCh.send({type:"broadcast",event:"typing",payload:{from:uid(),chat_id:c.id,value}})}catch{}
}
function typingChanged(v){clearTimeout(state.typingTimer);notifyTyping(!!v);if(v)state.typingTimer=setTimeout(()=>notifyTyping(false),1200)}

/* ---------- notifications ---------- */
function updateBadge(){const n=state.chats.reduce((t,c)=>t+(isSecret(c.id)?0:(c.unread||0)),0);document.title=(n?`(${n}) `:"")+"NTalk"}
function playBeep(){try{const a=new (window.AudioContext||window.webkitAudioContext)();const o=a.createOscillator(),g=a.createGain();o.connect(g);g.connect(a.destination);o.frequency.value=880;g.gain.setValueAtTime(.15,a.currentTime);g.gain.exponentialRampToValueAtTime(.001,a.currentTime+.25);o.start();o.stop(a.currentTime+.25)}catch{}}
function showToast(title,body,chatId){
 document.getElementById("ntToast")?.remove();
 const t=document.createElement("div");t.id="ntToast";t.className="toast";
 t.innerHTML=`<b>${esc(title)}</b><span>${esc(body)}</span>`;
 t.onclick=()=>{t.remove();openChatById(chatId)};
 document.body.appendChild(t);setTimeout(()=>t.remove(),5000);
}
async function notifyIncoming(c,m){
 const sec=isSecret(c.id);
 const who=sec?"NTalk":(c.is_group?`${senderName(m.sender_id)} · ${c.name}`:c.name);
 const body=sec?"New message":(m.content||(m.message_type==="image"?"📷 Photo":m.message_type==="video"?"🎥 Video":"📎 File"));
 if(document.hidden&&state.pushActive)return;
 playBeep();
 if(document.hidden&&"Notification" in window&&Notification.permission==="granted"){
   try{
     const reg=await navigator.serviceWorker?.getRegistration();
     if(reg)reg.showNotification(who,{body,icon:"icons/icon-192.png",badge:"icons/icon-192.png",tag:c.id,renotify:true,data:{chat_id:c.id}});
     else new Notification(who,{body,icon:"icons/icon-192.png"});
   }catch{}
 }else showToast(who,body,c.id);
}
async function enableNotifications(){
 if(!("Notification" in window))return alert("This browser does not support notifications.");
 if(Notification.permission==="denied")return alert("Notifications are blocked. Enable them in the browser's site settings.");
 if(Notification.permission!=="granted"){
   const r=await Notification.requestPermission();
   if(r!=="granted"){render();return alert("Notifications not enabled.")}
 }
 const ok=await registerPush();
 alert(ok?"Notifications enabled. You will get messages and calls even when the app is closed.":"Notifications are enabled while the app is open. Background push is not ready yet (VAPID key / send-push function missing).");
 render();
}
const notifStatus=()=>!("Notification" in window)?"Unsupported":Notification.permission==="granted"?"On":Notification.permission==="denied"?"Blocked":"Off";

/* ---------- groups ---------- */
function groupsView(){
 const rows=state.chats.map((c,i)=>c.is_group&&!isSecret(c.id)?groupRow(c,i):"").join("");
 return `<section class="chat-list"><header class="list-head"><div><h2>Groups</h2><p>Chat with many people</p></div><button class="round" onclick="openGroupModal()" title="New group">${ico("plus")}</button></header><div id="directoryRows">${rows||`<div class="empty-small">No groups yet. Tap <b>+</b> to create one.</div>`}</div></section>`;
}
function groupRow(c,i){
 return `<button class="chat-row" onclick="openChat(${i})"><div class="avatar group">${ico("users")}</div><div class="chat-info"><b>${esc(c.name)}</b><span>${esc(c.msg||"Group created")}</span></div><div class="chat-meta"><small>${esc(fmt(c.time)||"")}</small>${c.unread?`<em>${c.unread}</em>`:""}</div></button>`;
}
function closeModal(){document.getElementById("modalRoot")?.remove()}
/* ---------- member picker (contacts + search) ---------- */
function pickInit(exclude=[]){
 const ex=new Set(exclude);
 state.pick={items:new Map(),selected:new Set(),exclude:ex};
 state.people.forEach(p=>{if(!ex.has(p.id))state.pick.items.set(p.id,p)});
}
function pickRowsHtml(){
 const pk=state.pick;if(!pk)return "";
 const rows=[...pk.items.values()].sort((a,b)=>(a.display_name||"").localeCompare(b.display_name||"")).map(p=>`<label class="pick-row"><input type="checkbox" value="${p.id}" ${pk.selected.has(p.id)?"checked":""} onchange="pickToggle('${p.id}',this.checked)">${avatarBox((nickOf(p.id)||p.display_name||p.username),p.avatar_url,"sm")}<span>${esc((nickOf(p.id)||p.display_name||p.username))}<small class="muted"> @${esc(p.username)}</small></span></label>`).join("");
 return rows||`<div class="empty-small">Search by name or username to add people.</div>`;
}
function pickToggle(id,on){const pk=state.pick;if(!pk)return;if(on)pk.selected.add(id);else pk.selected.delete(id)}
let pickTimer=null;
function pickSearch(q){
 clearTimeout(pickTimer);
 pickTimer=setTimeout(async()=>{
  const pk=state.pick;if(!pk)return;
  if(q.trim().length>=2){
   const {data,error}=await sb.rpc("search_profiles",{q:q.trim()});
   if(error)console.warn(error);
   else(data||[]).forEach(r=>{if(!pk.exclude.has(r.id)&&!pk.items.has(r.id))pk.items.set(r.id,normProfile(r))});
  }
  const el=document.getElementById("pickList");if(el)el.innerHTML=pickRowsHtml();
 },350);
}
function openGroupModal(){
 closeModal();pickInit([]);
 document.body.insertAdjacentHTML("beforeend",`<div id="modalRoot" class="modal-back" onclick="if(event.target===this)closeModal()"><div class="modal"><h3>New group</h3><input id="groupName" class="m-input" maxlength="60" placeholder="Group name"><input class="m-input" placeholder="Search name or username to add" oninput="pickSearch(this.value)" autocomplete="off"><div id="pickList" class="pick-list">${pickRowsHtml()}</div><div class="modal-actions"><button class="m-cancel" onclick="closeModal()">Cancel</button><button class="m-ok" onclick="createGroup()">Create</button></div></div></div>`);
}
async function createGroup(){
 const name=document.getElementById("groupName").value.trim();
 const ids=[...(state.pick?.selected||[])];
 if(!name)return alert("Enter a group name.");
 if(!ids.length)return alert("Select at least one member.");
 const {data:gid,error}=await sb.rpc("create_group",{group_name:name,member_ids:ids});
 if(error)return alert(error.message);
 closeModal();
 await loadChats();
 state.page="groups";
 const i=state.chats.findIndex(c=>c.id===gid);
 if(i>=0)await openChat(i);else render();
}
async function groupInfo(){
 const c=state.chats[state.activeChat];if(!c||!c.is_group)return;
 const {data,error}=await sb.rpc("group_members",{cid:c.id});
 if(error)return alert(error.message);
 const admin=c.created_by===uid();
 state._gm=data||[];
 const rows=state._gm.map(m=>`<div class="pick-row"><div class="avatar sm">${esc(avatarName(m.full_name||m.username))}</div><span class="grow">${esc(m.full_name||m.username)}${m.user_id===uid()?" (You)":""}${m.user_id===c.created_by?" · Admin":""}</span>${admin&&m.user_id!==uid()?`<button class="m-danger" onclick="removeMember('${m.user_id}')">Remove</button>`:""}</div>`).join("");
 closeModal();
 document.body.insertAdjacentHTML("beforeend",`<div id="modalRoot" class="modal-back" onclick="if(event.target===this)closeModal()"><div class="modal"><h3>${esc(c.name)}${admin?` <button class="m-link" onclick="renameGroup()">Rename</button>`:""}</h3><p class="muted">${state._gm.length} members</p>${admin?`<button class="m-add" onclick="addMembersModal()">＋ Add members</button>`:""}<div class="pick-list">${rows}</div><div class="modal-actions"><button class="m-danger" onclick="leaveGroup()">Leave group</button><button class="m-ok" onclick="closeModal()">Close</button></div></div></div>`);
}
async function addMembersModal(){
 const c=state.chats[state.activeChat];if(!c)return;
 pickInit((state._gm||[]).map(m=>m.user_id));
 closeModal();
 document.body.insertAdjacentHTML("beforeend",`<div id="modalRoot" class="modal-back" onclick="if(event.target===this)closeModal()"><div class="modal"><h3>Add members</h3><input class="m-input" placeholder="Search name or username" oninput="pickSearch(this.value)" autocomplete="off"><div id="pickList" class="pick-list">${pickRowsHtml()}</div><div class="modal-actions"><button class="m-cancel" onclick="groupInfo()">Back</button><button class="m-ok" onclick="doAddMembers()">Add</button></div></div></div>`);
}
async function doAddMembers(){
 const c=state.chats[state.activeChat];if(!c)return;
 const ids=[...(state.pick?.selected||[])];
 if(!ids.length)return alert("Select at least one person.");
 const {error}=await sb.rpc("add_group_members",{cid:c.id,member_ids:ids});
 if(error)return alert(error.message);
 await loadChats();render();groupInfo();
}
async function removeMember(userId){
 const c=state.chats[state.activeChat];if(!c)return;
 if(!confirm("Remove this member from the group?"))return;
 const {error}=await sb.rpc("remove_group_member",{cid:c.id,member:userId});
 if(error)return alert(error.message);
 await loadChats();render();groupInfo();
}
async function renameGroup(){
 const c=state.chats[state.activeChat];if(!c)return;
 const name=(prompt("New group name:",c.name)||"").trim();
 if(!name||name===c.name)return;
 const {error}=await sb.rpc("rename_group",{cid:c.id,new_name:name});
 if(error)return alert(error.message);
 await loadChats();render();groupInfo();
}
async function leaveGroup(){
 const c=state.chats[state.activeChat];if(!c)return;
 if(!confirm("Leave this group?"))return;
 const {error}=await sb.rpc("leave_group",{cid:c.id});
 if(error)return alert(error.message);
 closeModal();state.activeChat=null;state.messages=[];
 await loadChats();render();
}

async function initPresence(){
 if(!hasSupabase||!uid())return;
 if(state.presence)await sb.removeChannel(state.presence);
 const ch=sb.channel("ntalk-presence",{config:{presence:{key:uid()}}});
 ch.on("presence",{event:"sync"},()=>{const ps=ch.presenceState();state.onlineUsers=Object.keys(ps);updatePresenceFlags();if(state.page==="chats")render()})
 .on("presence",{event:"join"},({key})=>{state.onlineUsers=[...(state.onlineUsers||[]),key];updatePresenceFlags();render()})
 .on("presence",{event:"leave"},({key})=>{state.onlineUsers=(state.onlineUsers||[]).filter(x=>x!==key);updatePresenceFlags();render();setTimeout(()=>{const c=state.chats[state.activeChat];if(c&&c.user_id===key)fetchLastSeen(c)},1500)});
 await ch.subscribe(async status=>{if(status==="SUBSCRIBED")await ch.track({online_at:new Date().toISOString()})});
 state.presence=ch;
}

const fmtDur=s=>{s=Math.max(0,Math.round(s||0));return Math.floor(s/60)+":"+String(s%60).padStart(2,"0")};
function fmtCallTime(ts){
 const d=new Date(ts),n=new Date(),y=new Date(n);y.setDate(n.getDate()-1);
 const t=d.toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"});
 if(d.toDateString()===n.toDateString())return "Today, "+t;
 if(d.toDateString()===y.toDateString())return "Yesterday, "+t;
 return d.toLocaleDateString([],{day:"numeric",month:"short"})+", "+t;
}
async function loadCallLogs(){
 if(!hasSupabase||!uid())return;
 state.callLogsAt=Date.now();
 const {data,error}=await sb.from("call_logs").select("*").order("started_at",{ascending:false}).limit(60);
 state.callLogsLoading=false;
 if(error){console.warn("call_logs",error);return}
 state.callLogs=data||[];
 await loadPeople();
 if(state.page==="calls")render();
}
function callRow(l){
 const mine=l.caller_id===uid();
 let name,avatar=null,otherId=null;
 if(l.is_group){const c=state.chats.find(x=>x.id===l.chat_id);name=c?c.name:"Group call"}
 else{otherId=mine?l.callee_id:l.caller_id;const p=state.people.find(x=>x.id===otherId);name=p?.display_name||p?.username||"NTalk user";avatar=p?.avatar_url}
 const ok=l.status==="completed";
 let label,cls;
 if(mine){label=ok?"Outgoing":l.status==="declined"?"Declined":l.status==="busy"?"Busy":l.status==="failed"?"Failed":"No answer";cls=ok?"out":"bad"}
 else{label=ok?"Incoming":"Missed";cls=ok?"in":"missed"}
 const kind=l.call_type==="video"?"Video":"Voice";
 const dur=ok?` · ${fmtDur(l.duration_seconds)}`:"";
 const btn=l.is_group?"":`<div class="call-actions"><button onclick="startCall('${l.call_type}','${otherId}')" title="Call again">${ico(l.call_type==="video"?"video":"phone")}</button></div>`;
 return `<div class="chat-row call-row">${l.is_group?`<div class="avatar group">${ico("users")}</div>`:avatarBox(name,avatar)}<div class="chat-info"><b>${esc(name)}</b><span class="cl ${cls}">${mine?"↗":"↙"} ${label} · ${kind}${dur}</span><span>${esc(fmtCallTime(l.started_at))}</span></div>${btn}</div>`;
}
function callsView(){
 if(!state.callLogsLoading&&Date.now()-(state.callLogsAt||0)>15000){state.callLogsLoading=true;loadCallLogs()}
 const rows=(state.callLogs||[]).map(callRow).join("");
 return `<section class="full-page"><header><h2>Calls</h2><button class="round" onclick="openCallSearch()" title="New call">${ico("plus")}</button></header>${rows||`<div class="empty-small">No calls yet.<br>Tap + to call someone, or use the call buttons inside a chat.</div>`}</section>`;
}
function openCallSearch(){
 closeModal();
 document.body.insertAdjacentHTML("beforeend",`<div id="modalRoot" class="modal-back" onclick="if(event.target===this)closeModal()"><div class="modal"><h3>New call</h3><input id="callQ" class="m-input" placeholder="Search name or username" oninput="callSearch(this.value)" autocomplete="off"><div id="callRes" class="pick-list"><div class="empty-small">Type at least 2 letters.</div></div><div class="modal-actions"><button class="m-ok" onclick="closeModal()">Close</button></div></div></div>`);
 document.getElementById("callQ")?.focus();
}
let callQTimer=null;
function callSearch(v){
 clearTimeout(callQTimer);
 const q=v.trim(),box=()=>document.getElementById("callRes");
 if(q.length<2){if(box())box().innerHTML=`<div class="empty-small">Type at least 2 letters.</div>`;return}
 callQTimer=setTimeout(async()=>{
  const {data,error}=await sb.rpc("search_profiles",{q});
  if(!box())return;
  if(error||!data||!data.length){box().innerHTML=`<div class="empty-small">No users found.</div>`;return}
  const list=data.map(normProfile);state.callCandidates=list;
  box().innerHTML=list.map(p=>`<div class="pick-row">${avatarBox(p.display_name,p.avatar_url,"sm")}<span class="grow">${esc(p.display_name)}<small class="muted"> @${esc(p.username)}</small></span><button class="call-mini" onclick="callFromSearch('voice','${p.id}')">${ico("phone")}</button><button class="call-mini" onclick="callFromSearch('video','${p.id}')">${ico("video")}</button></div>`).join("");
 },350);
}
function callFromSearch(type,id){const p=(state.callCandidates||[]).find(x=>x.id===id);closeModal();startCall(type,id,p?.display_name)}
function profileView(){return `<section class="full-page profile"><header><h2>Profile</h2><button onclick="logout()" class="danger-text">Logout</button></header><div class="profile-top"><label class="profile-avatar-wrap" title="Change photo"><div class="profile-avatar">${state.user?.avatar_url?`<img src="${esc(state.user.avatar_url)}" alt="">`:esc(avatarName(meName()))}</div><span class="avatar-edit">${ico("camera")}</span><input type="file" accept="image/*" hidden onchange="changeAvatar(this.files[0])"></label><h2>${esc(meName())}</h2><p>${esc(state.user?.username||"@user")}</p><span class="status">Online</span></div><div class="settings-card"><button onclick="editProfile()">Edit profile <span>${ico("user")}</span></button><button onclick="toggleLastSeen()">Last seen: ${state.shareLastSeen===false?"Nobody":"Everyone"} <span>${ico("user")}</span></button><button onclick="installApp()">Install NTalk <span>${ico("download")}</span></button><button onclick="enableNotifications()">Notifications: ${notifStatus()} <span>${ico("chat")}</span></button><button onclick="forceUpdate()">Update app · v${APP_VERSION} <span>${ico("download")}</span></button><button onclick="toggleTheme()">Appearance: ${state.theme==="dark"?"Dark":"Light"} <span>${ico("theme")}</span></button><button onclick="alert('Email: '+state.user.email)">Account <span>${ico("user")}</span></button></div></section>`}
function resizeImage(file,size=320){return new Promise((res,rej)=>{const img=new Image(),u=URL.createObjectURL(file);img.onload=()=>{const m=Math.min(img.width,img.height),cv=document.createElement("canvas");cv.width=cv.height=size;cv.getContext("2d").drawImage(img,(img.width-m)/2,(img.height-m)/2,m,m,0,0,size,size);URL.revokeObjectURL(u);cv.toBlob(b=>b?res(b):rej(new Error("Image error")),"image/jpeg",.85)};img.onerror=()=>rej(new Error("Cannot read this image"));img.src=u})}
async function changeAvatar(file){
 if(!file||!hasSupabase)return;
 if(!file.type.startsWith("image/"))return alert("Please choose an image.");
 try{
  const blob=await resizeImage(file);
  const path=`${uid()}/avatar-${Date.now()}.jpg`;
  const up=await sb.storage.from("ntalk-avatars").upload(path,blob,{contentType:"image/jpeg",upsert:false});
  if(up.error)return alert("Photo upload failed: "+up.error.message+"\nRun supabase_profile_avatars.sql in Supabase first.");
  const url=sb.storage.from("ntalk-avatars").getPublicUrl(path).data.publicUrl;
  const {error}=await sb.from("profiles").update({avatar_url:url}).eq("id",uid());
  if(error)return alert(error.message);
  state.user.avatar_url=url;saveUser();render();
 }catch(e){alert(e.message)}
}
function editProfile(){
 closeModal();
 document.body.insertAdjacentHTML("beforeend",`<div id="modalRoot" class="modal-back" onclick="if(event.target===this)closeModal()"><div class="modal"><h3>Edit profile</h3><p class="muted">Display name</p><input id="epName" class="m-input" maxlength="40" value="${esc(state.user?.name||"")}"><p class="muted">Username (letters, numbers, _ or .)</p><input id="epUser" class="m-input" maxlength="24" value="${esc((state.user?.username||"").replace(/^@/,""))}"><div class="modal-actions"><button class="m-cancel" onclick="closeModal()">Cancel</button><button class="m-ok" onclick="saveProfile()">Save</button></div></div></div>`);
}
async function saveProfile(){
 const name=document.getElementById("epName").value.trim();
 const username=document.getElementById("epUser").value.trim().replace(/^@/,"").toLowerCase();
 if(!name)return alert("Enter a display name.");
 if(!/^[a-z0-9_.]{3,24}$/.test(username))return alert("Username must be 3-24 characters: letters, numbers, _ or .");
 const {error}=await sb.from("profiles").update({full_name:name,username}).eq("id",uid());
 if(error)return alert(error.code==="23505"?"This username is already taken.":error.message);
 state.user.name=name;state.user.username="@"+username;saveUser();closeModal();render();
}

/* ---- ring tones (generated with WebAudio, no sound files needed) ---- */
let audioCtx=null, ringTimer=null;
function getAudio(){try{if(!audioCtx)audioCtx=new (window.AudioContext||window.webkitAudioContext)();if(audioCtx.state==="suspended")audioCtx.resume();return audioCtx}catch{return null}}
function tone(freqs,dur,vol=.15){
 const a=getAudio();if(!a)return;
 const g=a.createGain();g.connect(a.destination);const t=a.currentTime;
 g.gain.setValueAtTime(.0001,t);g.gain.exponentialRampToValueAtTime(vol,t+.03);
 g.gain.setValueAtTime(vol,t+Math.max(.04,dur-.06));g.gain.exponentialRampToValueAtTime(.0001,t+dur);
 freqs.forEach(f=>{const o=a.createOscillator();o.type="sine";o.frequency.value=f;o.connect(g);o.start(t);o.stop(t+dur+.03)});
}
function stopRing(){clearInterval(ringTimer);ringTimer=null;try{navigator.vibrate&&navigator.vibrate(0)}catch{}}
function startRing(kind){
 stopRing();
 const play=kind==="in"
  ?()=>{tone([880],.18);setTimeout(()=>tone([1175],.18),230);setTimeout(()=>tone([880],.18),760);setTimeout(()=>tone([1175],.18),990);try{navigator.vibrate&&navigator.vibrate([350,150,350])}catch{}}
  :()=>tone([440,480],1.4,.12);
 play();ringTimer=setInterval(play,kind==="in"?2600:4000);
}
["pointerdown","keydown","touchstart"].forEach(ev=>document.addEventListener(ev,()=>{getAudio()},{once:true,passive:true}));

function rtcConfig(){
 const ice=[{urls:"stun:stun.l.google.com:19302"},{urls:"stun:stun1.l.google.com:19302"}];
 if(cfg.TURN_URL){const urls=String(cfg.TURN_URL).split(",").map(x=>x.trim()).filter(Boolean);ice.push({urls,username:cfg.TURN_USERNAME,credential:cfg.TURN_CREDENTIAL})}
 return {iceServers:ice};
}
async function setupSignaling(){
 if(!hasSupabase||!state.user)return;
 if(state.signal)await sb.removeChannel(state.signal);
 state.signalReady=new Promise(res=>{
   state.signal=sb.channel("ntalk-call-signal",{config:{broadcast:{self:false}}});
   state.signal.on("broadcast",{event:"call"},async({payload})=>{if(payload.to===uid())await onSignal(payload)}).subscribe(st=>{if(st==="SUBSCRIBED")res(true)});
 });
}
async function signal(payload){if(state.signal)await state.signal.send({type:"broadcast",event:"call",payload:{...payload,from:uid(),fromName:meName()}})}
function callTarget(){return state.chats[state.activeChat]?.user_id}
async function startCall(type,userId,nameHint){
 if(state.call||state.gcall||state.ginvite)return;
 const to=userId||callTarget();if(!to)return alert("Open a chat first.");
 const person=state.people.find(p=>p.id===to);const otherName=nameHint||person?.display_name||(state.chats[state.activeChat]?.user_id===to?state.chats[state.activeChat].name:"")||"NTalk user";
 if(!navigator.mediaDevices?.getUserMedia)return alert("Microphone/camera access is unavailable. Use HTTPS.");
 getAudio();
 try{localStream=await navigator.mediaDevices.getUserMedia({audio:true,video:type==="video"});}catch(e){return alert("Permission denied or device media is unavailable: "+e.message)}
 if(state.call){localStream.getTracks().forEach(t=>t.stop());localStream=null;return}
 state.call={role:"caller",type,to,otherName,status:"Calling…",answered:false,startedAt:Date.now(),answeredAt:null,cache:{offer:null,ice:[]}};
 showCallOverlay();startRing("out");
 const pc=new RTCPeerConnection(rtcConfig());peer=pc;
 localStream.getTracks().forEach(t=>pc.addTrack(t,localStream));
 pc.onicecandidate=e=>{if(!e.candidate)return;const c=state.call;if(c&&peer===pc){c.cache.ice.push(e.candidate);signal({kind:"ice",to,candidate:e.candidate})}};
 pc.ontrack=e=>attachRemote(e.streams[0]);
 pc.onconnectionstatechange=()=>updateCallStatus(pc.connectionState);
 try{
  const offer=await pc.createOffer();await pc.setLocalDescription(offer);
  if(!state.call||peer!==pc)return;
  const msg={kind:"offer",to,type,offer:{type:offer.type,sdp:offer.sdp}};
  state.call.cache.offer=msg;
  await signal(msg);
  pushNotify({type:"call",to,call_type:type});
  const cc=state.call;
  if(cc)cc.timeout=setTimeout(()=>{if(state.call===cc&&!cc.answered){showToast("Call","No answer","");endCall(true)}},45000);
 }catch(e){console.warn("startCall",e);if(state.call){showToast("Call","Could not start the call","");endCall(false)}}
}
async function onSignal(p){
 if(typeof p.kind==="string"&&p.kind.indexOf("g_")===0)return onGroupSignal(p);
 if(p.kind==="offer"){
   if(state.call||state.gcall||state.ginvite){
     if(state.call&&state.call.role==="callee"&&state.call.to===p.from)signal({kind:"ringing",to:p.from});
     else signal({kind:"busy",to:p.from});
     return;
   }
   state.call={role:"callee",type:p.type,to:p.from,otherName:p.fromName||"NTalk user",status:"Incoming call",offer:p.offer,accepted:false};
   renderIncomingCall();signal({kind:"ringing",to:p.from});
 }
 else if(p.kind==="ringing"){
   const c=state.call;
   if(c&&c.role==="caller"&&c.to===p.from&&!c.answered&&c.status==="Calling…"){c.status="Ringing…";const e=document.getElementById("callStatus");if(e)e.textContent=c.status}
 }
 else if(p.kind==="ready"){
   const c=state.call;
   if(c&&c.role==="caller"&&c.to===p.from&&!c.answered&&c.cache&&c.cache.offer){
     await signal(c.cache.offer);
     for(const cand of c.cache.ice)await signal({kind:"ice",to:c.to,candidate:cand});
   }
 }
 else if(p.kind==="answer"){
   const c=state.call;
   if(!c||!peer||c.role!=="caller"||peer.signalingState!=="have-local-offer")return;
   c.answered=true;stopRing();clearTimeout(c.timeout);
   await peer.setRemoteDescription(p.answer);await flushIce();
 }
 else if(p.kind==="ice"){
   try{if(peer&&peer.remoteDescription)await peer.addIceCandidate(p.candidate);else pendingIce.push(p.candidate)}catch(e){console.warn("ice",e)}
 }
 else if(p.kind==="busy"){
   const c=state.call;if(c&&c.role==="caller"&&c.to===p.from){showToast("Call","User is busy on another call","");endCall(false,"busy")}
 }
 else if(p.kind==="reject"){
   const c=state.call;if(c&&c.to===p.from){showToast("Call","Call declined","");endCall(false,"declined")}
 }
 else if(p.kind==="hangup"){
   const c=state.call;
   if(c&&c.to===p.from){if(c.role==="callee"&&!c.accepted)showToast("Missed call","From "+c.otherName,"");endCall(false)}
 }
}
async function acceptCall(){
 const c=state.call;if(!c||c.role!=="callee"||c.accepted)return;
 stopRing();c.accepted=true;
 try{localStream=await navigator.mediaDevices.getUserMedia({audio:true,video:c.type==="video"});}
 catch(e){c.accepted=false;startRing("in");return alert(e.message)}
 if(state.call!==c){localStream.getTracks().forEach(t=>t.stop());localStream=null;return}
 const pc=new RTCPeerConnection(rtcConfig());peer=pc;
 localStream.getTracks().forEach(t=>pc.addTrack(t,localStream));
 pc.onicecandidate=e=>e.candidate&&signal({kind:"ice",to:c.to,candidate:e.candidate});
 pc.ontrack=e=>attachRemote(e.streams[0]);
 pc.onconnectionstatechange=()=>updateCallStatus(pc.connectionState);
 c.status="Connecting…";showCallOverlay();
 try{
  await pc.setRemoteDescription(c.offer);await flushIce();
  const answer=await pc.createAnswer();await pc.setLocalDescription(answer);
  if(state.call!==c)return;
  await signal({kind:"answer",to:c.to,answer:{type:answer.type,sdp:answer.sdp}});
 }catch(e){console.warn("acceptCall",e);if(state.call===c){showToast("Call","Could not connect the call","");endCall(true)}}
}
async function flushIce(){while(pendingIce.length)await peer.addIceCandidate(pendingIce.shift())}
function attachRemote(stream){if(stream)remoteStream=stream;const v=document.getElementById("remoteVideo");if(v&&remoteStream){v.srcObject=remoteStream;v.play?.().catch(()=>{});if(remoteStream.getVideoTracks().length)document.getElementById("remoteAvatar")?.classList.add("hidden")}}
function updateCallStatus(s){
 const c=state.call;if(!c)return;
 if(s==="connected"){c.status="Connected";c.answered=true;c.answeredAt=c.answeredAt||Date.now();stopRing();clearTimeout(c.timeout)}
 else if(s==="failed"){c.status="Connection failed";stopRing()}
 const e=document.getElementById("callStatus");if(e)e.textContent=c.status;
}
function showCallOverlay(){
 document.querySelector(".call-overlay")?.remove();const c=state.call,video=c.type==="video";
 document.body.insertAdjacentHTML("beforeend",`<div class="call-overlay ${video?"video":""}"><button class="close-call" onclick="endCall(true)">${ico("x")}</button><div class="call-main">${video?`<video id="remoteVideo" class="remote-video" autoplay playsinline></video><div id="remoteAvatar" class="video-avatar">${esc(avatarName(c.otherName))}</div><video id="localVideo" class="local-video" autoplay muted playsinline></video>`:`<audio id="remoteVideo" autoplay playsinline></audio><div id="remoteAvatar" class="call-avatar">${esc(avatarName(c.otherName))}</div>`}<div class="call-title"><h1>${video?"Video Call":"Voice Call"}</h1><h2>${esc(c.otherName)}</h2><p id="callStatus">${esc(c.status)}</p></div><div class="call-controls"><button onclick="toggleMute(this)">${ico("mic")}</button>${video?`<button onclick="toggleCamera(this)">${ico("camera")}</button>`:""}<button onclick="toggleSpeaker(this)" title="Speaker">${ico("speaker")}</button><button class="end" onclick="endCall(true)">${ico("phone")}</button></div></div></div>`);
 if(video&&localStream){const v=document.getElementById("localVideo");v.srcObject=localStream;v.play?.().catch(()=>{})}
 attachRemote();
}
function renderIncomingCall(){
 document.querySelector(".call-overlay")?.remove();const c=state.call;
 document.body.insertAdjacentHTML("beforeend",`<div class="call-overlay incoming"><div class="incoming-card"><div class="call-avatar">${esc(avatarName(c.otherName))}</div><h2>${esc(c.otherName)}</h2><p>Incoming ${c.type==="video"?"video":"voice"} call</p><div class="incoming-actions"><button class="reject" onclick="rejectCall()">${ico("x")}</button><button class="accept" onclick="acceptCall()">${ico("check")}</button></div></div></div>`);
 startRing("in");
}
async function rejectCall(){const c=state.call;stopRing();if(c)await signal({kind:"reject",to:c.to});endCall(false)}
async function endCall(send=true,outcome){
 const c=state.call;
 stopRing();if(c?.timeout)clearTimeout(c.timeout);
 if(send&&c?.to){
   try{await signal({kind:"hangup",to:c.to})}catch{}
   if(c.role==="caller"&&!c.answered)pushNotify({type:"missed_call",to:c.to});
 }
 if(c&&c.role==="caller")logCall(c,outcome);
 try{peer?.close()}catch{}
 peer=null;localStream?.getTracks().forEach(t=>t.stop());localStream=null;remoteStream=null;pendingIce=[];state.call=null;
 document.querySelector(".call-overlay")?.remove();
}
function logCall(c,outcome){
 if(!hasSupabase||!uid())return;
 const ok=!!c.answeredAt;
 const status=outcome||(ok?"completed":(c.status==="Connection failed"?"failed":"missed"));
 const dur=ok?Math.max(0,Math.round((Date.now()-c.answeredAt)/1000)):0;
 sb.from("call_logs").insert({caller_id:uid(),callee_id:c.to,is_group:false,call_type:c.type,status,started_at:new Date(c.startedAt||Date.now()).toISOString(),answered_at:ok?new Date(c.answeredAt).toISOString():null,duration_seconds:dur})
  .then(r=>{if(r.error)console.warn("call log",r.error);else{state.callLogsAt=0;if(state.page==="calls")loadCallLogs()}},()=>{});
}
function toggleMute(btn){const t=localStream?.getAudioTracks()[0];if(t){t.enabled=!t.enabled;btn.classList.toggle("muted",!t.enabled)}}
function toggleCamera(btn){const t=localStream?.getVideoTracks()[0];if(t){t.enabled=!t.enabled;btn.classList.toggle("muted",!t.enabled)}}

let deferredPrompt=null;
window.addEventListener("beforeinstallprompt",e=>{e.preventDefault();deferredPrompt=e});
async function installApp(){if(deferredPrompt){deferredPrompt.prompt();await deferredPrompt.userChoice;deferredPrompt=null}else alert("Use the browser menu → Install app / Add to Home screen.")}

/* =====================  LAST SEEN (WhatsApp style)  ===================== */
function fmtLastSeen(ts){
 const d=new Date(ts),n=new Date(),y=new Date(n);y.setDate(n.getDate()-1);
 const time=d.toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"});
 if(d.toDateString()===n.toDateString())return `last seen today at ${time}`;
 if(d.toDateString()===y.toDateString())return `last seen yesterday at ${time}`;
 return `last seen ${d.toLocaleDateString([],{day:"numeric",month:"short"})} at ${time}`;
}
async function fetchLastSeen(c){
 if(!hasSupabase||!c||c.is_group||!c.user_id)return;
 const {data,error}=await sb.rpc("get_last_seen",{target:c.user_id});
 if(error){console.warn("last seen",error);return}
 c.lastSeen=data||null;
 if(state.chats[state.activeChat]?.id===c.id)render();
}
const rawTouch=()=>{if(hasSupabase&&uid())sb.rpc("touch_last_seen").then(()=>{},()=>{})};
function startLastSeen(){
 if(state.lsTimer)clearInterval(state.lsTimer);
 rawTouch();
 state.lsTimer=setInterval(()=>{if(!document.hidden)rawTouch()},60000);
}
async function loadPrivacy(){
 if(!hasSupabase||!uid())return;
 const {data}=await sb.from("user_privacy").select("share_last_seen").eq("user_id",uid()).maybeSingle();
 state.shareLastSeen=data?data.share_last_seen!==false:true;
 if(state.page==="profile")render();
}
async function toggleLastSeen(){
 const cur=state.shareLastSeen!==false,next=!cur;
 const msg=next?"Show your last seen to others? You will also be able to see theirs.":"Hide your last seen? You also will not be able to see other people's last seen.";
 if(!confirm(msg))return;
 const {error}=await sb.rpc("set_share_last_seen",{share:next});
 if(error)return alert(error.message);
 state.shareLastSeen=next;
 const c=state.chats[state.activeChat];if(c)fetchLastSeen(c);
 render();
}
function convStatusText(c){
 if(c.is_group)return `${c.members||""} members`;
 if(c.typing)return "typing…";
 if(c.online)return "● Online";
 return c.lastSeen?fmtLastSeen(c.lastSeen):"Offline";
}

/* =====================  PROFILE CARD (other user)  ===================== */
function headClick(e){
 if(e.target.closest("button"))return;
 if(!e.target.closest(".avatar,.hd-name"))return;
 const c=state.chats[state.activeChat];if(!c)return;
 if(c.is_group)groupInfo();else openProfileCard();
}
function openPhotoUrl(url){
 document.getElementById("mediaView")?.remove();
 document.body.insertAdjacentHTML("beforeend",`<div id="mediaView" class="media-view" onclick="if(event.target===this)closeMedia()"><button class="mv-close" onclick="closeMedia()">✕</button><img src="${esc(url)}" alt=""></div>`);
}
async function openProfileCard(){
 const c=state.chats[state.activeChat];if(!c||c.is_group)return;
 await fetchLastSeen(c);
 const p=state.people.find(x=>x.id===c.user_id)||{};
 const url=p.avatar_url||c.avatar_url||"";
 const name=nickOf(c.user_id)||p.display_name||c.name;
 const nt=state.notes&&state.notes.get(c.user_id);let ntUrl="";if(nt&&nt.audio_path)ntUrl=(await signedUrl(nt.audio_path))||"";
 const ntHtml=nt?`<div class="note-card"><span class="note-bub inline">${esc(noteText(nt))}</span>${ntUrl?`<audio controls src="${esc(ntUrl)}"></audio>`:""}</div>`:"";
 const status=c.online?"● Online":(c.lastSeen?fmtLastSeen(c.lastSeen):"Offline");
 closeModal();
 document.body.insertAdjacentHTML("beforeend",`<div id="modalRoot" class="modal-back" onclick="if(event.target===this)closeModal()"><div class="modal">${url?`<img class="pc-photo" src="${esc(url)}" alt="" onclick="openPhotoUrl(this.src)">`:`<div class="pc-letter">${esc(avatarName(name))}</div>`}<h3 class="pc-name">${esc(name)}</h3><p class="pc-sub">@${esc(p.username||String(c.username||"").replace(/^@/,""))}</p><p class="pc-seen">${esc(status)}</p>${ntHtml}<div class="modal-actions" style="justify-content:center"><button class="m-cancel" onclick="editNickname('${c.user_id}')">✎ Edit name</button></div><div class="modal-actions"><button class="m-ok" onclick="closeModal()">Close</button></div></div></div>`);
}

/* =====================  READ RECEIPTS  ===================== */
async function markSeen(chatId){
 if(!hasSupabase||!uid())return;
 const now=new Date().toISOString();
 try{
  await sb.from("messages").update({delivered_at:now}).eq("chat_id",chatId).neq("sender_id",uid()).is("delivered_at",null);
  await sb.from("messages").update({seen_at:now}).eq("chat_id",chatId).neq("sender_id",uid()).is("seen_at",null);
 }catch(e){console.warn("markSeen",e)}
}
async function markDeliveredAll(){
 if(!hasSupabase||!uid())return;
 try{await sb.from("messages").update({delivered_at:new Date().toISOString()}).neq("sender_id",uid()).is("delivered_at",null)}catch(e){console.warn(e)}
}

/* =====================  REPLY  ===================== */
function msgSnippet(m){
 if(m.content)return m.content;
 const t=m.mime_type||"";
 return t.startsWith("image/")?"📷 Photo":t.startsWith("video/")?"🎥 Video":t.startsWith("audio/")?"🎤 Audio":"📎 "+(m.file_name||"File");
}
function openMsgMenu(id){
 const m=state.messages.find(x=>x.id===id);if(!m)return;
 closeModal();
 document.body.insertAdjacentHTML("beforeend",`<div id="modalRoot" class="modal-back" onclick="if(event.target===this)closeModal()"><div class="modal"><button class="menu-btn" onclick="replyToMsg('${m.id}')">↩ Reply</button>${m.content?`<button class="menu-btn" onclick="copyMsg('${m.id}')">⧉ Copy</button>`:""}<button class="menu-btn" onclick="closeModal()">Cancel</button></div></div>`);
}
async function copyMsg(id){
 const m=state.messages.find(x=>x.id===id);closeModal();if(!m||!m.content)return;
 try{await navigator.clipboard.writeText(m.content)}
 catch{const t=document.createElement("textarea");t.value=m.content;document.body.appendChild(t);t.select();try{document.execCommand("copy")}catch{}t.remove()}
}
function replyToMsg(id){
 const m=state.messages.find(x=>x.id===id);if(!m)return;
 closeModal();
 state.replyTo={id:m.id,name:m.sender_id===uid()?"You":senderName(m.sender_id),text:msgSnippet(m)};
 render();document.getElementById("msg")?.focus();
}
function cancelReply(){state.replyTo=null;render()}
function jumpToMsg(id){
 const el=document.querySelector(`.bubble[data-mid="${id}"]`);if(!el)return;
 el.scrollIntoView({block:"center",behavior:"smooth"});
 el.classList.add("flash");setTimeout(()=>el.classList.remove("flash"),1300);
}
function imgLoaded(){if(Date.now()<(state.stickUntil||0))scrollMessages()}
function setupMsgGestures(){
 let t=null,sx=0,sy=0,id=null,fired=false;
 const clear=()=>{clearTimeout(t);t=null};
 document.addEventListener("pointerdown",e=>{
   const b=e.target.closest?.(".bubble[data-mid]");
   if(!b||e.target.closest("a,video,audio,button,.quote")){id=null;return}
   id=b.dataset.mid;sx=e.clientX;sy=e.clientY;fired=false;clear();
   t=setTimeout(()=>{t=null;fired=true;openMsgMenu(id)},500);
 });
 document.addEventListener("pointermove",e=>{if(id&&(Math.abs(e.clientX-sx)>10||Math.abs(e.clientY-sy)>10))clear()});
 document.addEventListener("pointerup",e=>{
   if(!id)return;
   const dx=e.clientX-sx,dy=e.clientY-sy;clear();
   if(!fired&&dx>70&&Math.abs(dy)<40)replyToMsg(id);
   id=null;
 });
 document.addEventListener("pointercancel",()=>{clear();id=null});
 document.addEventListener("contextmenu",e=>{const b=e.target.closest?.(".bubble[data-mid]");if(b){e.preventDefault();clear();fired=true;openMsgMenu(b.dataset.mid)}});
}

/* =====================  PUSH NOTIFICATIONS  ===================== */
const urlB64=s=>{const pad="=".repeat((4-s.length%4)%4);const raw=atob((s+pad).replace(/-/g,"+").replace(/_/g,"/"));const out=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)out[i]=raw.charCodeAt(i);return out};
async function registerPush(){
 if(!hasSupabase||!uid()||!cfg.VAPID_PUBLIC_KEY)return false;
 if(!("serviceWorker" in navigator)||!("PushManager" in window)||!("Notification" in window)||Notification.permission!=="granted")return false;
 try{
  const reg=await navigator.serviceWorker.ready;
  const key=urlB64(cfg.VAPID_PUBLIC_KEY);
  let sub=await reg.pushManager.getSubscription();
  if(!sub){
    try{sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:key})}
    catch(e){
      if(e&&e.name==="InvalidStateError"){const old=await reg.pushManager.getSubscription();if(old)await old.unsubscribe();sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:key})}
      else throw e;
    }
  }
  const j=sub.toJSON();
  if(!j.endpoint||!j.keys)return false;
  const {error}=await sb.rpc("register_push",{p_endpoint:j.endpoint,p_p256dh:j.keys.p256dh,p_auth:j.keys.auth});
  if(error){console.warn("register_push",error);return false}
  state.pushActive=true;return true;
 }catch(e){console.warn("push setup failed",e);return false}
}
async function unregisterPush(){
 try{const reg=await navigator.serviceWorker?.getRegistration();const sub=await reg?.pushManager.getSubscription();if(sub)await sb.rpc("unregister_push",{p_endpoint:sub.endpoint})}catch{}
}
function pushNotify(body){
 if(!hasSupabase||!cfg.VAPID_PUBLIC_KEY)return;
 try{sb.functions.invoke("send-push",{body}).then(r=>{if(r&&r.error)console.warn("send-push",r.error)},()=>{})}catch{}
}
async function announceReady(callerId){
 if(!state.user||!callerId)return;
 try{await (state.signalReady||Promise.resolve());await signal({kind:"ready",to:callerId})}catch(e){console.warn(e)}
}
function handleLaunchParams(){
 const q=new URLSearchParams(location.search);
 const call=q.get("call"),chat=q.get("chat"),gcall=q.get("gcall"),from=q.get("from"),t=Number(q.get("t")||0);
 if(!call&&!chat&&!gcall)return;
 history.replaceState(null,"",location.pathname+location.hash);
 if(chat)openChatById(chat);
 if(call&&Date.now()-t<60000)announceReady(call);
 if(gcall&&from&&Date.now()-t<60000)announceGroupReady(from,gcall);
}

/* =====================  STATUS / STORY  ===================== */
const STATUS_COLORS=["#128c7e","#7c5cff","#e11d48","#0ea5e9","#f59e0b","#16a34a","#475569"];
const safeColor=c=>/^#[0-9a-fA-F]{6}$/.test(c||"")?c:STATUS_COLORS[0];
function timeAgo(ts){
 const s=(Date.now()-new Date(ts).getTime())/1000;
 if(s<60)return "just now";if(s<3600)return Math.floor(s/60)+" min ago";if(s<86400)return Math.floor(s/3600)+" h ago";
 return new Date(ts).toLocaleDateString([],{day:"numeric",month:"short"});
}
async function loadStatuses(){
 if(!hasSupabase||!uid())return;
 const {data,error}=await sb.from("statuses").select("*").gt("expires_at",new Date().toISOString()).order("created_at",{ascending:true});
 if(error){console.warn("statuses",error);return}
 const rows=data||[],seen=new Set();
 if(rows.length){
   const v=await sb.from("status_views").select("status_id").eq("viewer_id",uid()).in("status_id",rows.map(r=>r.id));
   (v.data||[]).forEach(r=>seen.add(r.status_id));
 }
 const by=new Map();
 for(const s of rows){s._seen=s.user_id===uid()||seen.has(s.id);if(!by.has(s.user_id))by.set(s.user_id,[]);by.get(s.user_id).push(s)}
 const groups=[...by.entries()].map(([user_id,items])=>({user_id,items,allSeen:items.every(i=>i._seen),latest:items[items.length-1].created_at}));
 state.statusMine=groups.find(g=>g.user_id===uid())||null;
 state.statuses=groups.filter(g=>g.user_id!==uid()).sort((a,b)=>(Number(a.allSeen)-Number(b.allSeen))||String(b.latest).localeCompare(String(a.latest)));
}
async function cleanupMyStatuses(){
 if(!hasSupabase||!uid())return;
 try{
  const {data}=await sb.from("statuses").select("id,media_path").eq("user_id",uid()).lte("expires_at",new Date().toISOString());
  if(!data||!data.length)return;
  const paths=data.map(r=>r.media_path).filter(Boolean);
  if(paths.length)await sb.storage.from("ntalk-media").remove(paths);
  await sb.from("statuses").delete().in("id",data.map(r=>r.id));
 }catch(e){console.warn("cleanup",e)}
}
function statusRow(){
 const mine=state.statusMine;
 const me=`<div class="st-item" onclick="${mine?`openStory('${uid()}')`:"openStatusComposer()"}"><div class="st-ring ${mine?"unseen":""}">${avatarBox(meName(),state.user?.avatar_url)}</div><span class="st-plus" onclick="event.stopPropagation();openStatusComposer()">+</span><span class="nm">My status</span></div>`;
 const others=(state.statuses||[]).map(g=>{
   const p=state.people.find(x=>x.id===g.user_id);if(!p)return "";
   return `<div class="st-item" onclick="openStory('${g.user_id}')"><div class="st-ring ${g.allSeen?"seen":"unseen"}">${avatarBox((nickOf(p.id)||p.display_name||p.username),p.avatar_url)}</div><span class="nm">${esc((nickOf(p.id)||p.display_name||p.username))}</span></div>`;
 }).join("");
 const mn=state.notes&&state.notes.get(uid());
 const noteTile=`<div class="st-item has-note" onclick="openNoteComposer()"><span class="note-bub ${mn?"":"add"}" ${mn?`onclick="event.stopPropagation();showNote('${uid()}')"`:""}>${mn?esc(noteText(mn)):"Add note"}</span><div class="st-ring ${mn?"unseen":""}">${avatarBox(meName(),state.user?.avatar_url)}</div><span class="st-plus" onclick="event.stopPropagation();openNoteComposer()">+</span><span class="nm">My note</span></div>`;
 return `<div class="st-row">${me}${noteTile}${others}</div>`;
}
/* ---- composer ---- */
function openStatusComposer(){state.stDraft={mode:"choose",color:STATUS_COLORS[0],text:""};renderStatusModal()}
function renderStatusModal(){
 const d=state.stDraft;if(!d)return;
 closeModal();
 let inner="";
 if(d.mode==="choose")inner=`<h3>New status</h3><div class="st-choose"><label class="st-big">${ico("camera")}<span>Photo</span><input type="file" accept="image/*" hidden onchange="stagePhoto(this.files[0])"></label><label class="st-big">${ico("film")}<span>Video</span><input type="file" accept="video/*" hidden onchange="stageVideo(this.files[0])"></label><button class="st-big" onclick="stageText()">${ico("chat")}<span>Text</span></button></div><div class="modal-actions"><button class="m-cancel" onclick="closeStatusModal()">Cancel</button></div>`;
 else if(d.mode==="video")inner=`<h3>Video status</h3><video class="st-preview" src="${esc(d.url)}" controls playsinline></video><input id="stCaption" class="m-input" maxlength="120" placeholder="Add a caption..."><div class="modal-actions"><button class="m-cancel" onclick="openStatusComposer()">Back</button><button class="m-ok" onclick="postStatus()">Post</button></div>`;
 else if(d.mode==="photo")inner=`<h3>Photo status</h3><img class="st-preview" src="${esc(d.url)}" alt=""><input id="stCaption" class="m-input" maxlength="120" placeholder="Add a caption..."><div class="modal-actions"><button class="m-cancel" onclick="openStatusComposer()">Back</button><button class="m-ok" onclick="postStatus()">Post</button></div>`;
 else inner=`<h3>Text status</h3><textarea id="stText" class="st-textarea" maxlength="200" placeholder="Type a status" style="background:${safeColor(d.color)}">${esc(d.text||"")}</textarea><div class="st-colors">${STATUS_COLORS.map(c=>`<button class="st-dot ${c===d.color?"on":""}" style="background:${c}" onclick="pickStatusColor('${c}')"></button>`).join("")}</div><div class="modal-actions"><button class="m-cancel" onclick="openStatusComposer()">Back</button><button class="m-ok" onclick="postStatus()">Post</button></div>`;
 document.body.insertAdjacentHTML("beforeend",`<div id="modalRoot" class="modal-back" onclick="if(event.target===this)closeStatusModal()"><div class="modal">${inner}</div></div>`);
}
function closeStatusModal(){const d=state.stDraft;if(d?.url)URL.revokeObjectURL(d.url);state.stDraft=null;closeModal()}
function stagePhoto(file){
 if(!file)return;
 if(!file.type.startsWith("image/"))return alert("Please choose an image.");
 const d=state.stDraft||{};if(d.url)URL.revokeObjectURL(d.url);
 state.stDraft={mode:"photo",file,url:URL.createObjectURL(file),color:d.color||STATUS_COLORS[0],text:""};
 renderStatusModal();
}
function stageText(){state.stDraft={...state.stDraft,mode:"text"};renderStatusModal()}
function pickStatusColor(c){const d=state.stDraft;if(!d)return;d.text=document.getElementById("stText")?.value||"";d.color=c;renderStatusModal();document.getElementById("stText")?.focus()}
function resizeMax(file,max=1080){
 return new Promise((res,rej)=>{
  const img=new Image(),u=URL.createObjectURL(file);
  img.onload=()=>{
    const k=Math.min(1,max/Math.max(img.width,img.height));
    const cv=document.createElement("canvas");cv.width=Math.round(img.width*k);cv.height=Math.round(img.height*k);
    cv.getContext("2d").drawImage(img,0,0,cv.width,cv.height);URL.revokeObjectURL(u);
    cv.toBlob(b=>b?res(b):rej(new Error("Image error")),"image/jpeg",.82);
  };
  img.onerror=()=>rej(new Error("Cannot read this image"));img.src=u;
 });
}
async function postStatus(){
 const d=state.stDraft;if(!d||!hasSupabase)return;
 const btn=document.querySelector("#modalRoot .m-ok"),reset=()=>{if(btn){btn.disabled=false;btn.textContent="Post"}};
 if(btn){btn.disabled=true;btn.textContent="Posting…"}
 try{
  let row;
  if(d.mode==="video"){
    const ext=(d.file.type.split("/")[1]||"mp4").replace(/[^a-z0-9]/gi,"").slice(0,5)||"mp4";
    const path=`${uid()}/status-${crypto.randomUUID()}.${ext}`;
    const up=await sb.storage.from("ntalk-media").upload(path,d.file,{contentType:d.file.type||"video/mp4",upsert:false});
    if(up.error)throw up.error;
    row={user_id:uid(),kind:"video",media_path:path,caption:(document.getElementById("stCaption")?.value||"").trim()||null,duration_seconds:Math.round(d.duration*10)/10};
  }else if(d.mode==="photo"){
    const blob=await resizeMax(d.file,1080);
    const path=`${uid()}/status-${crypto.randomUUID()}.jpg`;
    const up=await sb.storage.from("ntalk-media").upload(path,blob,{contentType:"image/jpeg",upsert:false});
    if(up.error)throw up.error;
    row={user_id:uid(),kind:"image",media_path:path,caption:(document.getElementById("stCaption")?.value||"").trim()||null};
  }else{
    const text=(document.getElementById("stText")?.value||"").trim();
    if(!text){reset();return alert("Type something first.")}
    row={user_id:uid(),kind:"text",text_content:text,bg_color:safeColor(d.color)};
  }
  const {error}=await sb.from("statuses").insert(row);
  if(error)throw error;
  closeStatusModal();
  await loadStatuses();render();
 }catch(e){reset();alert("Could not post status: "+(e.message||e)+"\nMake sure supabase_features.sql was run.")}
}
/* ---- viewer ---- */
async function openStory(userId){
 const g=userId===uid()?state.statusMine:(state.statuses||[]).find(x=>x.user_id===userId);
 if(!g||!g.items.length)return;
 const items=g.items.slice();
 await Promise.all(items.filter(i=>i.kind!=="text"&&!i._url).map(async i=>{i._url=await signedUrl(i.media_path)}));
 let start=items.findIndex(i=>!i._seen);if(start<0)start=0;
 state.story={userId,items,i:start,own:userId===uid(),views:{},paused:false,held:false};
 drawStory();
}
function drawStory(){
 const s=state.story;if(!s)return;
 const it=s.items[s.i];if(!it)return closeStory();
 document.getElementById("storyView")?.remove();
 const p=s.own?{display_name:"My status",avatar_url:state.user?.avatar_url}:(state.people.find(x=>x.id===s.userId)||{});
 const bars=s.items.map((_,k)=>`<div class="sbar"><div class="sfill ${k<s.i?"done":k===s.i?"run":""}" ${k===s.i?`style="animation-duration:${storyDur(it)}s"`:""}></div></div>`).join("");
 const body=it.kind==="video"?(it._url?`<video src="${esc(it._url)}" playsinline autoplay></video>`:`<div class="story-text" style="background:#222"><p>Could not load video</p></div>`):it.kind==="image"
  ?(it._url?`<img src="${esc(it._url)}" alt="">`:`<div class="story-text" style="background:#222"><p>Could not load photo</p></div>`)
  :`<div class="story-text" style="background:${safeColor(it.bg_color)}"><p>${esc(it.text_content||"")}</p></div>`;
 const cap=it.kind!=="text"&&it.caption?`<div class="story-cap">${esc(it.caption)}</div>`:"";
 const seenBtn=s.own?`<button class="story-seen" onclick="showStatusViewers()"><span id="storySeenBtn">👁 Seen by ${(s.views[it.id]||[]).length}</span></button>`:"";
 document.body.insertAdjacentHTML("beforeend",`<div id="storyView" class="story${s.paused?" paused":""}"><div class="story-bars">${bars}</div><div class="story-head">${avatarBox(p.display_name||"N",p.avatar_url)}<div class="who"><b>${esc(s.own?"My status":(p.display_name||"User"))}</b><small>${esc(timeAgo(it.created_at))}</small></div>${s.own?`<button onclick="deleteStory()" title="Delete">🗑</button>`:""}<button onclick="closeStory()">✕</button></div><div class="story-body">${body}</div>${cap}<div class="story-hit" onpointerdown="storyDown(event)" onpointerup="storyUp(event)" onpointerleave="storyCancel()" onpointercancel="storyCancel()"></div>${seenBtn}</div>`);
 const run=document.querySelector("#storyView .sfill.run");
 if(run)run.addEventListener("animationend",nextStory,{once:true});
 const sv=document.querySelector("#storyView video");if(sv){const pp=sv.play();if(pp&&pp.catch)pp.catch(()=>{sv.muted=true;const q2=sv.play();if(q2&&q2.catch)q2.catch(()=>{})})}
 markStoryViewed(it);
 if(s.own)loadStoryViews(it);
}
function pauseStory(on){const s=state.story;if(!s)return;s.paused=on;document.getElementById("storyView")?.classList.toggle("paused",on);const sv=document.querySelector("#storyView video");if(sv){if(on)sv.pause();else{const pp=sv.play();if(pp&&pp.catch)pp.catch(()=>{})}}}
function storyDown(){const s=state.story;if(!s)return;s.held=false;clearTimeout(s.holdT);s.holdT=setTimeout(()=>{s.held=true;pauseStory(true)},220)}
function storyUp(e){
 const s=state.story;if(!s)return;
 clearTimeout(s.holdT);
 if(s.held){s.held=false;pauseStory(false);return}
 if(e.clientX/window.innerWidth<.33)prevStory();else nextStory();
}
function storyCancel(){const s=state.story;if(!s)return;clearTimeout(s.holdT);if(s.held){s.held=false;pauseStory(false)}}
function nextStory(){const s=state.story;if(!s)return;if(s.i<s.items.length-1){s.i++;s.paused=false;drawStory()}else closeStory()}
function prevStory(){const s=state.story;if(!s)return;if(s.i>0)s.i--;s.paused=false;drawStory()}
function closeStory(){
 const s=state.story;
 document.getElementById("storyView")?.remove();
 clearTimeout(s?.holdT);state.story=null;
 (state.statuses||[]).forEach(g=>{g.allSeen=g.items.every(i=>i._seen)});
 state.statuses=(state.statuses||[]).slice().sort((a,b)=>(Number(a.allSeen)-Number(b.allSeen))||String(b.latest).localeCompare(String(a.latest)));
 render();
}
function markStoryViewed(it){
 const s=state.story;if(!s||s.own||it._seen)return;
 it._seen=true;
 sb.from("status_views").upsert({status_id:it.id,viewer_id:uid()},{onConflict:"status_id,viewer_id",ignoreDuplicates:true}).then(()=>{},()=>{});
}
async function loadStoryViews(it){
 const s=state.story;if(!s)return;
 const {data}=await sb.from("status_views").select("viewer_id,viewed_at").eq("status_id",it.id).order("viewed_at",{ascending:false});
 if(!state.story||state.story!==s)return;
 s.views[it.id]=data||[];
 const b=document.getElementById("storySeenBtn");if(b&&s.items[s.i]?.id===it.id)b.textContent=`👁 Seen by ${s.views[it.id].length}`;
}
function showStatusViewers(){
 const s=state.story;if(!s)return;
 const it=s.items[s.i],v=s.views[it.id]||[];
 pauseStory(true);closeModal();
 const rows=v.map(r=>{const p=state.people.find(x=>x.id===r.viewer_id);return `<div class="pick-row">${avatarBox(p?.display_name||"?",p?.avatar_url,"sm")}<span class="grow">${esc(p?.display_name||"User")}</span><small class="muted">${esc(fmt(r.viewed_at))}</small></div>`}).join("")||`<div class="empty-small">No views yet.</div>`;
 document.body.insertAdjacentHTML("beforeend",`<div id="modalRoot" class="modal-back over-story" onclick="if(event.target===this)closeViewers()"><div class="modal"><h3>Seen by ${v.length}</h3><div class="pick-list">${rows}</div><div class="modal-actions"><button class="m-ok" onclick="closeViewers()">Close</button></div></div></div>`);
}
function closeViewers(){closeModal();pauseStory(false)}
async function deleteStory(){
 const s=state.story;if(!s||!s.own)return;
 const it=s.items[s.i];pauseStory(true);
 if(!confirm("Delete this status?")){pauseStory(false);return}
 const {error}=await sb.from("statuses").delete().eq("id",it.id);
 if(error){pauseStory(false);return alert(error.message)}
 if(it.media_path)sb.storage.from("ntalk-media").remove([it.media_path]).then(()=>{},()=>{});
 s.items.splice(s.i,1);
 if(state.statusMine){state.statusMine.items=state.statusMine.items.filter(x=>x.id!==it.id);if(!state.statusMine.items.length)state.statusMine=null}
 if(!s.items.length){closeStory();return}
 s.i=Math.min(s.i,s.items.length-1);s.paused=false;drawStory();
}

/* =====================  GROUP CALLS (mesh, up to 4 people)  ===================== */
const GROUP_MAX=4;
async function startGroupCall(type){
 const c=state.chats[state.activeChat];
 if(!c||!c.is_group)return;
 if(state.call||state.gcall||state.ginvite)return alert("You are already in a call.");
 if(!navigator.mediaDevices?.getUserMedia)return alert("Microphone/camera access is unavailable. Use HTTPS.");
 getAudio();
 const {data,error}=await sb.rpc("group_members",{cid:c.id});
 if(error)return alert(error.message);
 const members=(data||[]).map(m=>m.user_id).filter(id=>id!==uid());
 if(!members.length)return alert("There is nobody else in this group.");
 try{localStream=await navigator.mediaDevices.getUserMedia({audio:true,video:type==="video"})}
 catch(e){return alert("Permission denied or device media is unavailable: "+e.message)}
 if(state.call||state.gcall||state.ginvite){localStream.getTracks().forEach(t=>t.stop());localStream=null;return}
 const g=state.gcall={room:c.id,type,name:c.name,role:"initiator",members,peers:new Map(),early:{},startedAt:Date.now(),answeredAt:null};
 showGroupCall();startRing("out");
 members.forEach(m=>signal({kind:"g_invite",to:m,room:c.id,type,name:c.name}));
 pushNotify({type:"call",chat_id:c.id,call_type:type});
 g.timeout=setTimeout(()=>{if(state.gcall===g&&!g.answeredAt){showToast("Call","No one joined","");leaveGroupCall(true)}},45000);
}
function onGroupSignal(p){
 const g=state.gcall;
 if(p.kind==="g_invite"){
   if(state.call||state.gcall||state.ginvite)return;
   const inv={room:p.room,type:p.type,name:p.name||"Group",from:p.from,fromName:p.fromName||"Someone"};
   inv.timer=setTimeout(()=>{if(state.ginvite===inv){dismissGroupInvite();showToast("Missed group call",inv.name,"")}},45000);
   state.ginvite=inv;renderGroupIncoming();return;
 }
 if(p.kind==="g_cancel"){
   if(state.ginvite&&state.ginvite.room===p.room&&state.ginvite.from===p.from){const n=state.ginvite.name;dismissGroupInvite();showToast("Missed group call",n,"")}
   return;
 }
 if(p.kind==="g_ready"){
   if(g&&g.role==="initiator"&&g.room===p.room)signal({kind:"g_invite",to:p.from,room:g.room,type:g.type,name:g.name});
   return;
 }
 if(!g||g.room!==p.room)return;
 if(p.kind==="g_join"){
   if(!g.peers.has(p.from)&&1+g.peers.size>=GROUP_MAX){signal({kind:"g_full",to:p.from,room:g.room});return}
   ensureGroupPeer(p.from,p.fromName);
   offerToGroupPeer(p.from);
 }
 else if(p.kind==="g_full"){showToast("Call","This call is full (maximum 4 people)","");leaveGroupCall(false)}
 else if(p.kind==="g_offer")onGroupOffer(p);
 else if(p.kind==="g_answer")onGroupAnswer(p);
 else if(p.kind==="g_ice")onGroupIce(p);
 else if(p.kind==="g_leave")removeGroupPeer(p.from);
}
function renderGroupIncoming(){
 document.querySelector(".call-overlay")?.remove();const inv=state.ginvite;
 document.body.insertAdjacentHTML("beforeend",`<div class="call-overlay incoming"><div class="incoming-card"><div class="call-avatar">${esc(avatarName(inv.name))}</div><h2>${esc(inv.name)}</h2><p>${esc(inv.fromName)} · Incoming group ${inv.type==="video"?"video":"voice"} call</p><div class="incoming-actions"><button class="reject" onclick="dismissGroupInvite()">${ico("x")}</button><button class="accept" onclick="acceptGroupInvite()">${ico("check")}</button></div></div></div>`);
 startRing("in");
}
function dismissGroupInvite(){
 const inv=state.ginvite;if(inv)clearTimeout(inv.timer);
 state.ginvite=null;stopRing();document.querySelector(".call-overlay.incoming")?.remove();
}
async function acceptGroupInvite(){
 const inv=state.ginvite;if(!inv)return;
 stopRing();clearTimeout(inv.timer);
 if(state.call||state.gcall){dismissGroupInvite();return}
 let lm;
 try{lm=await navigator.mediaDevices.getUserMedia({audio:true,video:inv.type==="video"})}
 catch(e){dismissGroupInvite();return alert(e.message)}
 localStream=lm;
 const {data}=await sb.rpc("group_members",{cid:inv.room});
 const members=(data||[]).map(m=>m.user_id).filter(id=>id!==uid());
 document.querySelector(".call-overlay.incoming")?.remove();state.ginvite=null;
 const g=state.gcall={room:inv.room,type:inv.type,name:inv.name,role:"member",members,peers:new Map(),early:{},startedAt:Date.now(),answeredAt:null};
 showGroupCall();
 members.forEach(m=>signal({kind:"g_join",to:m,room:g.room}));
}
function ensureGroupPeer(userId,name){
 const g=state.gcall;if(!g)return null;
 let e=g.peers.get(userId);if(e)return e;
 const pc=new RTCPeerConnection(rtcConfig());
 e={pc,userId,name:name||senderName(userId),polite:uid()>userId,makingOffer:false,ignoreOffer:false,pending:g.early[userId]||[],stream:null,state:"connecting"};
 delete g.early[userId];
 g.peers.set(userId,e);
 localStream?.getTracks().forEach(t=>pc.addTrack(t,localStream));
 pc.onicecandidate=ev=>{if(ev.candidate&&state.gcall===g)signal({kind:"g_ice",to:userId,room:g.room,candidate:ev.candidate})};
 pc.ontrack=ev=>{e.stream=ev.streams[0];attachGroupStream(userId)};
 pc.onconnectionstatechange=()=>{
   e.state=pc.connectionState;
   if(pc.connectionState==="connected")onGroupConnected();
   if(pc.connectionState==="failed")showToast("Call","Connection to "+e.name+" failed","");
   updateGroupTile(userId);updateGroupStatus();
 };
 addGroupTile(userId,e.name);
 return e;
}
async function offerToGroupPeer(userId){
 const g=state.gcall;if(!g)return;const e=g.peers.get(userId);if(!e)return;
 try{
  e.makingOffer=true;
  const offer=await e.pc.createOffer();
  if(e.pc.signalingState!=="stable")return;
  await e.pc.setLocalDescription(offer);
  await signal({kind:"g_offer",to:userId,room:g.room,offer:{type:offer.type,sdp:offer.sdp}});
 }catch(err){console.warn("group offer",err)}
 finally{e.makingOffer=false}
}
async function onGroupOffer(p){
 const g=state.gcall;if(!g)return;
 if(!g.peers.has(p.from)&&1+g.peers.size>=GROUP_MAX){signal({kind:"g_full",to:p.from,room:g.room});return}
 const e=ensureGroupPeer(p.from,p.fromName);if(!e)return;
 const pc=e.pc;
 const collision=e.makingOffer||pc.signalingState!=="stable";
 e.ignoreOffer=!e.polite&&collision;
 if(e.ignoreOffer)return;
 try{
  await pc.setRemoteDescription(p.offer);
  await flushGroupIce(e);
  const answer=await pc.createAnswer();
  await pc.setLocalDescription(answer);
  await signal({kind:"g_answer",to:p.from,room:g.room,answer:{type:answer.type,sdp:answer.sdp}});
 }catch(err){console.warn("group offer handle",err)}
}
async function onGroupAnswer(p){
 const g=state.gcall;const e=g?.peers.get(p.from);if(!e)return;
 try{
  if(e.pc.signalingState==="have-local-offer"){await e.pc.setRemoteDescription(p.answer);e.ignoreOffer=false;await flushGroupIce(e)}
 }catch(err){console.warn("group answer",err)}
}
async function onGroupIce(p){
 const g=state.gcall;if(!g)return;
 const e=g.peers.get(p.from);
 if(!e){(g.early[p.from]=g.early[p.from]||[]).push(p.candidate);return}
 if(e.ignoreOffer)return;
 if(e.pc.remoteDescription){try{await e.pc.addIceCandidate(p.candidate)}catch(err){console.warn("group ice",err)}}
 else e.pending.push(p.candidate);
}
async function flushGroupIce(e){while(e.pending.length){try{await e.pc.addIceCandidate(e.pending.shift())}catch{}}}
function showGroupCall(){
 const g=state.gcall;document.getElementById("gcallView")?.remove();
 const video=g.type==="video";
 document.body.insertAdjacentHTML("beforeend",`<div id="gcallView" class="gcall"><div class="gc-top"><b>${esc(g.name)}</b><small id="gcStatus">Calling…</small></div><div id="gcGrid" class="gc-grid"></div><div class="gc-controls"><button onclick="toggleMute(this)">${ico("mic")}</button>${video?`<button onclick="toggleCamera(this)">${ico("camera")}</button>`:""}<button onclick="toggleSpeaker(this)" title="Speaker">${ico("speaker")}</button><button class="end" onclick="leaveGroupCall(true)">${ico("phone")}</button></div></div>`);
 addGroupTile(uid(),"You",true);
 g.peers.forEach(e=>addGroupTile(e.userId,e.name));
 updateGroupStatus();
}
function addGroupTile(userId,name,local=false){
 const grid=document.getElementById("gcGrid");
 if(!grid||document.getElementById("gt-"+userId))return;
 const video=state.gcall?.type==="video";
 grid.insertAdjacentHTML("beforeend",`<div class="gc-tile ${local&&video?"has-video":""}" id="gt-${userId}"><video id="gv-${userId}" ${local?"muted":""} autoplay playsinline></video><div class="gc-av">${esc(avatarName(name))}</div><div class="gc-name">${esc(name)}<small id="gs-${userId}">${local?"":"Connecting…"}</small></div></div>`);
 if(local){const v=document.getElementById("gv-"+userId);if(v){v.muted=true;v.srcObject=localStream;v.play?.().catch(()=>{})}}
 grid.dataset.n=String(grid.children.length);
}
function attachGroupStream(userId){
 const e=state.gcall?.peers.get(userId);const v=document.getElementById("gv-"+userId);
 if(v&&e?.stream){v.srcObject=e.stream;v.play?.().catch(()=>{});document.getElementById("gt-"+userId)?.classList.toggle("has-video",e.stream.getVideoTracks().length>0)}
}
function updateGroupTile(userId){
 const e=state.gcall?.peers.get(userId);const s=document.getElementById("gs-"+userId);
 if(s&&e)s.textContent=e.state==="connected"?"":e.state==="failed"?"Failed":"Connecting…";
}
function removeGroupPeer(userId){
 const g=state.gcall;if(!g)return;
 const e=g.peers.get(userId);if(e){try{e.pc.close()}catch{}g.peers.delete(userId)}
 document.getElementById("gt-"+userId)?.remove();
 const grid=document.getElementById("gcGrid");if(grid)grid.dataset.n=String(grid.children.length);
 updateGroupStatus();
}
function onGroupConnected(){
 const g=state.gcall;if(!g)return;
 if(!g.answeredAt){g.answeredAt=Date.now();stopRing();clearTimeout(g.timeout)}
 updateGroupStatus();
}
function updateGroupStatus(){
 const g=state.gcall;const s=document.getElementById("gcStatus");if(!g||!s)return;
 const n=[...g.peers.values()].filter(e=>e.state==="connected").length;
 s.textContent=n?`${n+1} in call`:(g.answeredAt?"Waiting for others…":(g.role==="initiator"?"Calling…":"Joining…"));
}
function leaveGroupCall(send=true){
 const g=state.gcall;if(!g)return;
 stopRing();clearTimeout(g.timeout);
 if(send){
   g.peers.forEach(e=>signal({kind:"g_leave",to:e.userId,room:g.room}));
   if(g.role==="initiator"&&!g.answeredAt){
     g.members.forEach(m=>signal({kind:"g_cancel",to:m,room:g.room}));
     pushNotify({type:"missed_call",chat_id:g.room});
   }
 }
 if(g.role==="initiator")logGroupCall(g);
 g.peers.forEach(e=>{try{e.pc.close()}catch{}});
 localStream?.getTracks().forEach(t=>t.stop());localStream=null;
 state.gcall=null;document.getElementById("gcallView")?.remove();
}
function logGroupCall(g){
 if(!hasSupabase||!uid())return;
 const ok=!!g.answeredAt;
 sb.from("call_logs").insert({caller_id:uid(),callee_id:null,chat_id:g.room,is_group:true,call_type:g.type,status:ok?"completed":"missed",started_at:new Date(g.startedAt).toISOString(),answered_at:ok?new Date(g.answeredAt).toISOString():null,duration_seconds:ok?Math.max(0,Math.round((Date.now()-g.answeredAt)/1000)):0})
  .then(r=>{if(r.error)console.warn("group call log",r.error);else{state.callLogsAt=0;if(state.page==="calls")loadCallLogs()}},()=>{});
}
async function announceGroupReady(from,room){
 if(!state.user||!from||!room)return;
 try{await (state.signalReady||Promise.resolve());await signal({kind:"g_ready",to:from,room})}catch(e){console.warn(e)}
}
const GOOGLE_SVG=`<svg viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.5l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z"/><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4.1 7.1-10.1 7.1-17.5z"/><path fill="#FBBC05" d="M10.5 28.7c-.5-1.5-.8-3-.8-4.7s.3-3.2.8-4.7l-7.9-6.1C.9 16.4 0 20.1 0 24s.9 7.6 2.6 10.8l7.9-6.1z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.5-5.8c-2.1 1.4-4.8 2.3-8.4 2.3-6.3 0-11.6-4.1-13.5-9.8l-7.9 6.1C6.5 42.6 14.6 48 24 48z"/></svg>`;
async function googleLogin(){
 if(!hasSupabase)return alert("Supabase configuration missing.");
 const {error}=await sb.auth.signInWithOAuth({provider:"google",options:{redirectTo:location.origin+location.pathname}});
 if(error)alert(error.message);
}
function setupView(){
 const u=state.user||{};
 return `<main class="auth"><section class="auth-card"><div class="brand"><div class="logo">N</div><div><h1>NTalk</h1><p>Set up your profile</p></div></div>
 <label>Display name</label><input id="suName" maxlength="40" value="${esc(u.name||"")}">
 <label>Username</label><input id="suUser" maxlength="24" value="${esc((u.username||"").replace(/^@/,""))}">
 <p class="muted">Other people find you by this name or username.</p>
 <button class="primary wide" onclick="saveSetup()">Continue</button></section></main>`;
}
async function saveSetup(){
 const name=document.getElementById("suName").value.trim();
 const username=document.getElementById("suUser").value.trim().replace(/^@/,"").toLowerCase();
 if(!name)return alert("Enter your name.");
 if(!/^[a-z0-9_.]{3,24}$/.test(username))return alert("Username must be 3-24 characters: letters, numbers, _ or .");
 const {error}=await sb.from("profiles").update({full_name:name,username,needs_setup:false}).eq("id",uid());
 if(error)return alert(error.code==="23505"?"This username is already taken.":error.message);
 state.user.name=name;state.user.username="@"+username;state.user.needsSetup=false;saveUser();
 render();
}
/* =====================  CONTACT NAMES (private nicknames)  ===================== */
function nickOf(id){return (state.nicknames&&state.nicknames[id])||""}
async function loadNicknames(){
 if(!hasSupabase||!uid())return;
 const {data,error}=await sb.from("contact_names").select("target_id,nickname").eq("owner_id",uid());
 if(error){console.warn("contact names",error);return}
 state.nicknames={};
 (data||[]).forEach(r=>{state.nicknames[r.target_id]=r.nickname});
}
async function saveNickname(targetId,raw){
 const name=String(raw||"").trim().slice(0,40);
 if(!name){
   const {error}=await sb.from("contact_names").delete().eq("owner_id",uid()).eq("target_id",targetId);
   if(error)return alert(error.message);
   delete state.nicknames[targetId];
 }else{
   const {error}=await sb.from("contact_names").upsert({owner_id:uid(),target_id:targetId,nickname:name,updated_at:new Date().toISOString()});
   if(error)return alert(error.message);
   state.nicknames[targetId]=name;
 }
 await loadChats();
 render();
}
function editNickname(targetId){
 closeModal();
 const p=state.people.find(x=>x.id===targetId)||{};
 const cur=nickOf(targetId);
 document.body.insertAdjacentHTML("beforeend",`<div id="modalRoot" class="modal-back" onclick="if(event.target===this)closeModal()"><div class="modal"><h3>Contact name</h3><p class="muted">Only you see this name. ${esc((nickOf(p.id)||p.display_name||p.username)||"")} will not know about it.</p><input id="nickIn" class="m-input" maxlength="40" value="${esc(cur)}" placeholder="${esc((nickOf(p.id)||p.display_name||p.username)||"Name")}"><div class="modal-actions">${cur?`<button class="m-danger" onclick="saveNicknameFromModal('${targetId}',true)">Remove</button>`:""}<button class="m-cancel" onclick="closeModal()">Cancel</button><button class="m-ok" onclick="saveNicknameFromModal('${targetId}',false)">Save</button></div></div></div>`);
 document.getElementById("nickIn")?.focus();
}
function saveNicknameFromModal(targetId,remove){
 const v=remove?"":(document.getElementById("nickIn")?.value||"");
 closeModal();
 saveNickname(targetId,v);
}
/* =====================  ICONS (extra)  ===================== */
const EXTRA_ICONS={
 speaker:'<path d="M4 9v6h4l5 4V5L8 9H4Z"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/>',
 mute:'<path d="M4 9v6h4l5 4V5L8 9H4Z"/><path d="m17 9 4 6M21 9l-4 6"/>',
 lock:'<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
 film:'<rect x="4" y="3" width="16" height="18" rx="3"/><path d="m10 9 5 3-5 3V9Z"/>',
 heart:'<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.6-7 10-7 10Z"/>',
 comment:'<path d="M20 12a8 8 0 0 1-8 8H5l1.5-3A8 8 0 1 1 20 12Z"/>',
 trash:'<path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13"/>',
 music:'<path d="M9 18V6l10-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/>'
};

/* =====================  CHAT LIST: search icon, + button, secret title  ===================== */
function focusSearch(){setTimeout(()=>document.getElementById("dirSearch")?.focus(),50)}
function toggleSearch(){state.searchOpen=!state.searchOpen;if(!state.searchOpen)state.dirQuery="";render();if(state.searchOpen)focusSearch()}
function newChatPlus(){state.chatTab="chats";state.searchOpen=true;state.secretOpen=false;render();focusSearch()}
function setChatTab(t){state.chatTab=t;state.secretOpen=false;state.searchOpen=(t==="people");render();if(t==="people")focusSearch()}
function matchesQuery(name,username,q){
 const t=String(q||"").trim().toLowerCase();if(!t)return true;
 return String(name||"").toLowerCase().includes(t)||String(username||"").toLowerCase().includes(t);
}
function directoryHtml(){
 const q=state.dirQuery||"";
 const shown=visibleChats();
 const chats=shown.filter(c=>matchesQuery(c.name,String(c.username||"").replace(/^@/,""),q));
 const chatUsers=new Set(shown.map(c=>c.user_id));
 const nm=p=>nickOf(p.id)||p.display_name||p.username||"";
 const users=state.people.filter(p=>!chatUsers.has(p.id)&&matchesQuery(nm(p),p.username,q)).sort((a,b)=>nm(a).localeCompare(nm(b)));
 let h="";
 if(chats.length)h+=`<div class="sec-title">Chats</div>`+chats.map(c=>chatRow(c,state.chats.indexOf(c))).join("");
 if(users.length)h+=`<div class="sec-title">All users</div>`+users.map(personRow).join("");
 if(!h)h=`<div class="empty-small">${String(q).trim()?"No users or chats found.":"No other users have joined yet."}</div>`;
 return h;
}
function chatList(){
 if(state.secretOpen)return secretList();
 const showSearch=state.searchOpen||!!String(state.dirQuery||"").trim();
 return `<section class="chat-list">
 <header class="list-head"><div><h2 class="tap" onclick="openSecret()">Chats</h2><p>Your chats and all users</p></div><div class="lh-actions"><button class="round" onclick="toggleSearch()" title="Search">${ico("search")}</button><button class="round" onclick="newChatPlus()" title="Find people">${ico("plus")}</button></div></header>
 ${showSearch?`<div class="search">${ico("search")}<input id="dirSearch" autocomplete="off" placeholder="Search name or username..." value="${esc(state.dirQuery||"")}" oninput="filterDirectory(this.value)"></div>`:""}
 ${statusRow()}
 <div id="directoryRows">${directoryHtml()}</div>
 </section>`;
}

/* =====================  SECRET CHATS  ===================== */
const isSecret=id=>!!(state.secretIds&&state.secretIds.has(id));
async function loadSecretMeta(){
 if(!hasSupabase||!uid())return;
 const [a,b]=await Promise.all([sb.from("secret_chats").select("chat_id").eq("owner_id",uid()),sb.rpc("secret_has_pin")]);
 state.secretIds=new Set((a.data||[]).map(r=>r.chat_id));
 state.hasSecretPin=b.error?false:!!b.data;
 updateBadge();render();
}
function secretModal(html){closeModal();document.body.insertAdjacentHTML("beforeend",`<div id="modalRoot" class="modal-back over-story" onclick="if(event.target===this)secretCancel()"><div class="modal">${html}</div></div>`);setTimeout(()=>document.getElementById("spA")?.focus(),60)}
let secretResolve=null;
function unlockSecret(){
 if(state.secretUnlocked)return Promise.resolve(true);
 return new Promise(res=>{
  secretResolve=res;
  if(!state.hasSecretPin)secretModal(`<h3>Create secret password</h3><p class="muted">Secret chats are hidden. You need this password to open them. If you forget it you can reset it, but the secret chats then become normal chats again.</p><input id="spA" type="password" class="m-input" placeholder="New password (4-32 characters)" autocomplete="new-password"><input id="spB" type="password" class="m-input" placeholder="Repeat password" autocomplete="new-password"><div class="modal-actions"><button class="m-cancel" onclick="secretCancel()">Cancel</button><button class="m-ok" onclick="secretCreate()">Create</button></div>`);
  else secretModal(`<h3>Secret chats</h3><p class="muted">Enter your secret password.</p><input id="spA" type="password" class="m-input" placeholder="Password" autocomplete="current-password"><div class="modal-actions"><button class="m-link" onclick="secretForgot()">Forgot?</button><button class="m-cancel" onclick="secretCancel()">Cancel</button><button class="m-ok" onclick="secretCheck()">Open</button></div>`);
 });
}
function secretDone(ok){closeModal();const r=secretResolve;secretResolve=null;if(ok)state.secretUnlocked=true;if(r)r(ok)}
function secretCancel(){secretDone(false)}
async function secretCreate(){
 const a=document.getElementById("spA").value,b=document.getElementById("spB").value;
 if(a.length<4||a.length>32)return alert("Password must be 4 to 32 characters.");
 if(a!==b)return alert("Passwords do not match.");
 const {error}=await sb.rpc("secret_set_pin",{new_pin:a,old_pin:null});
 if(error)return alert(error.message);
 state.hasSecretPin=true;secretDone(true);
}
async function secretCheck(){
 const v=document.getElementById("spA").value;
 if(!v)return;
 const {data,error}=await sb.rpc("secret_verify",{pin:v});
 if(error)return alert(error.message);
 if(!data){document.getElementById("spA").value="";return alert("Wrong password.")}
 secretDone(true);
}
async function secretForgot(){
 if(!confirm("Reset the secret password? Your secret chats will become normal chats again (nothing is deleted)."))return;
 const {error}=await sb.rpc("secret_reset");
 if(error)return alert(error.message);
 state.secretIds=new Set();state.hasSecretPin=false;state.secretUnlocked=false;state.secretOpen=false;
 secretDone(false);render();
}
async function openSecret(){
 const ok=await unlockSecret();if(!ok)return;
 state.secretOpen=true;state.chatTab="chats";state.activeChat=null;render();
}
function lockSecret(){state.secretUnlocked=false;state.secretOpen=false;if(state.user){if(state.activeChat!==null&&isSecret(state.chats[state.activeChat]?.id))state.activeChat=null;render()}}
function secretList(){
 const rows=state.chats.map((c,i)=>isSecret(c.id)?(c.is_group?groupRow(c,i):chatRow(c,i)):"").join("");
 return `<section class="chat-list"><header class="list-head"><div><h2>Secret chats</h2><p>Only you can open these</p></div><div class="lh-actions"><button class="round" onclick="changeSecretPassword()" title="Change password">${ico("lock")}</button><button class="round" onclick="lockSecret()" title="Lock and close">${ico("x")}</button></div></header><div id="directoryRows">${rows||`<div class="empty-small">No secret chats yet.<br>Open a chat, tap <b>⋯</b> and choose <b>Move to secret chats</b>.</div>`}</div></section>`;
}
function changeSecretPassword(){
 secretResolve=null;
 secretModal(`<h3>Change secret password</h3><input id="spA" type="password" class="m-input" placeholder="Current password" autocomplete="current-password"><input id="spB" type="password" class="m-input" placeholder="New password (4-32 characters)" autocomplete="new-password"><div class="modal-actions"><button class="m-cancel" onclick="closeModal()">Cancel</button><button class="m-ok" onclick="doChangeSecret()">Change</button></div>`);
}
async function doChangeSecret(){
 const o=document.getElementById("spA").value,n=document.getElementById("spB").value;
 if(n.length<4||n.length>32)return alert("New password must be 4 to 32 characters.");
 const {error}=await sb.rpc("secret_set_pin",{new_pin:n,old_pin:o});
 if(error)return alert(error.message);
 closeModal();showToast("Secret chats","Password changed","");
}
function chatInfo(){
 const c=state.chats[state.activeChat];if(!c)return;
 closeModal();
 const sec=isSecret(c.id);
 document.body.insertAdjacentHTML("beforeend",`<div id="modalRoot" class="modal-back" onclick="if(event.target===this)closeModal()"><div class="modal"><button class="menu-btn" onclick="closeModal();${c.is_group?"groupInfo()":"openProfileCard()"}">${c.is_group?"Group info":"Contact info"}</button><button class="menu-btn" onclick="toggleSecretChat('${c.id}')">${ico("lock")} ${sec?"Remove from secret chats":"Move to secret chats"}</button><button class="menu-btn" onclick="closeModal()">Cancel</button></div></div>`);
}
async function toggleSecretChat(id){
 closeModal();
 if(isSecret(id)){
  const {error}=await sb.from("secret_chats").delete().eq("owner_id",uid()).eq("chat_id",id);
  if(error)return alert(error.message);
  state.secretIds.delete(id);render();showToast("Secret chats","Moved back to normal chats","");return;
 }
 const ok=await unlockSecret();if(!ok)return;
 const {error}=await sb.from("secret_chats").insert({owner_id:uid(),chat_id:id});
 if(error)return alert(error.message);
 state.secretIds.add(id);state.activeChat=null;state.messages=[];state.secretOpen=false;
 render();showToast("Secret chats","Moved. Tap the “Chats” title to open secret chats.","");
}

/* =====================  SPEAKER  ===================== */
async function toggleSpeaker(btn){
 const els=[...document.querySelectorAll("#remoteVideo, #gcallView video")].filter(v=>v.id!=="gv-"+uid());
 if(!els.length||typeof els[0].setSinkId!=="function"){showToast("Speaker","This browser cannot switch the speaker. Use the phone volume or Bluetooth.","");return}
 let outs=[];
 try{outs=(await navigator.mediaDevices.enumerateDevices()).filter(d=>d.kind==="audiooutput")}catch{}
 const isSpk=d=>/speaker/i.test(d.label),isEar=d=>/earpiece|receiver|handset|phone/i.test(d.label)&&!isSpk(d);
 const spk=outs.find(isSpk),ear=outs.find(isEar);
 if(!spk||!ear){showToast("Speaker","This phone does not let the browser switch between speaker and earpiece.","");return}
 state.speakerOn=!state.speakerOn;
 try{await Promise.all(els.map(e=>e.setSinkId((state.speakerOn?spk:ear).deviceId)));btn.classList.toggle("on",state.speakerOn)}
 catch(e){state.speakerOn=!state.speakerOn;showToast("Speaker","Could not switch: "+e.message,"")}
}

/* =====================  VIDEO STATUS helpers  ===================== */
function videoMeta(file){
 return new Promise((res,rej)=>{
  const v=document.createElement("video"),u=URL.createObjectURL(file);v.preload="metadata";
  v.onloadedmetadata=()=>{const d=v.duration;URL.revokeObjectURL(u);res({duration:isFinite(d)?d:0})};
  v.onerror=()=>{URL.revokeObjectURL(u);rej(new Error("This video format cannot be read by the browser."))};
  v.src=u;
 });
}
const storyDur=it=>it.kind==="video"?Math.max(3,Math.min(121,Number(it.duration_seconds)||15)):5;
async function stageVideo(file){
 if(!file)return;
 if(!file.type.startsWith("video/"))return alert("Please choose a video.");
 if(file.size>50*1024*1024)return alert("This video is larger than 50 MB. Choose a smaller or shorter video.");
 try{
  const m=await videoMeta(file);
  if(m.duration>121)return alert("Status videos can be up to 2 minutes.");
  const d=state.stDraft||{};if(d.url)URL.revokeObjectURL(d.url);
  state.stDraft={mode:"video",file,url:URL.createObjectURL(file),duration:m.duration,color:d.color||STATUS_COLORS[0],text:""};
  renderStatusModal();
 }catch(e){alert(e.message)}
}

/* =====================  SHORTS  ===================== */
const shortsMuted=()=>state.shortsMuted!==false;
function openShorts(){state.page="shorts";state.activeChat=null;state.shortsMounted=false;render()}
function shortsView(){return `<section class="shorts"><header class="shorts-head"><button class="round" onclick="leaveShorts()" title="Back">‹</button><b>Shorts</b><button class="round" onclick="openShortUpload()" title="Upload a short">${ico("plus")}</button></header><div id="shortsScroll" class="shorts-scroll"></div></section>`}
async function initShorts(){
 state.shortsList=[];state.shortsEnd=false;state.shortsLoading=false;
 if(state.shortsObs){state.shortsObs.disconnect();state.shortsObs=null}
 const box=document.getElementById("shortsScroll");if(!box)return;
 box.innerHTML=`<div class="short-msg">Loading shorts…</div>`;
 await loadMoreShorts(true);
}
async function loadMoreShorts(first=false){
 if(state.shortsLoading||state.shortsEnd||!hasSupabase)return;
 state.shortsLoading=true;
 const last=state.shortsList[state.shortsList.length-1];
 const {data,error}=await sb.rpc("shorts_feed",{p_limit:8,p_before:last?last.created_at:null});
 state.shortsLoading=false;
 const box=document.getElementById("shortsScroll");if(!box||state.page!=="shorts")return;
 if(error){box.innerHTML=`<div class="short-msg">Could not load shorts.<br><small>${esc(error.message)}</small></div>`;return}
 const rows=data||[];
 if(rows.length<8)state.shortsEnd=true;
 await Promise.all(rows.map(async r=>{r._url=await signedUrl(r.video_path)}));
 if(first)box.innerHTML="";
 if(first&&!rows.length){box.innerHTML=`<div class="short-msg">No shorts yet.<br>Tap + to upload the first one.</div>`;return}
 rows.forEach(r=>{state.shortsList.push(r);box.insertAdjacentHTML("beforeend",shortItem(r))});
 setupShortsObserver();
}
function shortItem(r){
 const name=r.full_name||r.username;
 return `<div class="short" data-sid="${r.id}"><video class="short-video" src="${esc(r._url||"")}" loop playsinline preload="metadata" onclick="toggleShortPlay(this)" onerror="shortVideoError('${r.id}')"></video><div class="short-shade"></div><div class="short-info"><div class="short-user">${avatarBox(name,r.avatar_url,"sm")}<b>${esc(name)}</b></div>${r.caption?`<p>${esc(r.caption)}</p>`:""}</div><div class="short-actions"><button id="sl-${r.id}" class="${r.liked?"liked":""}" onclick="likeShort('${r.id}')">${ico("heart",!!r.liked)}<span>${r.likes}</span></button><button onclick="openShortComments('${r.id}')">${ico("comment")}<span id="sc-${r.id}">${r.comments}</span></button><button class="short-sound" onclick="toggleShortSound()">${ico(shortsMuted()?"mute":"speaker")}</button>${r.user_id===uid()?`<button onclick="deleteShort('${r.id}')">${ico("trash")}</button>`:""}</div></div>`;
}
function setupShortsObserver(){
 const box=document.getElementById("shortsScroll");if(!box)return;
 if(!state.shortsObs){
  state.shortsObs=new IntersectionObserver(es=>{
   es.forEach(e=>{
    const v=e.target.querySelector("video");if(!v)return;
    if(e.isIntersecting&&e.intersectionRatio>=.7){
     v.muted=shortsMuted();
     const p=v.play();if(p&&p.catch)p.catch(()=>{v.muted=true;const q=v.play();if(q&&q.catch)q.catch(()=>{})});
     const items=[...box.children];if(items.indexOf(e.target)>=items.length-3)loadMoreShorts();
    }else v.pause();
   });
  },{root:box,threshold:[0,.7]});
 }
 box.querySelectorAll(".short").forEach(el=>{if(!el._obs){el._obs=true;state.shortsObs.observe(el)}});
}
function toggleShortPlay(v){if(v.paused){const p=v.play();if(p&&p.catch)p.catch(()=>{})}else v.pause()}
function toggleShortSound(){
 state.shortsMuted=!shortsMuted();
 document.querySelectorAll(".short-video").forEach(v=>{v.muted=state.shortsMuted});
 document.querySelectorAll(".short-sound").forEach(b=>{b.innerHTML=ico(state.shortsMuted?"mute":"speaker")});
}
function paintLike(r){const b=document.getElementById("sl-"+r.id);if(b){b.classList.toggle("liked",!!r.liked);b.innerHTML=`${ico("heart",!!r.liked)}<span>${r.likes}</span>`}}
async function likeShort(id){
 const r=(state.shortsList||[]).find(x=>x.id===id);if(!r)return;
 const want=!r.liked;r.liked=want;r.likes=Math.max(0,Number(r.likes)+(want?1:-1));paintLike(r);
 const q=want?sb.from("short_likes").insert({short_id:id,user_id:uid()}):sb.from("short_likes").delete().eq("short_id",id).eq("user_id",uid());
 const {error}=await q;
 if(error){r.liked=!want;r.likes=Math.max(0,Number(r.likes)+(want?-1:1));paintLike(r);console.warn(error)}
}
async function openShortComments(id){
 closeModal();
 document.body.insertAdjacentHTML("beforeend",`<div id="modalRoot" class="modal-back over-story" onclick="if(event.target===this)closeModal()"><div class="modal"><h3>Comments</h3><div id="cmList" class="pick-list"><div class="empty-small">Loading…</div></div><div class="cm-row"><input id="cmIn" class="m-input" maxlength="300" placeholder="Add a comment..." autocomplete="off"><button class="m-ok" onclick="postShortComment('${id}')">Send</button></div></div></div>`);
 await refreshComments(id);
}
async function refreshComments(id){
 const {data,error}=await sb.rpc("short_comments_list",{p_short:id});
 const el=document.getElementById("cmList");if(!el)return;
 if(error){el.innerHTML=`<div class="empty-small">${esc(error.message)}</div>`;return}
 const r=(state.shortsList||[]).find(x=>x.id===id),owner=r&&r.user_id===uid();
 el.innerHTML=(data||[]).map(c=>`<div class="pick-row">${avatarBox(c.full_name||c.username,c.avatar_url,"sm")}<span class="grow"><b>${esc(c.full_name||c.username)}</b><br>${esc(c.body)}</span>${(c.user_id===uid()||owner)?`<button class="m-danger" onclick="deleteShortComment('${c.id}','${id}')">✕</button>`:""}</div>`).join("")||`<div class="empty-small">No comments yet. Be the first.</div>`;
 if(r){r.comments=(data||[]).length;const n=document.getElementById("sc-"+id);if(n)n.textContent=r.comments}
 el.scrollTop=el.scrollHeight;
}
async function postShortComment(id){
 const inp=document.getElementById("cmIn"),body=(inp?.value||"").trim();if(!body)return;
 inp.value="";
 const {error}=await sb.from("short_comments").insert({short_id:id,user_id:uid(),body});
 if(error)return alert(error.message);
 await refreshComments(id);
}
async function deleteShortComment(cid,id){
 const {error}=await sb.from("short_comments").delete().eq("id",cid);
 if(error)return alert(error.message);
 await refreshComments(id);
}
async function deleteShort(id){
 const r=(state.shortsList||[]).find(x=>x.id===id);if(!r||r.user_id!==uid())return;
 if(!confirm("Delete this short?"))return;
 const {error}=await sb.from("shorts").delete().eq("id",id);
 if(error)return alert(error.message);
 sb.storage.from("ntalk-media").remove([r.video_path]).then(()=>{},()=>{});
 document.querySelector(`.short[data-sid="${id}"]`)?.remove();
 state.shortsList=state.shortsList.filter(x=>x.id!==id);
 if(!state.shortsList.length)initShorts();
}
async function shortVideoError(id){
 const r=(state.shortsList||[]).find(x=>x.id===id);if(!r||r._retried)return;
 r._retried=true;const u=await signedUrl(r.video_path);
 const v=document.querySelector(`.short[data-sid="${id}"] video`);if(v&&u){v.src=u;v.load()}
}
function openShortUpload(){
 closeModal();state.shUp=null;
 document.body.insertAdjacentHTML("beforeend",`<div id="modalRoot" class="modal-back over-story" onclick="if(event.target===this)closeShortUpload()"><div class="modal"><h3>New short</h3><label class="st-big">${ico("film")}<span id="shFileName">Choose a video</span><input type="file" accept="video/*" hidden onchange="stageShort(this.files[0])"></label><video id="shPrev" class="st-preview" controls playsinline style="display:none"></video><input id="shCap" class="m-input" maxlength="150" placeholder="Write a caption..."><p id="shStatus" class="muted" style="display:none"></p><p class="muted">Up to 2 minutes and 50 MB.</p><div class="modal-actions"><button class="m-cancel" onclick="closeShortUpload()">Cancel</button><button id="shPost" class="m-ok" onclick="postShort()">Post</button></div></div></div>`);
}
function closeShortUpload(){if(state.shUp&&state.shUp.url)URL.revokeObjectURL(state.shUp.url);state.shUp=null;closeModal()}
function setShStatus(msg,isErr){const el=document.getElementById("shStatus");if(!el)return;el.textContent=msg||"";el.style.display=msg?"block":"none";el.style.color=isErr?"var(--danger)":"var(--muted)"}
function videoMimeOf(file){
 if(file.type&&file.type.startsWith("video/"))return file.type;
 const ext=(file.name.split(".").pop()||"").toLowerCase();
 return {mp4:"video/mp4",m4v:"video/mp4",mov:"video/quicktime",webm:"video/webm","3gp":"video/3gpp",mkv:"video/x-matroska"}[ext]||"";
}
async function stageShort(file){
 if(!file)return;
 const mime=videoMimeOf(file);
 if(!mime)return setShStatus("This file is not a video. Choose a video file.",true);
 if(file.size>50*1024*1024)return setShStatus("This video is larger than 50 MB. Choose a smaller or shorter video.",true);
 setShStatus("Reading video…");
 let duration=0,note="Ready. Tap Post.";
 try{
  const m=await videoMeta(file);
  duration=m.duration;
  if(duration>121)return setShStatus("Shorts can be up to 2 minutes. This one is "+Math.round(duration)+" s.",true);
 }catch(e){note="Preview not available on this phone, but you can still tap Post."}
 if(state.shUp&&state.shUp.url)URL.revokeObjectURL(state.shUp.url);
 const url=URL.createObjectURL(file);
 state.shUp={file,url,duration,mime};
 const pv=document.getElementById("shPrev");if(pv){pv.src=url;pv.style.display="block"}
 const fn=document.getElementById("shFileName");if(fn)fn.textContent=file.name;
 setShStatus(note);
}
async function postShort(){
 const u=state.shUp;
 if(!u)return setShStatus("Choose a video first.",true);
 const btn=document.getElementById("shPost");
 const reset=()=>{if(btn){btn.disabled=false;btn.textContent="Post"}};
 if(btn){btn.disabled=true;btn.textContent="Posting…"}
 try{
  const ext=(u.file.name.split(".").pop()||"mp4").toLowerCase().replace(/[^a-z0-9]/g,"").slice(0,5)||"mp4";
  const path=`${uid()}/short-${crypto.randomUUID()}.${ext}`;
  setShStatus("Uploading video… please wait, do not close the app.");
  const up=await sb.storage.from("ntalk-media").upload(path,u.file,{contentType:u.mime,upsert:false});
  if(up.error)throw new Error("Upload failed: "+up.error.message);
  setShStatus("Saving short…");
  const caption=(document.getElementById("shCap")?.value||"").trim()||null;
  const {error}=await sb.from("shorts").insert({user_id:uid(),video_path:path,caption});
  if(error){sb.storage.from("ntalk-media").remove([path]).then(()=>{},()=>{});throw new Error("Save failed: "+error.message)}
  closeShortUpload();
  showToast("Shorts","Posted","");
  initShorts();
 }catch(e){reset();setShStatus(e.message||String(e),true)}
}
const EYE_ON='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>';
const EYE_OFF='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3l18 18M10.6 6.2A9.8 9.8 0 0 1 12 6c6.4 0 10 6 10 6a17 17 0 0 1-3.2 3.9M6.6 7.6A16.6 16.6 0 0 0 2 12s3.6 6 10 6a9.7 9.7 0 0 0 4-.9"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>';
function addPwToggles(){
 document.querySelectorAll('input[type="password"]:not([data-pw])').forEach(inp=>{
  inp.dataset.pw="1";
  const w=document.createElement("span");w.className="pw-wrap";
  inp.parentNode.insertBefore(w,inp);w.appendChild(inp);
  const b=document.createElement("button");b.type="button";b.className="pw-eye";
  b.setAttribute("aria-label","Show password");b.innerHTML=EYE_ON;
  b.onclick=()=>{
   const show=inp.type==="password";
   inp.type=show?"text":"password";
   b.innerHTML=show?EYE_OFF:EYE_ON;
   b.setAttribute("aria-label",show?"Hide password":"Show password");
  };
  w.appendChild(b);
 });
}
function setupPwToggles(){
 addPwToggles();
 new MutationObserver(()=>addPwToggles()).observe(document.body,{childList:true,subtree:true});
}

/* =====================  NOTES (text + song, 24 h)  ===================== */
const noteText=n=>(n.audio_path?"♪ ":"")+(n.body||n.audio_title||"Song");
function noteBubble(userId,extra=""){
 const n=state.notes&&state.notes.get(userId);if(!n)return "";
 return `<span class="note-bub ${extra}" onclick="event.stopPropagation();showNote('${userId}')">${esc(noteText(n))}</span>`;
}
function chatRow(c,i){
 const hasNote=!c.is_group&&state.notes&&state.notes.has(c.user_id);
 return `<button class="chat-row${hasNote?" has-note":""}" onclick="openChat(${i})">${hasNote?noteBubble(c.user_id):""}${avatarBox(c.name,c.avatar_url,c.online?"online":"")}<div class="chat-info"><b>${esc(c.name)}</b><span>${esc(c.msg||"Tap to chat")}</span></div><div class="chat-meta"><small>${esc(fmt(c.time)||"")}</small>${c.unread?`<em>${c.unread}</em>`:""}</div></button>`;
}
async function loadNotes(){
 if(!hasSupabase||!uid())return;
 const {data,error}=await sb.from("notes").select("*").gt("expires_at",new Date().toISOString());
 if(error){console.warn("notes",error);return}
 state.notes=new Map((data||[]).map(n=>[n.user_id,n]));
}
async function cleanupMyNote(){
 if(!hasSupabase||!uid())return;
 try{
  const {data}=await sb.from("notes").select("audio_path").eq("user_id",uid()).lte("expires_at",new Date().toISOString());
  if(!data||!data.length)return;
  if(data[0].audio_path)await sb.storage.from("ntalk-media").remove([data[0].audio_path]);
  await sb.from("notes").delete().eq("user_id",uid());
 }catch(e){console.warn("note cleanup",e)}
}
function audioMeta(file){
 return new Promise((res,rej)=>{
  const a=document.createElement("audio"),u=URL.createObjectURL(file);a.preload="metadata";
  a.onloadedmetadata=()=>{const d=a.duration;URL.revokeObjectURL(u);res({duration:isFinite(d)?d:0})};
  a.onerror=()=>{URL.revokeObjectURL(u);rej(new Error("This audio format cannot be read by the browser."))};
  a.src=u;
 });
}
async function showNote(userId){
 const n=state.notes&&state.notes.get(userId);if(!n)return;
 const mine=userId===uid();
 const p=mine?{display_name:meName(),avatar_url:state.user?.avatar_url}:(state.people.find(x=>x.id===userId)||{});
 const name=mine?"Your note":(nickOf(userId)||p.display_name||p.username||"Note");
 let url="";if(n.audio_path)url=(await signedUrl(n.audio_path))||"";
 closeModal();
 document.body.insertAdjacentHTML("beforeend",`<div id="modalRoot" class="modal-back over-story" onclick="if(event.target===this)closeModal()"><div class="modal note-modal">${avatarBox(p.display_name||name,p.avatar_url)}<h3 class="pc-name">${esc(name)}</h3>${n.body?`<div class="note-big">${esc(n.body)}</div>`:""}${n.audio_path?`<div class="note-song">♪ ${esc(n.audio_title||"Song")}</div>${url?`<audio controls autoplay src="${esc(url)}"></audio>`:`<p class="pc-sub">Could not load the song.</p>`}`:""}<p class="pc-sub">${esc(timeAgo(n.created_at))}</p><div class="modal-actions">${mine?`<button class="m-danger" onclick="deleteNote()">Delete</button><button class="m-cancel" onclick="openNoteComposer()">Edit</button>`:""}<button class="m-ok" onclick="closeModal()">Close</button></div></div></div>`);
}
function openNoteComposer(){
 closeModal();
 const cur=state.notes&&state.notes.get(uid());
 state.noteDraft={file:null,removeAudio:false};
 document.body.insertAdjacentHTML("beforeend",`<div id="modalRoot" class="modal-back over-story" onclick="if(event.target===this)closeModal()"><div class="modal"><h3>${cur?"Edit note":"New note"}</h3><input id="noteText" class="m-input" maxlength="60" placeholder="Share a thought..." value="${esc(cur?.body||"")}"><label class="st-big">${ico("music")}<span id="noteFileName">${cur&&cur.audio_path?esc("♪ "+(cur.audio_title||"Song")+" (tap to change)"):"Add a song (up to 2 min, 5 MB)"}</span><input type="file" accept="audio/*" hidden onchange="stageNoteAudio(this.files[0])"></label>${cur&&cur.audio_path?`<button id="noteRmSong" class="m-danger" onclick="removeNoteSong()">Remove song</button>`:""}<audio id="notePrev" controls style="display:none;width:100%"></audio><p class="muted">Your note stays for 24 hours. Only people you chat with can see it.</p><div class="modal-actions"><button class="m-cancel" onclick="closeModal()">Cancel</button><button id="notePost" class="m-ok" onclick="postNote()">Share</button></div></div></div>`);
}
async function stageNoteAudio(file){
 if(!file)return;
 if(!file.type.startsWith("audio/"))return alert("Please choose an audio file (mp3, m4a, wav...).");
 if(file.size>5*1024*1024)return alert("This song is larger than 5 MB. Choose a shorter clip.");
 try{
  const m=await audioMeta(file);
  if(m.duration>121)return alert("The song clip can be up to 2 minutes.");
  state.noteDraft={file,removeAudio:false};
  const pv=document.getElementById("notePrev");
  if(pv){if(pv.dataset.u)URL.revokeObjectURL(pv.dataset.u);const u=URL.createObjectURL(file);pv.dataset.u=u;pv.src=u;pv.style.display="block"}
  const fn=document.getElementById("noteFileName");if(fn)fn.textContent="♪ "+file.name;
 }catch(e){alert(e.message)}
}
function removeNoteSong(){
 state.noteDraft={file:null,removeAudio:true};
 const fn=document.getElementById("noteFileName");if(fn)fn.textContent="Add a song (up to 2 min, 5 MB)";
 document.getElementById("noteRmSong")?.remove();
}
async function postNote(){
 const text=(document.getElementById("noteText")?.value||"").trim();
 const d=state.noteDraft||{},cur=state.notes&&state.notes.get(uid());
 let audioPath=cur?cur.audio_path||null:null,audioTitle=cur?cur.audio_title||null:null,newPath=null;
 if(d.removeAudio){audioPath=null;audioTitle=null}
 if(!text&&!audioPath&&!d.file)return alert("Write something or add a song.");
 const btn=document.getElementById("notePost");if(btn){btn.disabled=true;btn.textContent="Sharing…"}
 const reset=()=>{if(btn){btn.disabled=false;btn.textContent="Share"}};
 try{
  if(d.file){
   const ext=(d.file.type.split("/")[1]||"mp3").replace(/[^a-z0-9]/gi,"").slice(0,5)||"mp3";
   newPath=`${uid()}/note-${crypto.randomUUID()}.${ext}`;
   const up=await sb.storage.from("ntalk-media").upload(newPath,d.file,{contentType:d.file.type||"audio/mpeg",upsert:false});
   if(up.error)throw up.error;
   audioPath=newPath;audioTitle=d.file.name.replace(/\.[^.]+$/,"").slice(0,40);
  }
  const {error}=await sb.rpc("set_note",{p_body:text||null,p_audio_path:audioPath,p_audio_title:audioTitle});
  if(error){if(newPath)sb.storage.from("ntalk-media").remove([newPath]).then(()=>{},()=>{});throw error}
  if(cur&&cur.audio_path&&cur.audio_path!==audioPath)sb.storage.from("ntalk-media").remove([cur.audio_path]).then(()=>{},()=>{});
  closeModal();await loadNotes();render();
 }catch(e){reset();alert("Could not share the note: "+(e.message||e)+"\nRun supabase_notes.sql in Supabase first.")}
}
async function deleteNote(){
 const cur=state.notes&&state.notes.get(uid());if(!cur)return;
 if(!confirm("Delete your note?"))return;
 const {error}=await sb.from("notes").delete().eq("user_id",uid());
 if(error)return alert(error.message);
 if(cur.audio_path)sb.storage.from("ntalk-media").remove([cur.audio_path]).then(()=>{},()=>{});
 closeModal();await loadNotes();render();
}
/* =====================  PHONE BACK BUTTON (layers)  ===================== */
const APP_VERSION="2026-10-13-d";
const nav={depth:0,ignore:0,timer:null};
function layerCount(){
 let n=0;
 if(document.getElementById("mediaView"))n++;
 if(document.getElementById("storyView"))n++;
 if(document.getElementById("modalRoot"))n++;
 if(state.call||state.gcall||state.ginvite||document.getElementById("gcallView"))n++;
 if(state.user&&state.activeChat!==null&&(state.page==="chats"||state.page==="groups"))n++;
 if(state.user&&state.secretOpen)n++;
 if(state.user&&state.page!=="chats")n++;
 return n;
}
function topLayerClose(){
 if(document.getElementById("mediaView")){closeMedia();return true}
 if(document.getElementById("storyView")){closeStory();return true}
 if(document.getElementById("modalRoot")){if(secretResolve)secretCancel();else closeModal();return true}
 if(state.call||state.gcall||state.ginvite||document.getElementById("gcallView"))return true;
 if(state.activeChat!==null&&(state.page==="chats"||state.page==="groups")){state.activeChat=null;state.messages=[];render();return true}
 if(state.secretOpen){state.secretOpen=false;render();return true}
 if(state.page!=="chats"){state.page="chats";state.shortsMounted=false;render();return true}
 return false;
}
function syncNav(){
 const want=state.user?layerCount():0;
 try{
  while(nav.depth<want){history.pushState({nt:nav.depth+1},"");nav.depth++}
  if(nav.depth>want){
   const k=nav.depth-want;nav.depth=want;nav.ignore++;
   clearTimeout(nav.timer);nav.timer=setTimeout(()=>{nav.ignore=0},900);
   history.go(-k);
  }
 }catch(e){console.warn("nav",e)}
}
function setupBackNav(){
 window.addEventListener("popstate",()=>{
  if(nav.ignore>0){nav.ignore--;return}
  nav.depth=Math.max(0,nav.depth-1);
  if(!state.user)return;
  topLayerClose();
  syncNav();
 });
 new MutationObserver(()=>syncNav()).observe(document.body,{childList:true});
}
function leaveShorts(){state.page="chats";state.shortsMounted=false;render()}
async function forceUpdate(){
 try{
  if("serviceWorker" in navigator){const rs=await navigator.serviceWorker.getRegistrations();await Promise.all(rs.map(r=>r.unregister()))}
  if(window.caches){const ks=await caches.keys();await Promise.all(ks.map(k=>caches.delete(k)))}
 }catch(e){console.warn(e)}
 location.reload();
}
function injectCriticalCss(){
 if(document.getElementById("ntCritical"))return;
 const st=document.createElement("style");st.id="ntCritical";
 st.textContent=`
 .st-row{align-items:flex-start}
 .st-row .st-item{padding-top:26px}
 .st-row .st-item .note-bub{position:absolute;top:0;left:50%;transform:translateX(-50%);max-width:84px;z-index:2}
 .st-row .st-item .st-plus{top:62px}
 body.in-chat .sidebar{display:none !important}
 @media(max-width:520px){body.in-chat .main{height:100dvh !important}}
 `;
 document.head.appendChild(st);
}

async function initBackend(){ await loadNicknames();
 await loadPeople();await loadChats();
 await subscribeMessageChannel();await setupTyping();await initPresence();await setupSignaling();
 loadPrivacy();loadSecretMeta();startLastSeen();loadNotes().then(()=>{if(state.page==="chats")render()});cleanupMyNote();markDeliveredAll();
 loadStatuses().then(()=>{cleanupMyStatuses();if(state.page==="chats"&&!state.story)render()});
 if("Notification" in window&&Notification.permission==="granted")registerPush();
 handleLaunchParams();
}
function render(){
 if(state.page==="shorts"&&state.shortsMounted&&state.user&&!recoveryMode&&!state.user.needsSetup)return;
 const _k=document.getElementById("msg"),_kv=_k?_k.value:"",_kf=!!_k&&document.activeElement===_k;
 const _m=document.getElementById("messages"),_st=_m?_m.scrollTop:0,_near=!_m||(_m.scrollHeight-_m.scrollTop-_m.clientHeight<140);
 const _d=document.getElementById("dirSearch"),_dv=_d?_d.value:null,_df=!!_d&&document.activeElement===_d,_ds=_d?_d.selectionStart:0;
 document.body.dataset.theme=state.theme;
 const hideNav=!!state.user&&(state.page==="shorts"||(state.activeChat!==null&&(state.page==="chats"||state.page==="groups")));
 document.body.classList.toggle("in-chat",hideNav);
 if(recoveryMode){app.innerHTML=resetView();return}
 if(!state.user){app.innerHTML=loginView();return}
 if(state.user.needsSetup){app.innerHTML=setupView();return}
 if(state.page!=="chats")state.secretOpen=false;
 const center=state.page==="calls"?callsView():state.page==="groups"?groupsView():state.page==="profile"?profileView():state.page==="shorts"?shortsView():chatList();
 app.innerHTML=`<div class="shell">${sidebar()}<main class="main">${center}${(state.page==="chats"||state.page==="groups")&&state.activeChat!==null?conversation():state.page==="groups"?`<div class="empty"><div class="logo">N</div><h2>Select a group</h2><p>Or tap <b>+</b> to create a new one.</p></div>`:state.page==="chats"?`<div class="empty"><div class="logo">N</div><h2>Select a chat</h2><p>Open <b>People</b> to see all registered NTalk users.</p></div>`:""}</main></div>`;
 const _n=document.getElementById("msg");if(_n&&_kv){_n.value=_kv;if(_kf)_n.focus()}
 const _dn=document.getElementById("dirSearch");if(_dn&&_dv!==null){if(_dn.value!==_dv)_dn.value=_dv;if(_df){_dn.focus();try{_dn.setSelectionRange(_ds,_ds)}catch{}}}
 const _mm=document.getElementById("messages");if(_mm){if(_near||state.forceScroll)_mm.scrollTop=_mm.scrollHeight;else _mm.scrollTop=_st}
 {const small=window.matchMedia&&window.matchMedia("(max-width:700px)").matches;const sbEl=app.querySelector(".sidebar"),mnEl=app.querySelector(".main"),shEl=app.querySelector(".shorts");if(sbEl)sbEl.style.display=(hideNav&&small)?"none":"";if(mnEl)mnEl.style.height=(hideNav&&small)?"100dvh":"";if(shEl)shEl.style.height="100dvh"}
 if(state.page==="shorts"){if(!state.shortsMounted){state.shortsMounted=true;initShorts()}}else state.shortsMounted=false;
 state.forceScroll=false;
 syncNav();
}
window.addEventListener("load",async()=>{
 if("serviceWorker" in navigator){navigator.serviceWorker.register("./sw.js").catch(()=>{});navigator.serviceWorker.addEventListener("message",e=>{const d=e.data||{};if(d.type==="open_chat")openChatById(d.chat_id);else if(d.type==="call_ready"&&Date.now()-Number(d.ts||0)<60000)announceReady(d.from);else if(d.type==="gcall_ready"&&Date.now()-Number(d.ts||0)<60000)announceGroupReady(d.from,d.chat_id)})}
 document.addEventListener("click",()=>{if("Notification" in window&&Notification.permission==="default")Notification.requestPermission().then(r=>{if(r==="granted")registerPush()}).catch(()=>{})},{once:true});
 setupMsgGestures();
 setupPwToggles();
 setupBackNav();
 injectCriticalCss();
 document.addEventListener("visibilitychange",()=>{if(!state.user)return;rawTouch();if(document.hidden){clearTimeout(state._lockT);state._lockT=setTimeout(()=>{if(state.secretUnlocked||state.secretOpen)lockSecret()},60000)}else clearTimeout(state._lockT);if(!document.hidden){const c=state.chats[state.activeChat];if(c){c.unread=0;if(!c.is_group)markSeen(c.id)}updateBadge()}});
 window.addEventListener("pagehide",()=>{if(state.user)rawTouch()});
 if(hasSupabase){const {data}=await sb.auth.getSession();if(data.session&&!recoveryMode){await loadProfile(data.session.user);await initBackend()}}
 render();
});
