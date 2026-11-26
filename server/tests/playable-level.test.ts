import assert from "node:assert/strict";
import {test} from "node:test";
import {verifyPlayableLevel} from "../domain/playable-level";
const asset={title:"Star Orchard",rows:["S.E","*#*","..."],required:2,solution:"DDRRUU"};
const live={name:"Star Orchard",moves:6,collected:2,cleared:true};
test("level acceptance ties the built Player to the reviewed route, pickups and exit",()=>{
  assert.deepEqual(verifyPlayableLevel(Buffer.from(JSON.stringify(asset)),live),live);
  for(const solution of ["RR","DR","DD","DDRRUUD"])
    assert.throws(()=>verifyPlayableLevel(Buffer.from(JSON.stringify({...asset,solution})),live),/PHASE_LEVEL_INVALID|PHASE_LEVEL_SIGNAL_CHANGED/);
  for(const change of [{name:"Lantern Maze"},{moves:7},{collected:1},{cleared:false}])
    assert.throws(()=>verifyPlayableLevel(Buffer.from(JSON.stringify(asset)),{...live,...change}),/PHASE_LEVEL_SIGNAL_CHANGED/);
});
