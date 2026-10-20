import { canonicalJson } from "./canonical-json.js";
/** Independent source grammar. Review, identity and completeness are never inferred. */
export const CONCRETE_EXTRACTOR_VERSION = "matrix-concrete-prose-v1";
export const CONCRETE_ATTRIBUTE = "CONCRETE_CLASS";
export const CONCRETE_UNIT = "B_CLASS";
export interface ConcreteFragment {pageNumber:number;blockIndex:number;lineIndex:number;rawText:string;bboxMilliPoints:number[]}
export interface ConcreteCandidate {value:string;rawValue:string;rawUnit:"B_CLASS";canonicalUnit:"B_CLASS";
  primaryFragments:ConcreteFragment[];contextFragments:Array<ConcreteFragment & {role:"ATTRIBUTE_HEADER"|"MATERIAL_SCOPE"}>}
const whitespace="[\\t\\n\\v\\f\\r\\u001c-\\u001f\\u0085\\p{Zs}\\p{Zl}\\p{Zp}]";
const trim=(text:string)=>text.replace(new RegExp(`^${whitespace}+|${whitespace}+$`,"gu"),"");
const clean=(text:string)=>trim(text.replace(/[ \t\u00a0\u202f]+/gu," "));
const exact=(text:string)=>new RegExp(`^${text}$(?![\\s\\S])`,"u");
const grade="(?<value>[BВ](?:25|30))";
const pd=exact("Лестницы, лестничные площадки всех корпусов "+grade+"\\.");
const pdHeader=["Для железобетонных конструкций предусматривается использование тяжелого бетона",
  "по ГОСТ 7473-2010 и ГОСТ 26633-2012 и приняты следующие классы по прочности на сжатие:"];
const rd=exact("Класс бетона по прочности для лестничных маршей и площадок - "+grade+", F150, W6, П4\\. В качестве крупного заполнителя для бетона применять гравий из плотных горных пород по ГОСТ 8267-93\\.");
const rdScope=exact("В основном комплекте чертежей марки [А-Яа-яA-Za-z0-9.,_()/\\-]{1,80} разработаны железобетонные конструкции внутренних монолитных лестниц подземной части \\. При разработке были использованы");
const anchors={PD:/лестницы, лестничные площадки/giu,RD:/класс бетона по прочности для лестничных/giu};
const scopes={PD:/(?:подземная|надземная) часть/giu,RD:/в основном комплекте чертежей марки/giu};
const headerAnchor=/для железобетонных конструкций предусматривается/giu;
const headerEnd=/приняты следующие классы по прочности на сжатие/giu;
const count=(text:string,pattern:RegExp)=>[...text.matchAll(pattern)].length;
const unique=(lines:ConcreteFragment[],pattern:RegExp)=>{const found=lines.filter(l=>count(clean(l.rawText),pattern));
  return found.length===1&&lines.reduce((n,l)=>n+count(clean(l.rawText),pattern),0)===1?found[0]:null;};
const anchorCount=(page:Record<string,unknown>,pattern:RegExp)=>(page.blocks as Array<{text:string}>).reduce((n,b)=>n+count(clean(b.text.replaceAll("\n"," ")),pattern),0);
const lineHeight=(line:ConcreteFragment)=>line.bboxMilliPoints[3]-line.bboxMilliPoints[1];
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value));
}
function ownData(value: object): boolean {
  return Reflect.ownKeys(value).every(key => typeof key === "string"
    && Object.getOwnPropertyDescriptor(value, key)?.enumerable === true
    && Object.hasOwn(Object.getOwnPropertyDescriptor(value, key)!, "value"));
}
function exactKeys(value: Record<string, unknown>, expected: string[]): boolean {
  return ownData(value) && Object.keys(value).length === expected.length
    && expected.every(key => Object.hasOwn(value, key));
}
function list(value: unknown): value is unknown[] {
  return Array.isArray(value) && Reflect.ownKeys(value).length === value.length + 1
    && Array.from({ length: value.length }, (_, i) => Object.getOwnPropertyDescriptor(value, String(i)))
      .every(descriptor => !!descriptor && Object.hasOwn(descriptor, "value") && descriptor.enumerable);
}
const positiveInteger = (value: unknown): value is number => typeof value === "number"
  && Number.isSafeInteger(value) && value > 0;
