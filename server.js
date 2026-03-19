const express = require('express');
const crypto  = require('crypto');
const cors    = require('cors');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const sessions = new Map();

// Clean expired sessions every 10 min
setInterval(() => {
  const now = Date.now();
  for (const [id, s] of sessions.entries()) {
    if (now > s.expiresAt + 60000) sessions.delete(id);
  }
}, 10 * 60 * 1000);

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'Jarvis Remote Desktop API', uptime: process.uptime() });
});

app.get('/', (req, res) => {
  res.json({ name: 'Jarvis Remote Desktop API', version: '2.0.0', tagline: 'Control It Your Way' });
});

// POST /pair → create new session, return QR URL
app.post('/pair', (req, res) => {
  const sessionId = crypto.randomBytes(16).toString('hex');
  const secret    = crypto.randomBytes(32).toString('hex');
  const expiresAt = Date.now() + 5 * 60 * 1000;

  sessions.set(sessionId, {
    sessionId, secret,
    status:    'waiting',
    expiresAt,
    createdAt: Date.now(),
    offer:     null,
    answer:    null,
    icePc:     [],
    iceMobile: [],
    mouseEvents: [],
    keyEvents:   [],
  });

  setTimeout(() => {
    const s = sessions.get(sessionId);
    if (s && s.status !== 'connected') s.status = 'expired';
  }, 5 * 60 * 1000);

  const BASE  = process.env.BASE_URL || 'https://jarvis-remote-desktop-api-production.up.railway.app';
  const qrUrl = `${BASE}/connect?session=${sessionId}&secret=${secret}`;

  res.json({ sessionId, secret, qrUrl, expiresAt });
});

// Desktop sends WebRTC offer
app.post('/pair/:id/offer', (req, res) => {
  const s = sessions.get(req.params.id);
  if (!s) return res.status(404).json({ error: 'Not found' });
  if (req.body.secret !== s.secret) return res.status(403).json({ error: 'Forbidden' });
  if (s.status === 'expired') return res.status(410).json({ error: 'Expired' });
  s.offer  = req.body.offer;
  s.status = 'pc_ready';
  res.json({ ok: true });
});

// Mobile polls for WebRTC offer
app.get('/pair/:id/offer', (req, res) => {
  const s = sessions.get(req.params.id);
  if (!s) return res.status(404).json({ error: 'Not found' });
  if (req.query.secret !== s.secret) return res.status(403).json({ error: 'Forbidden' });
  if (Date.now() > s.expiresAt) { s.status = 'expired'; return res.status(410).json({ error: 'Expired' }); }
  res.json({ status: s.status, offer: s.offer });
});

// Mobile sends WebRTC answer
app.post('/pair/:id/answer', (req, res) => {
  const s = sessions.get(req.params.id);
  if (!s) return res.status(404).json({ error: 'Not found' });
  if (req.body.secret !== s.secret) return res.status(403).json({ error: 'Forbidden' });
  s.answer = req.body.answer;
  s.status = 'connected';
  res.json({ ok: true });
});

// Desktop polls for mobile answer
app.get('/pair/:id/answer', (req, res) => {
  const s = sessions.get(req.params.id);
  if (!s) return res.status(404).json({ error: 'Not found' });
  if (req.query.secret !== s.secret) return res.status(403).json({ error: 'Forbidden' });
  res.json({ status: s.status, answer: s.answer });
});

// ICE candidate exchange
app.post('/pair/:id/ice', (req, res) => {
  const s = sessions.get(req.params.id);
  if (!s) return res.status(404).json({ error: 'Not found' });
  if (req.body.secret !== s.secret) return res.status(403).json({ error: 'Forbidden' });
  if (req.body.from === 'pc')     s.icePc.push(req.body.candidate);
  if (req.body.from === 'mobile') s.iceMobile.push(req.body.candidate);
  res.json({ ok: true });
});

app.get('/pair/:id/ice', (req, res) => {
  const s = sessions.get(req.params.id);
  if (!s) return res.status(404).json({ error: 'Not found' });
  if (req.query.secret !== s.secret) return res.status(403).json({ error: 'Forbidden' });
  const candidates = req.query.for === 'mobile' ? s.icePc : s.iceMobile;
  res.json({ candidates });
});

