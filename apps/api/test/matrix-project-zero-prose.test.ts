import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { extractProjectZeroCandidates, normalizeProjectZeroValue, PROJECT_ZERO_EXTRACTOR_VERSION }
  from "../src/matrix-project-zero-prose.js";
import { pythonExecutable, pythonEnv } from "./python.js";

const fixture = JSON.parse(readFileSync(new URL("../../../services/worker/tests/fixtures/project-zero-F0101-F0139.json", import.meta.url), "utf8"));
// Frozen independent Python golden; no dependency on ignored output files at test time.
const golden = [
  {
    "sourceFileId": "F0101",
    "sourceSha256": "01db90e015c39a9502b99969ce04f27825265203bc8728da6141d7b6d2b1ef54",
    "stage": "PD",
    "originalPdfPage": 13,
    "candidates": [
      {
        "value": "159.95",
        "rawValue": "159,95",
        "rawUnit": "м",
        "canonicalUnit": "m",
        "localZero": "0",
        "referenceKind": "FINISHED_FLOOR",
        "referenceText": "отметке чистого пола входного вестибюля на 1-м этаже.",
        "datumName": null,
        "primaryFragments": [
          {
            "blockIndex": 0,
            "lineIndex": 8,
            "rawText": "За относительную отметку 0,000 принята абсолютная отметка 159,95 м., что соответствует ",
            "bboxMilliPoints": [
              85138,
              677046,
              515421,
              687066
            ]
          },
          {
            "blockIndex": 0,
            "lineIndex": 9,
            "rawText": "отметке чистого пола входного вестибюля на 1-м этаже.",
            "bboxMilliPoints": [
              85135,
              664986,
              351559,
              675006
            ]
          }
        ],
        "unitAuthorityFragments": []
      }
    ]
  },
  {
    "sourceFileId": "F0139",
    "sourceSha256": "d59c225e75d1e0227f08869b31165bd93bf85ed4b1da005c3e86ebc27023b73f",
    "stage": "RD",
    "originalPdfPage": 4,
    "candidates": [
      {
        "value": "159.95",
        "rawValue": "159.95",
        "rawUnit": "метрах",
        "canonicalUnit": "m",
        "localZero": "0",
        "referenceKind": "FINISHED_FLOOR",
        "referenceText": "чистого пола первого этажа",
        "datumName": null,
        "primaryFragments": [
          {
            "blockIndex": 40,
            "lineIndex": 0,
            "rawText": "За относительную отметку ±0.000 принята отметка чистого пола первого этажа, соответствующая абсолютной отметке  159.95.",
            "bboxMilliPoints": [
              97800,
              606951,
              559015,
              618830
            ]
          }
        ],
        "unitAuthorityFragments": [
          {
            "blockIndex": 32,
            "lineIndex": 18,
            "rawText": "Бетонирование вести непрерывно, без образования рабочих швов (кроме оговоренных). Соединение рабочих стержней и выпусков арматуры приняты по длине внахлестку. Все размеры даны в миллиметрах,",
            "bboxMilliPoints": [
              71940,
              433911,
              832182,
              445790
            ]
          },
          {
            "blockIndex": 32,
            "lineIndex": 19,
            "rawText": "отметки - в метрах.",
            "bboxMilliPoints": [
              72300,
              416811,
              141824,
              428690
            ]
          }
        ]
      }
    ]
  }
];
type Stage = "PD" | "RD";
type Page = { pageNumber: number; widthMilliPoints: number; heightMilliPoints: number;
  quality: Record<string, unknown>; blocks: Array<{ text: string; bboxMilliPoints: number[]; lineBboxesMilliPoints: number[][] }> };
