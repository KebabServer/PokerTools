/* Portable binary checkpoint format: JSON metadata + little-endian state.
 * No dependency on Node.js or external libraries. The caller must verify the
 * complete game fingerprint through CFRSolver.resume() before using state. */
function createCheckpointFormat(){
 'use strict';
 const MAGIC='TRLC12\x00\x01',headBytes=16;
 function checksum(bytes){let h=2166136261>>>0;for(let i=0;i<bytes.length;i++)h=Math.imul(h^bytes[i],16777619)>>>0;return h.toString(16).padStart(8,'0');}
 function encode(checkpoint,config){
  const compact=checkpoint.format==='TurnRiverLab-checkpoint-v2';
  if(compact?!(checkpoint.storage instanceof Uint8Array):
    checkpoint.format!=='TurnRiverLab-checkpoint-v1'||!(checkpoint.storage instanceof Float64Array))throw Error('Invalid checkpoint');
  const safeConfig={...config,weights0:Array.from(config.weights0),weights1:Array.from(config.weights1)};
  const header={format:checkpoint.format,fingerprint:checkpoint.fingerprint,iteration:checkpoint.iteration,
    elapsedMs:checkpoint.elapsedMs,history:checkpoint.history,prunedMasks:checkpoint.prunedMasks??null,config:safeConfig,storageLength:checkpoint.storage.length,
    stateChecksum:checksum(new Uint8Array(checkpoint.storage.buffer,checkpoint.storage.byteOffset,checkpoint.storage.byteLength))};
  const json=new TextEncoder().encode(JSON.stringify(header));
  if(json.length>16000000)throw Error('Checkpoint header too large');
  const headerLength=compact?Math.ceil(json.length/8)*8:json.length;
  const buffer=new ArrayBuffer(headBytes+headerLength+checkpoint.storage.byteLength);
  const bytes=new Uint8Array(buffer);for(let i=0;i<MAGIC.length;i++)bytes[i]=MAGIC.charCodeAt(i);
  const v=new DataView(buffer);v.setUint32(8,headerLength,true);v.setUint32(12,checkpoint.storage.length,true);
  bytes.set(json,headBytes);
  bytes.fill(32,headBytes+json.length,headBytes+headerLength);
  bytes.set(new Uint8Array(checkpoint.storage.buffer,checkpoint.storage.byteOffset,checkpoint.storage.byteLength),headBytes+headerLength);
  return buffer;
 }
 function decode(buffer){
  if(!(buffer instanceof ArrayBuffer)||buffer.byteLength<headBytes)throw Error('Invalid checkpoint file');
  const bytes=new Uint8Array(buffer);for(let i=0;i<MAGIC.length;i++)if(bytes[i]!==MAGIC.charCodeAt(i))throw Error('Not a TurnRiverLab checkpoint');
  const v=new DataView(buffer),length=v.getUint32(8,true),n=v.getUint32(12,true);
  if(length>16000000||headBytes+length>bytes.length)
    throw Error('Truncated checkpoint or invalid state length');
  const header=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(headBytes,headBytes+length)));
  const compact=header.format==='TurnRiverLab-checkpoint-v2',offset=headBytes+length;
  if((compact?offset%8!==0:header.format!=='TurnRiverLab-checkpoint-v1')||
    header.storageLength!==n||!header.config||offset+n*(compact?1:8)!==bytes.length)
    throw Error('Checkpoint metadata or state length mismatch');
  if(checksum(bytes.subarray(headBytes+length))!==header.stateChecksum)throw Error('Checkpoint state checksum mismatch (damaged file)');
  const state=compact?new Uint8Array(buffer,offset,n):new Float64Array(n);
  if(!compact)for(let i=0;i<n;i++)state[i]=v.getFloat64(offset+i*8,true);
  return {config:{...header.config,weights0:Float64Array.from(header.config.weights0),weights1:Float64Array.from(header.config.weights1)},
    checkpoint:{format:header.format,fingerprint:header.fingerprint,iteration:header.iteration,
      elapsedMs:header.elapsedMs,history:header.history,prunedMasks:header.prunedMasks??null,storage:state}};
 }
 return {encode,decode};
}
if(typeof module!=='undefined'&&module.exports)module.exports={createCheckpointFormat};
