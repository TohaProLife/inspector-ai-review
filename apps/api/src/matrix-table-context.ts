import type { MatrixObservation } from "@inspector-ai/contracts";
import { canonicalJson } from "./canonical-json.js";

const record=(x:unknown):x is Record<string,unknown>=>!!x&&typeof x==="object"&&!Array.isArray(x);
const clean=(x:string)=>x.replace(/\s+/gu," ").trim();
const header=/^Для железобетонных конструкций предусматривается использование тяжелого бетона по ГОСТ [0-9]{1,5}-[0-9]{4} и ГОСТ [0-9]{1,5}-[0-9]{4} и приняты следующие классы по прочности на сжатие:$/iu;
const rowLabel=/^(?:·\s*)?(?:фундаментная плита|пилоны, колонны [+-]?[0-9]{1,3} по [+-]?[0-9]{1,3}|стены [+-]?[0-9]{1,3}(?:го)? по [+-]?[0-9]{1,3}|плита [+-]?[0-9]{1,3}(?:го)? этажа|плита покрытия)$/iu;
const valuePattern=/^([BВ][0-9]+(?:[.,][0-9]+)?)\s*[.;]?$/u;
type Line={blockId:string;rawText:string;box:number[];exact:boolean};
function lines(page:Record<string,unknown>):Line[] {
  if(!Array.isArray(page.blocks))return [];
  return page.blocks.flatMap((block,bi)=>{
    if(!record(block)||typeof block.text!=="string")return [];
    // Python splitlines() omits the empty item after one terminal newline.
    const parts=block.text.replace(/\r?\n$/u,"").split(/\r?\n/u);
    return parts.flatMap((rawText,li)=>{
      const box=Array.isArray(block.lineBboxesMilliPoints)?block.lineBboxesMilliPoints[li]:block.bboxMilliPoints;
      return rawText.trim()&&Array.isArray(box)&&box.length===4&&box.every(Number.isFinite)
        ?[{blockId:`${bi}:${li}`,rawText,box,exact:Array.isArray(block.lineBboxesMilliPoints)||parts.length===1}]:[];
    });
  });
}

/** Independently reconstruct the narrow continuation-table grammar from original pages. */
export function validConcreteTableContext(fact:MatrixObservation,artifact:Record<string,unknown>,stageAt:(page:number)=>string):boolean {
  if(fact.stage!=="PD"||fact.attribute!=="CONCRETE_CLASS"||fact.unit!=="B_CLASS"
    ||!fact.contextFragments?.length||!Array.isArray(artifact.pages)||!Array.isArray(fact.evidenceFragments)
    ||fact.evidenceFragments.length!==2)return false;
  const pages=artifact.pages.filter(record),page=pages.find(p=>p.pageNumber===fact.pageNumber);
  if(!page)return false;
  const tableLines=lines(page),scopes=tableLines.filter(l=>/^Подземная часть$/iu.test(clean(l.rawText)));
  if(scopes.length!==1||!scopes[0].exact)return false;
  const scope=scopes[0];
  const headers=pages.filter(p=>p.pageNumber===fact.pageNumber||p.pageNumber===fact.pageNumber-1).flatMap(p=>{
    if(!Array.isArray(p.blocks))return [];
    return p.blocks.flatMap((block,bi)=>record(block)&&typeof block.text==="string"&&header.test(clean(block.text))
      ?[{page:p,lines:lines(p).filter(l=>l.blockId.startsWith(`${bi}:`))}]:[]);
  });
  if(headers.length!==1||headers[0].lines.length<1||headers[0].lines.length>3||headers[0].lines.some(l=>!l.exact))return false;
  const h=headers[0];
  if(stageAt(Number(h.page.pageNumber))!=="PD")return false;
  if(h.page.pageNumber===fact.pageNumber&&Math.min(...h.lines.map(l=>l.box[1]))<=scope.box[3])return false;
  const expectedContext=[...h.lines.map(line=>({pageNumber:h.page.pageNumber,blockId:line.blockId,rawText:line.rawText,
    bbox:normalized(line.box,h.page),role:"ATTRIBUTE_HEADER"})),{pageNumber:fact.pageNumber,blockId:scope.blockId,
    rawText:scope.rawText,bbox:normalized(scope.box,page),role:"TABLE_SCOPE"}];
  if(canonicalJson(fact.contextFragments)!==canonicalJson(expectedContext))return false;
  const [labelFragment,valueFragment]=fact.evidenceFragments;
  if(!record(labelFragment)||!record(valueFragment))return false;
  const label=tableLines.find(l=>l.blockId===labelFragment.blockId),value=tableLines.find(l=>l.blockId===valueFragment.blockId);
  if(!label||!value||!label.exact||!value.exact||!rowLabel.test(clean(label.rawText))
    ||valuePattern.exec(clean(value.rawText))?.[1]!==fact.rawValue)return false;
  const height=Math.max(1,label.box[3]-label.box[1]),center=(label.box[1]+label.box[3])/2;
  if(label.box[3]>scope.box[1]||value.box[0]<label.box[2]||value.box[0]-label.box[2]>32*height
    ||Math.abs((value.box[1]+value.box[3])/2-center)>.25*height)return false;
  const aligned=tableLines.filter(l=>l!==label&&l.exact&&l.box[0]>=label.box[2]
    &&l.box[0]-label.box[2]<=32*height&&Math.abs((l.box[1]+l.box[3])/2-center)<=.25*height);
  if(aligned.length!==1||aligned[0]!==value)return false;
  const otherAligned=tableLines.filter(l=>l!==label&&l!==value
    &&Math.abs((l.box[1]+l.box[3])/2-center)<=.25*height);
  if(otherAligned.length>1||otherAligned.some(l=>!l.exact||clean(l.rawText)!=="·"
    ||l.box[2]>label.box[0]||label.box[0]-l.box[2]>2*height))return false;
  const below=tableLines.filter(l=>l!==scope&&l.box[3]<=scope.box[1]);
  const stop=Math.max(0,...below.filter(l=>!rowLabel.test(clean(l.rawText))&&!valuePattern.test(clean(l.rawText))
    &&clean(l.rawText)!=="·").map(l=>l.box[3]));
  if(Math.min(label.box[1],value.box[1])<stop)return false;
  const rowBottom=Math.min(label.box[1],value.box[1]),rowTop=Math.max(label.box[3],value.box[3]);
  if(below.some(l=>l!==label&&rowLabel.test(clean(l.rawText))&&l.box[1]<rowTop&&l.box[3]>rowBottom))return false;
  return true;
}
function normalized(b:number[],page:Record<string,unknown>) {
  const w=Number(page.widthMilliPoints),h=Number(page.heightMilliPoints);
  return {x:b[0]/w,y:1-b[3]/h,width:(b[2]-b[0])/w,height:(b[3]-b[1])/h};
}

