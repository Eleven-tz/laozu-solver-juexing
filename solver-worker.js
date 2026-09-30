// Web Worker for laozu-solver SA
// 纯求解，无 DOM

// 常量
const DE=10000, A_ATK=2001, A_DEF=2002, A_HP=2003, A_ATKP=2004, A_DEFP=2005, A_HPP=2006;
const FILL_BONUS=1e7;
const ATTRS=[{id:2001,name:"攻击力"},{id:2002,name:"防御"},{id:2003,name:"生命值"},{id:2004,name:"攻击力百分比"},{id:2005,name:"防御百分比"},{id:2006,name:"生命值百分比"}];

// 全局数据（由主线程传入）
let SKILL_BY_ID = {};
let AWAKEN_DB = {};

// mulberry32
function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}

// buildTalentMap
function buildTalentMap(ids){
  const m={},seen=new Set(),conv={2004:2001,2005:2002,2006:2003};
  for(const id of ids){if(!id||seen.has(String(id)))continue;seen.add(String(id));
    const t=TALENT_BY_ID[id];if(!t)continue;const ba=conv[t.attr];if(!ba)continue;
    (m[t.form]??={})[ba]=((m[t.form]??={})[ba]??0)+t.value;}
  return m;
}

// effBase
function effBase(eq,starsMap,talentMap,attr,awakenMap){
  const b=eq.base.find(x=>x.attr===attr),bv=b?b.value:0;let o=0;
  // 原版逻辑：仅 quality===5 且有 elder 数据的红装吃星级加成，按装备 ID 查星级
  const stars=starsMap?(starsMap[eq.id]??0):0;
  if(eq.quality===5&&eq.elder&&eq.elder.starBonus&&stars>0){let s=0;for(const [th,v] of eq.elder.starBonus)if(th<=stars)s=v;o+=s/DE;}
  o+=((talentMap[eq.weaponForm]||{})[attr]??0)/DE;
  // 觉醒：自身全部基础属性提升（按觉醒等级查，1/2/3级累积）
  const awLv=awakenMap?(awakenMap[eq.id]??0):0;
  const awData=AWAKEN_DB[eq.id];
  if(awData){
    for(let lv=1;lv<=3&&lv<=awLv;lv++){
      const effs=awData.levels[lv];
      if(!effs)continue;
      for(const ef of effs)if(ef.type==="self_mult")o+=ef.pct/DE;
    }
  }
  return o>0?Math.floor(bv*(1+o)):bv;
}

