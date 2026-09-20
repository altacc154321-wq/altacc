import { PIECES, legalMoves, legalAttacks, squareName } from '/shared/rules.js';
import { ArenaScene } from './scene.js';

const $ = id => document.getElementById(id);
const roles = {pawn:'THE VANGUARD',knight:'THE DISRUPTOR',bishop:'THE SEER',rook:'THE FORTRESS',queen:'THE SOVEREIGN',king:'THE LAST WORD'};
const keys = Object.keys(PIECES);
let selected='knight',roomMode='create',socket=null,state=null,myId=null,token=null,code=null;
let connected=false,resuming=false,reconnectDelay=800,offset=0,mode='move',cursor=null,toastTimer,announcementTimer,victoryTimer,lastPhase=null,lastRoomUI='';
let audioOn=false,audioContext=null,scene=null,gamepadLast=0,padButtons=[];
const store = {get(key){try{return sessionStorage.getItem(key);}catch{return null;}},set(key,value){try{sessionStorage.setItem(key,value);}catch{}},remove(key){try{sessionStorage.removeItem(key);}catch{}}};

function toast(message) { $('toast').textContent=message;$('toast').classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').classList.remove('visible'),4000); }
function announce(message) { $('announcement').textContent=message;$('announcement').classList.add('visible');clearTimeout(announcementTimer);announcementTimer=setTimeout(()=>$('announcement').classList.remove('visible'),1800); }
function me() { return state?.players.find(p=>p.id===myId); }
function opponent() { return state?.players.find(p=>p.id!==myId); }
function inMatch() { return state && ['playing','finished'].includes(state.phase); }
function send(message) {if(socket?.readyState===WebSocket.OPEN){socket.send(JSON.stringify(message));return true;}toast('Reconnecting to the arena. Please wait.');return false;}
function sound(kind) {
  if(!audioOn)return;
  audioContext ||= new (window.AudioContext||window.webkitAudioContext)();
  if(audioContext.state==='suspended')audioContext.resume();
  const frequencies={move:[140,290],attack:[240,100],hit:[80,32],start:[220,440],victory:[440,660],select:[350,510]};
  const [a,b]=frequencies[kind]||frequencies.select;
  const osc=audioContext.createOscillator(),gain=audioContext.createGain(),now=audioContext.currentTime;
  osc.type=kind==='hit'?'sawtooth':'sine';osc.frequency.setValueAtTime(a,now);osc.frequency.exponentialRampToValueAtTime(b,now+.19);
  gain.gain.setValueAtTime(0,now);gain.gain.linearRampToValueAtTime(kind==='hit'?.075:.09,now+.01);gain.gain.exponentialRampToValueAtTime(.001,now+.35);
  osc.connect(gain).connect(audioContext.destination);osc.start(now);osc.stop(now+.36);
}

function selectPiece(piece, notify=true) {
  if(inMatch())return;
  selected=piece;const spec=PIECES[piece];
  for(const button of $('roster').children){const active=button.dataset.piece===piece;button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active));}
  $('champion-name').textContent=`The ${spec.name}`;$('champion-role').textContent=roles[piece];$('champion-description').textContent=spec.description;
  $('champion-number').textContent=`0${keys.indexOf(piece)+1} / 06`;
  $('stat-hp').textContent=`${spec.maxHp} HP`;$('stat-damage').textContent=`${spec.damage} DMG`;$('stat-cooldown').textContent=`${(spec.attackCooldown/1000).toFixed(2).replace(/0$/,'')} SEC`;
  const moves=legalMoves(piece,'white',{x:3,z:3},null,false);
  $('move-diagram').replaceChildren();
  for(let z=1;z<=5;z++)for(let x=1;x<=5;x++){
    const tile=document.createElement('span');tile.className='diagram-cell'+(x===3&&z===3?' origin':moves.some(p=>p.x===x&&p.z===z)?' legal':'');$('move-diagram').append(tile);
  }
  scene?.selectPreview(piece,me()?.color||'white');
  if(notify){sound('select');if(myId)send({type:'select',piece});}
}

