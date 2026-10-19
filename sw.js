const CACHE='ntalk-v9';
self.addEventListener('install',e=>{self.skipWaiting();e.waitUntil(caches.open(CACHE).then(c=>c.addAll(['./','./index.html','./style.css','./app.js','./config.js','./manifest.json','./icon.svg','./icons/icon-192.png','./icons/icon-512.png','./icons/icon-maskable-512.png','./icons/apple-touch-icon.png','./favicon.ico'])).catch(()=>{}))});
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));

// network-first: new files always load; cache is only an offline fallback
self.addEventListener('fetch',e=>{
  if(e.request.method!=='GET'||!e.request.url.startsWith(self.location.origin))return;
  e.respondWith(fetch(e.request,{cache:'no-cache'}).then(x=>{const copy=x.clone();caches.open(CACHE).then(c=>c.put(e.request,copy)).catch(()=>{});return x}).catch(()=>caches.match(e.request).then(r=>r||caches.match('./index.html'))));
});

// ---------- Web Push ----------
self.addEventListener('push',e=>{
  let d={};
  try{d=e.data?e.data.json():{}}catch(_){d={title:'NTalk',body:e.data?e.data.text():''}}
  e.waitUntil((async()=>{
    const cs=await self.clients.matchAll({type:'window',includeUncontrolled:true});
    // app is open and visible: it already shows its own toast / incoming call screen
    if(cs.some(c=>c.visibilityState==='visible'))return;
    const base={icon:'icons/icon-192.png',badge:'icons/icon-192.png',tag:d.tag||undefined,data:d};
    if(d.type==='call'){
      await self.registration.showNotification(d.title||'Incoming call',{...base,body:d.body||'Incoming call',renotify:true,requireInteraction:true,vibrate:[400,200,400,200,800],actions:[{action:'answer',title:'Answer'}]});
    }else if(d.type==='missed_call'){
      await self.registration.showNotification(d.title||'Missed call',{...base,body:d.body||'',renotify:true});
    }else{
      await self.registration.showNotification(d.title||'NTalk',{...base,body:d.body||'New message',renotify:true,vibrate:[120,60,120]});
    }
  })());
});

self.addEventListener('notificationclick',e=>{
  e.notification.close();
  const d=e.notification.data||{};
  e.waitUntil((async()=>{
    const cs=await self.clients.matchAll({type:'window',includeUncontrolled:true});
    let url='./';
    const group=d.type==='call'&&d.group;
    if(group)url='./?gcall='+encodeURIComponent(d.chat_id||'')+'&from='+encodeURIComponent(d.from||'')+'&t='+(d.ts||Date.now());
    else if(d.type==='call')url='./?call='+encodeURIComponent(d.from||'')+'&t='+(d.ts||Date.now());
    else if(d.chat_id)url='./?chat='+encodeURIComponent(d.chat_id);
    if(cs.length){
      const c=cs[0];
      try{await c.focus()}catch(_){}
      if(group)c.postMessage({type:'gcall_ready',chat_id:d.chat_id,from:d.from,ts:d.ts});
      else if(d.type==='call')c.postMessage({type:'call_ready',from:d.from,ts:d.ts});
      else if(d.chat_id)c.postMessage({type:'open_chat',chat_id:d.chat_id});
    }else{
      await self.clients.openWindow(url);
    }
  })());
});