// evaluate
function evaluate(pl,ctx,detail){
  const P=pl.length,R=ctx.R,C=ctx.C;
  const cmap=new Map();pl.forEach((p,i)=>p.cells.forEach(c=>cmap.set(c,i)));
  const neigh=Array.from({length:P},()=>new Set());
  const D4=[[-1,0],[1,0],[0,-1],[0,1]];
  pl.forEach((p,i)=>{for(const cell of p.cells){const r=(cell/C)|0,c=cell%C;
    for(const [dr,dc] of D4){const nr=r+dr,nc=c+dc;if(nr<0||nr>=R||nc<0||nc>=C)continue;
      const j=cmap.get(nr*C+nc);if(j!==undefined&&j!==i){neigh[i].add(j);neigh[j].add(i);}}}});
  const nb=neigh.map(s=>[...s]);
  const awakenMap=ctx.awaken||{};
  let powerTotal=0,weightedTotal=0;const pieces=[];
  for(let h=0;h<P;h++){
    const eq=pl[h].eq,y=new Map(),srcs=[];
    const add=(k,v)=>y.set(k,(y.get(k)??0)+v);
    for(const sid of eq.skillIds){const sk=SKILL_BY_ID[sid];if(!sk||sk.scope!=="self")continue;
      const T=nb[h].filter(p=>((1<<pl[p].eq.element)&sk.mask)!==0);if(!T.length)continue;
      for(const bf of sk.buffs){const F=bf.value*T.length;add(bf.attr,F);
        if(detail)srcs.push({t:"self",skill:sk.name,attr:bf.attr,value:F,per:bf.value,n:T.length,names:T.map(p=>pl[p].eq.name)});}}
    // 觉醒1：按相邻指定系数量给自身加属性（与 self-buff 同机制）
    const awLv=awakenMap[eq.id]??0,awData=AWAKEN_DB[eq.id];
    if(awData&&awLv>=1&&awData.levels[1]){
      for(const ef of awData.levels[1]){
        if(ef.type!=="self_per_adjacent")continue;
        const T=nb[h].filter(p=>pl[p].eq.element===ef.element);
        if(!T.length)continue;
        const F=ef.perUnit*T.length;add(ef.attr,F);
        if(detail)srcs.push({t:"awaken1",skill:`觉醒1`,attr:ef.attr,value:F,per:ef.perUnit,n:T.length,names:T.map(p=>pl[p].eq.name)});
      }
    }
    for(const p of nb[h]){const neq=pl[p].eq;
      for(const sid of neq.skillIds){const sk=SKILL_BY_ID[sid];if(!sk||sk.scope!=="adjacent")continue;
        if(((1<<eq.element)&sk.mask)===0)continue;
        for(const bf of sk.buffs){add(bf.attr,bf.value);
          if(detail)srcs.push({t:"neighbor",skill:sk.name,attr:bf.attr,value:bf.value,from:`${neq.name}·${pl[p].tier}阶`});}}}
    const uid=pl[h].inst.uid;
    const D=ctx.effAtk[uid]*(1+(y.get(A_ATKP)??0)/DE),
          Df=ctx.effDef[uid]*(1+(y.get(A_DEFP)??0)/DE),
          Hp=ctx.effHp[uid]*(1+(y.get(A_HPP)??0)/DE);
    const g=k=>k===A_ATK?D:k===A_DEF?Df:k===A_HP?Hp:(y.get(k)??0);
    let w=0,q=0;
    for(const a of ATTRS){const u=a.kind===2?0.01:1,gv=g(a.id);w+=gv*u*a.nPower;
      q+=gv*u*(ctx.weights?(ctx.weights[a.id]??a.nPower):a.nPower);}
    powerTotal+=w;weightedTotal+=q;
    pieces.push({eq,tier:pl[h].tier,atk:D,def:Df,hp:Hp,buffs:[...y.entries()],srcs,power:w,weighted:q});
  }
  // 觉醒3：相邻增益（给相邻指定系法宝攻防血+，影响摆法）
  // （全局形态光环不影响摆放，已移除计算）
  for(let h=0;h<P;h++){
    const eq=pl[h].eq,awLv=awakenMap[eq.id]??0,awData=AWAKEN_DB[eq.id];
    if(!awData||awLv<3||!awData.levels[3])continue;
    for(const ef of awData.levels[3]){
      if(ef.type!=="adjacent_buff")continue;
      const mult=ef.pct/DE;
      for(const p of nb[h]){
        if(pl[p].eq.element!==ef.element)continue;
        const pc=pieces[p];
        const bA=ctx.effAtk[pl[p].inst.uid],bD=ctx.effDef[pl[p].inst.uid],bH=ctx.effHp[pl[p].inst.uid];
        const dA=Math.floor(bA*mult),dD=Math.floor(bD*mult),dH=Math.floor(bH*mult);
        pc.atk+=dA;pc.def+=dD;pc.hp+=dH;
        let dw=0,dq=0;
        for(const a of ATTRS){
          const u=a.kind===2?0.01:1;let gv=0;
          if(a.id===A_ATK)gv=dA;else if(a.id===A_DEF)gv=dD;else if(a.id===A_HP)gv=dH;
          else continue;
          dw+=gv*u*a.nPower;dq+=gv*u*(ctx.weights?(ctx.weights[a.id]??a.nPower):a.nPower);
        }
        pc.power+=dw;pc.weighted+=dq;powerTotal+=dw;weightedTotal+=dq;
        if(detail)pc.srcs.push({t:"awaken3",skill:`觉醒3(来自${eq.name})`,attr:"相邻",value:ef.pct,per:ef.pct,n:1,names:[],from:eq.name});
      }
    }
  }
  return{powerTotal,weightedTotal,pieces};
}

