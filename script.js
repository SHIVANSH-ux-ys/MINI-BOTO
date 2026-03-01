
// ═══════════════════════════════════════════════
//  UNDERRUN — SEASON 1  (3 Levels)
//  Lv1: Surface+Sewer  Lv2: Bike+AcidRain  Lv3: Arena+Boss
// ═══════════════════════════════════════════════
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const mapCanvas = document.getElementById('mapCanvas');
const mapCtx = mapCanvas.getContext('2d');

function resize() { canvas.width = window.innerWidth; canvas.height = window.innerHeight; }
resize(); window.addEventListener('resize', resize);

// ── CONSTANTS ──
const GRAVITY = 0.55;
const WORLD_LEN = 14000;
const DAY_DUR = 30, NIGHT_DUR = 25, MORN_DUR = 12;

let view3D = false;
const PERSP = { fov: 0.18 };

// ── STATE MACHINE ──
// gameState: 'start' | 'playing' | 'levelTrans' | 'gameover' | 'seasonEnd'
// gameLevel: 1 (surface/sewer), 2 (bike), 3 (arena)
let gameState = 'start';
let gameLevel = 1;
let score = 0, kills = 0;

// ── PHASE (Level 1) ──
let phase = 'day', phaseTimer = DAY_DUR, phaseDuration = DAY_DUR;
let dayCount = 0;

