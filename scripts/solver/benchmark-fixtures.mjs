import { core } from './harness.mjs'

function weightedRange(minPair,minHigh,minKicker) {
  return Float64Array.from(core.ALL_COMBOS,([a,b])=>{
    const hi=Math.max(core.rank(a),core.rank(b)),lo=Math.min(core.rank(a),core.rank(b))
    if(hi===lo)return hi>=minPair?1:0
    if(hi<minHigh||lo<minKicker)return 0
    if((a&3)===(b&3))return lo+2>=hi||hi>=12?1:.45
    return hi>=12&&lo>=9?.65:0
  })
}
function stressRange(weights) {
  return Float64Array.from(weights,(w,i)=>w&&i%5===0?w*10**(-(i%19)):0)
}
const wide0=weightedRange(7,10,7),wide1=weightedRange(5,10,6)
const flop={
  board:['As','Th','2d'],pot:100,stack:100,maxRaises:1,allIn:true,maxNodes:100_000,
  flopSizes0:[33,66],flopSizes1:[50],flopRaiseSizes0:[50],flopRaiseSizes1:[50],
  turnSizes0:[50],turnSizes1:[],sizes0:[],sizes1:[],
  flopSamplingSeed:79,flopTurnSamples:3,flopRiverSamples:4,
  weights0:wide0,weights1:wide1,
}
const river={
  ...flop,board:[...flop.board,'8h','4c'],sizes0:[50],sizes1:[75],allIn:false,maxRaises:0,
}
export const precisionCases={
  'sampled-flop':{config:flop,steps:1000,every:50},
  'exact-flop':{
    config:{...flop,flopTurnSamples:49,flopRiverSamples:48,flopSizes0:[50],flopSizes1:[],
      turnSizes0:[],turnSizes1:[],sizes0:[33],allIn:false,maxRaises:0},
    steps:40,every:8,
  },
  'locked-a':{config:river,lock:62,steps:5000,every:500},
  'locked-b':{config:river,lock:62.25,steps:5000,every:500},
  long:{
    config:{...river,pot:900_000,stack:900_000,weights0:stressRange(wide0),weights1:stressRange(wide1),
      gtoAlgorithm:'dcfr-scheduled-cubic',scheduledAveragingPower:4},
    steps:50_000,every:5000,
  },
}

export const pairedTurn={...river,board:['As','Ah','7d','2c'],stack:160,turnSizes0:[50],turnSizes1:[50],
  sizes0:[33,75],sizes1:[50]};
export const fixedRiver=river;