// stateScore
function stateScore(st){
  if(!st.pl.length)return st.ctx.fillAll?0:0;
  const r=evaluate(st.pl,st.ctx,false);
  const base=objective(r,st.ctx.target);
  const cells=st.pl.reduce((a,p)=>a+p.cells.length,0);
  return base+(st.ctx.fillAll?cells*FILL_BONUS:0);
}

// buildPlacementTable
function buildPlacementTable(instances,R,C,locked){
  const table=new Map(); // uid -> [{r,c,cells}]
  const byAnchor=new Map(); // uid -> Map("r,c" -> placement)
  for(const inst of instances){
    const list=[],am=new Map(),sh=inst.shape;
    for(let r=0;r+sh.h<=R;r++)for(let c=0;c+sh.w<=C;c++){
      const cells=sh.cells.map(([dr,dc])=>(r+dr)*C+(c+dc));
      if(cells.some(i=>locked.has(i)))continue;
      const pm={r,c,cells};
      list.push(pm);am.set(r+","+c,pm);
    }
    table.set(inst.uid,list);byAnchor.set(inst.uid,am);
  }
  return{table,byAnchor};
}

// newSolverState
function newSolverState(instances,table,R,C,locked,ctx){
  return{
    instances,table,R,C,locked,ctx,
    pl:[], // 已放置 [{inst,eq,tier,r,c,cells}]
    unplaced:new Set(instances.map(i=>i.uid)),
    uidToInst:new Map(instances.map(i=>[i.uid,i])),
    score:-Infinity,
  };
}

// snapshot
function snapshot(st){
  return st.pl.map(p=>({uid:p.inst.uid,r:p.r,c:p.c}));
}

// restore
function restore(st,snap){
  st.pl=[];st.unplaced=new Set(st.instances.map(i=>i.uid));
  for(const s of snap){
    const pm=st.table.byAnchor.get(s.uid).get(s.r+","+s.c);
    if(pm)placeInst(st,s.uid,pm);
  }
}

// greedyPlace
function greedyPlace(st,uid,maxSamples,rng){
  const list=st.table.table.get(uid);
  if(!list||!list.length)return 0;
  const occ=buildOcc(st.pl,st.R,st.C,st.locked);
  const base=stateScore(st);
  const n=list.length,step=n>maxSamples?Math.ceil(n/maxSamples):1;
  const start=step>1?((rng()*step)|0):0;
  let bestPm=null,bestGain=-Infinity;
  for(let i=start;i<n;i+=step){
    const pm=list[i];
    if(!cellsFree(pm.cells,occ))continue;
    const inst=st.uidToInst.get(uid);
    st.pl.push({inst,eq:inst.eq,tier:inst.tier,r:pm.r,c:pm.c,cells:pm.cells});
    const sc=stateScore(st);
    st.pl.pop();
    const gain=sc-base;
    if(gain>bestGain||(gain===bestGain&&rng()<0.3)){bestGain=gain;bestPm=pm;}
  }
  if(bestPm&&placeInst(st,uid,bestPm))return bestGain;
  return 0;
}

// greedyPlaceAll
function greedyPlaceAll(st,uids,rng){
  for(const uid of uids){
    if(!st.unplaced.has(uid))continue;
    greedyPlace(st,uid,64,rng);
  }
}