// ── INPUT ──
const keys = {};
window.addEventListener('keydown', e => {
  if (['Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code)) e.preventDefault();
  keys[e.code] = true;
  if (gameState === 'playing') handleAction(e.code);
  if (e.code === 'Tab') { e.preventDefault(); view3D = !view3D; showStatus(view3D?'3D MODE ON':'2D MODE'); }
});
window.addEventListener('keyup', e => { keys[e.code] = false; });

// ═══════════════════════════════════════════════
//  SHARED HELPERS
// ═══════════════════════════════════════════════
function groundY() { return canvas.height * 0.62; }
function sewCeilY() { return groundY() + 30; }
function sewFloorY() { return sewCeilY() + 160; }

let cam = { x: 0 };
function updateCamera() {
  const tx = player.x - canvas.width * 0.35;
  cam.x += (tx - cam.x) * 0.1;
  cam.x = Math.max(0, Math.min(cam.x, WORLD_LEN - canvas.width));
}

let particles = [];
function spawnParticles(x, y, color, count=8, opts={}) {
  for (let i=0; i<count; i++) {
    const ang = Math.random()*Math.PI*2, spd = (opts.speed||3)+Math.random()*2;
    particles.push({x,y,vx:Math.cos(ang)*spd,vy:Math.sin(ang)*spd,life:opts.life||35,maxLife:opts.life||35,color,size:opts.size||(2+Math.random()*3)});
  }
}
function updateParticles() {
  for (let i=particles.length-1;i>=0;i--) {
    const p=particles[i]; p.x+=p.vx; p.y+=p.vy; p.vy+=0.12; p.life--;
    if(p.life<=0) particles.splice(i,1);
  }
}
function drawParticles() {
  particles.forEach(p=>{
    const a=p.life/p.maxLife;
    const px=view3D?projectX(p.x,p.y):p.x-cam.x;
    const py=view3D?projectY(p.y):p.y;
    ctx.globalAlpha=a; ctx.fillStyle=p.color;
    ctx.beginPath(); ctx.arc(px,py,p.size*a,0,Math.PI*2); ctx.fill();
  });
  ctx.globalAlpha=1;
}

function projectX(wx,wy) {
  if(!view3D) return wx-cam.x;
  const gy=groundY(), dep=1-(wy/gy)*PERSP.fov, cx=canvas.width/2;
  return cx+(wx-cam.x-cx)*dep;
}
function projectY(wy) {
  if(!view3D) return wy;
  const gy=groundY();
  if(wy>=gy) return wy+(wy-gy)*0.15;
  return wy*(1-PERSP.fov*0.3)+gy*PERSP.fov*0.3;
}

let statusTimer=0, trapWarnTimer=0, phaseAlertTimer=0;
function showStatus(msg) { const el=document.getElementById('statusMsg'); el.textContent=msg; el.classList.add('show'); statusTimer=160; }
function showTrapWarn(msg) { const el=document.getElementById('trapWarn'); el.textContent=msg; el.classList.add('show'); trapWarnTimer=240; }
function tickStatus() { if(statusTimer>0){statusTimer--;if(statusTimer===0)document.getElementById('statusMsg').classList.remove('show');} }
function tickTrapWarn() { if(trapWarnTimer>0){trapWarnTimer--;if(trapWarnTimer===0)document.getElementById('trapWarn').classList.remove('show');} }
function showPhaseAlert(text,cls) {
  const el=document.getElementById('phaseAlert');
  el.innerHTML=text.replace('\n','<br>'); el.className='show '+cls; phaseAlertTimer=180;
}

// ═══════════════════════════════════════════════
//  PLAYER
// ═══════════════════════════════════════════════
let player = {};
function spawnPlayer() {
  player = {
    x:120, y:0, vx:0, vy:0, w:18, h:36,
    hp:100, maxHp:100, ammo:12, maxAmmo:12,
    facing:1, onGround:false, jumpCount:0, maxJumps:2,
    crawling:false, underground:false, inManhole:false, manholeIndex:-1,
    reloading:false, reloadTimer:0,
    shooting:false, shootTimer:0,
    invincible:0, stunned:0, poisoned:0, poisonTick:0,
    onFire:0, fireTick:0,
    animTick:0, animFrame:0,
    distanceTraveled:0,
    nightDrainAcc:0,
    deathCause:'', dead:false,
    // Bike-specific
    onBike:false, bikeSpeed:0, bikeMaxSpeed:9, bikeAccel:0.15, bikeBrake:0.3,
    bikeJumped:false, bikeJumpCount:0,
    // Arena
    punchCooldown:0, blocking:false,
  };
  player.y = groundY() - player.h - 2;
}

function damagePlayer(dmg, cause) {
  if(player.invincible>0) return;
  player.hp-=dmg; player.invincible=40; player.deathCause=cause||'';
  spawnParticles(player.x+player.w/2,player.y+player.h/2,'#ef4444',6);
  if(player.hp<=0) { player.hp=0; player.dead=true; doGameOver(); }
  updateHpUI();
}

function updateHpUI() { document.getElementById('hpFill').style.width=(player.hp/player.maxHp*100)+'%'; }
function updateAmmoUI() {
  document.getElementById('ammoFill').style.width=(player.ammo/player.maxAmmo*100)+'%';
  document.getElementById('ammoCount').textContent=player.ammo+'/'+player.maxAmmo;
}

// ═══════════════════════════════════════════════
//  LEVEL 1 — SURFACE + SEWERS
// ═══════════════════════════════════════════════
let world = {};
let bullets = [];
let enemies = [];

function generateLevel1() {
  world = { manholes:[], ammoPickups:[], traps:[], sewPipes:[], sewRats:[],
            healthPacks:[], crates:[], lampPosts:[], checkpointX: WORLD_LEN - 500 };

  const mCount = 10;
  const spacing = WORLD_LEN / mCount;
  for (let i=0; i<mCount; i++) {
    world.manholes.push({ x: 400+spacing*i+(Math.random()*spacing*0.4-spacing*0.2), open:true });
  }
  for (let i=0; i<22; i++) world.ammoPickups.push({x:300+Math.random()*(WORLD_LEN-600),collected:false,underground:false});
  for (let i=0; i<14; i++) world.ammoPickups.push({x:400+Math.random()*(WORLD_LEN-800),collected:false,underground:true});
  for (let i=0; i<10; i++) world.healthPacks.push({x:500+Math.random()*(WORLD_LEN-1000),collected:false,underground:Math.random()<0.4});
  for (let i=0; i<25; i++) world.crates.push({x:200+Math.random()*(WORLD_LEN-400), h:20+Math.random()*25|0});
  for (let x=300; x<WORLD_LEN; x+=200+Math.random()*160) world.lampPosts.push({x});
  // Sewer pipes
  for (let i=0; i<20; i++) world.sewPipes.push({x:300+Math.random()*(WORLD_LEN-600), drip:0, dripSpeed:0.3+Math.random()*0.4});
  // Sewer rats
  for (let i=0; i<12; i++) world.sewRats.push({x:400+Math.random()*(WORLD_LEN-800), vx:(Math.random()<0.5?-1:1)*(0.8+Math.random()), animTick:0, animFrame:0});
  // Surface traps
  for (let i=0; i<12; i++) world.traps.push({type:'bear',x:500+Math.random()*(WORLD_LEN-1100),triggered:false,resetTimer:0});
  for (let i=0; i<6; i++) world.traps.push({type:'spike',x:600+Math.random()*(WORLD_LEN-1200),w:50+Math.random()*40});
  for (let i=0; i<8; i++) world.traps.push({type:'gas',x:400+Math.random()*(WORLD_LEN-800),timer:0,period:160+Math.random()*120|0,active:false,cloudLife:0});
  for (let i=0; i<5; i++) world.traps.push({type:'crusher',x:700+Math.random()*(WORLD_LEN-1400),timer:0,period:120+Math.random()*100|0,crushing:false,crushY:0});
  for (let i=0; i<7; i++) world.traps.push({type:'flame',x:500+Math.random()*(WORLD_LEN-1000),timer:0,period:100+Math.random()*80|0,active:false,flameLife:0});
  // Underground traps
  for (let i=0; i<8; i++) world.traps.push({type:'sewspike',x:400+Math.random()*(WORLD_LEN-800),w:40+Math.random()*30});
  for (let i=0; i<6; i++) world.traps.push({type:'sewelectric',x:500+Math.random()*(WORLD_LEN-1000),w:60+Math.random()*40,timer:0,period:80+Math.random()*60|0,active:false});
  for (let i=0; i<5; i++) world.traps.push({type:'sewgas',x:400+Math.random()*(WORLD_LEN-800),timer:0,period:150+Math.random()*120|0,active:false,life:0});
}

function spawnEnemies() {
  const count = 4 + dayCount;
  for (let i=0; i<count; i++) {
    const type = Math.random()<0.25?'brute':(Math.random()<0.5?'vamp':'zombie');
    const ex = cam.x + canvas.width + 100 + Math.random()*500;
    const ey = groundY() - (type==='brute'?52:38);
    enemies.push({x:ex,y:ey,vx:type==='brute'?-0.8:-1.2,w:type==='brute'?30:22,h:type==='brute'?52:38,
      hp:type==='brute'?5:2,maxHp:type==='brute'?5:2,type,animTick:0,animFrame:0,underground:false,alert:false});
  }
}

function fireBullet() {
  if(player.ammo<=0||player.reloading||player.stunned>0) return;
  player.ammo--; player.shooting=true; player.shootTimer=8;
  const bx=player.x+(player.facing>0?player.w:0);
  const by=player.y+player.h*0.4;
  bullets.push({x:bx,y:by,vx:player.facing*18,vy:0,life:55,underground:player.underground});
  updateAmmoUI();
}

function tryManhole() {
  if(player.inManhole) {
    if(phase==='night'){showStatus('TOO DANGEROUS — WAIT FOR MORNING');return;}
    exitManhole(); return;
  }
  for (let i=0;i<world.manholes.length;i++) {
    const m=world.manholes[i];
    if(Math.abs(m.x-player.x)<44&&!player.underground){
      player.inManhole=true; player.manholeIndex=i;
      player.underground=true;
      player.x=m.x; player.y=sewCeilY()+10;
      player.vy=2; player.vx=0;
      document.getElementById('underground').classList.add('show');
      showStatus('IN THE SEWERS — SAFE FROM NIGHT');
      return;
    }
  }
  showStatus('NO MANHOLE NEARBY');
}

function exitManhole() {
  player.underground=false; player.inManhole=false;
  player.y=groundY()-player.h-2; player.vy=-8;
  document.getElementById('underground').classList.remove('show');
  showStatus('EMERGED — WATCH FOR TRAPS!');
}

function updateLevel1Player(dt) {
  if(player.dead) return;
  player.invincible=Math.max(0,player.invincible-1);
  if(player.stunned>0){player.stunned--;player.vx=0;}

  if(player.poisoned>0){
    player.poisoned--;player.poisonTick++;
    if(player.poisonTick%40===0){damagePlayer(3,'TOXIC POISONING');spawnParticles(player.x+player.w/2,player.y,'#4ade80',4,{size:3,speed:1.5});}
  }
  if(player.onFire>0){
    player.onFire--;player.fireTick=(player.fireTick||0)+1;
    if(player.fireTick%25===0){damagePlayer(4,'BURNING');spawnParticles(player.x+player.w/2,player.y+player.h*0.3,'#f97316',5,{speed:2,life:18,size:3});}
  }
  if(player.shootTimer>0){player.shootTimer--;}else{player.shooting=false;}
  if(player.reloading){
    player.reloadTimer--;
    if(player.reloadTimer<=0){player.ammo=player.maxAmmo;player.reloading=false;updateAmmoUI();showStatus('RELOADED');}
  }
  if(player.stunned===0){
    const speed=player.crawling?2.2:4.5;
    if(keys['KeyA']||keys['ArrowLeft']){player.vx=-speed;player.facing=-1;}
    else if(keys['KeyD']||keys['ArrowRight']){player.vx=speed;player.facing=1;}
    else{player.vx*=0.75;}
  }
  player.crawling=!!(keys['KeyS']||keys['ArrowDown'])&&player.onGround&&!player.underground;
  player.h=player.crawling?18:36;
  if(keys['Space']&&!player.shooting&&player.shootTimer===0) fireBullet();

  player.vy+=GRAVITY; player.x+=player.vx; player.y+=player.vy;
  player.distanceTraveled+=Math.abs(player.vx);

  const floorY=player.underground?sewFloorY()-player.h:groundY()-player.h;
  const ceilY=player.underground?sewCeilY()+4:-500;
  if(player.y>=floorY){player.y=floorY;player.vy=0;player.onGround=true;player.jumpCount=0;}
  else{player.onGround=false;}
  if(player.y<=ceilY){player.y=ceilY;player.vy=2;}
  player.x=Math.max(0,Math.min(player.x,WORLD_LEN-player.w));

  // Pickups
  world.ammoPickups.forEach(a=>{
    if(a.collected||a.underground!==player.underground) return;
    const ay=a.underground?sewFloorY()-30:groundY()-22;
    if(Math.abs(a.x-player.x)<28&&Math.abs(ay-player.y)<36){
      a.collected=true; player.ammo=Math.min(player.maxAmmo,player.ammo+6);
      updateAmmoUI(); showStatus('+6 AMMO'); spawnParticles(a.x,ay,'#3b82f6',6); score+=10;
    }
  });
  world.healthPacks.forEach(h=>{
    if(h.collected||h.underground!==player.underground) return;
    const hy=h.underground?sewFloorY()-30:groundY()-22;
    if(Math.abs(h.x-player.x)<28&&Math.abs(hy-player.y)<36){
      h.collected=true; player.hp=Math.min(player.maxHp,player.hp+25);
      updateHpUI(); showStatus('+25 HP'); spawnParticles(h.x,hy,'#ef4444',8,{speed:3}); score+=20;
    }
  });
  // Sewer rats
  world.sewRats.forEach(r=>{
    r.animTick++; if(r.animTick%10===0)r.animFrame=(r.animFrame+1)%2;
    r.x+=r.vx; if(r.x<100||r.x>WORLD_LEN-100)r.vx*=-1;
  });
  // Night drain
  if(phase==='night'&&!player.underground){
    player.nightDrainAcc=(player.nightDrainAcc||0)+dt;
    if(player.nightDrainAcc>=0.33){player.nightDrainAcc=0;player.hp=Math.max(0,player.hp-1);updateHpUI();if(player.hp<=0){player.dead=true;player.deathCause='NIGHT EXPOSURE';doGameOver();}}
  } else {player.nightDrainAcc=0;}
  // Enemy contact
  if(phase==='night'&&!player.underground){
    enemies.forEach(e=>{if(Math.abs(e.x-player.x)<40&&Math.abs(e.y-player.y)<50&&player.invincible===0)damagePlayer(5,'VAMPIRE ATTACK');});
  }
  // Checkpoint
  if(!player.underground && player.x >= world.checkpointX) {
    triggerLevelTransition(1);
  }
  player.animTick++; if(player.animTick%8===0)player.animFrame=(player.animFrame+1)%4;
  score+=0.01; document.getElementById('scoreVal').textContent=Math.floor(score);
  updateHpUI(); updateAmmoUI();
}

function updateLevel1Enemies() {
  enemies.forEach((e,i)=>{
    if(player.underground&&!e.underground){e.x+=e.vx;e.animTick++;if(e.animTick%8===0)e.animFrame=(e.animFrame+1)%4;if(e.x<0||e.x>WORLD_LEN)e.vx*=-1;return;}
    const dx=player.x-e.x, dist=Math.abs(dx);
    e.alert=dist<450;
    const speed=e.type==='brute'?0.9:1.2;
    if(dist>5) e.vx=Math.sign(dx)*speed;
    e.x+=e.vx; e.animTick++; if(e.animTick%8===0)e.animFrame=(e.animFrame+1)%4;
    if(dist<35&&Math.abs(e.y-player.y)<45&&!player.underground&&player.invincible===0)
      damagePlayer(e.type==='brute'?14:8,e.type==='brute'?'BRUTE ATTACK':'ENEMY ATTACK');
  });
}

function updateBullets() {
  for(let bi=bullets.length-1;bi>=0;bi--){
    const b=bullets[bi]; b.x+=b.vx; b.y+=b.vy; b.life--;
    if(b.life<=0){bullets.splice(bi,1);continue;}
    let hit=false;
    for(let ei=enemies.length-1;ei>=0;ei--){
      const e=enemies[ei];
      if(b.x>e.x&&b.x<e.x+e.w&&b.y>e.y&&b.y<e.y+e.h&&b.underground===e.underground){
        e.hp--; spawnParticles(b.x,b.y,'#ef4444',6); hit=true;
        if(e.hp<=0){
          const col=e.type==='vamp'?'#8b5cf6':e.type==='brute'?'#f97316':'#6b7280';
          spawnParticles(e.x+e.w/2,e.y+e.h/2,col,14);
          enemies.splice(ei,1); kills++; score+=60;
          showStatus(e.type==='vamp'?'VAMP SLAIN!':e.type==='brute'?'BRUTE DOWN!':'ZOMBIE DOWN!');
        }
        break;
      }
    }
    if(hit) bullets.splice(bi,1);
  }
}

function updateLevel1Traps() {
  const gy=groundY(), sfy=sewFloorY(), scy=sewCeilY();
  world.traps.forEach(t=>{
    const tx=t.x, px=player.x+player.w/2, pdist=Math.abs(px-tx);
    if(['bear','spike','gas','crusher','flame'].includes(t.type)&&phase!=='morning') return;
    if(t.type==='bear'){
      if(t.triggered){t.resetTimer--;if(t.resetTimer<=0)t.triggered=false;return;}
      if(!player.underground&&pdist<18&&player.onGround){t.triggered=true;t.resetTimer=200;player.stunned=80;damagePlayer(12,'BEAR TRAP');spawnParticles(tx,gy-10,'#ef4444',10);showStatus('⚠ BEAR TRAP!');}
    } else if(t.type==='spike'){
      if(!player.underground&&px>t.x&&px<t.x+t.w&&player.vy>2&&player.y+player.h>gy-5){damagePlayer(35,'SPIKE PIT');spawnParticles(px,gy,'#ef4444',16,{speed:5});player.vy=-8;showStatus('⚠ SPIKE PIT!');}
    } else if(t.type==='gas'){
      t.timer++;if(t.timer>=t.period){t.timer=0;t.active=true;t.cloudLife=140;}
      if(t.active){t.cloudLife--;if(t.cloudLife<=0)t.active=false;if(!player.underground&&pdist<65&&player.poisoned===0){player.poisoned=200;showStatus('☠ TOXIC GAS!');}}
    } else if(t.type==='crusher'){
      t.timer++;if(t.timer>=t.period){t.timer=0;t.crushing=true;t.crushY=0;}
      if(t.crushing){t.crushY=Math.min(t.crushY+3,60);if(t.crushY>=60){t.crushing=false;t.crushY=0;}if(!player.underground&&pdist<25&&player.onGround&&t.crushY>40){damagePlayer(25,'CRUSHER');spawnParticles(tx,gy-30,'#ef4444',12,{speed:5});showStatus('💥 CRUSHER!');}}
    } else if(t.type==='flame'){
      t.timer++;if(t.timer>=t.period){t.timer=0;t.active=true;t.flameLife=70;}
      if(t.active){t.flameLife--;if(t.flameLife<=0)t.active=false;if(!player.underground&&pdist<30&&player.onFire===0){player.onFire=150;showStatus('🔥 ON FIRE!');spawnParticles(player.x+player.w/2,player.y,'#f97316',8,{speed:3,life:25});}}
    } else if(t.type==='sewspike'){
      if(player.underground&&px>t.x&&px<t.x+t.w&&player.vy>1&&player.y+player.h>sfy-25){damagePlayer(20,'SEWER SPIKES');player.vy=-7;spawnParticles(px,sfy-10,'#dc2626',10,{speed:4});showStatus('⚠ SEWER SPIKES!');}
    } else if(t.type==='sewelectric'){
      t.timer++;if(t.timer>=t.period){t.timer=0;t.active=!t.active;}
      if(t.active&&player.underground&&px>t.x&&px<t.x+t.w&&player.y+player.h>sfy-24&&player.invincible===0){damagePlayer(8,'ELECTRIFIED SEWAGE');player.vy=-5;spawnParticles(px,sfy-12,'#fef08a',8,{speed:3});showStatus('⚡ ELECTRIFIED WATER!');}
    } else if(t.type==='sewgas'){
      t.timer++;if(t.timer>=t.period){t.timer=0;t.active=true;t.life=120;}
      if(t.active){t.life--;if(t.life<=0)t.active=false;if(player.underground&&pdist<50&&player.poisoned===0){player.poisoned=160;showStatus('☠ SEWER GAS!');}}
    }
  });
}

function tickPhase(dt) {
  phaseTimer-=dt;
  const frac=Math.max(0,phaseTimer/phaseDuration);
  document.getElementById('phaseFill').style.width=(frac*100)+'%';
  document.getElementById('phaseCountdown').textContent=Math.ceil(Math.max(0,phaseTimer))+'s';
  if(phaseTimer<=0) switchPhase();
  if(phaseTimer<=10&&phaseTimer>0){
    const cls=phase==='night'?'show-night':phase==='morning'?'show-morning':'';
    const tog=Math.floor(phaseTimer*2)%2===0;
    document.getElementById('dangerOverlay').className=tog&&cls?cls:'';
  } else {document.getElementById('dangerOverlay').className='';}
  if(phaseAlertTimer>0){phaseAlertTimer--;}else{document.getElementById('phaseAlert').classList.remove('show');}
}

function switchPhase() {
  if(phase==='day'){
    phase='night';phaseDuration=NIGHT_DUR;phaseTimer=NIGHT_DUR;dayCount++;
    spawnEnemies();
    document.getElementById('timeDisplay').className='night';
    document.getElementById('timeDisplay').textContent='🌙 NIGHT';
    document.getElementById('phaseFill').className='night';
    showPhaseAlert('NIGHT FALLS\n🌙 SEEK SHELTER','night');
    if(!player.underground)showStatus('⚠ GET IN A MANHOLE NOW!');
  } else if(phase==='night'){
    phase='morning';phaseDuration=MORN_DUR;phaseTimer=MORN_DUR;
    enemies=[];
    document.getElementById('timeDisplay').className='morning';
    document.getElementById('timeDisplay').textContent='🌅 MORNING';
    document.getElementById('phaseFill').className='morning';
    showPhaseAlert('DAWN BREAKS\n⚠ TRAPS ARMED','morning');
    showTrapWarn('⚠ MORNING TRAPS ACTIVE — MOVE CAREFULLY');
    world.traps.forEach(t=>{if(t.type==='bear')t.triggered=false;if(t.type==='crusher')t.timer=0;});
  } else {
    phase='day';phaseDuration=DAY_DUR;phaseTimer=DAY_DUR;
    player.hp=Math.min(player.maxHp,player.hp+15);updateHpUI();
    document.getElementById('timeDisplay').className='day';
    document.getElementById('timeDisplay').textContent='☀ DAY';
    document.getElementById('phaseFill').className='day';
    showPhaseAlert('SAFE ZONE\n☀ REST & COLLECT','day');
    world.traps.forEach(t=>{if(t.type==='bear')t.triggered=false;});
  }
}

// ═══════════════════════════════════════════════
//  LEVEL 2 — BIKE + ACID RAIN
// ═══════════════════════════════════════════════
let bikeWorld = {};
let acidRainDrops = [];
let bikeObstacles = [];
let acidRainActive = false;
let acidRainTimer = 0;
let acidRainDuration = 0;
let bikeHalted = false, bikeHaltTimer = 0;
let level2Progress = 0;
const LEVEL2_LEN = 16000;
const BIKE_Y_BASE = 0; // relative to groundY()

function generateLevel2() {
  bikeWorld = {
    checkpointX: LEVEL2_LEN - 600,
    roadCracks: [],
    potholes: [],
    roadBumps: [],
    healthPacks: [],
    ammoPickups: [],
    coverZones: [],
  };
  // Road damage
  for(let i=0;i<40;i++) bikeWorld.roadCracks.push({x:300+Math.random()*(LEVEL2_LEN-600)});
  for(let i=0;i<20;i++) bikeWorld.potholes.push({x:400+Math.random()*(LEVEL2_LEN-800),w:40+Math.random()*50,depth:10+Math.random()*15});
  for(let i=0;i<25;i++) bikeWorld.roadBumps.push({x:300+Math.random()*(LEVEL2_LEN-600),h:8+Math.random()*12});
  for(let i=0;i<15;i++) bikeWorld.healthPacks.push({x:600+Math.random()*(LEVEL2_LEN-1200),collected:false});
  for(let i=0;i<20;i++) bikeWorld.ammoPickups.push({x:400+Math.random()*(LEVEL2_LEN-800),collected:false});
  // Cover zones (tunnels / overhangs player can shelter in during acid rain)
  for(let i=0;i<8;i++) bikeWorld.coverZones.push({x:500+i*(LEVEL2_LEN/9)+Math.random()*200,w:180+Math.random()*80});
  // Reset acid rain
  acidRainDrops=[];
  acidRainActive=false; acidRainTimer=0; acidRainDuration=0;
  bikeHalted=false; bikeHaltTimer=0;
  level2Progress=0;
  player.onBike=true; player.bikeSpeed=3;
  player.x=200; player.y=groundY()-player.h-2;
  cam.x=0;
  document.getElementById('speedBar').classList.add('show');
  document.getElementById('timeDisplay').className='bike';
  document.getElementById('timeDisplay').textContent='🏍 RIDE';
  document.getElementById('phaseFill').className='bike';
  document.getElementById('phaseCountdown').textContent='';
  document.getElementById('bossBar').classList.remove('show');
}

function spawnAcidRain() {
  acidRainActive=true; acidRainDuration=600+Math.random()*400;
  showPhaseAlert('⚠ ACID RAIN!\nSEEK COVER','bike');
  showTrapWarn('☠ ACID RAIN — TAKE COVER OR HALT!');
  document.getElementById('dangerOverlay').className='show-acid';
  for(let i=0;i<150;i++) {
    acidRainDrops.push({
      x:cam.x+Math.random()*canvas.width, y:Math.random()*groundY(),
      vy:8+Math.random()*6, vx:(Math.random()-0.5)*2, splash:false, splashTimer:0
    });
  }
}

function isUnderCover() {
  const px=player.x;
  return bikeWorld.coverZones.some(c=>px>=c.x&&px<=c.x+c.w);
}

function updateLevel2Player(dt) {
  if(player.dead) return;
  player.invincible=Math.max(0,player.invincible-1);

  // Acid rain timer
  if(!acidRainActive) {
    acidRainTimer+=dt;
    if(acidRainTimer>=12+Math.random()*8) { acidRainTimer=0; spawnAcidRain(); }
  } else {
    acidRainDuration--;
    if(acidRainDuration<=0){acidRainActive=false;acidRainDrops=[];document.getElementById('dangerOverlay').className='';showStatus('ACID RAIN STOPPED');}
  }

  // Halt mechanic
  if(bikeHalted){
    bikeHaltTimer--;
    player.bikeSpeed=Math.max(0,player.bikeSpeed-0.3);
    if(bikeHaltTimer<=0){bikeHalted=false;showStatus('ROAD CLEAR — ACCELERATE!');}
    // Still take acid damage if not under cover
    if(acidRainActive&&!isUnderCover()&&player.invincible===0&&Math.random()<0.04){
      damagePlayer(3,'ACID RAIN EXPOSURE');
      spawnParticles(player.x+Math.random()*player.w,player.y,'#84cc16',3,{speed:1,life:15,size:2});
    }
  } else {
    // Accelerate / brake
    if(keys['KeyS']||keys['ArrowDown']){
      player.bikeSpeed=Math.max(1,player.bikeSpeed-player.bikeBrake);
      // Manual halt = safe from rain (stop completely)
      if(player.bikeSpeed<=1&&acidRainActive){
        bikeHalted=true; bikeHaltTimer=120;
        showStatus(isUnderCover()?'SHELTERED — SAFE FROM ACID':'⚠ EXPOSED! FIND COVER!');
      }
    } else {
      player.bikeSpeed=Math.min(player.bikeMaxSpeed,player.bikeSpeed+player.bikeAccel);
    }
    // Acid rain damage (exposed)
    if(acidRainActive&&!isUnderCover()&&player.invincible===0&&Math.random()<0.015){
      damagePlayer(2,'ACID BURN'); spawnParticles(player.x+player.w/2,player.y,'#84cc16',4,{speed:1.5,life:18,size:2});
    }
  }

  // Jump
  if((keys['KeyW']||keys['ArrowUp'])&&player.onGround&&!player.bikeJumped){
    player.vy=-11; player.bikeJumped=true;
  }
  if(keys['KeyA']||keys['ArrowLeft']){player.vx=-1;player.facing=-1;}
  else if(keys['KeyD']||keys['ArrowRight']){player.vx=1;player.facing=1;}
  else {player.vx=0;}

  player.vy+=GRAVITY;
  const gy=groundY();
  player.x+=player.bikeSpeed+(keys['KeyA']?-1:keys['KeyD']?1:0);
  player.y+=player.vy;
  if(player.y>=gy-player.h-2){player.y=gy-player.h-2;player.vy=0;player.onGround=true;player.bikeJumped=false;}
  else{player.onGround=false;}
  player.x=Math.max(0,Math.min(player.x,LEVEL2_LEN-player.w));

  // Pothole damage
  bikeWorld.potholes.forEach(p=>{
    if(player.x+player.w>p.x&&player.x<p.x+p.w&&player.onGround&&player.invincible===0&&!bikeHalted){
      damagePlayer(8,'POTHOLE'); player.vy=-5;
      spawnParticles(player.x+player.w/2,gy,'#6b7280',8,{speed:4});
      showStatus('💥 POTHOLE!');
    }
  });
  // Bump
  bikeWorld.roadBumps.forEach(b=>{
    if(Math.abs(player.x-b.x)<20&&player.onGround&&player.bikeSpeed>4&&player.invincible===0){
      player.vy=-(5+b.h*0.4); damagePlayer(4,'ROAD BUMP');
      spawnParticles(b.x,gy,'#9ca3af',5,{speed:3});
    }
  });

  // Pickups
  bikeWorld.healthPacks.forEach(h=>{
    if(h.collected) return;
    const hy=gy-22;
    if(Math.abs(h.x-player.x)<28&&Math.abs(hy-player.y)<36){h.collected=true;player.hp=Math.min(player.maxHp,player.hp+20);updateHpUI();showStatus('+20 HP');spawnParticles(h.x,hy,'#ef4444',6);}
  });
  bikeWorld.ammoPickups.forEach(a=>{
    if(a.collected) return;
    const ay=gy-22;
    if(Math.abs(a.x-player.x)<28&&Math.abs(ay-player.y)<36){a.collected=true;player.ammo=Math.min(player.maxAmmo,player.ammo+6);updateAmmoUI();showStatus('+6 AMMO');spawnParticles(a.x,ay,'#3b82f6',5);}
  });

  // Update acid drops
  for(let i=acidRainDrops.length-1;i>=0;i--){
    const d=acidRainDrops[i];
    if(d.splash){d.splashTimer--;if(d.splashTimer<=0)acidRainDrops.splice(i,1);continue;}
    d.x+=d.vx; d.y+=d.vy;
    if(d.y>=gy){d.splash=true;d.splashTimer=8;spawnParticles(d.x,gy,'#84cc16',1,{speed:1.5,life:8,size:1.5});}
    if(d.x<cam.x-50||d.x>cam.x+canvas.width+50){acidRainDrops.splice(i,1);}
    // Replenish
    if(acidRainActive&&acidRainDrops.length<150){
      acidRainDrops.push({x:cam.x+Math.random()*canvas.width,y:-20,vy:8+Math.random()*6,vx:(Math.random()-0.5)*2,splash:false,splashTimer:0});
    }
  }

  // Speed HUD
  document.getElementById('speedFill').style.width=(player.bikeSpeed/player.bikeMaxSpeed*100)+'%';

  // Update distance
  player.distanceTraveled+=player.bikeSpeed;
  level2Progress=player.x/LEVEL2_LEN;

  // Phase bar as distance
  document.getElementById('phaseFill').style.width=(level2Progress*100)+'%';

  if(player.x>=bikeWorld.checkpointX) triggerLevelTransition(2);
  score+=0.02; document.getElementById('scoreVal').textContent=Math.floor(score);
  updateHpUI(); updateAmmoUI();
}

// ═══════════════════════════════════════════════
//  LEVEL 3 — ARENA COMBAT + BOSS
// ═══════════════════════════════════════════════
let arenaEnemies = [];
let boss = null;
let arenaPhase = 'wave1'; // wave1, wave2, bossIntro, bossFight, done
let arenaWaveTimer = 0;
let arenaEnemiesKilled = 0;
let arenaWave1Count = 6, arenaWave2Count = 10;
const ARENA_WIDTH = 2400;

function generateLevel3() {
  player.onBike=false;
  document.getElementById('speedBar').classList.remove('show');
  arenaEnemies=[]; boss=null;
  arenaPhase='wave1'; arenaWaveTimer=0; arenaEnemiesKilled=0;
  player.x=300; player.y=groundY()-player.h-2;
  player.vx=0; player.vy=0;
  cam.x=0;
  document.getElementById('timeDisplay').className='arena';
  document.getElementById('timeDisplay').textContent='⚔ ARENA';
  document.getElementById('phaseFill').className='arena';
  document.getElementById('phaseCountdown').textContent='';
  document.getElementById('dangerOverlay').className='show-arena';
  showPhaseAlert('ARENA\n⚔ FIGHT TO THE DEATH','arena');
  spawnArenaWave1();
}

function spawnArenaWave1() {
  arenaEnemies=[];
  for(let i=0;i<arenaWave1Count;i++){
    const side=i%2===0?1:-1;
    const ex=ARENA_WIDTH/2+side*(300+i*80);
    arenaEnemies.push({
      x:ex, y:groundY()-44, vx:-side*1.2, w:22, h:44,
      hp:4, maxHp:4, type:'soldier', armed:true,
      gun:true, animTick:0, animFrame:0,
      shootCooldown:80+Math.random()*60|0, shootTimer:0,
      alert:true, dead:false,
    });
  }
  showStatus('WAVE 1: ARMED SOLDIERS!');
  showTrapWarn('⚠ 6 ARMED MEN APPROACHING!');
}

function spawnArenaWave2() {
  arenaEnemies=[];
  for(let i=0;i<arenaWave2Count;i++){
    const side=i%2===0?1:-1;
    const ex=ARENA_WIDTH/2+side*(200+i*60)+Math.random()*100;
    const type=i<4?'soldier':i<7?'brute':i<9?'knife':'soldier';
    arenaEnemies.push({
      x:ex, y:groundY()-44, vx:-side*1.4, w:type==='brute'?30:22, h:type==='brute'?52:44,
      hp:type==='brute'?8:5, maxHp:type==='brute'?8:5, type,
      armed:true, gun:type!=='knife'&&type!=='brute',
      animTick:0, animFrame:0,
      shootCooldown:60+Math.random()*50|0, shootTimer:0,
      alert:true, dead:false,
    });
  }
  showStatus('WAVE 2: ELITE FORCES!');
  showTrapWarn('⚠ 10 ELITE FIGHTERS — KNIVES, GUNS, BRUTES!');
}

function spawnBoss() {
  boss = {
    x:ARENA_WIDTH*0.65, y:0,
    vx:-1.5, w:40, h:60,
    hp:40, maxHp:40,
    phase:'approach', // approach, fight, stunned
    attackTimer:0, attackCooldown:80,
    punchPhase:0, // 0=idle, 1=wind-up, 2=striking, 3=recovery
    punchTimer:0,
    stunTimer:0,
    animTick:0, animFrame:0,
    dashTimer:0, dashCooldown:180,
    enraged:false, enrageThreshold:20,
  };
  boss.y=groundY()-boss.h-2;
  document.getElementById('bossBar').classList.add('show');
  document.getElementById('bossName').textContent='⚔ WARLORD KADE ⚔';
  updateBossHpUI();
  showPhaseAlert('FINAL BOSS\n⚔ WARLORD KADE','arena');
  showStatus('1v1 FIST FIGHT! USE SPACE TO PUNCH!');
  showTrapWarn('NO GUNS — FISTS ONLY! DODGE & PUNCH!');
}

function updateBossHpUI() {
  if(!boss) return;
  document.getElementById('bossHpFill').style.width=(boss.hp/boss.maxHp*100)+'%';
}

function updateLevel3Player(dt) {
  if(player.dead) return;
  player.invincible=Math.max(0,player.invincible-1);
  if(player.stunned>0){player.stunned--;player.vx*=0.3;}
  if(player.punchCooldown>0) player.punchCooldown--;

  const speed=4.5;
  if(player.stunned===0){
    if(keys['KeyA']||keys['ArrowLeft']){player.vx=-speed;player.facing=-1;}
    else if(keys['KeyD']||keys['ArrowRight']){player.vx=speed;player.facing=1;}
    else {player.vx*=0.75;}
  }
  player.vy+=GRAVITY;
  player.x+=player.vx; player.y+=player.vy;
  player.x=Math.max(0,Math.min(player.x,ARENA_WIDTH-player.w));
  const gy=groundY();
  if(player.y>=gy-player.h-2){player.y=gy-player.h-2;player.vy=0;player.onGround=true;player.jumpCount=0;}
  else{player.onGround=false;}

  // Punch (SPACE in arena fist fight = melee, bullets in wave phases)
  if(keys['Space']){
    if(arenaPhase==='bossFight') {
      // Fist fight — punch the boss
      if(player.punchCooldown===0){
        player.punchCooldown=35; player.shooting=true; player.shootTimer=12;
        const dist=Math.abs(boss.x+boss.w/2 - (player.x+player.w/2));
        if(dist<70){
          const dmg = player.stunned>0?0:8+(player.punchCooldown<5?4:0);
          boss.hp=Math.max(0,boss.hp-dmg);
          spawnParticles(boss.x+boss.w/2,boss.y+boss.h*0.3,'#ef4444',10,{speed:5});
          updateBossHpUI(); score+=30;
          if(Math.random()<0.3) { boss.stunTimer=30; boss.punchPhase=3; }
          showStatus('PUNCH CONNECTS! -'+dmg+' HP');
          if(boss.hp<=0) { boss.hp=0; updateBossHpUI(); triggerLevelTransition(3); }
        } else { showStatus('TOO FAR — GET CLOSER!'); }
      }
    } else if(!player.shooting&&player.shootTimer===0) {
      fireBullet(); // Waves — use gun
    }
  }

  if(player.shootTimer>0){player.shootTimer--;}else{player.shooting=false;}
  if(player.reloading){player.reloadTimer--;if(player.reloadTimer<=0){player.ammo=player.maxAmmo;player.reloading=false;updateAmmoUI();showStatus('RELOADED');}}

  player.animTick++; if(player.animTick%8===0)player.animFrame=(player.animFrame+1)%4;
  score+=0.02; document.getElementById('scoreVal').textContent=Math.floor(score);
  updateHpUI(); updateAmmoUI();
}

function updateArenaEnemies() {
  const gy=groundY();
  for(let i=arenaEnemies.length-1;i>=0;i--){
    const e=arenaEnemies[i];
    const dx=player.x-e.x, dist=Math.abs(dx);
    e.vx=Math.sign(dx)*(e.type==='brute'?0.8:1.3);
    e.x+=e.vx; e.animTick++; if(e.animTick%8===0)e.animFrame=(e.animFrame+1)%4;
    e.x=Math.max(0,Math.min(e.x,ARENA_WIDTH-e.w));
    // Enemy shooting
    if(e.gun&&e.shootCooldown>0){e.shootCooldown--;}
    else if(e.gun&&dist<600&&player.invincible===0){
      e.shootCooldown=80+Math.random()*60|0;
      // Shoot at player
      const bx=e.x+(e.vx>0?e.w:0);
      const by=e.y+e.h*0.4;
      bullets.push({x:bx,y:by,vx:Math.sign(dx)*14,vy:0,life:55,underground:false,enemy:true});
    }
    // Melee
    if(dist<32&&Math.abs(e.y-player.y)<50&&player.invincible===0){
      damagePlayer(e.type==='brute'?16:e.type==='knife'?12:7,e.type+' ATTACK');
      spawnParticles(player.x+player.w/2,player.y,'#ef4444',8);
    }
  }
  // Enemy bullets hitting player
  for(let bi=bullets.length-1;bi>=0;bi--){
    const b=bullets[bi];
    if(b.enemy){
      b.x+=b.vx; b.y+=b.vy; b.life--;
      if(b.life<=0){bullets.splice(bi,1);continue;}
      if(b.x>player.x&&b.x<player.x+player.w&&b.y>player.y&&b.y<player.y+player.h&&player.invincible===0){
        damagePlayer(10,'ENEMY BULLET'); bullets.splice(bi,1);
      }
    }
  }
}

function updateArenaPlayerBullets() {
  for(let bi=bullets.length-1;bi>=0;bi--){
    const b=bullets[bi];
    if(b.enemy) continue;
    b.x+=b.vx; b.y+=b.vy; b.life--;
    if(b.life<=0){bullets.splice(bi,1);continue;}
    let hit=false;
    for(let ei=arenaEnemies.length-1;ei>=0;ei--){
      const e=arenaEnemies[ei];
      if(b.x>e.x&&b.x<e.x+e.w&&b.y>e.y&&b.y<e.y+e.h){
        e.hp--; spawnParticles(b.x,b.y,'#ef4444',6); hit=true;
        if(e.hp<=0){
          spawnParticles(e.x+e.w/2,e.y+e.h/2,'#f97316',14);
          arenaEnemies.splice(ei,1); kills++; score+=80;
          arenaEnemiesKilled++;
          showStatus('DOWN! '+(arenaEnemies.length)+' REMAIN');
        }
        break;
      }
    }
    if(hit) bullets.splice(bi,1);
  }
}

function updateBoss(dt) {
  if(!boss||boss.hp<=0) return;
  const gy=groundY();
  if(boss.y<gy-boss.h-2){boss.vy=(boss.vy||0)+GRAVITY;boss.y+=boss.vy;}
  else{boss.y=gy-boss.h-2;boss.vy=0;}

  if(boss.hp<=boss.enrageThreshold&&!boss.enraged){
    boss.enraged=true;
    showStatus('⚠ BOSS ENRAGED! FASTER ATTACKS!');
    spawnParticles(boss.x+boss.w/2,boss.y,'#ef4444',30,{speed:8,life:60});
  }

  const dx=player.x-boss.x, dist=Math.abs(dx);
  const spd=boss.enraged?2.2:1.6;
  if(boss.stunTimer>0){boss.stunTimer--;return;}

  // Approach / movement
  boss.vx=Math.sign(dx)*spd;
  boss.x+=boss.vx;
  boss.x=Math.max(0,Math.min(boss.x,ARENA_WIDTH-boss.w));
  boss.animTick++; if(boss.animTick%6===0)boss.animFrame=(boss.animFrame+1)%4;

  // Dash attack
  boss.dashTimer++;
  if(boss.dashTimer>=(boss.enraged?120:180)){
    boss.dashTimer=0;
    boss.x+=Math.sign(dx)*120; // dash
    spawnParticles(boss.x+boss.w/2,boss.y+boss.h/2,'#ef4444',12,{speed:6,size:4});
    if(dist<120&&player.invincible===0){damagePlayer(20,'BOSS DASH');showStatus('💥 DASH ATTACK!');}
  }

  // Punch attack
  boss.attackTimer++;
  const atkCd=boss.enraged?50:80;
  if(boss.attackTimer>=atkCd&&dist<90){
    boss.attackTimer=0;
    if(player.invincible===0){
      const dmg=boss.enraged?18:12;
      damagePlayer(dmg,'BOSS PUNCH');
      player.vx=Math.sign(player.x-boss.x)*8; player.vy=-7;
      spawnParticles(player.x+player.w/2,player.y,'#dc2626',14,{speed:6});
      showStatus('💥 BOSS PUNCH! -'+dmg+' HP');
    }
  }
}

function updateArenaPhase(dt) {
  arenaWaveTimer+=dt;
  if(arenaPhase==='wave1'){
    if(arenaEnemies.length===0&&arenaEnemiesKilled>=arenaWave1Count){
      arenaPhase='wave2'; arenaEnemiesKilled=0; spawnArenaWave2();
      player.hp=Math.min(player.maxHp,player.hp+30); updateHpUI();
      showStatus('+30 HP BONUS — WAVE 2 INCOMING!');
    }
  } else if(arenaPhase==='wave2'){
    if(arenaEnemies.length===0&&arenaEnemiesKilled>=arenaWave2Count){
      arenaPhase='bossIntro'; arenaEnemiesKilled=0;
      player.hp=Math.min(player.maxHp,player.hp+20); updateHpUI(); player.ammo=player.maxAmmo; updateAmmoUI();
      showStatus('ALL CLEARED! BOSS APPROACHING...');
      setTimeout(()=>{arenaPhase='bossFight';spawnBoss();},3000);
    }
  }
  // Update phase bar
  if(arenaPhase==='wave1') document.getElementById('phaseFill').style.width=(arenaEnemiesKilled/arenaWave1Count*100)+'%';
  else if(arenaPhase==='wave2') document.getElementById('phaseFill').style.width=(arenaEnemiesKilled/arenaWave2Count*100)+'%';
  else if(arenaPhase==='bossFight'&&boss) document.getElementById('phaseFill').style.width=((1-boss.hp/boss.maxHp)*100)+'%';
}

// ═══════════════════════════════════════════════
//  LEVEL TRANSITIONS
// ═══════════════════════════════════════════════
function triggerLevelTransition(completedLevel) {
  gameState='levelTrans';
  document.getElementById('dangerOverlay').className='';
  const el=document.getElementById('lvlTransition');
  if(completedLevel===1){
    document.getElementById('lvtBadge').textContent='LEVEL 1 COMPLETE';
    document.getElementById('lvtTitle').textContent='STREETS SURVIVED';
    document.getElementById('lvtTitle').style.color='#22d3ee';
    document.getElementById('lvtSub').innerHTML='You endured the day/night cycles and the sewers.<br>A motorcycle waits at the checkpoint ahead.<br><span style="color:#ffd700">Ride on. The city still hunts you.</span>';
    document.getElementById('lvtBtn').textContent='GET ON THE BIKE →';
  } else if(completedLevel===2){
    document.getElementById('lvtBadge').textContent='LEVEL 2 COMPLETE';
    document.getElementById('lvtTitle').textContent='RIDE COMPLETE';
    document.getElementById('lvtTitle').style.color='#a3e635';
    document.getElementById('lvtSub').innerHTML='You outran the acid rain and survived the bad roads.<br>The bike breaks down at the arena entrance.<br><span style="color:#ef4444">The final fight awaits. No more guns for long.</span>';
    document.getElementById('lvtBtn').textContent='ENTER THE ARENA →';
  } else if(completedLevel===3){
    // Season end
    gameState='seasonEnd';
    document.getElementById('seScore').textContent=Math.floor(score);
    document.getElementById('seKills').textContent=kills;
    document.getElementById('seDist').textContent=Math.floor(player.distanceTraveled/100)+'m';
    const seEl=document.getElementById('seasonEnd');
    seEl.classList.add('show');
    // Season end canvas effect
    launchSeasonEndParticles();
    return;
  }
  el.classList.add('show');
}

function launchSeasonEndParticles() {
  const colors=['#ffd700','#c4b5fd','#22d3ee','#ef4444','#4ade80','#fbbf24'];
  const int=setInterval(()=>{
    if(gameState!=='seasonEnd'){clearInterval(int);return;}
    for(let i=0;i<5;i++){
      const x=Math.random()*canvas.width, y=Math.random()*canvas.height*0.5;
      spawnParticles(x,y,colors[Math.floor(Math.random()*colors.length)],4,{speed:4+Math.random()*4,life:80+Math.random()*60,size:3+Math.random()*3});
    }
  },60);
}

document.getElementById('lvtBtn').addEventListener('click',()=>{
  const prevLevel=gameLevel;
  gameLevel++;
  document.getElementById('lvlTransition').classList.remove('show');
  gameState='playing';
  if(gameLevel===2){
    generateLevel2();
    updateStageDisplay();
  } else if(gameLevel===3){
    generateLevel3();
    updateStageDisplay();
  }
});

function updateStageDisplay() {
  document.getElementById('stageVal').textContent=gameLevel===1?(dayCount+1+'-1'):(gameLevel===2?'2-BIKE':'3-ARENA');
  const badges=['LEVEL 1','LEVEL 2 — BIKE','LEVEL 3 — ARENA'];
  document.getElementById('levelBadge').textContent=badges[gameLevel-1]||'LEVEL '+gameLevel;
}

// ═══════════════════════════════════════════════
//  HANDLE INPUT
// ═══════════════════════════════════════════════
function handleAction(code) {
  if(player.stunned>0&&code!=='Space') return;
  if(gameLevel===1){
    if((code==='KeyW'||code==='ArrowUp')&&!player.crawling){
      if(player.jumpCount<player.maxJumps&&!player.inManhole){player.vy=-12;player.jumpCount++;player.onGround=false;}
    }
    if(code==='Space') fireBullet();
    if(code==='KeyR'&&!player.reloading){player.reloading=true;player.reloadTimer=90;showStatus('RELOADING...');}
    if(code==='KeyE') tryManhole();
  } else if(gameLevel===2){
    if((code==='KeyW'||code==='ArrowUp')&&player.onGround){player.vy=-12;player.onGround=false;}
    if(code==='Space') fireBullet();
    if(code==='KeyR'&&!player.reloading){player.reloading=true;player.reloadTimer=90;showStatus('RELOADING...');}
  } else if(gameLevel===3){
    if((code==='KeyW'||code==='ArrowUp')&&player.onGround&&player.jumpCount<2){player.vy=-12;player.jumpCount++;player.onGround=false;}
    if(code==='KeyR'&&!player.reloading&&arenaPhase!=='bossFight'){player.reloading=true;player.reloadTimer=90;showStatus('RELOADING...');}
  }
}

// ═══════════════════════════════════════════════
//  GAME FLOW
// ═══════════════════════════════════════════════
function startGame() {
  score=0; kills=0; dayCount=0; gameLevel=1;
  phase='day'; phaseTimer=DAY_DUR; phaseDuration=DAY_DUR;
  bullets=[]; particles=[]; enemies=[];
  generateLevel1(); spawnPlayer(); updateCamera();
  document.getElementById('startScreen').classList.add('hidden');
  document.getElementById('gameOverScreen').classList.add('hidden');
  document.getElementById('seasonEnd').classList.remove('show');
  document.getElementById('lvlTransition').classList.remove('show');
  document.getElementById('timeDisplay').className='day';
  document.getElementById('timeDisplay').textContent='☀ DAY';
  document.getElementById('phaseFill').className='day';
  document.getElementById('bossBar').classList.remove('show');
  document.getElementById('speedBar').classList.remove('show');
  document.getElementById('underground').classList.remove('show');
  document.getElementById('dangerOverlay').className='';
  document.getElementById('phaseCountdown').textContent=DAY_DUR+'s';
  updateStageDisplay();
  updateHpUI(); updateAmmoUI();
  gameState='playing';
}

function doGameOver() {
  gameState='gameover';
  document.getElementById('goScore').textContent=Math.floor(score);
  document.getElementById('goStage').textContent=gameLevel;
  document.getElementById('goKills').textContent=kills;
  document.getElementById('goDistance').textContent=Math.floor(player.distanceTraveled/100)+'m';
  document.getElementById('goCause').textContent=player.deathCause?'CAUSE: '+player.deathCause:'';
  setTimeout(()=>document.getElementById('gameOverScreen').classList.remove('hidden'),1000);
}

// ═══════════════════════════════════════════════
//  DRAW — SHARED SKY
// ═══════════════════════════════════════════════
function drawSky() {
  const w=canvas.width, gy=groundY();
  let skyGrad=ctx.createLinearGradient(0,0,0,gy);
  if(gameLevel===1){
    if(phase==='day'){const t=phaseTimer/DAY_DUR;if(t>0.85||t<0.15){skyGrad.addColorStop(0,'#1a0a2e');skyGrad.addColorStop(0.5,'#7c2d12');skyGrad.addColorStop(1,'#f97316');}else{skyGrad.addColorStop(0,'#075985');skyGrad.addColorStop(0.6,'#0c6490');skyGrad.addColorStop(1,'#7dd3fc');}}
    else if(phase==='night'){skyGrad.addColorStop(0,'#020617');skyGrad.addColorStop(0.5,'#0f0a2e');skyGrad.addColorStop(1,'#1e1b4b');}
    else{skyGrad.addColorStop(0,'#1c0a00');skyGrad.addColorStop(0.4,'#7c2d12');skyGrad.addColorStop(1,'#f97316');}
  } else if(gameLevel===2){
    // Dark stormy sky for bike level
    if(acidRainActive){skyGrad.addColorStop(0,'#0a1a00');skyGrad.addColorStop(0.5,'#1a2e00');skyGrad.addColorStop(1,'#2a3d00');}
    else{skyGrad.addColorStop(0,'#0c1a2e');skyGrad.addColorStop(0.5,'#1a2d4a');skyGrad.addColorStop(1,'#2d3d5a');}
  } else {
    // Arena — red-lit underground arena
    skyGrad.addColorStop(0,'#0a0000');skyGrad.addColorStop(0.5,'#1a0505');skyGrad.addColorStop(1,'#2d0808');
  }
  ctx.fillStyle=skyGrad; ctx.fillRect(0,0,w,gy);

  if(gameLevel===1){
    // Clouds day
    if(phase==='day'){
      const tc=Date.now()/8000;
      for(let ci=0;ci<6;ci++){const cx=((ci*220+tc*30)%(w+300)+w)%w-150,cy=30+ci*25+Math.sin(tc+ci)*10;ctx.fillStyle='rgba(255,255,255,0.12)';ctx.beginPath();ctx.ellipse(cx,cy,60+ci*15,18,0,0,Math.PI*2);ctx.fill();ctx.beginPath();ctx.ellipse(cx+30,cy-10,40,14,0,0,Math.PI*2);ctx.fill();}
    }
    // Stars night
    if(phase==='night'){
      for(let i=0;i<100;i++){const sx=((i*137.508+cam.x*0.05)%w+w)%w,sy=(i*97.3+10)%(gy*0.8),twinkle=0.5+0.5*Math.sin(Date.now()/600+i);ctx.fillStyle=`rgba(255,255,255,${twinkle*0.9})`;ctx.beginPath();ctx.arc(sx,sy,(i%3===0)?1.8:0.9,0,Math.PI*2);ctx.fill();}
      // Moon
      const mx=w*0.78-(cam.x*0.02%(w*0.3)),my=gy*0.18;
      const mg=ctx.createRadialGradient(mx,my,0,mx,my,32);mg.addColorStop(0,'#f1f5f9');mg.addColorStop(1,'#cbd5e1');ctx.fillStyle=mg;ctx.beginPath();ctx.arc(mx,my,28,0,Math.PI*2);ctx.fill();ctx.fillStyle='#0f172a';ctx.beginPath();ctx.arc(mx+10,my-7,22,0,Math.PI*2);ctx.fill();
    } else {
      // Sun
      const sunX=w*(phase==='morning'?0.2:0.75)-(cam.x*0.03%(w*0.5)),sunY=gy*(phase==='morning'?0.45:0.15);
      const g=ctx.createRadialGradient(sunX,sunY,0,sunX,sunY,80);
      g.addColorStop(0,phase==='morning'?'rgba(255,120,0,1)':'rgba(255,220,50,1)');g.addColorStop(0.35,phase==='morning'?'rgba(255,60,0,0.4)':'rgba(255,180,0,0.4)');g.addColorStop(1,'transparent');
      ctx.fillStyle=g;ctx.fillRect(sunX-80,sunY-80,160,160);ctx.fillStyle=phase==='morning'?'#f97316':'#fbbf24';ctx.beginPath();ctx.arc(sunX,sunY,20,0,Math.PI*2);ctx.fill();
    }
  } else if(gameLevel===2){
    // Storm clouds
    const t=Date.now()/3000;
    for(let ci=0;ci<10;ci++){
      const cx=((ci*190+t*20+cam.x*0.1)%(w+400)+w)%w-200;
      const cy=30+ci*18;
      const alpha=acidRainActive?0.7:0.3;
      ctx.fillStyle=`rgba(30,60,20,${alpha})`;
      ctx.beginPath();ctx.ellipse(cx,cy,80+ci*12,22,0,0,Math.PI*2);ctx.fill();
      ctx.beginPath();ctx.ellipse(cx+40,cy-12,50,16,0,0,Math.PI*2);ctx.fill();
    }
    if(!acidRainActive){
      // Lightning occasionally
      if(Math.random()<0.005){
        ctx.strokeStyle='rgba(200,255,150,0.8)';ctx.lineWidth=2;
        ctx.beginPath();const lx=Math.random()*w;ctx.moveTo(lx,0);ctx.lineTo(lx+(Math.random()-0.5)*80,gy*0.6);ctx.stroke();
      }
    }
  } else {
    // Arena — torches
    const t=Date.now()/400;
    for(let i=0;i<12;i++){
      const tx=((i*200-cam.x*0.5)%w+w)%w;
      const tflicker=0.6+0.4*Math.sin(t+i*2.3);
      const tg=ctx.createRadialGradient(tx,gy-80,0,tx,gy-80,50*tflicker);
      tg.addColorStop(0,`rgba(249,115,22,${0.5*tflicker})`);tg.addColorStop(1,'transparent');
      ctx.fillStyle=tg;ctx.fillRect(tx-60,gy-140,120,120);
    }
    // Crowd silhouettes
    for(let i=0;i<30;i++){
      const cx=((i*80-cam.x*0.2)%w+w)%w;
      const cheering=Math.sin(Date.now()/800+i)*8;
      ctx.fillStyle='rgba(0,0,0,0.8)';
      ctx.fillRect(cx-12,gy-100-cheering,24,40);
      ctx.beginPath();ctx.arc(cx,gy-105-cheering,10,0,Math.PI*2);ctx.fill();
    }
  }

  // 3D horizon
  if(view3D){ctx.strokeStyle='rgba(255,255,255,0.06)';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(0,gy*0.72);ctx.lineTo(w,gy*0.72);ctx.stroke();}
}

// ═══════════════════════════════════════════════
//  DRAW — GROUND
// ═══════════════════════════════════════════════
function drawGround() {
  const w=canvas.width, gy=groundY(), scy=sewCeilY();
  if(gameLevel===1){
    // Road surface
    const roadCol=phase==='night'?'#1a2e22':phase==='morning'?'#2a1a0a':'#374151';
    ctx.fillStyle=roadCol; ctx.fillRect(0,gy,w,12);
    ctx.strokeStyle='rgba(255,255,255,0.07)';ctx.lineWidth=2;ctx.setLineDash([30,20]);
    ctx.beginPath();ctx.moveTo(0,gy+6);ctx.lineTo(w,gy+6);ctx.stroke();ctx.setLineDash([]);
    // Dirt
    const dg=ctx.createLinearGradient(0,gy+12,0,scy);
    dg.addColorStop(0,'#2d1e0e');dg.addColorStop(0.5,'#1f1508');dg.addColorStop(1,'#150e05');
    ctx.fillStyle=dg;ctx.fillRect(0,gy+12,w,scy-gy-12);
    // Stone texture
    ctx.strokeStyle='rgba(0,0,0,0.2)';ctx.lineWidth=1;
    for(let xi=(-cam.x%50);xi<w;xi+=50){ctx.beginPath();ctx.moveTo(xi,gy+14);ctx.lineTo(xi,scy);ctx.stroke();}
    // Lamp posts
    world.lampPosts.forEach(lp=>{
      const lx=lp.x-cam.x;if(lx<-30||lx>w+30) return;
      ctx.fillStyle='#374151';ctx.fillRect(lx-3,gy-80,6,80);
      ctx.fillStyle='#4b5563';ctx.fillRect(lx-3,gy-80,20,5);
      const lg=ctx.createRadialGradient(lx+17,gy-77,0,lx+17,gy-77,40);
      const lc=phase==='night'?'rgba(139,92,246,0.25)':phase==='morning'?'rgba(249,115,22,0.18)':'rgba(253,224,71,0.12)';
      lg.addColorStop(0,lc);lg.addColorStop(1,'transparent');
      ctx.fillStyle=lg;ctx.fillRect(lx-20,gy-120,80,80);
      ctx.fillStyle=phase==='night'?'rgba(253,224,71,0.9)':'rgba(253,224,71,0.5)';
      ctx.beginPath();ctx.arc(lx+17,gy-77,5,0,Math.PI*2);ctx.fill();
    });
    // Crates
    world.crates.forEach(c=>{
      const cx=c.x-cam.x;if(cx<-40||cx>w+40) return;
      const cW=28,cH=c.h;
      ctx.fillStyle='#92400e';ctx.fillRect(cx,gy-cH,cW,cH);
      ctx.fillStyle='#78350f';ctx.strokeStyle='#451a03';ctx.lineWidth=2;
      ctx.strokeRect(cx,gy-cH,cW,cH);
      ctx.strokeRect(cx+cW/2-1,gy-cH,2,cH);ctx.strokeRect(cx,gy-cH/2,cW,2);
      ctx.fillStyle='rgba(255,255,255,0.05)';ctx.fillRect(cx+2,gy-cH+2,cW-4,cH/3);
    });
    // Manholes
    world.manholes.forEach(m=>{
      const mx=m.x-cam.x;if(mx<-30||mx>w+30) return;
      ctx.fillStyle='#4b5563';ctx.beginPath();ctx.ellipse(mx,gy+5,18,5,0,0,Math.PI*2);ctx.fill();
      ctx.fillStyle=phase==='night'?'#1a0a2e':phase==='morning'?'#3a1a0a':'#374151';
      ctx.beginPath();ctx.ellipse(mx,gy+4,16,4,0,0,Math.PI*2);ctx.fill();
      ctx.fillStyle='#6b7280';ctx.lineWidth=1.5;
      for(let ri=0;ri<4;ri++){const ra=ri*Math.PI/4;ctx.beginPath();ctx.moveTo(mx+Math.cos(ra)*4,gy+4+Math.sin(ra)*1.5);ctx.lineTo(mx+Math.cos(ra)*14,gy+4+Math.sin(ra)*4);ctx.strokeStyle='#374151';ctx.stroke();}
      const near=Math.abs(m.x-player.x)<50&&!player.underground;
      if(near){ctx.strokeStyle=phase==='night'?'#ef4444':'#10b981';ctx.lineWidth=2;ctx.beginPath();ctx.ellipse(mx,gy+4,19,6,0,0,Math.PI*2);ctx.stroke();ctx.fillStyle='rgba(255,255,255,0.9)';ctx.font='bold 11px Share Tech Mono';ctx.textAlign='center';ctx.fillText('[E]',mx,gy-8);}
    });
    // Surface traps
    drawLevel1Traps();
    // Ammo & HP pickups
    drawPickups();
  } else if(gameLevel===2){
    drawBikeRoad();
  } else if(gameLevel===3){
    drawArenaFloor();
  }
}

function drawLevel1Traps() {
  const w=canvas.width, gy=groundY();
  world.traps.filter(t=>['bear','spike','gas','crusher','flame'].includes(t.type)).forEach(t=>{
    const txP=t.x-cam.x; if(txP<-80||txP>w+80) return;
    const ty=gy; const onlyMorning=phase==='morning';
    if(t.type==='bear'){
      const col=t.triggered?'rgba(100,100,100,0.6)':'#374151';
      ctx.fillStyle=col;ctx.beginPath();ctx.arc(txP,ty-4,12,0,Math.PI);ctx.fill();
      ctx.strokeStyle=t.triggered?'#6b7280':'#ef4444';ctx.lineWidth=2;
      ctx.beginPath();ctx.moveTo(txP-12,ty-4);ctx.lineTo(txP-8,ty-10);ctx.moveTo(txP-6,ty-4);ctx.lineTo(txP-4,ty-10);ctx.moveTo(txP+4,ty-4);ctx.lineTo(txP+6,ty-10);ctx.moveTo(txP+8,ty-4);ctx.lineTo(txP+12,ty-10);ctx.stroke();
      if(!onlyMorning&&!t.triggered){ctx.fillStyle='rgba(249,115,22,0.15)';ctx.beginPath();ctx.arc(txP,ty-4,20,0,Math.PI*2);ctx.fill();}
    } else if(t.type==='spike'){
      const sxC=t.x-cam.x;
      ctx.fillStyle='#111';ctx.fillRect(sxC,gy-8,t.w,8);
      ctx.fillStyle='#6b7280';
      const spikeCnt=Math.floor(t.w/10);
      for(let si=0;si<spikeCnt;si++){const sx=sxC+si*10+5;ctx.beginPath();ctx.moveTo(sx-4,gy);ctx.lineTo(sx,gy-18);ctx.lineTo(sx+4,gy);ctx.fill();}
      ctx.strokeStyle='rgba(239,68,68,0.8)';ctx.lineWidth=2;ctx.setLineDash([4,4]);ctx.strokeRect(sxC-2,gy-20,t.w+4,20);ctx.setLineDash([]);
    } else if(t.type==='gas'){
      ctx.fillStyle='#374151';ctx.fillRect(txP-12,ty,24,8);
      if(t.active){const cl=t.cloudLife/140;const cg=ctx.createRadialGradient(txP,gy-35,0,txP,gy-35,65*cl);cg.addColorStop(0,`rgba(74,222,128,${0.4*cl})`);cg.addColorStop(1,'transparent');ctx.fillStyle=cg;ctx.fillRect(txP-75,gy-110,150,110);}
    } else if(t.type==='crusher'){
      const cH=t.crushY||0;
      ctx.fillStyle='#374151';ctx.fillRect(txP-20,gy-90,40,12);ctx.fillRect(txP-16,gy-90+12,32,cH);
      ctx.fillStyle='#4b5563';ctx.fillRect(txP-18,gy-90+8+cH,36,14);
      ctx.strokeStyle='rgba(239,68,68,0.6)';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(txP-10,gy-80);ctx.lineTo(txP-10,gy-90+12+cH);ctx.stroke();ctx.beginPath();ctx.moveTo(txP+10,gy-80);ctx.lineTo(txP+10,gy-90+12+cH);ctx.stroke();
    } else if(t.type==='flame'){
      ctx.fillStyle='#374151';ctx.fillRect(txP-8,ty,16,8);
      if(t.active){const fl=t.flameLife/70,t2=Date.now()/200;for(let fi=0;fi<8;fi++){const fh=(20+fi*12)*fl,fw=(6-fi*0.5)*fl,fx=txP+Math.sin(t2+fi*0.7)*3,c1=fi<3?'#fff':(fi<5?'#fef08a':(fi<7?'#f97316':'#dc2626'));ctx.fillStyle=c1;ctx.globalAlpha=fl*(1-fi/10);ctx.beginPath();ctx.ellipse(fx,gy-fh,fw,fh*0.3,0,0,Math.PI*2);ctx.fill();}ctx.globalAlpha=1;}
    }
  });
}

function drawPickups() {
  const gy=groundY();
  world.ammoPickups.filter(a=>!a.underground&&!a.collected).forEach(a=>{
    const ax=a.x-cam.x;if(ax<-30||ax>canvas.width+30) return;
    const ay=gy-22;const t=Date.now()/600;
    ctx.fillStyle='#1d4ed8';ctx.fillRect(ax-8,ay+Math.sin(t+ax)*3,16,18);
    ctx.fillStyle='#93c5fd';ctx.fillRect(ax-5,ay+4+Math.sin(t+ax)*3,10,3);ctx.fillRect(ax-5,ay+9+Math.sin(t+ax)*3,10,2);ctx.fillRect(ax-5,ay+14+Math.sin(t+ax)*3,10,3);
    const g=ctx.createRadialGradient(ax,ay+10,0,ax,ay+10,18);g.addColorStop(0,'rgba(59,130,246,0.35)');g.addColorStop(1,'transparent');ctx.fillStyle=g;ctx.fillRect(ax-20,ay-10,40,40);
  });
  world.healthPacks.filter(h=>!h.underground&&!h.collected).forEach(h=>{
    const ax=h.x-cam.x;if(ax<-30||ax>canvas.width+30) return;
    const ay=gy-24;const t=Date.now()/600;
    ctx.fillStyle='#dc2626';ctx.fillRect(ax-10,ay+Math.sin(t+ax)*3,20,20);
    ctx.fillStyle='#fca5a5';ctx.fillRect(ax-2,ay+4+Math.sin(t+ax)*3,4,12);ctx.fillRect(ax-6,ay+8+Math.sin(t+ax)*3,12,4);
    const g=ctx.createRadialGradient(ax,ay+10,0,ax,ay+10,18);g.addColorStop(0,'rgba(239,68,68,0.3)');g.addColorStop(1,'transparent');ctx.fillStyle=g;ctx.fillRect(ax-20,ay-8,40,36);
  });
  // Checkpoint sign (level 1)
  if(world.checkpointX){
    const cx=world.checkpointX-cam.x;if(cx>-100&&cx<canvas.width+100){
      const gy2=groundY();
      ctx.fillStyle='#fbbf24';ctx.fillRect(cx-2,gy2-120,4,120);
      ctx.fillStyle='#fbbf24';ctx.fillRect(cx,gy2-120,80,30);
      ctx.fillStyle='#000';ctx.font='bold 10px Orbitron,monospace';ctx.textAlign='left';ctx.fillText('CHECKPOINT',cx+4,gy2-100);
      ctx.setLineDash([8,8]);ctx.strokeStyle='#fbbf24';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(cx,gy2);ctx.lineTo(cx,gy2-160);ctx.stroke();ctx.setLineDash([]);
    }
  }
}

function drawBikeRoad() {
  const w=canvas.width, gy=groundY();
  // Road
  const roadGrad=ctx.createLinearGradient(0,gy-5,0,gy+80);
  roadGrad.addColorStop(0,acidRainActive?'#1a2200':'#374151');
  roadGrad.addColorStop(1,acidRainActive?'#0a1500':'#1f2937');
  ctx.fillStyle=roadGrad; ctx.fillRect(0,gy-5,w,80);
  // Road markings
  ctx.strokeStyle='rgba(255,255,255,0.15)'; ctx.lineWidth=3; ctx.setLineDash([40,25]);
  ctx.beginPath(); ctx.moveTo(0,gy+15); ctx.lineTo(w,gy+15); ctx.stroke(); ctx.setLineDash([]);
  // Road shoulder lines
  ctx.strokeStyle='rgba(255,200,0,0.3)'; ctx.lineWidth=2;
  ctx.beginPath(); ctx.moveTo(0,gy-2); ctx.lineTo(w,gy-2); ctx.stroke();

  // Road cracks
  bikeWorld.roadCracks.forEach(c=>{
    const cx=c.x-cam.x;if(cx<-20||cx>w+20) return;
    ctx.strokeStyle='rgba(0,0,0,0.6)'; ctx.lineWidth=1.5;
    ctx.beginPath(); ctx.moveTo(cx,gy); ctx.lineTo(cx+10+Math.random()*15,gy+8); ctx.lineTo(cx+5,gy+16); ctx.stroke();
  });
  // Potholes
  bikeWorld.potholes.forEach(p=>{
    const px=p.x-cam.x;if(px<-60||px>w+60) return;
    ctx.fillStyle='#111'; ctx.beginPath(); ctx.ellipse(px+p.w/2,gy+5,p.w/2,p.depth/2,0,0,Math.PI*2); ctx.fill();
    ctx.strokeStyle='rgba(239,68,68,0.6)'; ctx.lineWidth=1.5; ctx.setLineDash([4,3]);
    ctx.beginPath(); ctx.ellipse(px+p.w/2,gy+5,p.w/2+4,p.depth/2+3,0,0,Math.PI*2); ctx.stroke(); ctx.setLineDash([]);
  });
  // Road bumps
  bikeWorld.roadBumps.forEach(b=>{
    const bx=b.x-cam.x;if(bx<-30||bx>w+30) return;
    ctx.fillStyle='#4b5563';
    ctx.beginPath(); ctx.ellipse(bx,gy,25,b.h,0,0,Math.PI,true); ctx.fill();
    ctx.strokeStyle='rgba(249,115,22,0.5)'; ctx.lineWidth=1; ctx.beginPath(); ctx.ellipse(bx,gy,28,b.h+3,0,0,Math.PI,true); ctx.stroke();
  });
  // Cover zones (tunnels/overhangs)
  bikeWorld.coverZones.forEach(c=>{
    const cx=c.x-cam.x;if(cx<-220||cx>w+220) return;
    // Overhang structure
    const coverGrad=ctx.createLinearGradient(cx,gy-120,cx,gy-20);
    coverGrad.addColorStop(0,'#1f2937'); coverGrad.addColorStop(1,'#374151');
    ctx.fillStyle=coverGrad; ctx.fillRect(cx,gy-120,c.w,20);
    ctx.fillStyle='#111'; ctx.fillRect(cx,gy-120,8,100); ctx.fillRect(cx+c.w-8,gy-120,8,100);
    ctx.fillStyle='rgba(0,0,0,0.4)'; ctx.fillRect(cx,gy-100,c.w,80);
    // Cover indicator
    ctx.fillStyle='rgba(34,211,238,0.2)'; ctx.fillRect(cx,gy-5,c.w,5);
    ctx.fillStyle='rgba(34,211,238,0.6)'; ctx.font='8px Share Tech Mono'; ctx.textAlign='center'; ctx.fillText('SHELTER',cx+c.w/2,gy-108);
  });
  // Pickups
  bikeWorld.healthPacks.filter(h=>!h.collected).forEach(h=>{
    const ax=h.x-cam.x;if(ax<-30||ax>w+30) return;
    const ay=gy-28; const t=Date.now()/600;
    ctx.fillStyle='#dc2626'; ctx.fillRect(ax-10,ay+Math.sin(t+ax)*3,20,20);
    ctx.fillStyle='#fca5a5'; ctx.fillRect(ax-2,ay+4+Math.sin(t+ax)*3,4,12); ctx.fillRect(ax-6,ay+8+Math.sin(t+ax)*3,12,4);
  });
  bikeWorld.ammoPickups.filter(a=>!a.collected).forEach(a=>{
    const ax=a.x-cam.x;if(ax<-30||ax>w+30) return;
    const ay=gy-26; const t=Date.now()/600;
    ctx.fillStyle='#1d4ed8'; ctx.fillRect(ax-8,ay+Math.sin(t+ax)*3,16,18);
    ctx.fillStyle='#93c5fd'; ctx.fillRect(ax-5,ay+5+Math.sin(t+ax)*3,10,3);
  });
  // Destination
  const destX=(bikeWorld.checkpointX||LEVEL2_LEN-600)-cam.x;
  if(destX>-100&&destX<w+100){
    const t=Date.now()/300;
    ctx.strokeStyle=`rgba(34,211,238,${0.5+0.5*Math.sin(t)})`; ctx.lineWidth=4;
    ctx.setLineDash([12,6]);ctx.beginPath();ctx.moveTo(destX,gy-180);ctx.lineTo(destX,gy);ctx.stroke();ctx.setLineDash([]);
    ctx.fillStyle='#22d3ee';ctx.fillRect(destX,gy-180,100,30);ctx.fillStyle='#000';ctx.font='bold 11px Orbitron,monospace';ctx.textAlign='left';ctx.fillText('ARENA',destX+6,gy-158);
  }

  // Acid rain drops
  acidRainDrops.forEach(d=>{
    if(d.splash){
      ctx.globalAlpha=d.splashTimer/8;ctx.fillStyle='#84cc16';ctx.beginPath();ctx.ellipse(d.x-cam.x,groundY(),8,3,0,0,Math.PI*2);ctx.fill();ctx.globalAlpha=1;
    } else {
      ctx.strokeStyle='rgba(132,204,22,0.7)';ctx.lineWidth=1.5;
      ctx.beginPath();ctx.moveTo(d.x-cam.x,d.y);ctx.lineTo(d.x-cam.x+d.vx*2,d.y+10);ctx.stroke();
    }
  });

  // Acid rain overlay
  if(acidRainActive){
    const ag=ctx.createLinearGradient(0,0,0,gy);ag.addColorStop(0,'rgba(100,160,20,0.08)');ag.addColorStop(1,'transparent');
    ctx.fillStyle=ag;ctx.fillRect(0,0,w,gy);
  }
}

function drawArenaFloor() {
  const w=canvas.width, gy=groundY();
  // Arena stone floor
  const floorGrad=ctx.createLinearGradient(0,gy,0,gy+60);
  floorGrad.addColorStop(0,'#2d1a1a');floorGrad.addColorStop(1,'#1a0a0a');
  ctx.fillStyle=floorGrad; ctx.fillRect(0,gy,w,60);
  // Stone tiles
  ctx.strokeStyle='rgba(0,0,0,0.4)'; ctx.lineWidth=1;
  const tileW=64, tileH=32;
  const offX=cam.x%tileW;
  for(let tx=-offX;tx<w;tx+=tileW){
    for(let ty=0;ty<40;ty+=tileH){
      ctx.strokeRect(tx,gy+ty,tileW,tileH);
      ctx.fillStyle=`rgba(60,20,20,${0.02+((Math.floor(tx/tileW)+Math.floor(ty/tileH))%2)*0.03})`;
      ctx.fillRect(tx+1,gy+ty+1,tileW-2,tileH-2);
    }
  }
  // Blood stains (arena flavor)
  [200,700,1200,1800,2000].forEach(bx=>{
    const sx=bx-cam.x;if(sx<-80||sx>w+80) return;
    ctx.fillStyle='rgba(100,0,0,0.3)';ctx.beginPath();ctx.ellipse(sx,gy+5,20+Math.sin(bx)*10,8,Math.sin(bx)*0.5,0,Math.PI*2);ctx.fill();
  });
  // Arena walls
  const wallGrad=ctx.createLinearGradient(0,gy-200,0,gy);wallGrad.addColorStop(0,'#1a0808');wallGrad.addColorStop(1,'#3d1515');
  ctx.fillStyle=wallGrad;ctx.fillRect(0,0,w,gy);
  // Torch lights on walls
  const t=Date.now()/500;
  for(let i=0;i<8;i++){
    const tx=((i*280-cam.x*0.3)%w+w)%w;
    const fl=0.6+0.4*Math.sin(t+i*1.7);
    const tg=ctx.createRadialGradient(tx,gy-60,0,tx,gy-60,50*fl);
    tg.addColorStop(0,`rgba(249,115,22,${0.6*fl})`);tg.addColorStop(0.5,`rgba(220,38,38,${0.3*fl})`);tg.addColorStop(1,'transparent');
    ctx.fillStyle=tg;ctx.fillRect(tx-60,gy-120,120,120);
    // Torch stick
    ctx.fillStyle='#6b3a1f';ctx.fillRect(tx-3,gy-90,6,40);
    ctx.fillStyle='#f97316';ctx.globalAlpha=fl;ctx.beginPath();ctx.ellipse(tx,gy-90,5,12,0,0,Math.PI*2);ctx.fill();ctx.globalAlpha=1;
  }
  // Health pickups in arena
  [600,1200].forEach(hx=>{
    const hxS=hx-cam.x;if(hxS<-30||hxS>w+30) return;
    const hy=gy-24;const t2=Date.now()/600;
    ctx.fillStyle='#dc2626';ctx.fillRect(hxS-10,hy+Math.sin(t2)*3,20,20);
    ctx.fillStyle='#fca5a5';ctx.fillRect(hxS-2,hy+4+Math.sin(t2)*3,4,12);ctx.fillRect(hxS-6,hy+8+Math.sin(t2)*3,12,4);
    const g=ctx.createRadialGradient(hxS,hy+10,0,hxS,hy+10,20);g.addColorStop(0,'rgba(239,68,68,0.3)');g.addColorStop(1,'transparent');
    ctx.fillStyle=g;ctx.fillRect(hxS-22,hy-8,44,38);
    if(Math.abs(hx-player.x)<30&&Math.abs(hy-player.y)<36){
      player.hp=Math.min(player.maxHp,player.hp+20);updateHpUI();showStatus('+20 HP');spawnParticles(hx,hy,'#ef4444',8);
    }
  });
}

// ═══════════════════════════════════════════════
//  DRAW — SEWER (Level 1)
// ═══════════════════════════════════════════════
function drawSewer() {
  if(gameLevel!==1) return;
  const w=canvas.width, gy=groundY(), sfy=sewFloorY(), scy=sewCeilY(), sewH=sfy-scy;
  // Tunnel
  const wallGrad=ctx.createLinearGradient(0,scy,0,sfy);wallGrad.addColorStop(0,'#1a1208');wallGrad.addColorStop(0.3,'#231a0e');wallGrad.addColorStop(1,'#110c06');
  ctx.fillStyle=wallGrad;ctx.fillRect(0,scy,w,sewH);
  // Brick
  const brickW=48,brickH=16;ctx.strokeStyle='rgba(0,0,0,0.35)';ctx.lineWidth=1;
  for(let row=0;row<sewH/brickH+1;row++){const offX=(row%2===0)?0:brickW/2;for(let col=-1;col<w/brickW+2;col++){const bx=col*brickW+offX-(cam.x*0.1%brickW),by=scy+row*brickH;ctx.strokeRect(bx,by,brickW,brickH);const shade=0.03+((row*7+col*13)%5)*0.008;ctx.fillStyle=`rgba(60,40,20,${shade})`;ctx.fillRect(bx+1,by+1,brickW-2,brickH-2);}}
  // Sewage
  const sewageH=28;const sewGrad=ctx.createLinearGradient(0,sfy-sewageH,0,sfy);sewGrad.addColorStop(0,'#1a3a1a');sewGrad.addColorStop(1,'#142c10');ctx.fillStyle=sewGrad;ctx.fillRect(0,sfy-sewageH,w,sewageH+(canvas.height-sfy));
  // Ripples
  const t=Date.now()/1000;ctx.strokeStyle='rgba(50,120,30,0.3)';ctx.lineWidth=1.5;
  for(let i=0;i<10;i++){const rx=((i*180-cam.x*0.2+t*20*(i%2===0?1:-1))%(w+200)+w)%w-100;ctx.beginPath();ctx.moveTo(rx,sfy-sewageH+4);ctx.bezierCurveTo(rx+30,sfy-sewageH+2,rx+60,sfy-sewageH+6,rx+90,sfy-sewageH+3);ctx.stroke();}
  // Glow
  const sg=ctx.createLinearGradient(0,sfy-sewageH-40,0,sfy-sewageH);sg.addColorStop(0,'transparent');sg.addColorStop(1,'rgba(30,90,20,0.25)');ctx.fillStyle=sg;ctx.fillRect(0,sfy-sewageH-40,w,40);
  // Pipes
  world.sewPipes.forEach(p=>{const px=p.x-cam.x;if(px<-60||px>w+60) return;ctx.fillStyle='#374151';ctx.fillRect(px-9,scy,18,22);ctx.fillStyle='#1f2937';ctx.fillRect(px-11,scy+18,22,7);p.drip+=p.dripSpeed;if(p.drip>100)p.drip=0;const dripY=scy+25+(p.drip*0.7);if(p.drip<80){ctx.fillStyle='rgba(40,120,30,0.7)';ctx.beginPath();ctx.ellipse(px,dripY,2.5,3+p.drip*0.04,0,0,Math.PI*2);ctx.fill();}});
  // Rats
  world.sewRats.forEach(r=>{
    const rx=r.x-cam.x;if(rx<-30||rx>w+30) return;
    const ry=sfy-sewageH-10,facing=r.vx>0?1:-1;
    ctx.save();ctx.translate(rx,ry);ctx.scale(facing,1);
    ctx.fillStyle='#4b3728';ctx.beginPath();ctx.ellipse(0,0,9,6,0,0,Math.PI*2);ctx.fill();
    ctx.fillStyle='#5c4535';ctx.beginPath();ctx.ellipse(9,0,6,5,0,0,Math.PI*2);ctx.fill();
    ctx.fillStyle='#ef4444';ctx.beginPath();ctx.arc(12,-1.5,1.5,0,Math.PI*2);ctx.fill();
    ctx.strokeStyle='#6b4c35';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(-9,0);ctx.quadraticCurveTo(-18,5,-14,10);ctx.stroke();
    ctx.restore();
  });
  // Underground ammo & hp
  world.ammoPickups.filter(a=>a.underground&&!a.collected).forEach(a=>{
    const ax=a.x-cam.x;if(ax<-30||ax>w+30) return;
    const ay=sfy-sewageH-28;ctx.fillStyle='#1d4ed8';ctx.fillRect(ax-8,ay,16,18);
    ctx.fillStyle='#93c5fd';ctx.fillRect(ax-5,ay+4,10,3);ctx.fillRect(ax-5,ay+9,10,2);ctx.fillRect(ax-5,ay+14,10,3);
  });
  world.healthPacks.filter(h=>h.underground&&!h.collected).forEach(h=>{
    const ax=h.x-cam.x;if(ax<-30||ax>w+30) return;
    const ay=sfy-sewageH-30;ctx.fillStyle='#dc2626';ctx.fillRect(ax-10,ay,20,20);ctx.fillStyle='#fca5a5';ctx.fillRect(ax-2,ay+4,4,12);ctx.fillRect(ax-6,ay+8,12,4);
  });
  // Manhole shafts from below
  world.manholes.forEach(m=>{
    const mx=m.x-cam.x;if(mx<-60||mx>w+60) return;
    const shaftGrad=ctx.createLinearGradient(0,scy,0,scy+55);shaftGrad.addColorStop(0,'rgba(200,180,100,0.25)');shaftGrad.addColorStop(1,'transparent');ctx.fillStyle=shaftGrad;ctx.fillRect(mx-20,scy,40,55);ctx.fillStyle='#374151';ctx.fillRect(mx-20,scy,40,7);
    const near=player.underground&&Math.abs(m.x-player.x)<50;
    if(near){ctx.strokeStyle=phase==='night'?'#ef4444':'#10b981';ctx.lineWidth=2;ctx.strokeRect(mx-22,scy-1,44,9);ctx.fillStyle='#fff';ctx.font='bold 11px Share Tech Mono';ctx.textAlign='center';ctx.fillText('[E]',mx,scy-8);}
  });
  // Ceiling arch
  ctx.strokeStyle='rgba(0,0,0,0.5)';ctx.lineWidth=3;for(let ax=(-cam.x*0.1%120);ax<w+120;ax+=120){ctx.beginPath();ctx.moveTo(ax,scy);ctx.quadraticCurveTo(ax+60,scy+35,ax+120,scy);ctx.stroke();}
  // Electric/gas traps
  world.traps.filter(tr=>tr.type==='sewelectric').forEach(trap=>{
    const tx=trap.x-cam.x;if(tx<-80||tx>w+80) return;
    const ty=sfy-sewageH;ctx.fillStyle=trap.active?'rgba(253,224,71,0.4)':'rgba(253,224,71,0.08)';ctx.fillRect(tx,ty,trap.w,sewageH);
    if(trap.active){ctx.strokeStyle='rgba(253,224,71,0.8)';ctx.lineWidth=1.5;for(let zi=0;zi<3;zi++){ctx.beginPath();ctx.moveTo(tx+zi*(trap.w/3),ty);for(let zs=1;zs<6;zs++)ctx.lineTo(tx+zi*(trap.w/3)+(Math.random()-0.5)*12,ty+zs*(sewageH/6));ctx.stroke();}}
  });
  world.traps.filter(tr=>tr.type==='sewgas').forEach(trap=>{
    const tx=trap.x-cam.x;if(tx<-80||tx>w+80) return;
    if(trap.active){const cg=ctx.createRadialGradient(tx,sfy-sewageH-20,0,tx,sfy-sewageH-20,50*(trap.life/120));cg.addColorStop(0,`rgba(74,222,128,${0.3*(trap.life/120)})`);cg.addColorStop(1,'transparent');ctx.fillStyle=cg;ctx.fillRect(tx-60,sfy-sewageH-70,120,70);}
  });
}

// ═══════════════════════════════════════════════
//  DRAW — PLAYER
// ═══════════════════════════════════════════════
function drawPlayer() {
  const px=player.x-cam.x, py=player.y, h=player.h, pw=player.w;
  if(player.invincible>0&&Math.floor(player.invincible/4)%2===0) return;
  const feetY=py+h;
  const cxS=view3D?projectX(player.x+pw/2,feetY):px+pw/2;
  const cyS=view3D?projectY(feetY):feetY;
  const sc=(h/36)*(view3D?0.92:1);
  ctx.save(); ctx.translate(cxS,cyS);
  if(player.facing===-1) ctx.scale(-1,1);
  if(player.onFire>0){ctx.shadowColor='#f97316';ctx.shadowBlur=16;}
  if(player.poisoned>0){ctx.shadowColor='#4ade80';ctx.shadowBlur=10;}
  if(player.stunned>0){ctx.shadowColor='#fbbf24';ctx.shadowBlur=12;}

  const skinTone='#e8a882';
  const walkCycle=Math.sin(player.animFrame*1.6);
  const breathe=Math.sin(Date.now()/600)*(player.onGround?0.5:0);

  if(gameLevel===2&&player.onBike) {
    // Draw player sitting on bike
    // Legs bent
    ctx.fillStyle='#2d3748';ctx.beginPath();ctx.roundRect(-10*sc,-10*sc,10*sc,14*sc,2*sc);ctx.fill();
    ctx.beginPath();ctx.roundRect(0*sc,-10*sc,10*sc,14*sc,2*sc);ctx.fill();
    // Torso
    ctx.fillStyle='#1e3a5f';ctx.beginPath();ctx.roundRect(-8*sc,-28*sc,16*sc,20*sc,[2*sc,2*sc,4*sc,4*sc]);ctx.fill();
    // Head with helmet
    ctx.fillStyle='#1a1a1a';ctx.beginPath();ctx.roundRect(-8*sc,-44*sc,16*sc,14*sc,[4*sc,4*sc,1*sc,1*sc]);ctx.fill();
    ctx.fillStyle=skinTone;ctx.beginPath();ctx.roundRect(-6*sc,-38*sc,12*sc,9*sc,2*sc);ctx.fill();
    ctx.fillStyle='rgba(0,200,255,0.6)';ctx.fillRect(-7*sc,-44*sc,14*sc,5*sc); // visor
    // Arms forward
    ctx.fillStyle='#3b5a8a';ctx.beginPath();ctx.roundRect(5*sc,-24*sc,12*sc,8*sc,2*sc);ctx.fill();
  } else if(!player.crawling) {
    // Back arm
    const bArmSwing=walkCycle*10*(player.onGround?1:0);
    ctx.save();ctx.translate(-3*sc,-22*sc+breathe);ctx.rotate((bArmSwing-10)*Math.PI/180);
    ctx.fillStyle='#3b5a8a';ctx.beginPath();ctx.roundRect(-3*sc,0,6*sc,10*sc,2*sc);ctx.fill();
    ctx.fillStyle=skinTone;ctx.beginPath();ctx.roundRect(-2.5*sc,10*sc,5*sc,8*sc,2*sc);ctx.fill();ctx.restore();
    // Legs
    const lLS=walkCycle*14,rLS=-walkCycle*14;
    ctx.save();ctx.translate(-4*sc,-14*sc);ctx.rotate(lLS*Math.PI/180);ctx.fillStyle='#2d3748';ctx.beginPath();ctx.roundRect(-4*sc,0,8*sc,9*sc,2*sc);ctx.fill();ctx.translate(0,9*sc);ctx.rotate(Math.max(0,-lLS*0.5)*Math.PI/180);ctx.fillStyle='#1a202c';ctx.beginPath();ctx.roundRect(-3.5*sc,0,7*sc,8*sc,2*sc);ctx.fill();ctx.fillStyle='#111';ctx.beginPath();ctx.roundRect(-4*sc,7*sc,9*sc,4*sc,1*sc);ctx.fill();ctx.restore();
    ctx.save();ctx.translate(4*sc,-14*sc);ctx.rotate(rLS*Math.PI/180);ctx.fillStyle='#374151';ctx.beginPath();ctx.roundRect(-4*sc,0,8*sc,9*sc,2*sc);ctx.fill();ctx.translate(0,9*sc);ctx.rotate(Math.max(0,rLS*0.5)*Math.PI/180);ctx.fillStyle='#1f2937';ctx.beginPath();ctx.roundRect(-3.5*sc,0,7*sc,8*sc,2*sc);ctx.fill();ctx.fillStyle='#111';ctx.beginPath();ctx.roundRect(-4*sc,7*sc,9*sc,4*sc,1*sc);ctx.fill();ctx.restore();
    // Torso
    const torsoY=-32*sc+breathe;
    ctx.fillStyle=player.underground?'#1e3a5f':(gameLevel===3?'#3d1515':'#2d4a7a');
    ctx.beginPath();ctx.roundRect(-8*sc,torsoY,16*sc,18*sc,[2*sc,2*sc,4*sc,4*sc]);ctx.fill();
    ctx.fillStyle='#92400e';ctx.fillRect(-8*sc,torsoY+15*sc,16*sc,3*sc);ctx.fillStyle='#d97706';ctx.fillRect(-2*sc,torsoY+15*sc,4*sc,3*sc);
    // Head
    ctx.fillStyle=skinTone;ctx.fillRect(-3*sc,torsoY-4*sc,6*sc,5*sc);
    const headY=torsoY-16*sc;
    ctx.fillStyle='#1a1a1a';ctx.beginPath();ctx.roundRect(-8*sc,headY-2*sc,16*sc,8*sc,[4*sc,4*sc,0,0]);ctx.fill();
    ctx.fillStyle=skinTone;ctx.beginPath();ctx.roundRect(-7*sc,headY+4*sc,14*sc,11*sc,[2*sc,2*sc,3*sc,3*sc]);ctx.fill();
    ctx.fillStyle='#fff';ctx.fillRect(1*sc,headY+6*sc,5*sc,4*sc);ctx.fillStyle='#1a1a2e';ctx.fillRect(2*sc,headY+7*sc,3*sc,3*sc);ctx.fillStyle='#fff';ctx.fillRect(3*sc,headY+7*sc,1*sc,1*sc);
    ctx.fillStyle='#7c3a2d';ctx.fillRect(1*sc,headY+13*sc,5*sc,2*sc);
    if(phase==='night'||player.underground){ctx.fillStyle='#15803d';ctx.beginPath();ctx.ellipse(4*sc,headY+6*sc,4*sc,3*sc,0,0,Math.PI*2);ctx.fill();ctx.fillStyle='#4ade80';ctx.beginPath();ctx.ellipse(4*sc,headY+6*sc,2.5*sc,2*sc,0,0,Math.PI*2);ctx.fill();}
    // Gun arm
    if(gameLevel!==3||arenaPhase!=='bossFight'){
      ctx.save();ctx.translate(8*sc,-22*sc+breathe);
      ctx.fillStyle='#3b5a8a';ctx.beginPath();ctx.roundRect(-3*sc,0,7*sc,10*sc,2*sc);ctx.fill();
      ctx.fillStyle=skinTone;ctx.beginPath();ctx.roundRect(-2.5*sc,10*sc,6*sc,7*sc,2*sc);ctx.fill();ctx.restore();
      // Rifle
      const gunY=-18*sc;
      ctx.fillStyle='#4a3728';ctx.beginPath();ctx.roundRect(-2*sc,gunY,6*sc,5*sc,1*sc);ctx.fill();
      ctx.fillStyle='#1a1a1a';ctx.beginPath();ctx.roundRect(3*sc,gunY-1*sc,18*sc,5*sc,1*sc);ctx.fill();
      ctx.fillStyle='#111';ctx.fillRect(21*sc,gunY,8*sc,3*sc);
      if(player.shooting){ctx.shadowColor='#fef08a';ctx.shadowBlur=20;ctx.fillStyle='#fff';ctx.beginPath();ctx.arc(29*sc,gunY+1.5*sc,5*sc,0,Math.PI*2);ctx.fill();ctx.shadowBlur=0;}
    } else {
      // Fist raised in boss fight
      ctx.save();ctx.translate(8*sc,-22*sc+breathe);
      const punchAnim=player.shooting?-Math.PI/4:0;
      ctx.rotate(punchAnim);
      ctx.fillStyle='#3b5a8a';ctx.beginPath();ctx.roundRect(-3*sc,0,7*sc,10*sc,2*sc);ctx.fill();
      ctx.fillStyle=skinTone;ctx.beginPath();ctx.roundRect(-3*sc,10*sc,8*sc,7*sc,3*sc);ctx.fill();
      if(player.shooting){ctx.shadowColor='#ef4444';ctx.shadowBlur=15;}ctx.restore();
    }
  } else {
    // Crawling
    ctx.fillStyle='#374151';ctx.beginPath();ctx.roundRect(-14*sc,-8*sc,12*sc,6*sc,2*sc);ctx.fill();
    ctx.fillStyle='#1f2937';ctx.beginPath();ctx.roundRect(-4*sc,-7*sc,11*sc,5*sc,2*sc);ctx.fill();
    ctx.fillStyle='#2d4a7a';ctx.beginPath();ctx.roundRect(-10*sc,-14*sc,18*sc,8*sc,2*sc);ctx.fill();
    ctx.fillStyle=skinTone;ctx.beginPath();ctx.roundRect(6*sc,-16*sc,5*sc,12*sc,2*sc);ctx.fill();
    ctx.fillStyle='#1a1a1a';ctx.beginPath();ctx.roundRect(8*sc,-20*sc,12*sc,8*sc,3*sc);ctx.fill();
    ctx.fillStyle=skinTone;ctx.beginPath();ctx.roundRect(9*sc,-15*sc,10*sc,8*sc,2*sc);ctx.fill();
    ctx.fillStyle='#fff';ctx.fillRect(14*sc,-13*sc,4*sc,3*sc);
    ctx.fillStyle='#1a1a1a';ctx.beginPath();ctx.roundRect(10*sc,-9*sc,18*sc,4*sc,1*sc);ctx.fill();
    if(player.shooting){ctx.shadowColor='#fef08a';ctx.shadowBlur=16;ctx.fillStyle='#fef08a';ctx.beginPath();ctx.arc(33*sc,-7.5*sc,4*sc,0,Math.PI*2);ctx.fill();ctx.shadowBlur=0;}
  }

  // Bike drawn under player
  if(gameLevel===2&&player.onBike){
    const bikeY=2;
    // Wheels
    ctx.fillStyle='#1f2937';ctx.beginPath();ctx.arc(-18*sc,bikeY,12*sc,0,Math.PI*2);ctx.fill();
    ctx.fillStyle='#374151';ctx.beginPath();ctx.arc(-18*sc,bikeY,8*sc,0,Math.PI*2);ctx.fill();
    ctx.beginPath();ctx.arc(16*sc,bikeY,12*sc,0,Math.PI*2);ctx.fill();
    ctx.fillStyle='#1f2937';ctx.beginPath();ctx.arc(16*sc,bikeY,8*sc,0,Math.PI*2);ctx.fill();
    // Frame
    ctx.fillStyle='#374151';ctx.fillRect(-18*sc,bikeY-6,34*sc,6);
    ctx.fillStyle='#1f2937';ctx.beginPath();ctx.moveTo(-18*sc,bikeY-6);ctx.lineTo(0,bikeY-16*sc);ctx.lineTo(16*sc,bikeY-6);ctx.closePath();ctx.fill();
    // Exhaust puff
    if(player.bikeSpeed>2){spawnParticles(player.x-20,player.y+player.h-5,'#9ca3af',1,{speed:0.5,life:12,size:4});spawnParticles(player.x-20,player.y+player.h-5,'rgba(150,150,150,0.5)',1,{speed:0.3,life:18,size:6});}
    // Speed lines
    if(player.bikeSpeed>5){
      ctx.strokeStyle=`rgba(255,255,255,${(player.bikeSpeed/player.bikeMaxSpeed)*0.25})`;ctx.lineWidth=1;
      for(let si=0;si<5;si++){const sy=-30*sc+si*12*sc;ctx.beginPath();ctx.moveTo(-40*sc,sy);ctx.lineTo(-80*sc,sy);ctx.stroke();}
    }
  }

  // Stun stars
  if(player.stunned>0){const st=Date.now()/280;ctx.shadowBlur=0;for(let si=0;si<3;si++){const sx=Math.cos(st+si*2.1)*14*sc,sy=Math.sin(st+si*2.1)*6*sc-42*sc;ctx.fillStyle='#fef08a';ctx.font=`${10*sc}px monospace`;ctx.textAlign='center';ctx.fillText('★',sx,sy);}}
  ctx.shadowBlur=0;ctx.restore();
}

// ═══════════════════════════════════════════════
//  DRAW — ENEMIES
// ═══════════════════════════════════════════════
function drawEnemies() {
  const enemyList = gameLevel===3 ? arenaEnemies : enemies;
  enemyList.forEach(e=>{
    const ex=e.x-cam.x,ey=e.y;
    if(ex<-80||ex>canvas.width+80) return;
    ctx.save(); ctx.translate(ex+e.w/2,ey+e.h/2);
    if(e.vx<0) ctx.scale(-1,1);
    const h2=e.h/2, w2=e.w/2;

    if(e.type==='soldier'||e.type==='knife'){
      // Soldier
      const armored=e.type==='soldier';
      // Legs
      const walk=Math.sin(e.animFrame*1.4)*12;
      ctx.fillStyle='#374151';ctx.fillRect(-w2+2,h2-18,w2-2,18);
      ctx.fillStyle='#2d3748';ctx.fillRect(2,h2-18,w2-2,18);
      // Body
      ctx.fillStyle=armored?'#1a3a1a':'#2d1a1a';ctx.fillRect(-w2,h2-36,e.w,20);
      ctx.fillStyle=armored?'#1f4a1f':'#3d2525';ctx.fillRect(-w2+2,h2-34,e.w-4,6); // chest armor
      // Head
      ctx.fillStyle='#4a4a4a';ctx.fillRect(-w2+2,h2-52,e.w-4,16); // helmet
      ctx.fillStyle='#c4836a';ctx.fillRect(-w2+4,h2-44,e.w-8,10); // face
      ctx.fillStyle='rgba(0,0,0,0.8)';ctx.fillRect(-w2+4,h2-44,e.w-8,4); // visor
      // Gun
      if(e.gun){ctx.fillStyle='#1a1a1a';ctx.fillRect(w2,h2-36,16,5);}
      else {ctx.fillStyle='#6b3a1f';ctx.fillRect(w2-2,h2-36,12,4);} // knife
    } else if(e.type==='brute'){
      // Big brute
      ctx.fillStyle='#7c2d12';ctx.beginPath();ctx.roundRect(-w2,h2-e.h*0.6,e.w,e.h*0.62,3);ctx.fill();
      ctx.fillStyle='#92400e';ctx.fillRect(-w2+1,h2-e.h,-e.w-2,18); // placeholder fix
      ctx.fillStyle='#92400e';ctx.fillRect(-w2+1,h2-e.h+2,e.w-2,18);
      ctx.fillStyle='#fef08a';ctx.fillRect(-w2+3,h2-e.h+5,6,5);ctx.fillRect(w2-9,h2-e.h+5,6,5); // eyes
      ctx.fillStyle='#1a1a1a';ctx.beginPath();ctx.moveTo(-8,h2-e.h+2);ctx.lineTo(-12,h2-e.h-12);ctx.lineTo(-3,h2-e.h+4);ctx.fill();ctx.beginPath();ctx.moveTo(8,h2-e.h+2);ctx.lineTo(12,h2-e.h-12);ctx.lineTo(3,h2-e.h+4);ctx.fill(); // horns
    } else if(e.type==='vamp'){
      ctx.fillStyle='#4c1d95';ctx.beginPath();ctx.moveTo(-w2-6,h2-e.h+8);ctx.lineTo(w2+6,h2-e.h+8);ctx.lineTo(w2+2,h2+4);ctx.lineTo(-w2-2,h2+4);ctx.fill();
      ctx.fillStyle='#1a0a2e';ctx.fillRect(-w2,h2-e.h+6,e.w,e.h*0.6);
      ctx.fillStyle='#d1d5db';ctx.fillRect(-w2+2,h2-e.h-12,e.w-4,16);
      ctx.fillStyle='#dc2626';ctx.fillRect(-w2+4,h2-e.h-8,4,4);ctx.fillRect(w2-8,h2-e.h-8,4,4);
      ctx.fillStyle='#fff';ctx.fillRect(-w2+6,h2-e.h+2,3,6);ctx.fillRect(w2-9,h2-e.h+2,3,6);
    } else {
      ctx.fillStyle='#365314';ctx.fillRect(-w2,h2-e.h*0.65,e.w,e.h*0.65);
      ctx.fillStyle='#84cc16';ctx.fillRect(-w2+1,h2-e.h-13,e.w-2,15);
      ctx.fillStyle='#fef08a';ctx.fillRect(-w2+3,h2-e.h-10,5,4);ctx.fillRect(w2-8,h2-e.h-10,5,4);
    }
    if(e.alert){ctx.fillStyle='#ef4444';ctx.font='bold 14px monospace';ctx.textAlign='center';ctx.fillText('!',0,h2-e.h-22);}
    ctx.restore();
    if(e.hp<e.maxHp){
      ctx.fillStyle='#991b1b';ctx.fillRect(ex,ey-8,e.w,5);
      ctx.fillStyle='#ef4444';ctx.fillRect(ex,ey-8,e.w*(e.hp/e.maxHp),5);
    }
  });
}

function drawBoss() {
  if(!boss) return;
  const bx=boss.x-cam.x, by=boss.y;
  if(bx<-80||bx>canvas.width+80) return;
  const t=Date.now()/300;
  const bw=boss.w, bh=boss.h;

  ctx.save(); ctx.translate(bx+bw/2,by+bh/2);
  if(boss.vx<0) ctx.scale(-1,1);

  const enrColor=boss.enraged?'#dc2626':'#7f1d1d';
  // Aura
  if(boss.enraged){const ag=ctx.createRadialGradient(0,0,0,0,0,60);ag.addColorStop(0,'rgba(220,38,38,0.15)');ag.addColorStop(1,'transparent');ctx.fillStyle=ag;ctx.fillRect(-70,-70,140,140);}
  // Legs
  const walk=Math.sin(boss.animFrame*1.2)*15;
  ctx.fillStyle='#3a1a1a';ctx.fillRect(-bw/2+2,bh/2-22,bw/2-2,22); // left leg
  ctx.fillStyle='#4a2020';ctx.fillRect(2,bh/2-22,bw/2-2,22); // right leg
  // Body — imposing
  ctx.fillStyle=enrColor;ctx.beginPath();ctx.roundRect(-bw/2,bh/2-bh*0.65,bw,bh*0.65,4);ctx.fill();
  // Chest armor
  ctx.fillStyle='#111';ctx.fillRect(-bw/2+3,bh/2-bh*0.62,bw-6,12);
  ctx.fillStyle='#dc2626';ctx.fillRect(-bw/2+6,bh/2-bh*0.58,bw-12,6);
  // Head — skull-like
  ctx.fillStyle='#1a0808';ctx.beginPath();ctx.roundRect(-bw/2+2,bh/2-bh-8,bw-4,20,[4,4,0,0]);ctx.fill();
  ctx.fillStyle='#c4836a';ctx.beginPath();ctx.roundRect(-bw/2+4,bh/2-bh+8,bw-8,14,[2,2,3,3]);ctx.fill();
  ctx.fillStyle=boss.enraged?'#fbbf24':'#ef4444';ctx.fillRect(-bw/2+6,bh/2-bh+10,7,5);ctx.fillRect(bw/2-13,bh/2-bh+10,7,5);
  ctx.fillStyle='#fff';ctx.fillRect(-bw/2+7,bh/2-bh+11,3,3);ctx.fillRect(bw/2-12,bh/2-bh+11,3,3);
  // Scar
  ctx.strokeStyle='rgba(0,0,0,0.5)';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(4,bh/2-bh+8);ctx.lineTo(2,bh/2-bh+18);ctx.stroke();
  // Fist arms
  const punchOut=boss.attackTimer>boss.attackCooldown-20;
  ctx.fillStyle='#3a1a1a';ctx.beginPath();ctx.roundRect(bw/2,bh/2-bh*0.5,12+(punchOut?25:0),8,2);ctx.fill();
  ctx.fillStyle='#c4836a';ctx.beginPath();ctx.roundRect(bw/2+(punchOut?30:10),bh/2-bh*0.5,10,10,3);ctx.fill();
  // Stun
  if(boss.stunTimer>0){const st=Date.now()/200;for(let si=0;si<4;si++){const sx=Math.cos(st+si*1.57)*24,sy=Math.sin(st+si*1.57)*12-bh-14;ctx.fillStyle='#fef08a';ctx.font='12px monospace';ctx.textAlign='center';ctx.fillText('★',sx,sy);}}

  ctx.restore();
  // HP tag
  ctx.fillStyle='rgba(0,0,0,0.7)';ctx.fillRect(bx,by-22,boss.w,14);
  ctx.fillStyle='#ef4444';ctx.fillRect(bx,by-22,boss.w*(boss.hp/boss.maxHp),14);
  ctx.fillStyle='#fff';ctx.font='bold 9px Share Tech Mono';ctx.textAlign='center';ctx.fillText('KADE',bx+boss.w/2,by-11);
}

function drawBullets() {
  bullets.forEach(b=>{
    const bx=b.x-cam.x;
    const g=ctx.createRadialGradient(bx,b.y,0,bx,b.y,6);
    g.addColorStop(0,'#fff');g.addColorStop(0.5,b.enemy?'#f97316':'#fde047');g.addColorStop(1,'transparent');
    ctx.fillStyle=g;ctx.fillRect(bx-6,b.y-6,12,12);
    ctx.strokeStyle=b.enemy?'rgba(249,115,22,0.3)':'rgba(253,224,71,0.3)';ctx.lineWidth=1;
    ctx.beginPath();ctx.moveTo(bx,b.y);ctx.lineTo(bx-b.vx*0.4,b.y);ctx.stroke();
  });
}

// ═══════════════════════════════════════════════
//  MINIMAP
// ═══════════════════════════════════════════════
function drawMinimap() {
  const mw=mapCanvas.width,mh=mapCanvas.height;
  mapCtx.clearRect(0,0,mw,mh);
  const worldLen=gameLevel===2?LEVEL2_LEN:gameLevel===3?ARENA_WIDTH:WORLD_LEN;
  const scale=mw/worldLen, mgy=mh*0.52;
  mapCtx.fillStyle=gameLevel===3?'#0a0000':(gameLevel===2?(acidRainActive?'#0a1a00':'#0c1a2e'):(phase==='night'?'#020617':(phase==='morning'?'#1c0a00':'#075985')));
  mapCtx.fillRect(0,0,mw,mgy);
  mapCtx.fillStyle=gameLevel===3?'#2d0808':(gameLevel===1?(phase==='night'?'#374151':'#4b5563'):'#374151');
  mapCtx.fillRect(0,mgy,mw,4);
  if(gameLevel===1){mapCtx.fillStyle='#1a1208';mapCtx.fillRect(0,mgy+4,mw,mh-mgy-4);}
  if(gameLevel===1){world.manholes.forEach(m=>{mapCtx.fillStyle='#10b981';mapCtx.fillRect(m.x*scale-1,mgy-4,2,8);});}
  // Player
  const ppx=player.x*scale;
  mapCtx.fillStyle='#fbbf24';mapCtx.fillRect(ppx-3,mgy-8,6,6);
  // Enemies
  (gameLevel===3?arenaEnemies:enemies).forEach(e=>{mapCtx.fillStyle='#ef4444';mapCtx.fillRect(e.x*scale-2,mgy-5,4,5);});
  if(boss){mapCtx.fillStyle='#dc2626';mapCtx.fillRect(boss.x*scale-4,mgy-7,8,7);}
  // Viewport
  mapCtx.strokeStyle='rgba(255,255,255,0.2)';mapCtx.lineWidth=1;mapCtx.strokeRect(cam.x*scale,0,canvas.width*scale,mh);
  // Progress
  mapCtx.fillStyle='rgba(255,255,255,0.08)';mapCtx.fillRect(0,mh-3,mw,3);
  mapCtx.fillStyle='#fbbf24';mapCtx.fillRect(0,mh-3,mw*(player.x/worldLen),3);
}

function drawNightFog() {
  if(gameLevel!==1||phase!=='night') return;
  const w=canvas.width,gy=groundY(),t=Date.now()/1000;
  const fg=ctx.createLinearGradient(0,gy,0,gy-100);fg.addColorStop(0,'rgba(88,28,135,0.4)');fg.addColorStop(1,'transparent');ctx.fillStyle=fg;ctx.fillRect(0,gy-100,w,100);
  for(let i=0;i<7;i++){const fx=((i*300+cam.x*0.5+t*28*(i%2===0?1:-1))%(w+200)+w)%w-100,fy=gy-12-Math.sin(t+i)*22;const fcg=ctx.createRadialGradient(fx,fy,0,fx,fy,90+i*18);fcg.addColorStop(0,'rgba(139,92,246,0.18)');fcg.addColorStop(1,'transparent');ctx.fillStyle=fcg;ctx.fillRect(fx-110,fy-90,220,180);}
}
function drawMorningHaze() {
  if(gameLevel!==1||phase!=='morning') return;
  const w=canvas.width,gy=groundY(),t=Date.now()/1000;
  const hg=ctx.createLinearGradient(0,gy-80,0,gy);hg.addColorStop(0,'transparent');hg.addColorStop(1,'rgba(249,115,22,0.15)');ctx.fillStyle=hg;ctx.fillRect(0,gy-80,w,80);
}

// ═══════════════════════════════════════════════
//  MAIN LOOP
// ═══════════════════════════════════════════════
let lastTime=0;
function loop(ts) {
  const dt=Math.min((ts-lastTime)/1000,0.05); lastTime=ts;
  ctx.clearRect(0,0,canvas.width,canvas.height);

  if(gameState==='playing') {
    updateCamera();
    if(gameLevel===1){
      updateLevel1Player(dt); updateLevel1Enemies(); updateBullets(); updateLevel1Traps(); tickPhase(dt);
    } else if(gameLevel===2){
      updateLevel2Player(dt); updateBullets();
    } else if(gameLevel===3){
      updateLevel3Player(dt); updateArenaPhase(dt); updateArenaEnemies(); updateArenaPlayerBullets();
      // Update enemy bullets
      for(let bi=bullets.length-1;bi>=0;bi--){const b=bullets[bi];if(!b.enemy){b.x+=b.vx;b.y+=b.vy;b.life--;if(b.life<=0)bullets.splice(bi,1);}}
      if(boss&&arenaPhase==='bossFight') updateBoss(dt);
    }
    updateParticles(); tickStatus(); tickTrapWarn();

    drawSky();
    drawNightFog(); drawMorningHaze();
    if(gameLevel===1) drawSewer();
    drawGround();
    drawParticles();
    drawBullets();
    drawEnemies();
    if(boss&&arenaPhase==='bossFight') drawBoss();
    drawPlayer();
    drawMinimap();

  } else if(gameState==='gameover'||gameState==='levelTrans') {
    drawSky();
    if(gameLevel===1) drawSewer();
    drawGround();
    drawParticles();
    drawPlayer();
    updateParticles();
  } else if(gameState==='seasonEnd') {
    // Celebration drawing
    ctx.fillStyle='#000';ctx.fillRect(0,0,canvas.width,canvas.height);
    for(let i=0;i<6;i++){const wx=canvas.width*(0.1+i*0.15)+Math.sin(ts/1000*0.5+i)*50;const wy=canvas.height*(0.3+Math.sin(ts/1000*0.3+i*1.2)*0.25);const g=ctx.createRadialGradient(wx,wy,0,wx,wy,180);g.addColorStop(0,'rgba(139,92,246,0.1)');g.addColorStop(1,'transparent');ctx.fillStyle=g;ctx.fillRect(0,0,canvas.width,canvas.height);}
    drawParticles(); updateParticles();
  } else {
    ctx.fillStyle='#000';ctx.fillRect(0,0,canvas.width,canvas.height);
    const t2=ts/1000;for(let i=0;i<8;i++){const wx=canvas.width*(0.1+i*0.12)+Math.sin(t2*0.5+i)*40,wy=canvas.height*(0.3+Math.sin(t2*0.3+i*1.2)*0.2);const g=ctx.createRadialGradient(wx,wy,0,wx,wy,160);g.addColorStop(0,'rgba(139,92,246,0.07)');g.addColorStop(1,'transparent');ctx.fillStyle=g;ctx.fillRect(0,0,canvas.width,canvas.height);}
  }
  requestAnimationFrame(loop);
}

document.getElementById('startBtn').addEventListener('click', startGame);
document.getElementById('restartBtn').addEventListener('click', startGame);
document.getElementById('seReplay').addEventListener('click', startGame);

requestAnimationFrame(loop);

 