function box(value: unknown, width: number, height: number): value is number[] {
  return list(value) && value.length === 4 && value.every(n => typeof n === "number"
    && Number.isSafeInteger(n) && n >= 0) && Number(value[0]) < Number(value[2])
    && Number(value[2]) <= width && Number(value[1]) < Number(value[3]) && Number(value[3]) <= height;
}
function pageLines(page: unknown): { lines: ConcreteFragment[]; blocks: Array<{ text: string }>; width: number } | null {
  if (!record(page) || !exactKeys(page, ["pageNumber", "widthMilliPoints", "heightMilliPoints", "quality", "blocks"])
    || !positiveInteger(page.pageNumber) || !positiveInteger(page.widthMilliPoints) || !positiveInteger(page.heightMilliPoints)
    || !record(page.quality) || !ownData(page.quality) || page.quality.disposition !== "TEXT_LAYER_CANDIDATE"
    || !list(page.blocks)) return null;
  const width = page.widthMilliPoints, height = page.heightMilliPoints;
  const lines: ConcreteFragment[] = [], blocks: Array<{ text: string }> = [];
  for (const [blockIndex, block] of page.blocks.entries()) {
    if (!record(block) || !exactKeys(block, ["text", "bboxMilliPoints", "lineBboxesMilliPoints"])
      || typeof block.text !== "string" || /[\u0000-\u0008\u000b-\u001f\u2028\u2029\ufffd\ud800-\udfff]/u.test(block.text)
      || !box(block.bboxMilliPoints, width, height) || !list(block.lineBboxesMilliPoints)) return null;
    const texts = block.text.split("\n"), boxes = block.lineBboxesMilliPoints;
    if (!boxes.length || boxes.length !== texts.length || !boxes.every(b => box(b, width, height))) return null;
    const exactBoxes = boxes as number[][];
    const union = exactBoxes.reduce((a, b) => [Math.min(a[0], b[0]), Math.min(a[1], b[1]),
      Math.max(a[2], b[2]), Math.max(a[3], b[3])], exactBoxes[0]);
    if (!union.every((n, i) => n === (block.bboxMilliPoints as number[])[i])) return null;
    for (const [lineIndex, rawText] of texts.entries()) lines.push({ pageNumber: page.pageNumber, blockIndex, lineIndex, rawText,
      bboxMilliPoints: exactBoxes[lineIndex].slice() });
    blocks.push({ text: block.text });
  }
  return { lines, blocks, width };
}

function unobstructed(chosen:ConcreteFragment[],lines:ConcreteFragment[]):boolean {
  const boxes=chosen.map(line=>line.bboxMilliPoints);
  const envelope=boxes.reduce((a,b)=>[Math.min(a[0],b[0]),Math.min(a[1],b[1]),Math.max(a[2],b[2]),Math.max(a[3],b[3])],boxes[0]);
  return lines.every(line=>{
    if(chosen.some(p=>p.pageNumber===line.pageNumber&&p.blockIndex===line.blockIndex&&p.lineIndex===line.lineIndex)||!trim(line.rawText))return true;
    const b=line.bboxMilliPoints;
    return !(b[0]<envelope[2]&&b[2]>envelope[0]&&b[1]<envelope[3]&&b[3]>envelope[1]);
  });
}

/** No rebar parser, class, stripping-strength or whole-file identity dependency. */
export function extractConcreteCandidates(page:unknown,stage:unknown,previousPage:unknown=null):ConcreteCandidate[] {
  if(stage!=="PD"&&stage!=="RD")return [];
  const parsed=pageLines(page);if(!parsed)return [];
  const current=page as Record<string,unknown>,{lines}=parsed;
  const primary=unique(lines,anchors[stage]),scope=unique(lines,scopes[stage]);
  if(!primary||!scope||anchorCount(current,anchors[stage])!==1||anchorCount(current,scopes[stage])!==1)return [];
  const match=(stage==="PD"?pd:rd).exec(clean(primary.rawText));if(!match?.groups)return [];
  const p=primary.bboxMilliPoints,s=scope.bboxMilliPoints;
  const contexts:ConcreteCandidate["contextFragments"]=[];
  if(stage==="PD") {
    if(clean(scope.rawText)!=="Подземная часть"||Math.abs(p[0]-s[0])>2000||s[1]-p[3]<60000||s[1]-p[3]>120000)return [];
    const headerPages=[{page:current,lines}];
    if(previousPage!==null&&previousPage!==undefined) {
      const previous=pageLines(previousPage),previousRecord=previousPage as Record<string,unknown>;
      if(!previous||Number(previousRecord.pageNumber)+1!==current.pageNumber
        ||previousRecord.widthMilliPoints!==current.widthMilliPoints||previousRecord.heightMilliPoints!==current.heightMilliPoints)return [];
      headerPages.push({page:previousRecord,lines:previous.lines});
    }
    const all=headerPages.flatMap(h=>h.lines),first=unique(all,headerAnchor),second=unique(all,headerEnd);
    if(!first||!second||headerPages.reduce((n,h)=>n+anchorCount(h.page,headerAnchor),0)!==1
      ||headerPages.reduce((n,h)=>n+anchorCount(h.page,headerEnd),0)!==1||first.pageNumber!==second.pageNumber
      ||first.blockIndex!==second.blockIndex||first.lineIndex+1!==second.lineIndex
      ||clean(first.rawText)!==pdHeader[0]||clean(second.rawText)!==pdHeader[1])return [];
    const a=first.bboxMilliPoints,b=second.bboxMilliPoints;
    if(a[1]-b[3]<0||a[1]-b[3]>4000||a[0]-b[0]<0||a[0]-b[0]>40000||Math.abs(a[2]-b[2])>2000
      ||Math.abs(a[0]-p[0])>2000||(first.pageNumber===current.pageNumber&&b[1]<s[3]))return [];
    const actual=headerPages.find(h=>h.page.pageNumber===first.pageNumber)!;
    if([first,second].some(l=>lineHeight(l)<11000||lineHeight(l)>13000)||!unobstructed([first,second],actual.lines))return [];
    contexts.push({...first,role:"ATTRIBUTE_HEADER"},{...second,role:"ATTRIBUTE_HEADER"});
  } else if(!rdScope.test(clean(scope.rawText))||[p,s].some(b=>b[2]*2>Number(current.widthMilliPoints))
    ||p[0]-s[0]<0||p[0]-s[0]>40000||s[1]-p[3]<450000||s[1]-p[3]>650000)return [];
  const heights=[primary,scope,...contexts].map(lineHeight);
  if(heights.some(h=>h<11000||h>13000)||Math.max(...heights)-Math.min(...heights)>1000
    ||[primary,scope].some(l=>!unobstructed([l],lines)))return [];
  contexts.push({...scope,role:"MATERIAL_SCOPE"});
  return [{value:match.groups.value,rawValue:match.groups.value,rawUnit:CONCRETE_UNIT,canonicalUnit:CONCRETE_UNIT,
    primaryFragments:[primary],contextFragments:contexts}];
}