// makeOperators
function makeOperators(st,rng){
  const T=st.table;
  return[
    {w:40,fn:()=>{ // move：移动一件到同形状另一位置
      if(!st.pl.length)return null;
      const p=st.pl[(rng()*st.pl.length)|0];
      const list=T.table.get(p.inst.uid);
      if(list.length<2)return null;
      const curKey=p.r+","+p.c;
      const pm=list[(rng()*list.length)|0];
      if(pm.r+","+pm.c===curKey)return null;
      const removed=removeInst(st,p.inst.uid);
      if(!removed)return null;
      if(placeInst(st,p.inst.uid,pm)){
        return()=>{removeInst(st,p.inst.uid);placeInst(st,p.inst.uid,T.byAnchor.get(p.inst.uid).get(curKey));};
      }
      // 放回去
      placeInst(st,p.inst.uid,T.byAnchor.get(p.inst.uid).get(curKey));
      return null;
    }},
    {w:15,fn:()=>{ // swap：两件交换位置
      if(st.pl.length<2)return null;
      const a=st.pl[(rng()*st.pl.length)|0];
      let b=st.pl[(rng()*st.pl.length)|0];
      if(a===b)return null;
      const pa=T.byAnchor.get(a.inst.uid).get(b.r+","+b.c);
      const pb=T.byAnchor.get(b.inst.uid).get(a.r+","+a.c);
      if(!pa||!pb)return null;
      const ka=a.r+","+a.c,kb=b.r+","+b.c;
      removeInst(st,a.inst.uid);removeInst(st,b.inst.uid);
      if(placeInst(st,a.inst.uid,pa)&&placeInst(st,b.inst.uid,pb)){
        return()=>{removeInst(st,a.inst.uid);removeInst(st,b.inst.uid);
          placeInst(st,a.inst.uid,T.byAnchor.get(a.inst.uid).get(ka));
          placeInst(st,b.inst.uid,T.byAnchor.get(b.inst.uid).get(kb));};
      }
      // 回滚
      removeInst(st,a.inst.uid);removeInst(st,b.inst.uid);
      placeInst(st,a.inst.uid,T.byAnchor.get(a.inst.uid).get(ka));
      placeInst(st,b.inst.uid,T.byAnchor.get(b.inst.uid).get(kb));
      return null;
    }},
    {w:14,fn:()=>{ // replace：下一件已放的，贪心上一件未放的
      if(!st.pl.length||!st.unplaced.size)return null;
      const p=st.pl[(rng()*st.pl.length)|0];
      const uids=[...st.unplaced];
      const uid=uids[(rng()*uids.length)|0];
      const removed=removeInst(st,p.inst.uid);
      if(!removed)return null;
      const pm0=T.byAnchor.get(p.inst.uid).get(p.r+","+p.c);
      const gain=greedyPlace(st,uid,24,rng);
      // 只要放上去了就接受（由退火准则决定）
      if(!st.unplaced.has(uid)){
        return()=>{removeInst(st,uid);placeInst(st,p.inst.uid,pm0);};
      }
      placeInst(st,p.inst.uid,pm0);
      return null;
    }},
    {w:10,fn:()=>{ // add：贪心上一件未放的
      if(!st.unplaced.size)return null;
      const uids=[...st.unplaced];
      const uid=uids[(rng()*uids.length)|0];
      greedyPlace(st,uid,24,rng);
      if(!st.unplaced.has(uid)){
        return()=>{removeInst(st,uid);};
      }
      return null;
    }},
    {w:6,fn:()=>{ // remove：下一件（逃离局部最优）
      if(!st.pl.length)return null;
      const p=st.pl[(rng()*st.pl.length)|0];
      const pm0=T.byAnchor.get(p.inst.uid).get(p.r+","+p.c);
      removeInst(st,p.inst.uid);
      return()=>{placeInst(st,p.inst.uid,pm0);};
    }},
    {w:12,fn:()=>{ // bigShuffle：LNS大拆，拿下 6-8 件重排（跳出局部最优）
      if(st.pl.length<6)return null;
      const snap=snapshot(st);
      const n=6+((rng()*Math.min(3,st.pl.length-6))|0);
      const idxs=new Set();
      while(idxs.size<n)idxs.add((rng()*st.pl.length)|0);
      const removedUids=[...idxs].map(i=>st.pl[i].inst.uid);
      for(const uid of removedUids)removeInst(st,uid);
      const toPlace=[...removedUids,...st.unplaced];
      for(let i=toPlace.length-1;i>0;i--){const j=(rng()*(i+1))|0;[toPlace[i],toPlace[j]]=[toPlace[j],toPlace[i]];}
      greedyPlaceAll(st,toPlace,rng);
      return()=>{restore(st,snap);};
    }},
    {w:15,fn:()=>{ // shuffle：拿下 2-4 件，重排它们+未放的
      if(st.pl.length<2)return null;
      const snap=snapshot(st);
      const n=2+((rng()*Math.min(3,st.pl.length-1))|0);
      const idxs=new Set();
      while(idxs.size<n)idxs.add((rng()*st.pl.length)|0);
      const removedUids=[...idxs].map(i=>st.pl[i].inst.uid);
      for(const uid of removedUids)removeInst(st,uid);
      // 随机顺序重放
      const toPlace=[...removedUids,...st.unplaced];
      for(let i=toPlace.length-1;i>0;i--){const j=(rng()*(i+1))|0;[toPlace[i],toPlace[j]]=[toPlace[j],toPlace[i]];}
      greedyPlaceAll(st,toPlace,rng);
      return()=>{restore(st,snap);};
    }},
  ];
}