for(const [i,piece] of keys.entries()) {
  const spec=PIECES[piece],button=document.createElement('button');
  button.className='piece-card';button.dataset.piece=piece;button.setAttribute('aria-label',`Choose ${spec.name}`);
  button.innerHTML=`<span class="piece-index">0${i+1}</span><span class="piece-symbol">${spec.glyph}</span><span><strong>${spec.name}</strong><small>${roles[piece]}</small></span>`;
  button.addEventListener('click',()=>selectPiece(piece));$('roster').append(button);
  const card=document.createElement('div');card.className='manual-piece';card.innerHTML=`<strong><span>${spec.glyph}</span>${spec.name}</strong><p>${spec.movement} ${spec.attack}</p>`;$('manual-pieces').append(card);
}

const mapButtons=[];
for(let z=0;z<8;z++)for(let x=0;x<8;x++){
  const button=document.createElement('button');button.className='map-square';button.dataset.x=x;button.dataset.z=z;
  button.setAttribute('aria-label',squareName({x,z}));button.addEventListener('click',()=>commit({x,z}));button.addEventListener('mouseenter',()=>setCursor({x,z}));button.addEventListener('focus',()=>setCursor({x,z}));
  $('tactical-board').append(button);mapButtons.push(button);
}

try { scene=new ArenaScene($('arena'),commit,setCursor); }
catch(error) { console.error('3D renderer could not start',error);toast('WebGL is unavailable. Enable browser hardware acceleration, then reload.');$('enter-arena').disabled=true; }
selectPiece(selected,false);

function setRoomMode(next) {
  roomMode=next;$('join-field').hidden=next!=='join';$('create-tab').classList.toggle('active',next==='create');$('join-tab').classList.toggle('active',next==='join');
  $('enter-arena').innerHTML=(next==='create'?'CREATE DUEL':'JOIN DUEL')+' <span>↗</span>';
}
$('create-tab').onclick=()=>setRoomMode('create');$('join-tab').onclick=()=>setRoomMode('join');
function enterRoom() {
  const name=$('player-name').value.trim()||'Challenger';
  const invite=$('room-input').value.trim().toUpperCase();
  if(roomMode==='join'&&!/^[A-Z0-9]{6}$/.test(invite)){toast('Enter the six-character room code from your rival.');$('room-input').focus();return;}
  if(send({type:roomMode,name,piece:selected,...(roomMode==='join'?{code:invite}:{})})) {$('enter-arena').disabled=true;setTimeout(()=>$('enter-arena').disabled=false,1500);store.set('regicide-name',name);}
}
$('enter-arena').onclick=enterRoom;
for(const id of ['player-name','room-input'])$(id).addEventListener('keydown',e=>{if(e.key==='Enter')enterRoom();});
$('ready').onclick=()=>send({type:'ready'});
$('copy-code').onclick=async()=>{
  const url=new URL(location.href);url.search='';url.searchParams.set('room',code);
  try{await navigator.clipboard.writeText(url.href);toast('Invite link copied. Send it to your rival.');}catch{toast(`Room code: ${code}. Share this address and code with your rival.`);}
};

function clearRoom() {
  state=null;myId=null;token=null;code=null;resuming=false;lastPhase=null;lastRoomUI='';store.remove('regicide-session');clearTimeout(victoryTimer);
  $('victory').hidden=true;document.body.classList.remove('playing');$('game').hidden=true;$('lobby').hidden=false;$('room-form').hidden=false;$('room-waiting').hidden=true;
  scene?.setState(null,null,offset);scene?.selectPreview(selected);setConnectionLabel();
}
function leaveRoom() {send({type:'leave'});clearRoom();history.replaceState(null,'',location.pathname);}
$('leave-room').onclick=leaveRoom;$('exit-match').onclick=leaveRoom;$('victory-leave').onclick=leaveRoom;
$('rematch').onclick=()=>{if(send({type:'rematch'})){$('rematch').disabled=true;$('rematch').textContent='WAITING FOR YOUR RIVAL…';}};

function setConnectionLabel() {
  $('connection-label').textContent=connected?(code?`CONNECTED · ROOM ${code}`:'ARENA ONLINE'):'RECONNECTING TO ARENA';
  $('connection-dot').style.background=connected?'var(--teal)':'var(--gold)';
}