export const isConcreteProseFact=(item:{attribute?:unknown;contextFragments?:unknown;rawText?:unknown}):boolean=>
  item.attribute===CONCRETE_ATTRIBUTE&&((Array.isArray(item.contextFragments)
    &&item.contextFragments.some(part=>record(part)&&part.role==="MATERIAL_SCOPE"))
    ||(typeof item.rawText==="string"&&/лестницы, лестничные площадки|класс бетона по прочности для лестничных/iu.test(clean(item.rawText))));

/** Reconstruct every original fragment, including the PD header on the preceding page. */
export function validConcreteSourceBinding(item:Record<string,unknown>,fragments:unknown[],artifact:Record<string,unknown>,
  stageAt?:(pageNumber:number)=>unknown):boolean {
  if(!isConcreteProseFact(item)||item.unit!==CONCRETE_UNIT||item.rawUnit!==CONCRETE_UNIT
    ||canonicalJson(item.parameterCodes)!=='["KR-055"]'||!Array.isArray(artifact.pages)
    ||!["PD","RD"].includes(String(item.stage))
    ||["applicationScope","concreteApplicationScope","concreteScope","materialClassBasis","workingRole","componentRole",
      "componentKey","zoneKey","operatingModeKey","measurementBasisKey","loadBearing","memberIdentity"].some(key=>Object.hasOwn(item,key)))return false;
  const pages=artifact.pages.filter(record),page=pages.find(p=>p.pageNumber===item.pageNumber);
  if(!page)return false;
  const previous=pages.find(p=>p.pageNumber===Number(item.pageNumber)-1);
  if(stageAt&&(stageAt(Number(item.pageNumber))!==item.stage||(item.stage==="PD"&&previous&&stageAt(Number(previous.pageNumber))!=="PD")))return false;
  const candidates=extractConcreteCandidates(page,item.stage,item.stage==="PD"?previous:null);
  if(candidates.length!==1)return false;
  const candidate=candidates[0];
  const fragment=(part:ConcreteFragment)=>{
    const frame=pages.find(p=>p.pageNumber===part.pageNumber)!;
    const b=part.bboxMilliPoints,w=Number(frame.widthMilliPoints),h=Number(frame.heightMilliPoints);
    return {blockId:`${part.blockIndex}:${part.lineIndex}`,rawText:part.rawText,
      bbox:{x:b[0]/w,y:1-b[3]/h,width:(b[2]-b[0])/w,height:(b[3]-b[1])/h}};
  };
  const primary=candidate.primaryFragments.map(fragment);
  const context=candidate.contextFragments.map(part=>({pageNumber:part.pageNumber,...fragment(part),role:part.role}));
  return item.value===candidate.value&&item.rawValue===candidate.rawValue
    &&canonicalJson(fragments)===canonicalJson(primary)&&canonicalJson(item.contextFragments)===canonicalJson(context);
}
