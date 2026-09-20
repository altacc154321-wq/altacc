import * as THREE from 'three';
import { createPiece, createArena } from './models.js';
import { legalMoves, legalAttacks } from '/shared/rules.js';

const world = p => new THREE.Vector3((p.x - 3.5) * 3, 0, (p.z - 3.5) * 3);
const clamp = THREE.MathUtils.clamp;
const ease = t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

export class ArenaScene {
  constructor(canvas, onSquare, onHover) {
    this.canvas = canvas;
    this.onSquare = onSquare;
    this.onHover = onHover;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0b1716);
    this.scene.fog = new THREE.FogExp2(0x0b1716, .012);
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.7));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.2;
    this.camera = new THREE.PerspectiveCamera(43, innerWidth / innerHeight, .1, 180);
    this.camera.position.set(25, 24, 31);
    this.look = new THREE.Vector3(-7, 1, 0);
    this.scene.add(new THREE.HemisphereLight(0xdce6d4, 0x13251f, 2.0));
    const key = new THREE.DirectionalLight(0xffedcf, 3.8);
    key.position.set(-8, 22, 13);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.left = key.shadow.camera.bottom = -20;
    key.shadow.camera.right = key.shadow.camera.top = 20;
    key.shadow.camera.far = 65;
    key.shadow.normalBias = .04;
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x83b4ab, 3.2);
    rim.position.set(12, 10, -15);
    this.scene.add(rim);
    const warm = new THREE.PointLight(0xefc481, 90, 60, 1.7);
    warm.position.set(4, 12, -2);
    this.scene.add(warm);
    // A procedural studio environment gives the polished models readable reflections.
    const studio = new THREE.Scene();
    studio.background = new THREE.Color(0x54645d);
    for (const [x, y, z, sx, sy, sz, color] of [[-8,8,3,1,10,9,0xffedce],[8,7,-5,1,8,8,0x8abbb7],[0,15,0,12,1,12,0xd4d5c7]]) {
      const panel = new THREE.Mesh(new THREE.BoxGeometry(sx,sy,sz), new THREE.MeshBasicMaterial({color}));
      panel.position.set(x,y,z); studio.add(panel);
    }
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.environment = pmrem.fromScene(studio, .02);
    this.scene.environment = this.environment.texture;
    pmrem.dispose();
    studio.traverse(o => { o.geometry?.dispose(); o.material?.dispose(); });
    this.arena = createArena();
    this.scene.add(this.arena);
    this.addCoordinates();
    this.preview = new THREE.Group();
    this.scene.add(this.preview);
    this.models = new Map();
    this.effects = [];
    this.highlightGroup = new THREE.Group();
    this.scene.add(this.highlightGroup);
    this.tiles = [];
    const plane = new THREE.PlaneGeometry(2.78, 2.78);
    for (let z = 0; z < 8; z++) for (let x = 0; x < 8; x++) {
      const tile = new THREE.Mesh(plane, new THREE.MeshBasicMaterial({ color: 0x64d6af, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
      tile.rotation.x = -Math.PI / 2;
      tile.position.copy(world({ x, z })); tile.position.y = .045;
      this.highlightGroup.add(tile); this.tiles.push(tile);
    }
    const cursorGeo = new THREE.EdgesGeometry(new THREE.BoxGeometry(2.85, .035, 2.85));
    this.cursor = new THREE.LineSegments(cursorGeo, new THREE.LineBasicMaterial({ color: 0xf6d38e }));
    this.cursor.position.y = .08; this.cursor.visible = false; this.scene.add(this.cursor);
    this.raycaster = new THREE.Raycaster();
    this.ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this.pointer = new THREE.Vector2();
    this.yaw = 0; this.pitch = .62; this.distance = 18;
    this.shake = 0; this.lastTime = performance.now();
    this.mode = 'move'; this.state = null; this.localId = null;
    this.clockOffset = 0; this.inGame = false;
    this.createMotes();
    this.installInput();
    this.selectPreview('knight');
    this.resize();
    addEventListener('resize', () => this.resize());
    this.renderer.setAnimationLoop(t => this.render(t));
  }

  addCoordinates() {
    const make = (text, x, z, rotation = 0) => {
      const c = document.createElement('canvas'); c.width = 128; c.height = 128;
      const ctx = c.getContext('2d'); ctx.font = '50px Georgia'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#bfa66d'; ctx.fillText(text, 64, 64);
      const texture = new THREE.CanvasTexture(c); texture.colorSpace = THREE.SRGBColorSpace;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(.85,.85), new THREE.MeshBasicMaterial({map:texture,transparent:true,depthWrite:false}));
      m.rotation.x = -Math.PI/2; m.rotation.z = rotation; m.position.set(x,.055,z); this.scene.add(m);
    };
    for (let i=0;i<8;i++) { make('ABCDEFGH'[i],(i-3.5)*3,12.8); make(String(8-i),-12.8,(i-3.5)*3); }
  }

  createMotes() {
    const positions = new Float32Array(180 * 3);
    for(let i=0;i<positions.length;i+=3) { positions[i]=(Math.random()-.5)*65; positions[i+1]=Math.random()*27; positions[i+2]=(Math.random()-.5)*65; }
    const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position',new THREE.BufferAttribute(positions,3));
    this.motes = new THREE.Points(geometry,new THREE.PointsMaterial({color:0xc8b379,size:.035,transparent:true,opacity:.6,depthWrite:false}));
    this.scene.add(this.motes);
  }

  selectPreview(piece, color='white') {
    // Cache models: selection never rebuilds a GPU mesh or discards shared finishes.
    if (!this.previewCache) this.previewCache = new Map();
    const key = `${piece}-${color}`;
    let model = this.previewCache.get(key);
    if (!model) { model = createPiece(piece,color,2.65); this.previewCache.set(key,model); this.preview.add(model); }
    this.preview.children.forEach(m => { m.visible = m===model; });
    this.preview.position.set(1.5, .02, 1.5);
    this.previewPiece = piece;
    this.previewColor = color;
    if(!this.inGame) this.updateHighlights();
  }

  setState(state, localId, offset) {
    this.state = state; this.localId = localId; this.clockOffset = offset;
    const wasGame = this.inGame;
    this.inGame = state && ['playing','finished'].includes(state.phase);
    this.preview.visible = !this.inGame;
    if(this.inGame && !wasGame) {
      this.yaw = state.players.find(p => p.id===localId)?.color==='black' ? Math.PI : 0;
      this.pitch = .62; this.distance = 18;
    }
    const ids = new Set();
    for (const p of state?.players || []) {
      ids.add(p.id);
      let model = this.models.get(p.id);
      if (!model || model.userData.type!==p.piece || model.userData.color!==p.color) {
        if(model) this.scene.remove(model);
        model = createPiece(p.piece,p.color,1.3);
        model.position.copy(world(p)); model.rotation.y = p.color==='black' ? Math.PI : 0;
        this.models.set(p.id,model); this.scene.add(model);
      }
      model.visible = !!this.inGame;
      if(p.hp>0) { model.userData.deadAt = null; model.rotation.z=0; }
    }
    for(const [id,model] of this.models) if(!ids.has(id)) {this.scene.remove(model);this.models.delete(id);}
    this.updateHighlights();
  }

  setMode(mode) { this.mode=mode; this.updateHighlights(); }

  updateHighlights() {
    this.tiles.forEach(t => t.material.opacity=0);
    if(!this.inGame) {
      const moves=legalMoves(this.previewPiece||'knight',this.previewColor||'white',{x:4,z:4});
      for(const p of moves) {const t=this.tiles[p.z*8+p.x];t.material.color.setHex(0x74c6a5);t.material.opacity=.16;}
      return;
    }
    if(this.state?.phase!=='playing') return;
    const me=this.state.players.find(p=>p.id===this.localId),enemy=this.state.players.find(p=>p.id!==this.localId);
    if(!me) return;
    const squares=this.mode==='move'?legalMoves(me.piece,me.color,me,enemy,me.hasMoved):legalAttacks(me.piece,me.color,me,enemy);
    for(const p of squares) {const t=this.tiles[p.z*8+p.x];t.material.color.setHex(this.mode==='move'?0x68d4ad:0xf26f60);t.material.opacity=this.mode==='move'?.27:.27;}
    if(enemy && legalAttacks(me.piece,me.color,me,enemy).some(p=>p.x===enemy.x&&p.z===enemy.z)) {
      const t=this.tiles[enemy.z*8+enemy.x];t.material.color.setHex(0xf16658);t.material.opacity=.42;
    }
    const t=this.tiles[me.z*8+me.x];t.material.color.setHex(0xdcc086);t.material.opacity=.25;
  }

  setCursor(square) {
    this.cursor.visible = this.inGame && !!square;
    if(square) {this.cursor.position.copy(world(square));this.cursor.position.y=.09;}
  }

  installInput() {
    let down=null,dragging=false;
    this.canvas.addEventListener('contextmenu',e=>e.preventDefault());
    this.canvas.addEventListener('pointerdown',e=>{down={x:e.clientX,y:e.clientY,lastX:e.clientX,lastY:e.clientY};dragging=false;this.canvas.setPointerCapture(e.pointerId);});
    this.canvas.addEventListener('pointermove',e=>{
      if(down){
        if(Math.hypot(e.clientX-down.x,e.clientY-down.y)>5) dragging=true;
        if(dragging){this.yaw-=(e.clientX-down.lastX)*.006;this.pitch=clamp(this.pitch+(e.clientY-down.lastY)*.004,.22,1.18);}
        down.lastX=e.clientX;down.lastY=e.clientY;
      }
      if(!dragging && this.inGame) this.onHover(this.pick(e));
    });
    this.canvas.addEventListener('pointerup',e=>{if(down&&!dragging&&this.inGame&&e.button!==2)this.onSquare(this.pick(e));down=null;dragging=false;});
    this.canvas.addEventListener('pointercancel',()=>{down=null;dragging=false;});
    this.canvas.addEventListener('wheel',e=>{e.preventDefault();this.distance=clamp(this.distance+e.deltaY*.016,9,35);},{passive:false});
  }

  pick(e) {
    const r=this.canvas.getBoundingClientRect();
    this.pointer.set((e.clientX-r.left)/r.width*2-1,-(e.clientY-r.top)/r.height*2+1);
    this.raycaster.setFromCamera(this.pointer,this.camera);
    const p=this.raycaster.ray.intersectPlane(this.ground,new THREE.Vector3());
    if(!p)return null;
    const x=Math.floor((p.x+12)/3),z=Math.floor((p.z+12)/3);
    return x>=0&&x<8&&z>=0&&z<8?{x,z}:null;
  }

  resetView() {this.yaw=this.state?.players.find(p=>p.id===this.localId)?.color==='black'?Math.PI:0;this.pitch=.62;this.distance=18;}
  resize() {this.renderer.setSize(innerWidth,innerHeight,false);this.camera.aspect=innerWidth/innerHeight;this.camera.updateProjectionMatrix();}

  event(e) {
    const now=Date.now();
    if(e.type==='attack') {
      const start=world(e.from);start.y=.18;
      const end=world(e.target);end.y=.18;
      const geometry=new THREE.BufferGeometry().setFromPoints([start,end]);
      const line=new THREE.Line(geometry,new THREE.LineBasicMaterial({color:e.playerId===this.localId?0xf5c479:0xf66c60,transparent:true,opacity:.7}));
      this.scene.add(line);
      this.effects.push({object:line,born:now,life:Math.max(100,e.hitAt-(now+this.clockOffset)),kind:'line'});
      this.ring(e.target,0xe88268,Math.max(150,e.hitAt-(now+this.clockOffset)),1.1);
    }
    if(e.type==='hit') {
      const color=e.hit?0xf8cf83:0x7bb8b0;
      this.burst(e.target,color,e.hit?30:9);
      this.ring(e.target,color,600,e.hit?2.2:1.2);
      if(e.hit){this.shake=e.piece==='rook'||e.piece==='king'?.25:.13;const m=this.models.get(e.targetId);if(m)m.userData.hitAt=now;}
      if(e.from && e.target && ['rook','bishop','queen'].includes(e.piece))this.beam(e.from,e.target,color);
    }
    if(e.type==='move')this.ring(e.from,0x79d2b0,450,1.0);
    if(e.type==='victory' && e.loserId) {
      const model=this.models.get(e.loserId);
      if(model) {model.userData.deadAt=now;const p=this.state?.players.find(p=>p.id===e.loserId);if(p)this.burst(p,0xddcaa0,65,2.4);}
      this.shake=.34;
    }
  }

  ring(square,color,life,size) {
    const ring=new THREE.Mesh(new THREE.RingGeometry(.85,1,40),new THREE.MeshBasicMaterial({color,transparent:true,opacity:.9,side:THREE.DoubleSide,depthWrite:false}));
    ring.rotation.x=-Math.PI/2;ring.position.copy(world(square));ring.position.y=.09;
    this.scene.add(ring);this.effects.push({object:ring,born:Date.now(),life,kind:'ring',size});
  }

  beam(from,to,color) {
    const a=world(from),b=world(to);a.y=b.y=1.1;
    const delta=b.clone().sub(a);
    const beam=new THREE.Mesh(new THREE.CylinderGeometry(.11,.27,delta.length(),8),new THREE.MeshBasicMaterial({color,transparent:true,opacity:.9,depthWrite:false}));
    beam.position.copy(a.clone().add(b).multiplyScalar(.5));beam.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),delta.normalize());
    this.scene.add(beam);this.effects.push({object:beam,born:Date.now(),life:300,kind:'beam'});
  }

  burst(square,color,count,force=1) {
    for(let i=0;i<count;i++) {
      const mesh=new THREE.Mesh(new THREE.TetrahedronGeometry(.06+Math.random()*.10),new THREE.MeshBasicMaterial({color,transparent:true,opacity:1}));
      mesh.position.copy(world(square));mesh.position.y=.8;
      const velocity=new THREE.Vector3((Math.random()-.5)*8,(Math.random()*7+3),(Math.random()-.5)*8).multiplyScalar(force);
      this.scene.add(mesh);this.effects.push({object:mesh,born:Date.now(),life:600+Math.random()*800,kind:'particle',velocity});
    }
  }

  render(time) {
    const dt=Math.min((time-this.lastTime)/1000,.05);this.lastTime=time;
    const now=Date.now(),serverNow=now+this.clockOffset;
    this.motes.rotation.y=time*.000008;
    if(!this.inGame) {
      this.preview.rotation.y=Math.sin(time*.0002)*.23-.35;
      const mobile=innerWidth<760;
      const desired=mobile?new THREE.Vector3(26,27,34):new THREE.Vector3(25,24,31);
      this.camera.position.lerp(desired,.025);
      this.look.lerp(new THREE.Vector3(mobile?-6:-7,mobile?1:-3,0),.025);
    } else {
      for(const p of this.state?.players||[]) {
        const model=this.models.get(p.id);if(!model)continue;
        const position=world(p);
        let moving=false;
        if(p.move && serverNow<p.move.endAt) {
          const t=clamp((serverNow-p.move.startAt)/(p.move.endAt-p.move.startAt),0,1);
          position.copy(world(p.move.from)).lerp(world(p.move.to),ease(t));
          position.y=p.piece==='knight'?Math.sin(t*Math.PI)*4.5:Math.sin(t*Math.PI)*.22;
          const d=world(p.move.to).sub(world(p.move.from));model.rotation.y=Math.atan2(-d.x,-d.z);
          moving=true;
          if(Math.random()<.5){const dot=new THREE.Mesh(new THREE.SphereGeometry(.1,4,4),new THREE.MeshBasicMaterial({color:p.color==='white'?0xe9d39a:0x79c4b5,transparent:true,opacity:.7}));dot.position.copy(position);dot.position.y+=.3;this.scene.add(dot);this.effects.push({object:dot,born:now,life:400,kind:'trail'});}
        }
        if(p.attack && serverNow<p.attack.endAt) {
          const a=p.attack,t=clamp((serverNow-a.startAt)/(a.endAt-a.startAt),0,1);
          const target=world(a.target),d=target.clone().sub(position);
          model.rotation.y=Math.atan2(-d.x,-d.z);
          if(p.piece==='knight') {
            const outbound=serverNow<=a.hitAt;
            const progress=clamp(outbound?(serverNow-a.startAt)/(a.hitAt-a.startAt):(serverNow-a.hitAt)/(a.endAt-a.hitAt),0,1);
            position.lerp(target,outbound?ease(progress):1-ease(progress));
            position.y=Math.sin(progress*Math.PI)*(outbound?5:1.5);
          }
          else {position.add(d.normalize().multiplyScalar(Math.sin(t*Math.PI)*.8));model.rotation.z=Math.sin(t*Math.PI*2)*.10;}
        } else if(!model.userData.deadAt)model.rotation.z=0;
        if(p.id===this.localId&&!moving&&!p.attack)model.rotation.y=this.yaw;
        if(model.userData.hitAt && now-model.userData.hitAt<260) {
          const elapsed=(now-model.userData.hitAt)/260;
          position.x+=Math.sin(elapsed*24)*(1-elapsed)*.23;
          model.scale.setScalar(1.3+Math.sin(elapsed*Math.PI)*.06);
        } else model.scale.setScalar(1.3);
        if(model.userData.deadAt) {
          const t=clamp((now-model.userData.deadAt)/1100,0,1);
          model.rotation.z=t*Math.PI/2;position.y=-t*.45;model.visible=t<1;
        }
        model.position.copy(position);
      }
      const me=this.models.get(this.localId);
      if(me) {
        const p=this.state.players.find(p=>p.id===this.localId);
        const pullback=p?.move?Math.min(5,Math.hypot(p.move.to.x-p.move.from.x,p.move.to.z-p.move.from.z)*.7):0;
        const dist=this.distance+pullback;
        const target=me.position.clone().add(new THREE.Vector3(-Math.sin(this.yaw)*2.5,1,-Math.cos(this.yaw)*2.5));
        const desired=me.position.clone().add(new THREE.Vector3(Math.sin(this.yaw)*Math.cos(this.pitch)*dist,Math.sin(this.pitch)*dist,Math.cos(this.yaw)*Math.cos(this.pitch)*dist));
        this.camera.position.lerp(desired,1-Math.exp(-dt*5));this.look.lerp(target,1-Math.exp(-dt*7));
      }
    }
    if(this.shake>.002) {this.camera.position.x+=(Math.random()-.5)*this.shake;this.camera.position.y+=(Math.random()-.5)*this.shake;this.shake*=.88;}
    this.camera.lookAt(this.look);
    for(let i=this.effects.length-1;i>=0;i--) {
      const e=this.effects[i],age=now-e.born,t=clamp(age/e.life,0,1);
      if(t>=1){this.scene.remove(e.object);e.object.geometry.dispose();e.object.material.dispose();this.effects.splice(i,1);continue;}
      e.object.material.opacity=(1-t)*.85;
      if(e.kind==='ring')e.object.scale.setScalar(.6+t*e.size*2);
      if(e.kind==='particle'){e.velocity.y-=dt*13;e.object.position.addScaledVector(e.velocity,dt);e.object.rotation.x+=dt*4;e.object.rotation.z+=dt*5;}
      if(e.kind==='trail')e.object.scale.setScalar(1-t);
    }
    this.renderer.render(this.scene,this.camera);
  }
}