function connect() {
  socket=new WebSocket(`${location.protocol==='https:'?'wss:':'ws:'}//${location.host}`);
  socket.addEventListener('open',()=>{
    connected=true;reconnectDelay=800;setConnectionLabel();
    const saved=store.get('regicide-session');
    if(saved){try{const session=JSON.parse(saved);token=session.token;code=session.code;resuming=true;send({type:'resume',code,token});}catch{store.remove('regicide-session');}}
    socket.send(JSON.stringify({type:'ping',sentAt:Date.now()}));
  });
  socket.addEventListener('message',({data})=>{
    let message;try{message=JSON.parse(data);}catch{return;}
    if(message.type==='welcome') {
      myId=message.playerId;token=message.token;code=message.code;resuming=false;store.set('regicide-session',JSON.stringify({token,code}));setConnectionLabel();$('enter-arena').disabled=false;
    }
    if(message.type==='state') {
      const previous=state;state=message.state;
      if(!offset)offset=state.serverTime-Date.now();
      scene?.setState(state,myId,offset);renderState(previous);
    }
    if(message.type==='event') {
      const e=message.event;scene?.event(e);
      if(['move','attack','hit','start','victory'].includes(e.type))sound(e.type);
      if(e.type==='start'){clearTimeout(victoryTimer);$('victory').hidden=true;setMode('move');setTimeout(()=>announce('CLAIM THE BOARD'),150);}
      if(e.type==='hit'&&e.hit){if(e.targetId===myId)toast(`−${e.damage} HP · ${PIECES[e.piece].name} strike`);else toast(`${e.damage} damage · Clean hit`);}
      if(e.type==='hit'&&!e.hit&&e.playerId===myId)toast('Strike evaded. Anticipate their next move.');
      if(e.type==='disconnect')toast('Your rival disconnected. Their seat is held for 30 seconds.');
      if(e.type==='victory'){
        $('victory-description').textContent=e.reason==='dead-position'?'Neither piece can reach the other. A tactical stalemate.':e.reason==='double-capture'?'Both pieces fell in the same instant.':e.reason==='disconnect'?'Your rival left the arena. Victory by forfeit.':'A crown earned. A rival captured.';
        clearTimeout(victoryTimer);victoryTimer=setTimeout(showVictory,1600);
      }
    }
    if(message.type==='error') {toast(message.message);$('enter-arena').disabled=false;if(resuming)clearRoom();}
    if(message.type==='pong') {
      const latency=Date.now()-message.sentAt;offset=message.serverTime-(message.sentAt+latency/2);
      if(connected)$('connection-label').textContent=`${code?`ROOM ${code}`:'ARENA ONLINE'} · ${Math.round(latency)} MS`;
    }
  });
  socket.addEventListener('close',()=>{connected=false;setConnectionLabel();setTimeout(connect,reconnectDelay);reconnectDelay=Math.min(reconnectDelay*1.5,5000);});
  socket.addEventListener('error',()=>{});
}

function showVictory() {
  if(state?.phase!=='finished')return;
  $('winner-text').textContent=state.winner==='draw'?'STALEMATE':`${(state.winner||'white').toUpperCase()} WINS`;
  $('victory').hidden=false;
  const requested=me()?.rematch;$('rematch').disabled=!!requested;$('rematch').innerHTML=requested?'WAITING FOR YOUR RIVAL…':'INSTANT REMATCH <span>↻</span>';
}

