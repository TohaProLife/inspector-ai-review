import { canonicalJson } from "./canonical-json.js";
/** Source-authored categorical declarations only; no identity, approval or numeric ranking. */
export const REBAR_EXTRACTOR_VERSION = "matrix-rebar-prose-v1";
export const REBAR_ATTRIBUTE = "WORKING_REINFORCEMENT_CLASS";
export const REBAR_UNIT = "rebar_catalog_example";
export interface RebarFragment { blockIndex:number; lineIndex:number; rawText:string; bboxMilliPoints:number[] }
export interface RebarCandidate { value:string; rawValue:string; rawUnit:null; canonicalUnit:"rebar_catalog_example";
  primaryFragments:RebarFragment[]; scopeFragments:RebarFragment[] }
const whitespace="[\\t\\n\\v\\f\\r\\u001c-\\u001f\\u0085\\p{Zs}\\p{Zl}\\p{Zp}]";
const trim=(text:string)=>text.replace(new RegExp(`^${whitespace}+|${whitespace}+$`,"gu"),"");
const clean=(text:string)=>trim(text.replace(/[ \t\u00a0\u202f]+/gu," "));
const aliases:Record<string,string>={"А500C":"А500С","A500C":"А500С","A500С":"А500С","А500С":"А500С","A400":"А400","А400":"А400"};
export const normalizeRebarClass=(raw:unknown):string|null=>typeof raw==="string" && Object.hasOwn(aliases,raw)?aliases[raw]:null;
const grade="(?<value>А500C|A500C|A500С|А500С|A400|А400)";
const exact=(text:string)=>new RegExp(`^${text}$(?![\\s\\S])`,"u");
const pd=exact("Арматура для железобетонных конструкций предусмотрена класса "+grade+" по ГОСТ Р");
const rd=exact("Арматура всех конструкций класса "+grade+" по ГОСТ 34028-2016\\. Армирование монолитных лестничных маршей и площадок выполняется отдельными стержнями с перевязкой их в местах пересечений");
const rdScope=exact("В основном комплекте чертежей марки [А-Яа-яA-Za-z0-9.,_()/\\-]{1,80} разработаны железобетонные конструкции внутренних монолитных лестниц подземной части \\. При разработке были использованы");
const rdStrength="Минимальная прочность бетона конструкций после снятия опалубки должна быть не менее 50%.";
const strengthAnchor=/минимальная прочность бетона конструкций после снятия опалубки/giu;
const rdStair="Класс бетона по прочности для лестничных маршей и площадок - В30, F150, W6, П4. В качестве крупного заполнителя для бетона применять гравий из плотных горных пород по ГОСТ 8267-93.";
// Python Unicode word boundaries, not JS's ASCII-only \b.
const word="[\\p{L}\\p{N}_]", boundary=`(?:(?<!${word})(?=${word})|(?<=${word})(?!${word}))`;
const governing=new RegExp(`арматура (?:для железобетонных конструкций|всех конструкций)${boundary}|(?:^|[.;] )арматур(?:а|ные стержни|ные каркасы)${boundary}|основная рабочая арматура${boundary}`,"giu");
const scopePD=/подземная часть|надземная часть/giu,scopeRD=/в основном комплекте чертежей марки/giu;
const stairPD=/лестницы, лестничные площадки/giu,stairRD=/класс бетона по прочности для лестничных/giu;
const count=(text:string,pattern:RegExp)=>[...text.matchAll(pattern)].length;
const unique=(lines:RebarFragment[],pattern:RegExp)=>{const found=lines.filter(l=>count(clean(l.rawText),pattern));return found.length===1?found[0]:null;};
const lineHeight=(line:RebarFragment)=>line.bboxMilliPoints[3]-line.bboxMilliPoints[1];
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
function pageLines(page: unknown): { lines: RebarFragment[]; blocks: Array<{ text: string }>; width: number } | null {
  if (!record(page) || !exactKeys(page, ["pageNumber", "widthMilliPoints", "heightMilliPoints", "quality", "blocks"])
    || !positiveInteger(page.pageNumber) || !positiveInteger(page.widthMilliPoints) || !positiveInteger(page.heightMilliPoints)
    || !record(page.quality) || !ownData(page.quality) || page.quality.disposition !== "TEXT_LAYER_CANDIDATE"
    || !list(page.blocks)) return null;
  const width = page.widthMilliPoints, height = page.heightMilliPoints;
  const lines: RebarFragment[] = [], blocks: Array<{ text: string }> = [];
  for (const [blockIndex, block] of page.blocks.entries()) {
    if (!record(block) || !exactKeys(block, ["text", "bboxMilliPoints", "lineBboxesMilliPoints"])
      || typeof block.text !== "string" || /[\r\u2028\u2029]/u.test(block.text)
      || !box(block.bboxMilliPoints, width, height) || !list(block.lineBboxesMilliPoints)) return null;
    const texts = block.text.split("\n"), boxes = block.lineBboxesMilliPoints;
    if (!boxes.length || boxes.length !== texts.length || !boxes.every(b => box(b, width, height))) return null;
    const exactBoxes = boxes as number[][];
    const union = exactBoxes.reduce((a, b) => [Math.min(a[0], b[0]), Math.min(a[1], b[1]),
      Math.max(a[2], b[2]), Math.max(a[3], b[3])], exactBoxes[0]);
    if (!union.every((n, i) => n === (block.bboxMilliPoints as number[])[i])) return null;
    for (const [lineIndex, rawText] of texts.entries()) lines.push({ blockIndex, lineIndex, rawText,
      bboxMilliPoints: exactBoxes[lineIndex].slice() });
    blocks.push({ text: block.text });
  }
  return { lines, blocks, width };
}
function unobstructed(chosen: RebarFragment[], lines: RebarFragment[],columnLeft?:number): boolean {
  const boxes = chosen.map(line => line.bboxMilliPoints);
  const envelope = boxes.reduce((a, b) => [Math.min(a[0], b[0]), Math.min(a[1], b[1]),
    Math.max(a[2], b[2]), Math.max(a[3], b[3])], boxes[0]);
  if(columnLeft!==undefined)envelope[0]=columnLeft;
  return lines.every(line => {
    if (chosen.some(part => part.blockIndex === line.blockIndex && part.lineIndex === line.lineIndex)
      || !trim(line.rawText)) return true;
    const b = line.bboxMilliPoints;
    return !(b[0] < envelope[2] && b[2] > envelope[0] && b[1] < envelope[3] && b[3] > envelope[1]);
  });
}
/** Independent page-only reconstruction. Preserves original complete lines and spacing. */
export function extractRebarCandidates(page:unknown,stage:unknown):RebarCandidate[] {
  if(stage!=="PD"&&stage!=="RD")return [];
  const parsed=pageLines(page);if(!parsed)return [];
  const {lines,blocks,width}=parsed, p=page as {blocks:Array<{lineBboxesMilliPoints:unknown[]}>};
  const first=unique(lines,governing);if(!first||blocks.reduce((n,b)=>n+count(clean(b.text.replaceAll("\n"," ")),governing),0)!==1)return [];
  const match=(stage==="PD"?pd:rd).exec(clean(first.rawText));if(!match?.groups)return [];
  const scopePattern=stage==="PD"?scopePD:scopeRD,stairPattern=stage==="PD"?stairPD:stairRD;
  const header=unique(lines,scopePattern),stair=unique(lines,stairPattern);if(!header||!stair)return [];
  if([scopePattern,stairPattern].some(pattern=>blocks.reduce((n,b)=>n+count(clean(b.text.replaceAll("\n"," ")),pattern),0)!==1))return [];
  const heights=[first,header,stair].map(lineHeight);
  if(heights.some(h=>h<11000||h>13000)||Math.max(...heights)-Math.min(...heights)>1000)return [];
  const a=first.bboxMilliPoints,h=header.bboxMilliPoints,s=stair.bboxMilliPoints;
  let primary:RebarFragment[],scopes:RebarFragment[];
  if(stage==="PD") {
    if(clean(header.rawText)!=="Подземная часть"||clean(stair.rawText)!=="Лестницы, лестничные площадки всех корпусов В30.")return [];
    const second=lines[lines.indexOf(first)+1];if(!second)return [];
    const b=second.bboxMilliPoints,adjacent=(second.blockIndex===first.blockIndex&&second.lineIndex===first.lineIndex+1)
      ||(second.blockIndex===first.blockIndex+1&&first.lineIndex===0&&second.lineIndex===0
        &&p.blocks[first.blockIndex].lineBboxesMilliPoints.length===1&&p.blocks[second.blockIndex].lineBboxesMilliPoints.length===1);
    if(!adjacent||clean(second.rawText)!=="52544-2006."||lineHeight(second)<11000||lineHeight(second)>13000
      ||Math.abs(lineHeight(first)-lineHeight(second))>1000||a[1]-b[3]<0||a[1]-b[3]>4000
      ||a[0]-b[0]<0||a[0]-b[0]>40000||!(b[0]<b[2]&&b[2]<=a[2])
      ||Math.abs(h[0]-s[0])>2000||Math.abs(s[0]-a[0])>2000||h[1]-s[3]<60000||h[1]-s[3]>120000
      ||s[1]-a[3]<30000||s[1]-a[3]>90000||!unobstructed([first,second],lines))return [];
    primary=[first,second];scopes=[header,stair];
  } else {
    if(!rdScope.test(clean(header.rawText))||clean(stair.rawText)!==rdStair)return [];
    const strength=unique(lines,strengthAnchor);
    if(!strength||clean(strength.rawText)!==rdStrength
      ||blocks.reduce((n,b)=>n+count(clean(b.text.replaceAll("\n"," ")),strengthAnchor),0)!==1
      ||lineHeight(strength)<11000||lineHeight(strength)>13000||Math.abs(lineHeight(strength)-lineHeight(first))>1000)return [];
    const t=strength.bboxMilliPoints;
    if([a,h,s,t].some(b=>b[2]*2>width)||a[0]-h[0]<0||a[0]-h[0]>40000
      ||Math.abs(s[0]-a[0])>2000||Math.abs(s[2]-a[2])>2000||s[1]-a[3]<0||s[1]-a[3]>30000
      ||h[1]-a[3]<450000||h[1]-a[3]>650000||a[0]-t[0]<0||a[0]-t[0]>40000||t[2]>a[2]
      ||s[1]-t[3]<0||s[1]-t[3]>7000||t[1]-a[3]<0||t[1]-a[3]>7000||!unobstructed([stair,strength,first],lines,Math.max(a[0],s[0])))return [];
    primary=[first];scopes=[header,stair,strength];
  }
  if([...primary,...scopes].some(line=>!unobstructed([line],lines)))return [];
  return [{value:aliases[match.groups.value],rawValue:match.groups.value,rawUnit:null,canonicalUnit:REBAR_UNIT,
    primaryFragments:primary,scopeFragments:scopes}];
}