const slabHeader=/^Толщины перекрытия и покрытия:$/iu;
const slabScope=/^Толщины перекрытий подземной части$/iu;
const floor="[+-]?[0-9]{1,3}",number="[0-9]+(?:[.,][0-9]+)?",unit="(?:мм|mm|см|cm|м|m)";
const slabLabel=new RegExp(`^-\\s+Перекрытия (${floor}) и (${floor}) этажей$`,"iu");
const structureLabel=new RegExp(`^-\\s+(?:Толщина фундаментной плиты|Перекрытия ${floor} и ${floor} этажей|Капители ${floor} и ${floor} этажей|Плита покрытия \\(стилобата\\)|Капители покрытия \\(стилобата\\))$`,"iu");
const structureValue=new RegExp(`^-\\s*${number}(?:,\\s+${number})*\\s*${unit}[.;]?$`,"u");
const slabValue=new RegExp(`^-\\s+(${number})\\s*(${unit})[.;]?$`,"u");

export function validSlabTableContext(fact:MatrixObservation,artifact:Record<string,unknown>):boolean {
  if(fact.stage!=="PD"||fact.attribute!=="SLAB_THICKNESS"||fact.unit!=="mm"
    ||!fact.contextFragments||fact.contextFragments.length!==2||!Array.isArray(artifact.pages)
    ||!Array.isArray(fact.evidenceFragments)||fact.evidenceFragments.length!==2)return false;
  const page=artifact.pages.find(p=>record(p)&&p.pageNumber===fact.pageNumber);
  if(!record(page))return false;
  const pageLines=lines(page),headers=pageLines.filter(l=>slabHeader.test(clean(l.rawText))),scopes=pageLines.filter(l=>slabScope.test(clean(l.rawText)));
  if(headers.length!==1||scopes.length!==1||!headers[0].exact||!scopes[0].exact)return false;
  const h=headers[0],scope=scopes[0];
  if(scope.box[1]<=h.box[3])return false;
  const expectedContext=[{pageNumber:fact.pageNumber,blockId:h.blockId,rawText:h.rawText,bbox:normalized(h.box,page),role:"ATTRIBUTE_HEADER"},
    {pageNumber:fact.pageNumber,blockId:scope.blockId,rawText:scope.rawText,bbox:normalized(scope.box,page),role:"TABLE_SCOPE"}];
  if(canonicalJson(expectedContext)!==canonicalJson(fact.contextFragments))return false;
  const [labelFragment,valueFragment]=fact.evidenceFragments;
  if(!record(labelFragment)||!record(valueFragment))return false;
  const label=pageLines.find(l=>l.blockId===labelFragment.blockId),value=pageLines.find(l=>l.blockId===valueFragment.blockId);
  if(!label||!value||!label.exact||!value.exact)return false;
  const labelMatch=slabLabel.exec(clean(label.rawText)),valueMatch=slabValue.exec(clean(value.rawText));
  if(!labelMatch||Number(labelMatch[1])===Number(labelMatch[2])||!valueMatch
    ||valueMatch[1]!==fact.rawValue||valueMatch[2]!==fact.rawUnit)return false;
  const height=Math.max(1,label.box[3]-label.box[1]),center=(label.box[1]+label.box[3])/2;
  if(label.box[3]>h.box[1]||value.box[3]>h.box[1]||h.box[1]-label.box[3]>20*height)return false;
  const aligned=pageLines.filter(l=>l!==label&&Math.abs((l.box[1]+l.box[3])/2-center)<=height/4);
  if(aligned.length!==1||aligned[0]!==value||value.box[0]<label.box[2]||value.box[0]-label.box[2]>32*height)return false;
  const below=pageLines.filter(l=>l.box[3]<=h.box[1]);
  if(below.filter(l=>slabLabel.test(clean(l.rawText))).length!==1)return false;
  const stop=Math.max(0,...below.filter(l=>!structureLabel.test(clean(l.rawText))&&!structureValue.test(clean(l.rawText))).map(l=>l.box[3]));
  const bottom=Math.min(label.box[1],value.box[1]),top=Math.max(label.box[3],value.box[3]);
  return bottom>=stop&&!below.some(l=>l!==label&&structureLabel.test(clean(l.rawText))&&Math.min(top,l.box[3])>Math.max(bottom,l.box[1]));
}