// Mobile sends mouse events → desktop reads them
app.post('/pair/:id/mouse', (req, res) => {
  const s = sessions.get(req.params.id);
  if (!s) return res.status(404).json({ error: 'Not found' });
  if (req.body.secret !== s.secret) return res.status(403).json({ error: 'Forbidden' });
  s.mouseEvents.push({ ...req.body, t: Date.now() });
  if (s.mouseEvents.length > 50) s.mouseEvents.shift();
  res.json({ ok: true });
});

app.get('/pair/:id/mouse', (req, res) => {
  const s = sessions.get(req.params.id);
  if (!s) return res.status(404).json({ error: 'Not found' });
  if (req.query.secret !== s.secret) return res.status(403).json({ error: 'Forbidden' });
  const events = [...s.mouseEvents];
  s.mouseEvents = [];
  res.json({ events });
});

// Mobile sends key events → desktop reads them
app.post('/pair/:id/key', (req, res) => {
  const s = sessions.get(req.params.id);
  if (!s) return res.status(404).json({ error: 'Not found' });
  if (req.body.secret !== s.secret) return res.status(403).json({ error: 'Forbidden' });
  s.keyEvents.push({ key: req.body.key, t: Date.now() });
  res.json({ ok: true });
});

app.get('/pair/:id/key', (req, res) => {
  const s = sessions.get(req.params.id);
  if (!s) return res.status(404).json({ error: 'Not found' });
  if (req.query.secret !== s.secret) return res.status(403).json({ error: 'Forbidden' });
  const events = [...s.keyEvents];
  s.keyEvents = [];
  res.json({ events });
});

// Status check
app.get('/pair/:id/status', (req, res) => {
  const s = sessions.get(req.params.id);
  if (!s) return res.status(404).json({ error: 'Not found' });
  if (Date.now() > s.expiresAt && s.status !== 'connected') s.status = 'expired';
  res.json({ status: s.status, expiresAt: s.expiresAt });
});

