import { z } from "zod";

const route = z.object({
  title:z.string().min(1).max(160), rows:z.array(z.string().regex(/^[S.E*#]{1,128}$/)).min(1).max(128),
  required:z.number().int().min(0).max(16384), solution:z.string().regex(/^[UDLR]{1,4096}$/)
});
const offsets: Record<string,readonly [number,number]> = {U:[0,-1],D:[0,1],L:[-1,0],R:[1,0]};

/** Replay the reviewed game asset independently of the Player's own clear signal. */
export function verifyPlayableLevel(content:Buffer, observed:unknown) {
  const level=route.parse(JSON.parse(content.toString("utf8")));
  const start=level.rows.flatMap((row,y)=>Array.from(row,(tile,x)=>({tile,x,y}))).filter(c=>c.tile==="S");
  if(start.length!==1 || level.rows.some(r=>r.length!==level.rows[0].length) ||
    level.rows.join("").split("E").length!==2)throw Error("PHASE_LEVEL_INVALID");
  let {x,y}=start[0], cleared=false;
  const collected=new Set<string>();
  for(const step of level.solution){
    const [dx,dy]=offsets[step];x+=dx;y+=dy;
    const tile=level.rows[y]?.[x];
    if(cleared || !tile || tile==="#")throw Error("PHASE_LEVEL_INVALID");
    if(tile==="*") collected.add(x+","+y);
    if(tile==="E"){if(collected.size<level.required)throw Error("PHASE_LEVEL_INVALID");cleared=true;}
  }
  const expected={name:level.title,moves:level.solution.length,collected:collected.size,cleared};
  const actual=z.object({name:z.string(),moves:z.number(),collected:z.number(),cleared:z.boolean()}).safeParse(observed);
  if(!cleared || !actual.success || Object.entries(expected).some(([key,value])=>actual.data[key as keyof typeof expected]!==value))
    throw Error("PHASE_LEVEL_SIGNAL_CHANGED");
  return expected;
}
