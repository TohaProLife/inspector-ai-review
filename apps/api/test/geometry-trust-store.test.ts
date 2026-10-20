import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { generateKeyPairSync, sign } from "node:crypto";
import { it, expect } from "vitest";
import { canonicalJson, sha256 } from "../src/canonical-json.js";
import { loadTrustedGeometryRegistration } from "../src/geometry-trust-store.js";
import { pythonExecutable, pythonEnv, projectRoot } from "./python.js";
it("requires signed operator authority, independent source bytes, actual PDF frame, SHA and holdout errors", async () => {
 const directory = await mkdtemp(join(tmpdir(),"trusted-geometry-test-"));
 try {
  const generated = JSON.parse(execFileSync(pythonExecutable,["-c",`import fitz,json,base64\nfrom services.worker.tests.test_geometry_registration_v1 import packet\nd=fitz.open();d.new_page()\nprint(json.dumps({'pdf':base64.b64encode(d.tobytes()).decode(),'packet':packet()}))`],{cwd:projectRoot,env:{...process.env,...pythonEnv,PYTHONPATH:"services/worker"},encoding:"utf8"}));
  const sourceBytes=Buffer.from(generated.pdf,"base64"), sourceSha256=sha256(sourceBytes);
  generated.packet.source.sourceSha256=sourceSha256;
  const independent=Buffer.from("Synthetic survey source. Not actual building coordinates.");
  const {publicKey,privateKey}=generateKeyPairSync("ed25519");
  await writeFile(join(directory,"operator.pub.pem"),publicKey.export({type:"spki",format:"pem"}));
  await writeFile(join(directory,"survey.csv"),independent);
  const payload={registrationId:"test",organizationId:"org",objectId:"object",sourceFileId:"file",sourceSha256,
   independentSource:{file:"survey.csv",sha256:sha256(independent),authority:"Synthetic surveyor",reference:"Synthetic acceptance data only",approvedBy:"test-operator",approvedAt:"2026-10-17T12:00:00Z"},packet:generated.packet};
  const install=async()=>writeFile(join(directory,"test.json"),canonicalJson({schemaVersion:"signed-geometry-control-source-v1",keyId:"operator",payload,signature:sign(null,Buffer.from(canonicalJson(payload)),privateKey).toString("base64")}));
  await install();
  const input={directory,registrationId:"test",organizationId:"org",objectId:"object",sourceFileId:"file",sourceSha256,sourceBytes};
  const result=await loadTrustedGeometryRegistration(input);
  expect(result.status).toBe("REVIEW_ONLY"); expect(result.findings).toEqual([]);
  expect(result.result!.maxHoldoutResidualProjectUnits).toBeLessThan(1e-12);
  await expect(loadTrustedGeometryRegistration({...input,objectId:"other"})).rejects.toThrow(/scope/);
  await writeFile(join(directory,"survey.csv"),"changed survey");
  await expect(loadTrustedGeometryRegistration(input)).rejects.toThrow(/control source SHA/);
  await writeFile(join(directory,"survey.csv"),independent);
  payload.packet.source.pdfPageNumber=2;await install();
  await expect(loadTrustedGeometryRegistration(input)).rejects.toThrow();
  payload.packet.source.pdfPageNumber=1; payload.packet.controlPoints[3].project[0]+=0.1; await install();
  await expect(loadTrustedGeometryRegistration(input)).rejects.toThrow(/numerical/);
  payload.packet.controlPoints[3].project[0]-=0.1;await install();
  const other=generateKeyPairSync("ed25519");await writeFile(join(directory,"operator.pub.pem"),other.publicKey.export({type:"spki",format:"pem"}));
  await expect(loadTrustedGeometryRegistration(input)).rejects.toThrow(/signature/);
 } finally {await rm(directory,{recursive:true,force:true});}
});