function page(stage: Stage): Page {
  const item = fixture.sources.find((s: any) => s.source.stage === stage);
  return structuredClone(item.sourceArtifact.pages[item.provenance.targetOriginalPdfPage - 1]);
}
function replace(p: Page, bi: number, li: number, before: string, after: string) {
  const lines = p.blocks[bi].text.split("\n");
  if (!lines[li].includes(before)) throw new Error("Mutation precondition missing");
  lines[li] = lines[li].replace(before, after); p.blocks[bi].text = lines.join("\n");
}
function union(p: Page, bi: number) {
  const boxes = p.blocks[bi].lineBboxesMilliPoints;
  p.blocks[bi].bboxMilliPoints = [Math.min(...boxes.map(b => b[0])), Math.min(...boxes.map(b => b[1])),
    Math.max(...boxes.map(b => b[2])), Math.max(...boxes.map(b => b[3]))];
}
function shift(p: Page, bi: number, li: number, dx = 0, dy = 0) {
  const b = p.blocks[bi].lineBboxesMilliPoints[li];
  p.blocks[bi].lineBboxesMilliPoints[li] = [b[0] + dx, b[1] + dy, b[2] + dx, b[3] + dy]; union(p,bi);
}
function append(p: Page, text: string, box = [1000,1000,15000,13000]) {
  p.blocks.push({ text, bboxMilliPoints: box.slice(), lineBboxesMilliPoints: [box.slice()] });
}
type Vector = { name: string; stage: unknown; page: unknown };
const rejected: Vector[] = [];
function reject(name: string, stage: Stage, mutate: (p: Page) => void) {
  const p = page(stage); mutate(p); rejected.push({name,stage,page:p});
}
for (const stage of ["PD","RD"] as const) {
  const [bi,li,original] = stage === "PD" ? [0,8,"159,95"] as const : [40,0,"159.95"] as const;
  for (const raw of ["159.95–160.0","159.95-160.0","159.95/160","159.95 или 160","1 159.95","0159.95",
    "±159.95","159.95±0.1","не менее 159.95","1e3","NaN","9".repeat(65),"159.95\n","- 159.95"]) {
    reject(`${stage}:invalid-value:${raw}`,stage,p=>replace(p,bi,li,original,raw));
  }
  for (const text of ["За относительную отметку ???","«За относительную отметку 0,000...»,","За относительную отметку 0.000"])
    reject(`${stage}:competing-anchor:${text}`,stage,p=>append(p,text));
  for (const [letter, folded] of [["ᲂ","о"],["ᲃ","с"],["ᲄ","т"],["ᲅ","т"]])
    reject(`${stage}:casefold-competing-anchor:${letter}`,stage,p=>append(p,"За относительную отметку ???".replaceAll(folded,letter)));
  reject(`${stage}:split-competing-anchor`,stage,p=>p.blocks.push({text:"За относительную\nотметку ???",bboxMilliPoints:[1000,1000,20000,26000],
    lineBboxesMilliPoints:[[1000,14000,20000,26000],[1000,1000,20000,13000]]}));
  reject(`${stage}:quality`,stage,p=>{p.quality.disposition="OCR_REQUIRED";});
  reject(`${stage}:page-number-bool`,stage,p=>{(p as any).pageNumber=true;});
  reject(`${stage}:extra-page`,stage,p=>{(p as any).approved=true;});
  reject(`${stage}:extra-block`,stage,p=>{(p.blocks[bi] as any).approved=true;});
  reject(`${stage}:unicode-separator`,stage,p=>replace(p,bi,li,"принята","при\u2028нята"));
  reject(`${stage}:carriage-return`,stage,p=>replace(p,bi,li,"принята","при\rнята"));
  for (const wrong of ["ID","UNRESOLVED","pd",null,[],1,stage === "PD" ? "RD" : "PD"])
    rejected.push({name:`${stage}:wrong-stage:${JSON.stringify(wrong)}`,stage:wrong,page:page(stage)});
  for (const block of stage === "PD" ? [0] : [40,32]) for (const kind of ["absent","coarse","wrong-count","out-of-page","fraction","bool","reversed","block-union"]) {
    reject(`${stage}:geometry:${block}:${kind}`,stage,p=>{
      const b=p.blocks[block];
      if(kind==="absent")delete (b as any).lineBboxesMilliPoints;
      else if(kind==="coarse")b.lineBboxesMilliPoints=b.text.split("\n").map(()=>b.bboxMilliPoints.slice());
      else if(kind==="wrong-count")b.lineBboxesMilliPoints.pop();
      else if(kind==="out-of-page")b.lineBboxesMilliPoints[0][2]=p.widthMilliPoints+1;
      else if(kind==="fraction")b.lineBboxesMilliPoints[0][0]=1.5;
      else if(kind==="bool")(b.lineBboxesMilliPoints[0] as any)[0]=true;
      else if(kind==="reversed")b.lineBboxesMilliPoints[0][2]=0;
      else b.bboxMilliPoints[0]++;
    });
  }
}
for (const [stage,bi,li,before,after] of [
  ["PD",0,8,"За относительную","«За относительную"], ["PD",0,8,"принята","не принята"],
  ["PD",0,8," м."," мм."],["PD",0,8," м."," М."], ["PD",0,9,"чистого пола","перекрытия"],
  ["PD",0,9,"1-м","2-м"],["PD",0,9,"этаже.","этаже, кроме корпуса2."],
  ["RD",40,0,"принята","предположительно принята"],["RD",40,0,"первого","второго"],
  ["RD",40,0,"За","Не За"],["RD",40,0,"За",'"За'],["RD",32,19,"метрах","миллиметрах"],
  ["RD",32,18,"Все размеры","Не Все размеры"],["RD",32,18,"Все размеры","«Все размеры"],
] as const) reject(`${stage}:meaning:${before}:${after}`,stage,p=>replace(p,bi,li,before,after));
for (const marker of ["±0.001","-0.000","0","0.000±0.1"])
  reject(`RD:bad-marker:${marker}`,"RD",p=>replace(p,40,0,"±0.000",marker));