const sidewalkCaption=["ВЕДОМОСТЬ ПРОЕЗДОВ, ТРОТУАРОВ,","ДОРОЖЕК И ПЛОЩАДОК"];
const sidewalkHeader=["Площадь","покрытия, кв.м. в","гр. ГПЗУ"];
const sidewalkLabel=["Тротуары пешеходные","из бетонной плитки,","по грунту"];
const sidewalkArea=/^((?:[0-9]+|[0-9]{1,3}(?:[ \u00a0\u202f][0-9]{3})+)(?:[.,][0-9]+)?)\s*м²$/u;
const center=(line:Line)=>(line.box[1]+line.box[3])/2;
const lineHeight=(line:Line)=>line.box[3]-line.box[1];
const unionBox=(group:Line[])=>[Math.min(...group.map(l=>l.box[0])),Math.min(...group.map(l=>l.box[1])),
  Math.max(...group.map(l=>l.box[2])),Math.max(...group.map(l=>l.box[3]))];
const sameText=(left:string,right:string)=>clean(left).toLowerCase()===clean(right).toLowerCase();
function orderedExactGroup(group:Line[]):boolean {
  if(group.some(line=>!line.exact||lineHeight(line)<=0||line.box[2]<=line.box[0]))return false;
  return group.every((line,index)=>index===0||(()=>{
    const previous=group[index-1],height=Math.max(lineHeight(previous),lineHeight(line));
    const gap=center(previous)-center(line);
    return gap>=.5*height&&gap<=2*height&&Math.min(previous.box[2],line.box[2])>Math.max(previous.box[0],line.box[0]);
  })());
}
function blockGroups(pageLines:Line[]):Line[][] {
  const groups=new Map<string,Line[]>();
  for(const line of pageLines){const key=line.blockId.split(":")[0];groups.set(key,[...(groups.get(key)??[]),line]);}
  return [...groups.values()];
}
function matchingGroups(pageLines:Line[],text:string[]):Line[][] {
  return blockGroups(pageLines).filter(group=>group.length===text.length&&group.every((line,index)=>sameText(line.rawText,text[index])));
}