/** Reconstruct both primary and MATERIAL_SCOPE fragments from the authentic page. */
export function validRebarSourceBinding(item:Record<string,unknown>,fragments:unknown[],page:Record<string,unknown>):boolean {
  if(item.attribute!==REBAR_ATTRIBUTE||item.unit!==REBAR_UNIT||canonicalJson(item.parameterCodes)!=='["KR-057"]')return false;
  const candidates=extractRebarCandidates(page,item.stage);if(candidates.length!==1)return false;
  const c=candidates[0],width=Number(page.widthMilliPoints),height=Number(page.heightMilliPoints);
  const normalized=(b:number[])=>({x:b[0]/width,y:1-b[3]/height,width:(b[2]-b[0])/width,height:(b[3]-b[1])/height});
  const primary=c.primaryFragments.map(p=>({blockId:`${p.blockIndex}:${p.lineIndex}`,rawText:p.rawText,bbox:normalized(p.bboxMilliPoints)}));
  const context=c.scopeFragments.map(p=>({pageNumber:item.pageNumber,blockId:`${p.blockIndex}:${p.lineIndex}`,
    rawText:p.rawText,bbox:normalized(p.bboxMilliPoints),role:"MATERIAL_SCOPE"}));
  return item.value===c.value&&item.rawValue===c.rawValue&&item.rawUnit===null
    &&canonicalJson(fragments)===canonicalJson(primary)&&canonicalJson(item.contextFragments)===canonicalJson(context)
    &&!["applicationScope","workingRole","reinforcementApplicationScope","componentKey","zoneKey"].some(key=>Object.hasOwn(item,key));
}