// Mobile connect page — phone opens this after scanning QR
app.get('/connect', (req, res) => {
  const { session, secret } = req.query;
  if (!session || !secret) return res.status(400).send('Invalid QR code');

  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1.0,user-scalable=no"/>
<title>Jarvis Remote Desktop</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:#06050f;color:#fff;font-family:system-ui,sans-serif;height:100vh;overflow:hidden}
#waiting{display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;padding:2rem;text-align:center}
#remote{display:none;width:100vw;height:100vh;background:#000;position:relative}
#stream{width:100%;height:100%;object-fit:contain;display:block}
.logo{font-size:1rem;font-weight:700;margin-bottom:2rem;color:#c4b5fd}
.logo b{color:#7c3aed}
.card{background:#0d0b18;border:1px solid rgba(139,92,246,0.25);border-radius:20px;padding:2rem;width:100%;max-width:340px}
.badge{display:inline-flex;align-items:center;gap:6px;background:rgba(139,92,246,0.1);border:1px solid rgba(139,92,246,0.2);padding:0.3rem 0.9rem;border-radius:100px;font-size:0.7rem;color:#c4b5fd;margin-bottom:1.25rem;font-family:monospace}
.dot{width:6px;height:6px;border-radius:50%;background:#a78bfa;animation:blink 1.4s step-end infinite;flex-shrink:0}
h2{font-size:1.1rem;font-weight:700;margin-bottom:0.5rem}
p.sub{color:rgba(255,255,255,0.38);font-size:0.85rem;line-height:1.6}
.toolbar{position:absolute;bottom:0;left:0;right:0;background:rgba(6,5,15,0.92);padding:0.75rem 1rem;display:flex;gap:0.5rem;justify-content:center;backdrop-filter:blur(10px)}
.tbtn{background:rgba(139,92,246,0.15);border:1px solid rgba(139,92,246,0.3);color:#c4b5fd;padding:0.5rem 1rem;border-radius:100px;font-size:0.78rem;cursor:pointer}
@keyframes blink{0%,100%{opacity:1}50%{opacity:0}}
@keyframes spin{to{transform:rotate(360deg)}}
.spin{width:22px;height:22px;border:2px solid rgba(139,92,246,0.2);border-top-color:#7c3aed;border-radius:50%;animation:spin 0.8s linear infinite;margin:0 auto 1rem}
</style>
</head>
<body>
<div id="waiting">
  <p class="logo"><b>Jarvis</b> Remote Desktop</p>
  <div class="card">
    <div class="spin" id="spin"></div>
    <div class="badge"><span class="dot"></span><span id="st">Connecting...</span></div>
    <h2 id="ttl">Please wait</h2>
    <p class="sub" id="desc">Looking for your PC. Make sure the Jarvis desktop agent is running.</p>
  </div>
</div>
<div id="remote">
  <video id="stream" autoplay playsinline></video>
  <div class="toolbar">
    <button class="tbtn" onclick="doKeyboard()">⌨ Keyboard</button>
    <button class="tbtn" onclick="doDisconnect()">✕ End</button>
  </div>
</div>
<script>
const SID='${session}',SEC='${secret}',API='';
let pc=null,pollO=null,pollI=null;

async function init(){
  try{
    const r=await fetch(API+'/pair/'+SID+'/status?secret='+SEC);
    const d=await r.json();
    if(d.status==='expired') return err('Session expired. Scan a new QR code.');
    waitOffer();
  }catch(e){err('Cannot reach server. Check internet.');}
}

function waitOffer(){
  set('Waiting for PC...','Desktop agent starting','Make sure the Jarvis agent is running on your PC.');
  pollO=setInterval(async()=>{
    try{
      const r=await fetch(API+'/pair/'+SID+'/offer?secret='+SEC);
      const d=await r.json();
      if(d.status==='pc_ready'&&d.offer){clearInterval(pollO);connect(d.offer);}
      else if(d.status==='expired'){clearInterval(pollO);err('Session expired. Scan again.');}
    }catch(e){}
  },2000);
}

async function connect(offer){
  set('Establishing stream...','Almost there','Setting up encrypted connection...');
  pc=new RTCPeerConnection({iceServers:[{urls:'stun:stun.l.google.com:19302'},{urls:'stun:stun1.l.google.com:19302'}]});
  pc.ontrack=e=>{
    document.getElementById('waiting').style.display='none';
    document.getElementById('remote').style.display='block';
    document.getElementById('stream').srcObject=e.streams[0];
  };
  pc.onicecandidate=async e=>{
    if(e.candidate) await fetch(API+'/pair/'+SID+'/ice',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({secret:SEC,candidate:e.candidate,from:'mobile'})});
  };
  await pc.setRemoteDescription(new RTCSessionDescription(offer));
  const ans=await pc.createAnswer();
  await pc.setLocalDescription(ans);
  await fetch(API+'/pair/'+SID+'/answer',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({secret:SEC,answer:ans})});
  pollI=setInterval(async()=>{
    try{
      const r=await fetch(API+'/pair/'+SID+'/ice?secret='+SEC+'&for=mobile');
      const d=await r.json();
      for(const c of d.candidates){try{await pc.addIceCandidate(new RTCIceCandidate(c));}catch(e){}}
    }catch(e){}
  },1000);
}

function set(badge,title,desc){
  document.getElementById('st').textContent=badge;
  document.getElementById('ttl').textContent=title;
  document.getElementById('desc').textContent=desc;
}
function err(msg){
  document.getElementById('spin').style.display='none';
  document.getElementById('ttl').textContent='⚠ Error';
  document.getElementById('desc').textContent=msg;
}
function doKeyboard(){
  const i=document.createElement('input');
  i.style.cssText='position:fixed;opacity:0;top:50%;left:50%';
  document.body.appendChild(i);i.focus();
  i.addEventListener('input',e=>{
    fetch(API+'/pair/'+SID+'/key',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({secret:SEC,key:e.data})});
  });
}
function doDisconnect(){clearInterval(pollI);if(pc)pc.close();window.location.reload();}

// Touch → mouse
const vid=document.getElementById('stream');
vid.addEventListener('touchstart',e=>mouse(e,'down'),{passive:false});
vid.addEventListener('touchmove',e=>{mouse(e,'move');e.preventDefault();},{passive:false});
vid.addEventListener('touchend',e=>mouse(e,'up'),{passive:false});
function mouse(e,type){
  const t=e.changedTouches[0],r=vid.getBoundingClientRect();
  fetch(API+'/pair/'+SID+'/mouse',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({secret:SEC,type,x:(t.clientX-r.left)/r.width,y:(t.clientY-r.top)/r.height})});
}
init();
</script>
</body>
</html>`);
});

app.listen(PORT, () => {
  console.log(`✓ Jarvis Remote Desktop API v2.0 running on port ${PORT}`);
});