/** Reconstruct only the fully captioned ground paving table; never infer approval or identity. */
export function validSidewalkTileTableContext(fact:MatrixObservation,artifact:Record<string,unknown>):boolean {
  if(fact.stage!=="PD"||fact.attribute!=="SIDEWALK_TILE_AREA"||fact.unit!=="m2"||fact.rawUnit!=="м²"
    ||fact.contextFragments?.length!==6||(!Array.isArray(fact.evidenceFragments)||fact.evidenceFragments.length!==5)||!Array.isArray(artifact.pages))return false;
  const page=artifact.pages.find(p=>record(p)&&p.pageNumber===fact.pageNumber);
  if(!record(page))return false;
  const all=lines(page),captions=matchingGroups(all,sidewalkCaption),headers=matchingGroups(all,sidewalkHeader);
  const scopes=matchingGroups(all,["(в гр. ГПЗУ)"]),targets=matchingGroups(all,sidewalkLabel);
  if(captions.length!==1||headers.length!==1||scopes.length!==1||targets.length!==1)return false;
  const caption=captions[0],header=headers[0],scope=scopes[0][0],captionBox=unionBox(caption),column=unionBox(header);
  if(!orderedExactGroup(caption)||!orderedExactGroup(header)||!orderedExactGroup([scope])||!orderedExactGroup([caption[1],scope]))return false;
  const scopeGap=center(caption[1])-center(scope),scopeHeight=Math.max(lineHeight(caption[1]),lineHeight(scope));
  const headerHeight=Math.max(...header.map(lineHeight));
  if(scope.box[0]<captionBox[0]||scope.box[2]>captionBox[2]||scopeGap<.5*scopeHeight||scopeGap>2*scopeHeight
    ||column[3]>=scope.box[1]||scope.box[1]-column[3]>8*headerHeight
    ||column[0]<(captionBox[0]+captionBox[2])/2||column[2]>captionBox[2]+2*Math.max(...caption.map(lineHeight)))return false;
  // A lower caption must delimit this table. Roof and other tables cannot donate values.
  const next=blockGroups(all).filter(group=>group.length>=2&&group[0]!==caption[0]
    &&group.slice(0,2).every((line,index)=>sameText(line.rawText,sidewalkCaption[index]))&&orderedExactGroup(group.slice(0,2))
    &&unionBox(group.slice(0,2))[3]<captionBox[1]
    &&Math.min(unionBox(group.slice(0,2))[2],column[2])>Math.max(unionBox(group.slice(0,2))[0],captionBox[0]));
  if(!next.length)return false;
  const stop=Math.max(...next.map(group=>unionBox(group.slice(0,2))[3]));
  const targetGroups=targets.filter(group=>{
    const box=unionBox(group);return box[1]>=stop&&box[3]<column[1]
      &&box[0]>=captionBox[0]&&box[2]<column[0];
  });
  if(targetGroups.length!==1||!orderedExactGroup(targetGroups[0]))return false;
  const label=targetGroups[0],labelBox=unionBox(label),height=Math.max(...label.map(lineHeight));
  if(column[1]-labelBox[3]>32*height)return false;
  const inRow=(line:Line)=>line.box[1]>=labelBox[1]&&line.box[3]<=labelBox[3];
  const types=all.filter(line=>sameText(line.rawText,"- тип 3")&&inRow(line)
    &&line.box[0]>=labelBox[2]&&line.box[2]<=column[0]);
  const values=all.filter(line=>sidewalkArea.test(clean(line.rawText))&&inRow(line)
    &&line.box[0]>=column[0]&&line.box[2]<=column[2]);
  if(types.length!==1||values.length!==1||!types[0].exact||!values[0].exact)return false;
  const type=types[0],value=values[0],primary=[...label,type,value];
  if(sidewalkArea.exec(clean(value.rawText))?.[1]!==fact.rawValue)return false;
  const selected=new Set(primary);
  if(all.some(line=>!selected.has(line)&&Math.min(line.box[3],labelBox[3])>Math.max(line.box[1],labelBox[1])
    &&Math.min(line.box[2],column[2]+2*height)>Math.max(line.box[0],labelBox[0])))return false;
  const cells=all.filter(line=>Math.min(line.box[3],column[1])>Math.max(line.box[1],stop)
    &&Math.min(line.box[2],column[2])>Math.max(line.box[0],column[0]));
  if(cells.some(line=>!line.exact||line.box[1]<stop||line.box[3]>column[1]||!sidewalkArea.test(clean(line.rawText)))
    ||cells.some((line,index)=>cells.slice(index+1).some(other=>Math.min(line.box[3],other.box[3])>Math.max(line.box[1],other.box[1]))))return false;
  const evidence=primary.map(line=>({blockId:line.blockId,rawText:line.rawText.trim(),bbox:normalized(line.box,page)}));
  const contexts=[...caption.map(line=>({line,role:"TABLE_SCOPE"})),{line:scope,role:"TABLE_SCOPE"},
    ...header.map(line=>({line,role:"ATTRIBUTE_HEADER"}))].map(({line,role})=>({pageNumber:fact.pageNumber,
      blockId:line.blockId,rawText:line.rawText,bbox:normalized(line.box,page),role}));
  return canonicalJson(fact.evidenceFragments)===canonicalJson(evidence)
    &&canonicalJson(fact.contextFragments)===canonicalJson(contexts);
}