for (const text of ["отметки - в метрах.","Отметки указаны в миллиметрах.","Высотные отметки принимаются в сантиметрах.",
  "Отметки выражены в cm.","отметки - ???","Все размеры указаны в сантиметрах.","Высотные отметки: м.",
  "Отметки выражены в м.","Отметки выражены в mm.","Отметки выражены в m.","Отметки выражены в см."])
  reject(`RD:conflicting-note:${text}`,"RD",p=>append(p,text));
for (const text of ["Примечание отсутствует.","«отметки - в метрах.»","Кроме корпуса2 отметки - в метрах."])
  reject(`RD:missing-or-scoped-note:${text}`,"RD",p=>replace(p,32,19,"отметки - в метрах.",text));
for (const [stage,bi,li,dx,dy] of [["PD",0,9,1200,0],["PD",0,9,0,-5000],["RD",32,19,1200,0],
  ["RD",32,19,0,-3000],["RD",40,0,850000,0]] as const)
  reject(`${stage}:coherent-reboxed-geometry:${bi}:${dx}:${dy}`,stage,p=>shift(p,bi,li,dx,dy));
reject("RD:other-column-note","RD",p=>{for(const li of [18,19])shift(p,32,li,850000,0);});
for (const [stage,box] of [["PD",[90000,675000,100000,677000]],["RD",[100000,429000,150000,433000]],
  ["RD",[100000,610000,150000,615000]]] as const)
  reject(`${stage}:interleaved:${box.join(":")}`,stage,p=>append(p,"Инородная строка",[...box]));
reject("PD:invalid-unselected-original-block","PD",p=>{p.blocks.at(-1)!.bboxMilliPoints[3]=p.heightMilliPoints+1;});

const accepted: Vector[] = [];
for (const stage of ["PD","RD"] as const) {
  const [bi,li,original] = stage === "PD" ? [0,8,"159,95"] as const : [40,0,"159.95"] as const;
  for (const raw of ["159.96","-159,9600","+159.9500","0.000","-0,00","159","9".repeat(64)]) {
    const p=page(stage);replace(p,bi,li,original,raw);accepted.push({name:`${stage}:signed:${raw}`,stage,page:p});
  }
  for (const whitespace of ["\t","\u00a0","\u202f"]) {
    const p=page(stage);p.blocks[bi].text=p.blocks[bi].text.replaceAll(" ",whitespace);
    accepted.push({name:`${stage}:raw-whitespace:${JSON.stringify(whitespace)}`,stage,page:p});
  }
  const p=page(stage);p.pageNumber=999;accepted.push({name:`${stage}:no-page-allowlist`,stage,page:p});
}
for (const marker of ["±0.000","0.000","±0,000"]) {
  const p=page("RD");replace(p,40,0,"±0.000",marker);accepted.push({name:`RD:zero-marker:${marker}`,stage:"RD",page:p});
}