function renderState(previous) {
  if(!state||!myId)return;
  const player=me(),enemy=opponent();if(!player){clearRoom();return;}
  const match=inMatch();document.body.classList.toggle('playing',match);$('lobby').hidden=match;$('game').hidden=!match;
  if(!match) {
    $('room-form').hidden=true;$('room-waiting').hidden=false;$('room-code').textContent=state.code;
    const key=JSON.stringify(state.players.map(p=>[p.id,p.name,p.piece,p.ready,p.connected]));
    if(key!==lastRoomUI) {
      lastRoomUI=key;$('room-players').replaceChildren();
      for(const p of state.players){
        const row=document.createElement('div');row.className=`room-player ${p.color}`;
        const orb=document.createElement('i');orb.className='player-orb';
        const label=document.createElement('span');label.textContent=`${p.name}${p.id===myId?' (you)':''}`;
        const info=document.createElement('span');info.textContent=`${PIECES[p.piece].name} · ${!p.connected?'Reconnecting':p.ready?'Ready':'Choosing'}`;
        row.append(orb,label,info);$('room-players').append(row);
      }
      if(state.players.length===1){const row=document.createElement('div');row.className='room-player empty';row.textContent='◌  Waiting for a worthy opponent…';$('room-players').append(row);}
    }
    $('ready').innerHTML=player.ready?'READY · CLICK TO CANCEL <span>✓</span>':'READY TO FIGHT <span>→</span>';
    $('waiting-note').textContent=enemy?(player.ready?'Waiting for your rival to ready up.':'Choose your class, then ready up to begin.'):'Share your invite with a second player.';
    if(player.piece!==selected)selectPiece(player.piece,false);else scene?.selectPreview(selected,player.color);
  } else {
    for(const [prefix,p] of [['own',player],['enemy',enemy]])if(p){
      $(''+prefix+'-name').textContent=p.name;$(''+prefix+'-piece').textContent=PIECES[p.piece].name;$(''+prefix+'-glyph').textContent=PIECES[p.piece].glyph;
      $(''+prefix+'-color').textContent=`${p.color.toUpperCase()} / ${prefix==='own'?'YOU':'RIVAL'}${p.connected?'':' · DISCONNECTED'}`;
      $(''+prefix+'-health').style.width=`${p.hp/p.maxHp*100}%`;$(''+prefix+'-hp').textContent=`${p.hp} / ${p.maxHp} HP`;
    }
    $('match-code').textContent=`ROOM ${state.code}`;$('battle-class').textContent=`THE ${player.piece.toUpperCase()} / ${roles[player.piece]}`;
    $('battle-rules').textContent=mode==='move'?PIECES[player.piece].movement:PIECES[player.piece].attack;
    $('position-name').textContent=squareName(player).toUpperCase();renderMap();
    if(state.phase==='playing'&&lastPhase!=='playing'){$('victory').hidden=true;$('rematch').disabled=false;cursor={x:player.x,z:player.z};}
    if(state.phase==='finished'&&previous?.phase==='finished'&&!$('victory').hidden)showVictory();
    if(state.phase==='finished'&&previous===null){$('victory-description').textContent='The duel is complete. Your next battle awaits.';showVictory();}
  }
  lastPhase=state.phase;
}

function legalTargets(type=mode) {const p=me(),e=opponent();return !p?[]:type==='move'?legalMoves(p.piece,p.color,p,e,p.hasMoved):legalAttacks(p.piece,p.color,p,e);}
function setMode(next) {
  mode=next;scene?.setMode(mode);$('move-action').classList.toggle('active',mode==='move');$('attack-action').classList.toggle('active',mode==='attack');$('attack-action').classList.toggle('attack-mode',mode==='attack');
  $('target-hint').textContent=mode==='move'?'CHOOSE A TEAL SQUARE TO MOVE':'CHOOSE A RED SQUARE TO STRIKE';
  if(me())$('battle-rules').textContent=mode==='move'?PIECES[me().piece].movement:PIECES[me().piece].attack;
  renderMap();
}
$('move-action').onclick=()=>setMode('move');$('attack-action').onclick=()=>setMode('attack');
function setCursor(square) {cursor=square;scene?.setCursor(square);if(inMatch())renderMap();}
function renderMap() {
  const p=me(),e=opponent();if(!p)return;
  const valid=new Set(legalTargets().map(s=>`${s.x},${s.z}`));
  for(const b of mapButtons){
    const x=Number(b.dataset.x),z=Number(b.dataset.z),own=p.x===x&&p.z===z,rival=e?.x===x&&e?.z===z;
    b.className='map-square'+((x+z)%2?' dark':'')+(valid.has(`${x},${z}`)?` ${mode}`:'')+(rival?' rival':'')+(cursor?.x===x&&cursor?.z===z?' cursor':'');
    b.textContent=own?PIECES[p.piece].glyph:rival?PIECES[e.piece].glyph:'';
    b.setAttribute('aria-label',`${squareName({x,z})}${own?' Your piece':rival?' Rival':''}${valid.has(`${x},${z}`)?' Legal '+mode:''}`);
  }
}
function commit(square) {
  if(state?.phase!=='playing'||!square)return;
  setCursor(square);
  if(!legalTargets().some(s=>s.x===square.x&&s.z===square.z)){toast(mode==='move'?'Choose a teal square. Your piece must follow its chess movement.':'That square is outside your capture pattern. Choose a red square.');return;}
  const p=me(),now=Date.now()+offset,readyAt=mode==='move'?p.moveReadyAt:p.attackReadyAt;
  if(now<readyAt){toast(`${mode==='move'?'Movement':'Strike'} ready in ${((readyAt-now)/1000).toFixed(1)}s`);return;}
  send({type:mode,...square});
}
function strikeRival() {if(state?.phase!=='playing')return;setMode('attack');const e=opponent();if(e)commit({x:e.x,z:e.z});}

