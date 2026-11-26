import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, mkdir, rm, open } from "node:fs/promises";
import { join, relative, isAbsolute } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { generateProceduralMedia } from "../adapters/media/procedural-media";
import { inspectPng, inspectWav } from "../adapters/media/inspect-media";
import { collectMedia } from "../adapters/storage/media-artifacts";
import { mediaBudget } from "../../shared/contracts/desktop-media";
import { applyTransfer, undoTransfer, previewTransfer } from "../application/desktop/transfers";
import { readFile } from "node:fs/promises";
import { safeFile, snapshotFiles } from "../adapters/storage/evidence";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

test("D5 temporary assets decode to requested PNG/WAV/sheet dimensions; corruption is not success", () => {
  const art = generateProceduralMedia({kind:"art",format:"png",width:37,height:23,color:"#12abcd",shape:"diamond",transparent:true})[0];
  const decoded = inspectPng(art.data); assert.equal(decoded.width,37); assert.equal(decoded.height,23); assert.ok(decoded.transparentPixels > 0);
  const circle=inspectPng(generateProceduralMedia({kind:"art",format:"png",width:128,height:96,color:"#55AAFF",shape:"circle",transparent:true})[0].data);
  assert.equal(circle.visibleBounds?.width,76);assert.equal(circle.visibleBounds?.height,76);
  const broken = Buffer.from(art.data); broken[45] ^= 1; assert.throws(()=>inspectPng(broken),/INVALID_PNG/);
  assert.throws(()=>inspectPng(Buffer.from("a description of an image")),/INVALID_PNG/);
  const sound = generateProceduralMedia({kind:"sound",format:"wav",seconds:.123,frequency:440,sampleRate:"44100",channels:2,waveform:"triangle",fade:true})[0];
  const wav = inspectWav(sound.data); assert.equal(wav.channels,2); assert.ok(Math.abs(wav.seconds-.123)<1/44100);
  const badWave = Buffer.from(sound.data); badWave.writeUInt16LE(2,32); assert.throws(()=>inspectWav(badWave),/INVALID/);
  assert.throws(()=>inspectWav(sound.data.subarray(0,-1)),/INVALID/);
  const effect = generateProceduralMedia({kind:"effect",format:"png-sheet",width:24,height:16,color:"#ffaa00",frames:8,seconds:1});
  assert.equal(inspectPng(effect[0].data).width,192); assert.equal(inspectPng(effect[0].data).height,16);
  assert.equal(JSON.parse(effect[1].data.toString()).frames,8);
  assert.throws(()=>generateProceduralMedia({kind:"effect",format:"png-sheet",width:1024,height:1024,color:"#ffaa00",frames:32,seconds:1}),/PIXEL_LIMIT/);
  assert.throws(()=>generateProceduralMedia({kind:"sound",format:"wav",seconds:1,frequency:12000,sampleRate:"22050",channels:1,waveform:"sine",fade:true}),/FREQUENCY_UNSUPPORTED/);
});

test("D5 ignored large WAV participates in fingerprints and binary transfer recovery; legacy 2 MiB remains", async () => {
  const root = await mkdtemp(join(tmpdir(),"orchiva-d5-transfer-")), run=promisify(execFile);
  try {
    await run("git",["-C",root,"init","-b","main"]);await writeFile(join(root,".gitignore"),"media/\n");await run("git",["-C",root,"add",".gitignore"]);await run("git",["-C",root,"-c","user.name=Test","-c","user.email=test@example.invalid","commit","-m","fixture"]);
    const data=generateProceduralMedia({kind:"sound",format:"wav",seconds:15,frequency:440,sampleRate:"48000",channels:2,waveform:"sine",fade:true})[0].data;
    assert.ok(data.length>2*1024*1024);await mkdir(join(root,"media"));await writeFile(join(root,"media/tone.wav"),data);
    await assert.rejects(safeFile(root,"media/tone.wav"),/2 MiB/);
    assert.deepEqual((await snapshotFiles(root,[])).changedFiles,[]);
    const before=await snapshotFiles(root,[],["media/tone.wav"]);assert.equal(before.files[0].size,data.length);
    const changed=Buffer.from(data);changed[100]^=1;await writeFile(join(root,"media/tone.wav"),changed);
    assert.notEqual((await snapshotFiles(root,[],["media/tone.wav"])).fingerprint,before.fingerprint);
    const digest=(b:Buffer)=>createHash("sha256").update(b).digest("hex");
    const manifest={version:1 as const,media:true as const,projectId:"media-test",token:"media-test",resultId:"result-test",fingerprint:before.fingerprint,files:[{path:"media/tone.wav",before:digest(changed),after:digest(data),content:data.toString("base64")}]};
    assert.equal((await previewTransfer(root,manifest))[0].conflict,false);
    await assert.rejects(applyTransfer(root,manifest,"media-transfer-01",["media/tone.wav"],()=>{throw Error("INTERRUPTED");}),/INTERRUPTED/);
    assert.equal((await applyTransfer(root,manifest,"media-transfer-01",["media/tone.wav"])).state,"applied");
    assert.deepEqual(await readFile(join(root,"media/tone.wav")),data);
    await undoTransfer(root,"media-transfer-01");assert.deepEqual(await readFile(join(root,"media/tone.wav")),changed);
    const {media: _media,...legacy}=manifest;await assert.rejects(previewTransfer(root,legacy),/FILE_LIMIT/);
  } finally { const delta=relative(tmpdir(),root);assert.ok(delta&&!delta.startsWith("..")&&!isAbsolute(delta));await rm(root,{recursive:true,force:true}); }
});

test("D5 manifest hashes large and ignored outputs without relaxing legacy limits", async () => {
  const root = await mkdtemp(join(tmpdir(),"orchiva-d5-"));
  try {
    await mkdir(join(root,"outputs")); await writeFile(join(root,".gitignore"),"outputs/\n");
    const data = Buffer.alloc(3*1024*1024,79); await writeFile(join(root,"outputs/large.bin"),data);
    const entries = await collectMedia(root,["outputs/large.bin"]);
    assert.equal(entries[0].bytes,data.length); assert.equal(entries[0].sha256,createHash("sha256").update(data).digest("hex"));
    await assert.rejects(collectMedia(root,["../escape"]),/INVALID_PATH/);
    await assert.rejects(collectMedia(root,["outputs/large.bin","OUTPUTS/LARGE.bin"]),/DUPLICATE/);
    await assert.rejects(collectMedia(root,["docs/.orchiva/state.json"]),/METADATA/);
    await assert.rejects(collectMedia(root,["outputs"]),/REGULAR/);
    await assert.rejects(collectMedia(root,["outputs/missing.png"]),/ENOENT/);
    const handle = await open(join(root,"outputs/oversize.bin"),"wx"); try { await handle.truncate(mediaBudget.perFile+1); } finally {await handle.close();}
    await assert.rejects(collectMedia(root,["outputs/oversize.bin"]),/SIZE_LIMIT/);
  } finally {
    const delta = relative(tmpdir(),root); assert.ok(delta && !delta.startsWith("..") && !isAbsolute(delta)); await rm(root,{recursive:true,force:true});
  }
});