describe("independent project zero adopted-prose boundary",()=>{
  it("matches frozen full35-page golden with original raw unit and floor qualifiers",()=>{
    expect(PROJECT_ZERO_EXTRACTOR_VERSION).toBe("matrix-project-zero-prose-v1");
    expect(fixture.sources.reduce((n:number,s:any)=>n+s.sourceArtifact.pages.length,0)).toBe(35);
    for(const item of fixture.sources) {
      const expected=golden.find(g=>g.sourceFileId===item.source.file_id)!;
      const all=item.sourceArtifact.pages.flatMap((p:Page)=>extractProjectZeroCandidates(p,item.source.stage));
      expect(all).toEqual(expected.candidates);
      for(const fact of all){expect(fact.datumName).toBeNull();expect(fact).not.toHaveProperty("entityKey");expect(fact).not.toHaveProperty("qualified");}
    }
    expect(extractProjectZeroCandidates(page("RD"),"RD")[0].unitAuthorityFragments).toHaveLength(2);
    expect(extractProjectZeroCandidates(page("PD"),"PD")[0].primaryFragments).toHaveLength(2);
  });
  it.each(rejected)("abstains: $name",vector=>{expect(extractProjectZeroCandidates(vector.page,vector.stage)).toEqual([]);});
  it.each(accepted)("extracts exact adopted scalar: $name",vector=>{
    const result=extractProjectZeroCandidates(vector.page,vector.stage);expect(result).toHaveLength(1);
    expect(result[0].value).toBe(normalizeProjectZeroValue(result[0].rawValue,result[0].rawUnit));
  });
  it("independently agrees with Python across all wire mutations",()=>{
    const vectors=[...rejected,...accepted];
    const proc=spawnSync(pythonExecutable,["-c",`import json,sys
from inspector_worker.project_zero_prose import extract_project_zero_candidates
x=json.load(sys.stdin)
json.dump([extract_project_zero_candidates(v['page'],v['stage']) for v in x],sys.stdout,ensure_ascii=False)`],
      {input:JSON.stringify(vectors),encoding:"utf8",env:{...process.env,...pythonEnv},timeout:30000,maxBuffer:8*1024*1024});
    expect(proc.status,proc.stderr).toBe(0);const expected=JSON.parse(proc.stdout);
    vectors.forEach((vector,i)=>expect(extractProjectZeroCandidates(vector.page,vector.stage),vector.name).toEqual(expected[i]));
  });
  it("rejects native TS malformed arrays, numbers, accessors and unsupported shapes",()=>{
    for(const mutate of [
      (p:any)=>{p.widthMilliPoints=Number.MAX_SAFE_INTEGER+1;},(p:any)=>{p.pageNumber=NaN;},
      (p:any)=>{p.heightMilliPoints=Infinity;},(p:any)=>{delete p.blocks[0].lineBboxesMilliPoints[0];},
      (p:any)=>{p.blocks[0].lineBboxesMilliPoints[0]=new Float64Array([1,2,3,4]);},
      (p:any)=>{p.blocks[0].lineBboxesMilliPoints[0].push(10);},(p:any)=>{p.blocks[0].bboxMilliPoints[0]=-1;},
      (p:any)=>{p.blocks[0].bboxMilliPoints[0]=Number.MAX_SAFE_INTEGER+1;},
      (p:any)=>{Object.defineProperty(p,"extra",{value:true});},(p:any)=>{p[Symbol("hidden")]=true;},
      (p:any)=>{Object.defineProperty(p.blocks[0],"text",{get(){throw Error("Getter executed");},enumerable:true});},
      (p:any)=>{delete p.blocks[0];},(p:any)=>{p.blocks[0].lineBboxesMilliPoints[0].extra=true;},
    ]) {const p=page("PD");mutate(p);expect(extractProjectZeroCandidates(p,"PD")).toEqual([]);}
    for(const raw of [null,[],new Map(),1,"page"])expect(extractProjectZeroCandidates(raw,"PD")).toEqual([]);
  });
  it("preserves all input bytes and returns independent fragment snapshots",()=>{
    const before=JSON.stringify(fixture);
    for(const item of fixture.sources) {
      const p=item.sourceArtifact.pages[item.provenance.targetOriginalPdfPage-1];
      const first=extractProjectZeroCandidates(p,item.source.stage),second=extractProjectZeroCandidates(p,item.source.stage);
      expect(first).toEqual(second);first[0].primaryFragments[0].bboxMilliPoints[0]=0;
      expect(extractProjectZeroCandidates(p,item.source.stage)).toEqual(second);
    }
    expect(JSON.stringify(fixture)).toBe(before);
  });
  it("normalizes signed decimals only for the two original unit spellings",()=>{
    for(const [raw,value] of [["-159,9600","-159.96"],["+159.9500","159.95"],["-0,00","0"],["+0","0"],["159","159"]])
      for(const unit of ["м","метрах"])expect(normalizeProjectZeroValue(raw,unit)).toBe(value);
    for(const raw of [" 159.95","159.95\n","±159.95","1e3","1 159.95","0159.95","9".repeat(65),null,true])
      expect(normalizeProjectZeroValue(raw,"м")).toBeNull();
    for(const unit of ["m","М","мм","cm"," метрах",null])expect(normalizeProjectZeroValue("159.95",unit)).toBeNull();
    expect(JSON.parse("120480.0")).toBe(JSON.parse("120480"));
  });
});
