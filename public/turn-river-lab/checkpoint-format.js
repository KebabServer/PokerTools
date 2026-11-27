/* Portable checkpoint containers. V1 stores little-endian Float64 entries.
 * V2 stores the aligned mixed-width arena as raw bytes.
 * CFRSolver.resume() verifies the game fingerprint and typed planes. */
function createCheckpointFormat(){
 'use strict';
 const MAGIC='TRLC12\x00',headBytes=16;
 const formats={1:'TurnRiverLab-checkpoint-v1',2:'TurnRiverLab-checkpoint-v2'};
 function checksum(bytes){let h=2166136261>>>0;for(let i=0;i<bytes.length;i++)h=Math.imul(h^bytes[i],16777619)>>>0;return h.toString(16).padStart(8,'0');}
 function encode(checkpoint,config){
  const version=checkpoint.format===formats[1]?1:checkpoint.format===formats[2]?2:0;
  const state=checkpoint.storage;
  if(!version||!(state instanceof (version===1?Float64Array:Uint8Array)))throw Error('Invalid checkpoint');
  const {storagePrecision,...settings}=config;
  const safeConfig={...settings,storageLayout:checkpoint.storageLayout??config.storageLayout??'dense',
    ...(version===2?{storagePrecision:checkpoint.storagePrecision??storagePrecision}:{}),
    weights0:Array.from(config.weights0),weights1:Array.from(config.weights1)};
  const stateBytes=new Uint8Array(state.buffer,state.byteOffset,state.byteLength);
  const header={format:checkpoint.format,fingerprint:checkpoint.fingerprint,iteration:checkpoint.iteration,
    elapsedMs:checkpoint.elapsedMs,history:checkpoint.history,prunedMasks:checkpoint.prunedMasks??null,config:safeConfig,
    ...(checkpoint.publicChance?{publicChance:checkpoint.publicChance}:{}),
    storageLength:state.length,stateChecksum:checksum(stateBytes)};
  const json=new TextEncoder().encode(JSON.stringify(header));
  if(json.length>16000000||state.length>0xffffffff)throw Error('Checkpoint is too large');
  const buffer=new ArrayBuffer(headBytes+json.length+state.byteLength);
  const bytes=new Uint8Array(buffer);
  for(let i=0;i<MAGIC.length;i++)bytes[i]=MAGIC.charCodeAt(i);
  bytes[7]=version;
  const v=new DataView(buffer);v.setUint32(8,json.length,true);v.setUint32(12,state.length,true);
  bytes.set(json,headBytes);bytes.set(stateBytes,headBytes+json.length);
  return buffer;
 }
 function decode(buffer){
  if(!(buffer instanceof ArrayBuffer)||buffer.byteLength<headBytes)throw Error('Invalid checkpoint file');
  const bytes=new Uint8Array(buffer);for(let i=0;i<MAGIC.length;i++)if(bytes[i]!==MAGIC.charCodeAt(i))throw Error('Not a TurnRiverLab checkpoint');
  const version=bytes[7],format=formats[version];
  if(!format)throw Error('Unsupported checkpoint format');
  const v=new DataView(buffer),length=v.getUint32(8,true),n=v.getUint32(12,true),width=version===1?8:1;
  const offset=headBytes+length;
  if(length>16000000||offset+n*width!==bytes.length)throw Error('Truncated checkpoint or invalid state length');
  const header=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(headBytes,offset)));
  if(header.format!==format||header.storageLength!==n||!header.config)throw Error('Checkpoint metadata mismatch');
  const payload=bytes.subarray(offset);
  if(checksum(payload)!==header.stateChecksum)throw Error('Checkpoint state checksum mismatch (damaged file)');
  let state;
  if(version===2)state=payload.slice();
  else {
   state=new Float64Array(n);
   for(let i=0;i<n;i++)state[i]=v.getFloat64(offset+i*8,true);
  }
  const storageLayout=header.config.storageLayout??'dense',storagePrecision=header.config.storagePrecision??'float64';
  return {config:{...header.config,storageLayout,storagePrecision,weights0:Float64Array.from(header.config.weights0),weights1:Float64Array.from(header.config.weights1)},
    checkpoint:{format,fingerprint:header.fingerprint,iteration:header.iteration,
      elapsedMs:header.elapsedMs,history:header.history,prunedMasks:header.prunedMasks??null,
      storageLayout,storagePrecision,storage:state,...(header.publicChance?{publicChance:header.publicChance}:{})}};
 }
 return {encode,decode};
}
if(typeof module!=='undefined'&&module.exports)module.exports={createCheckpointFormat};
