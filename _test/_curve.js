const { createCadence } = require("../vendor/cadence.js");
function tier(p){ if(p>0.5)return 4; if(p>0.3)return 3; if(p>0.1)return 2; return 1; }
async function run(th){
  const cad = createCadence({
    getLastMessage: () => null,
    connectionRateFn: () => 0.0025,
    onSave: async()=>{}, onLoad: async()=>({connection:0,poise:0,valence:0,arousal:0,immersion:0}),
    rates:{valenceSetpoint:-0.05,connectionAccel:1.5,accelDelay:30,poiseDefendThreshold:th,poiseDefendRate:0.004},
    verbose:false, onLog:()=>{},
  });
  const marks={};
  for(let i=1;i<=90;i++){
    await cad.tick(5);
    const s=await cad.getState();
    const t=tier(s.poise);
    if(!marks[t]) marks[t]={min:i*5,c:+s.connection.toFixed(3),p:+s.poise.toFixed(3)};
  }
  const f=await cad.getState();
  return {th, marks, end:{c:+f.connection.toFixed(3),p:+f.poise.toFixed(3)}};
}
(async()=>{ for(const th of [1.0,0.5,0.35,0.2,0.1]){ const r=await run(th);
  const m=r.marks;
  console.log("阈值 "+String(th).padEnd(5)+" | 档2@"+(m[2]?m[2].min+"min(c="+m[2].c+",p="+m[2].p+")":"—")+"  档3@"+(m[3]?m[3].min+"min(c="+m[3].c+",p="+m[3].p+")":"—")+"  | 450min 末: c="+r.end.c+" p="+r.end.p);
}})();