function openManual() {if(!$('manual').open)$('manual').showModal();}
$('manual-open').onclick=openManual;$('game-manual').onclick=openManual;$('manual-close').onclick=()=>$('manual').close();$('manual-done').onclick=()=>$('manual').close();
$('manual').addEventListener('click',e=>{if(e.target===$('manual')){const r=$('manual').getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)$('manual').close();}});
$('sound').onclick=()=>{audioOn=!audioOn;$('sound').querySelector('span').hidden=audioOn;$('sound').setAttribute('aria-label',audioOn?'Mute sound':'Enable sound');sound('select');};
$('fullscreen').onclick=async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();}catch{toast('Fullscreen is not available in this browser view.');}};

function moveCursor(dx,dz) {const p=me();if(!p)return;const old=cursor||p;setCursor({x:Math.max(0,Math.min(7,old.x+dx)),z:Math.max(0,Math.min(7,old.z+dz))});}
addEventListener('keydown',e=>{
  if(['INPUT','TEXTAREA'].includes(document.activeElement?.tagName)||$('manual').open||!$('victory').hidden)return;
  if(e.key==='Enter'&&document.activeElement?.tagName==='BUTTON')return;
  if(state?.phase==='playing') {
    if([' ','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Enter'].includes(e.key))e.preventDefault();
    if(e.repeat&&[' ','Enter'].includes(e.key))return;
    switch(e.key.toLowerCase()) {case'q':setMode('move');break;case'e':setMode('attack');break;case' ':strikeRival();break;case'r':scene?.resetView();break;case'arrowup':case'w':moveCursor(0,-1);break;case'arrowdown':case's':moveCursor(0,1);break;case'arrowleft':case'a':moveCursor(-1,0);break;case'arrowright':case'd':moveCursor(1,0);break;case'enter':commit(cursor);break;case'h':openManual();break;}
  } else if(!myId||!inMatch()){const index=Number(e.key)-1;if(index>=0&&index<6)selectPiece(keys[index]);}
});

function updateFrame(t) {
  if(state?.phase==='playing'){
    const player=me(),now=Date.now()+offset;
    if(player){for(const type of ['move','attack']){
      const spec=PIECES[player.piece],remaining=Math.max(0,player[`${type}ReadyAt`]-now),total=spec[`${type}Cooldown`];
      $(`${type}-time`).textContent=remaining?`${(remaining/1000).toFixed(1)} SEC`:'READY';$(`${type}-progress`).style.width=`${100*(1-remaining/total)}%`;
    }}
    const elapsed=Math.max(0,Math.floor((now-state.startedAt)/1000));$('match-time').textContent=`${String(Math.floor(elapsed/60)).padStart(2,'0')}:${String(elapsed%60).padStart(2,'0')}`;
    const pad=navigator.getGamepads?.()[0];
    if(pad&&!$('manual').open){
      if(scene){if(Math.abs(pad.axes[2]||0)>.15)scene.yaw-=(pad.axes[2]||0)*.035;if(Math.abs(pad.axes[3]||0)>.15)scene.pitch=Math.max(.22,Math.min(1.18,scene.pitch+(pad.axes[3]||0)*.025));}
      if(t-gamepadLast>160){const x=Math.abs(pad.axes[0])>.5?Math.sign(pad.axes[0]):0,z=Math.abs(pad.axes[1])>.5?Math.sign(pad.axes[1]):0;if(x||z){moveCursor(x,z);gamepadLast=t;}}
      for(const i of [0,2,3])if(pad.buttons[i]?.pressed&&!padButtons[i]){if(i===0)commit(cursor);if(i===2)setMode('attack');if(i===3)setMode('move');}
      padButtons=pad.buttons.map(b=>b.pressed);
    }
  }
  requestAnimationFrame(updateFrame);
}
const savedName=store.get('regicide-name');if(savedName)$('player-name').value=savedName;
const invite=new URLSearchParams(location.search).get('room');if(invite){setRoomMode('join');$('room-input').value=invite.toUpperCase();const saved=store.get('regicide-session');if(saved){try{if(JSON.parse(saved).code!==invite.toUpperCase())store.remove('regicide-session');}catch{store.remove('regicide-session');}}}
connect();setInterval(()=>{if(connected)socket.send(JSON.stringify({type:'ping',sentAt:Date.now()}));},3000);
requestAnimationFrame(updateFrame);