// pickOp
function pickOp(ops,rng){
  const total=ops.reduce((a,o)=>a+o.w,0);
  let x=rng()*total;
  for(const o of ops){x-=o.w;if(x<=0)return o.fn;}
  return ops[0].fn;
}

// Worker 主逻辑：单线退火
function runSingleLine(job) {
  const {instances, ctx, budget, seed, tempMult} = job;
  SKILL_BY_ID = job.skillById;
  AWAKEN_DB = job.awakenDb;
  
  const R = ctx.R, C = ctx.C;
  const locked = new Set(ctx.locked);
  const rng = mulberry32(seed >>> 0);
  
  // 构建摆放表
  const table = buildPlacementTable(instances, R, C, locked);
  
  // 初始状态
  const st = newSolverState(instances, table, R, C, locked, ctx);
  const ops = makeOperators(st, rng);
  greedyPlaceAll(st, instances.map(i => i.uid), rng);
  st.score = stateScore(st);
  
  let bestScore = st.score;
  let bestSnap = snapshot(st);
  let curScore = st.score;
  
  // 温度
  const cells0 = st.pl.reduce((a,p) => a + p.cells.length, 0);
  const tb0 = ctx.fillAll ? curScore - cells0 * FILL_BONUS : curScore;
  const T0 = Math.max(1, Math.abs(tb0) * 0.03 * tempMult);
  const T1 = Math.max(1e-9, Math.abs(tb0) * 1e-3 * tempMult);
  
  const t0 = performance.now();
  const end = t0 + budget * 1000;
  let iters = 0;
  let lastRestart = t0;
  let restartCount = 0;
  
  while (performance.now() < end) {
    const now = performance.now();
    const frac = Math.min(1, (now - t0) / (budget * 1000));
    const T = T0 * Math.pow(T1 / T0, frac);
    
    // 定时重启：每15秒从新起点开始（保留全局最优）
    if (now - lastRestart > 15000) {
      lastRestart = now;
      restartCount++;
      const newRng = mulberry32((seed + restartCount * 104729) >>> 0);
      const newSt = newSolverState(instances, table, R, C, locked, ctx);
      const newOps = makeOperators(newSt, newRng);
      greedyPlaceAll(newSt, instances.map(i => i.uid), newRng);
      newSt.score = stateScore(newSt);
      // 替换当前状态（保留 bestScore/bestSnap）
      st.pl = newSt.pl;
      st.unplaced = newSt.unplaced;
      st.score = newSt.score;
      curScore = newSt.score;
      // 注意：ops 引用了旧 st，需要重建
      // 简化：直接替换 ops 数组内容
      ops.length = 0;
      ops.push(...newOps);
    }
    
    const batchUntil = performance.now() + 23;
    while (performance.now() < batchUntil && performance.now() < end) {
      iters++;
      const before = st.score;
      const undo = pickOp(ops, rng)();
      if (!undo) continue;
      st.score = stateScore(st);
      const delta = st.score - before;
      if (delta >= 0 || rng() < Math.exp(delta / T)) {
        // 接受
        if (st.score > curScore) curScore = st.score;
        if (st.score > bestScore) {
          bestScore = st.score;
          bestSnap = snapshot(st);
        }
      } else {
        // 拒绝，回滚
        undo();
        st.score = before;
      }
    }
    
    // 发送进度
    if (iters % 5000 === 0) {
      postMessage({type: 'progress', iters, bestScore});
    }
  }
  
  return {bestScore, bestSnap, iters};
}

onmessage = function(e) {
  const job = e.data;
  if (job.type === 'solve') {
    try {
      const result = runSingleLine(job);
      postMessage({type: 'done', ...result});
    } catch (err) {
      postMessage({type: 'error', message: err.message, stack: err.stack});
    }
  }
};
