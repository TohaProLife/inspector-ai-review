import { bindTableRows, readTableRowPage, type TableRowFragment } from "./table-row-binding.js";

export const FIRE_RESISTANCE_EXTRACTOR_VERSION="matrix-fire-resistance-table-v1";
export const FIRE_RESISTANCE_BINDING_POLICY_VERSION="matrix-fire-resistance-upper-table-v1";
export interface FireResistanceCandidate {
  criterion:"R"|"REI";
  minutes:number;
  rawValue:string;
  rawUnit:"мин";
  canonicalUnit:"min";
  constructionLabelLines:string[];
  primaryFragments:TableRowFragment[];
  scopeFragments:TableRowFragment[];
  headerFragments:TableRowFragment[];
  unitFragments:TableRowFragment[];
  bindingPolicyVersion:typeof FIRE_RESISTANCE_BINDING_POLICY_VERSION;
  tableBoxMilliPoints:[number,number,number,number];
}
const LABEL_HEADER="Наименование строительной конструкции",VALUE_HEADER="Предел огнестойкости,";
const ROWS=[
  {key:"load-bearing-elements",labels:["Несущие стены, колонны и другие несущие элементы"]},
  {key:"fire-compartment-slabs",labels:["Перекрытия междуэтажные, разделяющие здание на","пожарные отсеки"]},
  {key:"lift-and-stair-shafts",labels:["Лифтовые и лестничные шахты"]},
  {key:"roof-slab",labels:["Плита покрытия"]},
  {key:"bridge-crossing",labels:["Мостовой переход"]},
  {key:"flights-and-landings",labels:["Марши и площадки"]},
];
const normalized=(text:string)=>text.replace(/[ \t\u00a0\u202f]+/gu," ").replace(/^ +| +$/gu,"");
const copy=(part:TableRowFragment):TableRowFragment=>({...part,bboxMilliPoints:[...part.bboxMilliPoints]});
const anchor=(part:TableRowFragment)=>({blockIndex:part.blockIndex,lineIndex:part.lineIndex,rawText:part.rawText});

/** Source-authored rows only. No criterion comparison, member correspondence or normative approval. */
export function extractFireResistanceCandidates(page:unknown,stage:unknown):FireResistanceCandidate[] {
  if(stage!=="PD"&&stage!=="RD")return [];
  const source=readTableRowPage(page);if(source.status!=="READY")return [];
  const byText=new Map<string,TableRowFragment[]>();
  for(const line of source.lines){const key=normalized(line.rawText);const entries=byText.get(key)??[];entries.push(line);byText.set(key,entries);}
  function unique(text:string):TableRowFragment|undefined{const matches=byText.get(text);return matches?.length===1?matches[0]:undefined;}
  const labelHeader=unique(LABEL_HEADER),valueHeader=unique(VALUE_HEADER),unit=unique("мин");
  if(!labelHeader||!valueHeader||!unit||unit.rawText!=="мин")return [];
  const groups:TableRowFragment[][]=[];
  for(const row of ROWS){const found:TableRowFragment[]=[];for(const text of row.labels){const line=unique(text);if(!line)return [];found.push(line);}groups.push(found);}
  const body=groups.flat(),chosen=[labelHeader,valueHeader,unit,...body],heights=chosen.map(f=>f.bboxMilliPoints[3]-f.bboxMilliPoints[1]);
  if(heights.some(h=>h<11000||h>13000)||Math.max(...heights)-Math.min(...heights)>1000)return [];
  if(Math.max(...body.map(f=>f.bboxMilliPoints[0]))-Math.min(...body.map(f=>f.bboxMilliPoints[0]))>1000)return [];
  for(const group of groups)for(let i=1;i<group.length;i++){
    const gap=group[i-1].bboxMilliPoints[1]-group[i].bboxMilliPoints[3];if(gap<0||gap>7000)return [];
  }
  const bands=groups.map(group=>[Math.min(...group.map(f=>f.bboxMilliPoints[1])),Math.max(...group.map(f=>f.bboxMilliPoints[3]))]);
  for(let i=1;i<bands.length;i++){const gap=bands[i-1][0]-bands[i][1];if(gap<0||gap>7000)return [];}
  const headerBottom=Math.min(...[labelHeader,valueHeader,unit].map(f=>f.bboxMilliPoints[1])),headerGap=headerBottom-bands[0][1];
  if(headerGap<0||headerGap>15000||unit.bboxMilliPoints[3]>valueHeader.bboxMilliPoints[1])return [];
  const labelLeft=Math.min(labelHeader.bboxMilliPoints[0],...body.map(f=>f.bboxMilliPoints[0]));
  const labelRight=Math.max(labelHeader.bboxMilliPoints[2],...body.map(f=>f.bboxMilliPoints[2]));
  const valueLeft=valueHeader.bboxMilliPoints[0],valueRight=valueHeader.bboxMilliPoints[2];
  if(labelRight>valueLeft||unit.bboxMilliPoints[0]<valueLeft||unit.bboxMilliPoints[2]>valueRight)return [];
  const tableBox:[number,number,number,number]=[labelLeft,bands.at(-1)![0],valueRight,Math.max(labelHeader.bboxMilliPoints[3],valueHeader.bboxMilliPoints[3],unit.bboxMilliPoints[3])];
  const policy={schemaVersion:"table-row-binding-policy-v1",tableBoxMilliPoints:tableBox,maxLineGapMilliPoints:7000,
    columns:[{key:"labels",role:"ROW_LABEL",xRangeMilliPoints:[labelLeft,labelRight],headerAnchors:[anchor(labelHeader)],unitAnchors:[]},
      {key:"values",role:"VALUE",xRangeMilliPoints:[valueLeft,valueRight],headerAnchors:[anchor(valueHeader)],unitAnchors:[anchor(unit)]}],
    rows:ROWS.map((row,index)=>({key:row.key,yRangeMilliPoints:bands[index],labelAnchors:groups[index].map(anchor),valueLineCounts:{values:1}}))};
  const bound=bindTableRows(page,policy);if(bound.status!=="BOUND")return [];
  const result:FireResistanceCandidate[]=[];
  for(const row of bound.rows){const labels=row.cells[0].fragments,values=row.cells[1].fragments;
    const match=/^(REI|R)[ ]+([1-9][0-9]{0,15})(?![\s\S])/u.exec(values[0].rawText);
    if(!match||!Number.isSafeInteger(Number(match[2])))return [];
    result.push({criterion:match[1] as "R"|"REI",minutes:Number(match[2]),rawValue:values[0].rawText,rawUnit:"мин",canonicalUnit:"min",
      constructionLabelLines:labels.map(f=>f.rawText),primaryFragments:values.map(copy),scopeFragments:labels.map(copy),
      headerFragments:[copy(labelHeader),copy(valueHeader)],unitFragments:[copy(unit)],
      bindingPolicyVersion:FIRE_RESISTANCE_BINDING_POLICY_VERSION,tableBoxMilliPoints:[...tableBox]});
  }
  return result;
}
