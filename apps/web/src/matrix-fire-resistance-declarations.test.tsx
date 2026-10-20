import {readFileSync} from "node:fs";
import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {describe,expect,it} from "vitest";
import type {MatrixFireResistanceSourceDeclaration,MatrixSourceDeclarationsV2,SourceFileSummary} from "@inspector-ai/contracts";
import {MatrixSourceDeclarations} from "./MatrixSourceDeclarations";
import {fireDeclarationEvidence,fireDeclarationMatchesQuery,fireDeclarationViewerKey} from "./MatrixFireResistanceDeclarations";
const fixture=JSON.parse(readFileSync(new URL("../../../services/worker/tests/fixtures/table-row-binding-v1/fire-requirements-F0106-p51.json",import.meta.url),"utf8"));
const values:["R"|"REI",number][]=[["R",120],["REI",120],["REI",150],["REI",120],["REI",120],["REI",60]];
const declarations:MatrixFireResistanceSourceDeclaration[]=values.map(([criterion,minutes],i)=>({
  schemaVersion:"matrix-source-declaration-v1",id:String(i+1).repeat(64),kind:"SOURCE_AUTHORED_FIRE_RESISTANCE_DECLARATION",extractorVersion:"matrix-fire-resistance-table-v1",
  sourceFileId:"F0106",sourceSha256:"a".repeat(64),textArtifactHash:"b".repeat(64),stage:"PD",pageNumber:51,
  widthMilliPoints:fixture.page.widthMilliPoints,heightMilliPoints:fixture.page.heightMilliPoints,criterion,minutes,
  rawValue:fixture.expected.rows[i].cells[1].fragments[0].rawText,rawUnit:"мин",canonicalUnit:"min",
  constructionLabelLines:fixture.expected.rows[i].cells[0].fragments.map((p:any)=>p.rawText),entityKey:null,applicabilityStatus:"UNREVIEWED",
  primaryFragments:structuredClone(fixture.expected.rows[i].cells[1].fragments),scopeFragments:structuredClone(fixture.expected.rows[i].cells[0].fragments),
  headerFragments:[structuredClone(fixture.expected.columns[0].headerFragments[0]),structuredClone(fixture.expected.columns[1].headerFragments[0])],
  unitFragments:structuredClone(fixture.expected.columns[1].unitFragments),bindingPolicyVersion:"matrix-fire-resistance-upper-table-v1",tableBoxMilliPoints:[122640,672528,538680,797808],
}));
const artifact:MatrixSourceDeclarationsV2={schemaVersion:"matrix-source-declarations-v2",extractorVersion:"matrix-source-declarations-v2",objectId:"OBJ-FIRE",inputManifestHash:"c".repeat(64),purpose:"EVIDENCE_ONLY",declarations};
const files:SourceFileSummary[]=[{id:"F0106",sha256:"a".repeat(64),name:"Полный КР ПД.pdf",size:1000,stages:["PD"],pageCount:139,registeredAt:"2026-10-18T00:00:00Z",review:null}];
const render=(query="",current=artifact)=>renderToStaticMarkup(createElement(MatrixSourceDeclarations,{artifact:current,objectId:"OBJ-FIRE",files,query,sections:{F0106:"KR"}}));
describe("source-authored fire resistance evidence UI",()=>{
  it("shows six original categories with distinct R/REI and every source role",()=>{
    const html=render();for(const text of ["Строк огнестойкости: 6 / 6","Запись огнестойкости: R 120 мин","Запись огнестойкости: REI 150 мин","пожарные отсеки","ПД · Раздел: KR · PDF 51","Категория конструкции","Заголовок таблицы","Единица из таблицы","не добавляют выполненных сравнений"])expect(html).toContain(text);
    expect((html.match(/<button/g)??[]).length).toBe(31);
    expect(html).not.toMatch(/Класс стали|productScope|Машинное предупреждение|Нет отклонения|80%|Подтвердить|Сохранить|Привязать|Сравнить|Þ»/u);
  });
  it("searches original categories, metadata, criterion/value and unit without discarding full context",()=>{
    for(const query of ["пожарные отсеки","REI 150","Мостовой переход"])expect(render(query)).toContain("Строк огнестойкости: 1 / 6");
    for(const query of ["мин","KR","Полный КР ПД.pdf"])expect(render(query)).toContain("Строк огнестойкости: 6 / 6");
    expect(fireDeclarationMatchesQuery(declarations[0],"С245",files)).toBe(false);
  });
  it("does not claim complete inventory for empty results or a missing query",()=>{
    for(const html of [render("неизвестная категория"),render("",{...artifact,declarations:[]})]){expect(html).toContain("Полнота поиска огнестойкости по документам не подтверждена");expect(html).not.toContain("<button");}
  });
  for(const fact of declarations)for(const kind of ["primary","scope","header","unit"] as const)it(`${fact.id[0]} ${kind}: exact source line and original frame`,()=>{
    const fragments=fact[`${kind}Fragments`];
    for(let i=0;i<fragments.length;i++){const fragment=fragments[i],b=fragment.bboxMilliPoints,evidence=fireDeclarationEvidence(fact,kind,i);
      expect(evidence).toMatchObject({sourceFileId:fact.sourceFileId,sourceSha256:fact.sourceSha256,stage:"PD",pageNumber:fragment.pageNumber,value:fragment.rawText,unit:"",sheet:null,revision:null,element:"Категория из таблицы; конкретный элемент не сопоставлен"});
      expect(evidence.bbox).toEqual([b[0]/fact.widthMilliPoints,1-b[3]/fact.heightMilliPoints,b[2]/fact.widthMilliPoints,1-b[1]/fact.heightMilliPoints]);
    }
    expect(()=>fireDeclarationEvidence(fact,kind,fragments.length)).toThrow(RangeError);
  });
  it("changes viewer identity for source/object/artifact/page/role/fragment",()=>{
    const fact=declarations[0],key=fireDeclarationViewerKey("OBJ",fact,"primary",0);
    for(const next of [fireDeclarationViewerKey("NEW",fact,"primary",0),fireDeclarationViewerKey("OBJ",{...fact,id:"d".repeat(64)},"primary",0),fireDeclarationViewerKey("OBJ",{...fact,sourceSha256:"e".repeat(64)},"primary",0),fireDeclarationViewerKey("OBJ",{...fact,pageNumber:52},"primary",0),fireDeclarationViewerKey("OBJ",fact,"unit",0),fireDeclarationViewerKey("OBJ",fact,"primary",1)])expect(next).not.toBe(key);
  });
  it("renders mixed v2 material and fire declarations through their own discriminated views",()=>{
    const golden=JSON.parse(readFileSync(new URL("../../../services/worker/tests/fixtures/matrix-steel-v1/research-parser-golden.json",import.meta.url),"utf8"));
    const vector=golden.cases.find((c:any)=>c.name==="original-F0105"),page=golden.sources.find((s:any)=>s.sourceFileId==="F0105").page;
    const steel={schemaVersion:"matrix-source-declaration-v1" as const,kind:"SOURCE_AUTHORED_STEEL_DECLARATION" as const,extractorVersion:"matrix-steel-prose-v1" as const,
      id:"e".repeat(64),sourceFileId:"F0105",sourceSha256:"f".repeat(64),textArtifactHash:"b".repeat(64),stage:"PD" as const,
      pageNumber:page.pageNumber,widthMilliPoints:page.widthMilliPoints,heightMilliPoints:page.heightMilliPoints,entityKey:null,applicabilityStatus:"UNREVIEWED" as const,...structuredClone(vector.expected[0])};
    const mixed:MatrixSourceDeclarationsV2={...artifact,declarations:[steel,...declarations]},before=JSON.stringify(mixed),html=render("",mixed);
    expect(html).toContain("Класс стали: C245");expect(html).toContain("3 двутавра 70Б3, ярус 2");
    expect(html).toContain("Строк огнестойкости: 6 / 6");expect(html).toContain("Запись огнестойкости: REI 150 мин");
    expect((html.match(/<button/g)??[]).length).toBe(35);expect(JSON.stringify(mixed)).toBe(before);
    expect(render("REI 150",mixed)).toContain("Строк огнестойкости: 1 / 6");
    expect(render("70Б3",mixed)).toContain("Деклараций материалов: 1 / 1");
  });
});
