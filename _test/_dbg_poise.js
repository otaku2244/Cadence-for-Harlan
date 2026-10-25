const { createCadence } = require("../vendor/cadence.js");
const cad = createCadence({
  getLastMessage: () => null,
  connectionRateFn: () => 0.0025,
  onSave: async () => {}, onLoad: async () => ({connection:0,poise:0,valence:0,arousal:0,immersion:0}),
  rates: { valenceSetpoint:-0.05, connectionAccel:1.5, accelDelay:30, poiseDefendThreshold: 1.0, poiseDefendRate:0.004 },
  verbose:false, onLog:()=>{},
});
(async()=>{
  for (let i=1;i<=48;i++){
    await cad.tick(5);
    const s = await cad.getState();
    if (i%6===0) console.log("t="+(i*5)+"min c="+s.connection.toFixed(3)+" p="+s.poise.toFixed(3));
  }
})();