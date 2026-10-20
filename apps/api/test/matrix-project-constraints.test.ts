import type { MatrixProjectConstraints } from "@inspector-ai/contracts";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { canonicalProjectConstraintJson, extractProjectConstraints, projectConstraintId,
  validateProjectConstraints, type ProjectConstraintInput } from "../src/matrix-project-constraints.js";
import { canonicalJson } from "../src/canonical-json.js";
import { validateMatrixExecution } from "../src/matrix-execution.js";
import { loadMatrixGoldenFixtures } from "./matrix-golden-fixtures.js";

// Frozen Python snapshots; wire source SHA256 c545a47ec732d2c476003a32675537d197c4f9750a84412c6e069c631eaa5e1d.
const golden: MatrixProjectConstraints = JSON.parse("{\"schemaVersion\":\"matrix-project-constraints-v1\",\"objectId\":\"OBJ-TYUMENSKAYA-5-GOLD-SEED\",\"inputManifestHash\":\"eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee\",\"extractorVersion\":\"matrix-project-bound-prose-v1\",\"purpose\":\"EVIDENCE_ONLY\",\"constraints\":[{\"id\":\"e51a0851241b570283a8ec157f5dcafca4fddd1d67318428026bc4bd548dc419\",\"schemaVersion\":\"matrix-project-constraint-v1\",\"kind\":\"PROJECT_AUTHORED_CONSTRAINT\",\"relation\":\"GE\",\"attribute\":\"DOOR_CLEAR_OPENING_WIDTH\",\"canonicalUnit\":\"m\",\"sourceFileId\":\"F0151\",\"sourceSha256\":\"afcd36eb35b235849627a7a4a8fb6065e463c13d5bf1a8e66baae05842bb418a\",\"textArtifactHash\":\"67ed82e56120ffecd42281e9762224311c2e699a798668a8fbcae72eb7d0b737\",\"stage\":\"PD\",\"extractorVersion\":\"matrix-project-bound-prose-v1\",\"entityKey\":null,\"applicabilityStatus\":\"UNREVIEWED\",\"componentClass\":\"ACCESSIBLE_ROUTE_DOOR_OPENING\",\"measurementBasis\":\"CLEAR_OPENING_WITH_LEAF_OPEN\",\"pageNumber\":22,\"widthMilliPoints\":595320,\"heightMilliPoints\":841920,\"limitValue\":\"0.9\",\"fragments\":[{\"blockIndex\":0,\"lineIndex\":0,\"rawText\":\"Ширина  дверных  проемов  в  стенах  и  перегородках,  через  которые\",\"bboxMilliPoints\":[120480,767890,556312,781930],\"usedTextRange\":{\"start\":0,\"end\":69}},{\"blockIndex\":1,\"lineIndex\":0,\"rawText\":\"может  передвигаться  инвалид  на  кресле-коляске,  а  также  выходов  на\",\"bboxMilliPoints\":[85085,743657,556334,757697],\"usedTextRange\":{\"start\":0,\"end\":73}},{\"blockIndex\":2,\"lineIndex\":0,\"rawText\":\"лестничные клетки и в лифтовые холлы принята не менее 0,9 м в свету при\",\"bboxMilliPoints\":[85085,719536,556327,733576],\"usedTextRange\":{\"start\":0,\"end\":71}},{\"blockIndex\":3,\"lineIndex\":0,\"rawText\":\"открытом  дверном  полотне.  Дверные  проемы  либо  не  имеют  порогов,  либо\",\"bboxMilliPoints\":[85085,695415,556315,709455],\"usedTextRange\":{\"start\":0,\"end\":27}}]}]}");
const wireVectors: Array<{name:string;patches:Array<{op:string;path:Array<string|number>;value?:unknown}>;expected:unknown}> = JSON.parse("[{\"name\":\"original-full40\",\"patches\":[],\"expected\":{\"schemaVersion\":\"matrix-project-constraints-v1\",\"objectId\":\"OBJ-TYUMENSKAYA-5-GOLD-SEED\",\"inputManifestHash\":\"eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee\",\"extractorVersion\":\"matrix-project-bound-prose-v1\",\"purpose\":\"EVIDENCE_ONLY\",\"constraints\":[{\"id\":\"e51a0851241b570283a8ec157f5dcafca4fddd1d67318428026bc4bd548dc419\",\"schemaVersion\":\"matrix-project-constraint-v1\",\"kind\":\"PROJECT_AUTHORED_CONSTRAINT\",\"relation\":\"GE\",\"attribute\":\"DOOR_CLEAR_OPENING_WIDTH\",\"canonicalUnit\":\"m\",\"sourceFileId\":\"F0151\",\"sourceSha256\":\"afcd36eb35b235849627a7a4a8fb6065e463c13d5bf1a8e66baae05842bb418a\",\"textArtifactHash\":\"67ed82e56120ffecd42281e9762224311c2e699a798668a8fbcae72eb7d0b737\",\"stage\":\"PD\",\"extractorVersion\":\"matrix-project-bound-prose-v1\",\"entityKey\":null,\"applicabilityStatus\":\"UNREVIEWED\",\"componentClass\":\"ACCESSIBLE_ROUTE_DOOR_OPENING\",\"measurementBasis\":\"CLEAR_OPENING_WITH_LEAF_OPEN\",\"pageNumber\":22,\"widthMilliPoints\":595320,\"heightMilliPoints\":841920,\"limitValue\":\"0.9\",\"fragments\":[{\"blockIndex\":0,\"lineIndex\":0,\"rawText\":\"Ширина  дверных  проемов  в  стенах  и  перегородках,  через  которые\",\"bboxMilliPoints\":[120480,767890,556312,781930],\"usedTextRange\":{\"start\":0,\"end\":69}},{\"blockIndex\":1,\"lineIndex\":0,\"rawText\":\"может  передвигаться  инвалид  на  кресле-коляске,  а  также  выходов  на\",\"bboxMilliPoints\":[85085,743657,556334,757697],\"usedTextRange\":{\"start\":0,\"end\":73}},{\"blockIndex\":2,\"lineIndex\":0,\"rawText\":\"лестничные клетки и в лифтовые холлы принята не менее 0,9 м в свету при\",\"bboxMilliPoints\":[85085,719536,556327,733576],\"usedTextRange\":{\"start\":0,\"end\":71}},{\"blockIndex\":3,\"lineIndex\":0,\"rawText\":\"открытом  дверном  полотне.  Дверные  проемы  либо  не  имеют  порогов,  либо\",\"bboxMilliPoints\":[85085,695415,556315,709455],\"usedTextRange\":{\"start\":0,\"end\":27}}]}]}},{\"name\":\"dot-decimal\",\"patches\":[{\"op\":\"set\",\"path\":[\"sourceArtifact\",\"pages\",21,\"blocks\",2,\"text\"],\"value\":\"лестничные клетки и в лифтовые холлы принята не менее 0.900 м в свету при\"}],\"expected\":{\"schemaVersion\":\"matrix-project-constraints-v1\",\"objectId\":\"OBJ-TYUMENSKAYA-5-GOLD-SEED\",\"inputManifestHash\":\"eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee\",\"extractorVersion\":\"matrix-project-bound-prose-v1\",\"purpose\":\"EVIDENCE_ONLY\",\"constraints\":[{\"id\":\"74c0d5839db36ea80e7cff4d52c08feda111e6f08437e48abc5385863237560a\",\"schemaVersion\":\"matrix-project-constraint-v1\",\"kind\":\"PROJECT_AUTHORED_CONSTRAINT\",\"relation\":\"GE\",\"attribute\":\"DOOR_CLEAR_OPENING_WIDTH\",\"canonicalUnit\":\"m\",\"sourceFileId\":\"F0151\",\"sourceSha256\":\"afcd36eb35b235849627a7a4a8fb6065e463c13d5bf1a8e66baae05842bb418a\",\"textArtifactHash\":\"aeb9e839e14715e7f7571be7f9c170b77db5ac21c7fe62f457bcb3bcd869ea8a\",\"stage\":\"PD\",\"extractorVersion\":\"matrix-project-bound-prose-v1\",\"entityKey\":null,\"applicabilityStatus\":\"UNREVIEWED\",\"componentClass\":\"ACCESSIBLE_ROUTE_DOOR_OPENING\",\"measurementBasis\":\"CLEAR_OPENING_WITH_LEAF_OPEN\",\"pageNumber\":22,\"widthMilliPoints\":595320,\"heightMilliPoints\":841920,\"limitValue\":\"0.9\",\"fragments\":[{\"blockIndex\":0,\"lineIndex\":0,\"rawText\":\"Ширина  дверных  проемов  в  стенах  и  перегородках,  через  которые\",\"bboxMilliPoints\":[120480,767890,556312,781930],\"usedTextRange\":{\"start\":0,\"end\":69}},{\"blockIndex\":1,\"lineIndex\":0,\"rawText\":\"может  передвигаться  инвалид  на  кресле-коляске,  а  также  выходов  на\",\"bboxMilliPoints\":[85085,743657,556334,757697],\"usedTextRange\":{\"start\":0,\"end\":73}},{\"blockIndex\":2,\"lineIndex\":0,\"rawText\":\"лестничные клетки и в лифтовые холлы принята не менее 0.900 м в свету при\",\"bboxMilliPoints\":[85085,719536,556327,733576],\"usedTextRange\":{\"start\":0,\"end\":73}},{\"blockIndex\":3,\"lineIndex\":0,\"rawText\":\"открытом  дверном  полотне.  Дверные  проемы  либо  не  имеют  порогов,  либо\",\"bboxMilliPoints\":[85085,695415,556315,709455],\"usedTextRange\":{\"start\":0,\"end\":27}}]}]}},{\"name\":\"positive-1m\",\"patches\":[{\"op\":\"set\",\"path\":[\"sourceArtifact\",\"pages\",21,\"blocks\",2,\"text\"],\"value\":\"лестничные клетки и в лифтовые холлы принята не менее 1 м в свету при\"}],\"expected\":{\"schemaVersion\":\"matrix-project-constraints-v1\",\"objectId\":\"OBJ-TYUMENSKAYA-5-GOLD-SEED\",\"inputManifestHash\":\"eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee\",\"extractorVersion\":\"matrix-project-bound-prose-v1\",\"purpose\":\"EVIDENCE_ONLY\",\"constraints\":[{\"id\":\"36ac05f79bdce000295aab557461b09ac464294432b45fd36def3b174a4517bd\",\"schemaVersion\":\"matrix-project-constraint-v1\",\"kind\":\"PROJECT_AUTHORED_CONSTRAINT\",\"relation\":\"GE\",\"attribute\":\"DOOR_CLEAR_OPENING_WIDTH\",\"canonicalUnit\":\"m\",\"sourceFileId\":\"F0151\",\"sourceSha256\":\"afcd36eb35b235849627a7a4a8fb6065e463c13d5bf1a8e66baae05842bb418a\",\"textArtifactHash\":\"14469aead8151660d1c531287ee37088639bafbcb710949be8de30f9252a86bb\",\"stage\":\"PD\",\"extractorVersion\":\"matrix-project-bound-prose-v1\",\"entityKey\":null,\"applicabilityStatus\":\"UNREVIEWED\",\"componentClass\":\"ACCESSIBLE_ROUTE_DOOR_OPENING\",\"measurementBasis\":\"CLEAR_OPENING_WITH_LEAF_OPEN\",\"pageNumber\":22,\"widthMilliPoints\":595320,\"heightMilliPoints\":841920,\"limitValue\":\"1\",\"fragments\":[{\"blockIndex\":0,\"lineIndex\":0,\"rawText\":\"Ширина  дверных  проемов  в  стенах  и  перегородках,  через  которые\",\"bboxMilliPoints\":[120480,767890,556312,781930],\"usedTextRange\":{\"start\":0,\"end\":69}},{\"blockIndex\":1,\"lineIndex\":0,\"rawText\":\"может  передвигаться  инвалид  на  кресле-коляске,  а  также  выходов  на\",\"bboxMilliPoints\":[85085,743657,556334,757697],\"usedTextRange\":{\"start\":0,\"end\":73}},{\"blockIndex\":2,\"lineIndex\":0,\"rawText\":\"лестничные клетки и в лифтовые холлы принята не менее 1 м в свету при\",\"bboxMilliPoints\":[85085,719536,556327,733576],\"usedTextRange\":{\"start\":0,\"end\":69}},{\"blockIndex\":3,\"lineIndex\":0,\"rawText\":\"открытом  дверном  полотне.  Дверные  проемы  либо  не  имеют  порогов,  либо\",\"bboxMilliPoints\":[85085,695415,556315,709455],\"usedTextRange\":{\"start\":0,\"end\":27}}]}]}},{\"name\":\"LE-rejected\",\"patches\":[{\"op\":\"set\",\"path\":[\"sourceArtifact\",\"pages\",21,\"blocks\",2,\"text\"],\"value\":\"лестничные клетки и в лифтовые холлы принята не более 0,9 м в свету при\"}],\"expected\":{\"schemaVersion\":\"matrix-project-constraints-v1\",\"objectId\":\"OBJ-TYUMENSKAYA-5-GOLD-SEED\",\"inputManifestHash\":\"eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee\",\"extractorVersion\":\"matrix-project-bound-prose-v1\",\"purpose\":\"EVIDENCE_ONLY\",\"constraints\":[]}},{\"name\":\"range-rejected\",\"patches\":[{\"op\":\"set\",\"path\":[\"sourceArtifact\",\"pages\",21,\"blocks\",2,\"text\"],\"value\":\"лестничные клетки и в лифтовые холлы принята не менее 0,9–1,2 м в свету при\"}],\"expected\":{\"schemaVersion\":\"matrix-project-constraints-v1\",\"objectId\":\"OBJ-TYUMENSKAYA-5-GOLD-SEED\",\"inputManifestHash\":\"eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee\",\"extractorVersion\":\"matrix-project-bound-prose-v1\",\"purpose\":\"EVIDENCE_ONLY\",\"constraints\":[]}},{\"name\":\"unit-case-rejected\",\"patches\":[{\"op\":\"set\",\"path\":[\"sourceArtifact\",\"pages\",21,\"blocks\",2,\"text\"],\"value\":\"лестничные клетки и в лифтовые холлы принята не менее 0,9 М в свету при\"}],\"expected\":{\"schemaVersion\":\"matrix-project-constraints-v1\",\"objectId\":\"OBJ-TYUMENSKAYA-5-GOLD-SEED\",\"inputManifestHash\":\"eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee\",\"extractorVersion\":\"matrix-project-bound-prose-v1\",\"purpose\":\"EVIDENCE_ONLY\",\"constraints\":[]}},{\"name\":\"norm-quote-rejected\",\"patches\":[{\"op\":\"set\",\"path\":[\"sourceArtifact\",\"pages\",21,\"blocks\",0,\"text\"],\"value\":\"Согласно СП ширина  дверных  проемов  в  стенах  и  перегородках,  через  которые\"}],\"expected\":{\"schemaVersion\":\"matrix-project-constraints-v1\",\"objectId\":\"OBJ-TYUMENSKAYA-5-GOLD-SEED\",\"inputManifestHash\":\"eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee\",\"extractorVersion\":\"matrix-project-bound-prose-v1\",\"purpose\":\"EVIDENCE_ONLY\",\"constraints\":[]}},{\"name\":\"quoted-anchor-rejected\",\"patches\":[{\"op\":\"set\",\"path\":[\"sourceArtifact\",\"pages\",21,\"blocks\",0,\"text\"],\"value\":\"«Ширина  дверных  проемов  в  стенах  и  перегородках,  через  которые\"}],\"expected\":{\"schemaVersion\":\"matrix-project-constraints-v1\",\"objectId\":\"OBJ-TYUMENSKAYA-5-GOLD-SEED\",\"inputManifestHash\":\"eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee\",\"extractorVersion\":\"matrix-project-bound-prose-v1\",\"purpose\":\"EVIDENCE_ONLY\",\"constraints\":[]}},{\"name\":\"negation-rejected\",\"patches\":[{\"op\":\"set\",\"path\":[\"sourceArtifact\",\"pages\",21,\"blocks\",2,\"text\"],\"value\":\"лестничные клетки и в лифтовые холлы не принята не менее 0,9 м в свету при\"}],\"expected\":{\"schemaVersion\":\"matrix-project-constraints-v1\",\"objectId\":\"OBJ-TYUMENSKAYA-5-GOLD-SEED\",\"inputManifestHash\":\"eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee\",\"extractorVersion\":\"matrix-project-bound-prose-v1\",\"purpose\":\"EVIDENCE_ONLY\",\"constraints\":[]}},{\"name\":\"wrong-basis-rejected\",\"patches\":[{\"op\":\"set\",\"path\":[\"sourceArtifact\",\"pages\",21,\"blocks\",3,\"text\"],\"value\":\"закрытом  дверном  полотне.  Дверные  проемы  либо  не  имеют  порогов,  либо\"}],\"expected\":{\"schemaVersion\":\"matrix-project-constraints-v1\",\"objectId\":\"OBJ-TYUMENSKAYA-5-GOLD-SEED\",\"inputManifestHash\":\"eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee\",\"extractorVersion\":\"matrix-project-bound-prose-v1\",\"purpose\":\"EVIDENCE_ONLY\",\"constraints\":[]}},{\"name\":\"exception-rejected\",\"patches\":[{\"op\":\"set\",\"path\":[\"sourceArtifact\",\"pages\",21,\"blocks\",3,\"text\"],\"value\":\"открытом  дверном  полотне, кроме двери Д1.  Дверные  проемы  либо  не  имеют  порогов,  либо\"}],\"expected\":{\"schemaVersion\":\"matrix-project-constraints-v1\",\"objectId\":\"OBJ-TYUMENSKAYA-5-GOLD-SEED\",\"inputManifestHash\":\"eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee\",\"extractorVersion\":\"matrix-project-bound-prose-v1\",\"purpose\":\"EVIDENCE_ONLY\",\"constraints\":[]}},{\"name\":\"unknown-last-tail-rejected\",\"patches\":[{\"op\":\"set\",\"path\":[\"sourceArtifact\",\"pages\",21,\"blocks\",3,\"text\"],\"value\":\"открытом  дверном  полотне.  Однако дверные  проемы  либо  не  имеют  порогов,  либо\"}],\"expected\":{\"schemaVersion\":\"matrix-project-constraints-v1\",\"objectId\":\"OBJ-TYUMENSKAYA-5-GOLD-SEED\",\"inputManifestHash\":\"eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee\",\"extractorVersion\":\"matrix-project-bound-prose-v1\",\"purpose\":\"EVIDENCE_ONLY\",\"constraints\":[]}},{\"name\":\"nonselected-page-affects-fullhash\",\"patches\":[{\"op\":\"set\",\"path\":[\"sourceArtifact\",\"pages\",0,\"blocks\",0,\"text\"],\"value\":\"Общество с ограниченной ответственностью \\n«БратКом-групп» \\nюр.адрес: Россия, 115230, Москва г., вн.тер.г. муниципальный \\nокруг Нагатино-Садовники \\nпроезд Хлебозаводский, \\nдом 7, стр.9.  Э3 ПX К25 О63 \\nИНН 7726445683 / КПП 772401001 \\ne-mail: info@bratkompgs.ru\\nтел.: 8(495)955-91-31 \"}],\"expected\":{\"schemaVersion\":\"matrix-project-constraints-v1\",\"objectId\":\"OBJ-TYUMENSKAYA-5-GOLD-SEED\",\"inputManifestHash\":\"eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee\",\"extractorVersion\":\"matrix-project-bound-prose-v1\",\"purpose\":\"EVIDENCE_ONLY\",\"constraints\":[{\"id\":\"f2839de0a1b51f82a1fbc23fa05b9159070848c03c148ef262153601917673b6\",\"schemaVersion\":\"matrix-project-constraint-v1\",\"kind\":\"PROJECT_AUTHORED_CONSTRAINT\",\"relation\":\"GE\",\"attribute\":\"DOOR_CLEAR_OPENING_WIDTH\",\"canonicalUnit\":\"m\",\"sourceFileId\":\"F0151\",\"sourceSha256\":\"afcd36eb35b235849627a7a4a8fb6065e463c13d5bf1a8e66baae05842bb418a\",\"textArtifactHash\":\"2c0e9ba741acb39cde88e894fcbe6fb9fff2a394fbbcbff35aa718fbfaf306bc\",\"stage\":\"PD\",\"extractorVersion\":\"matrix-project-bound-prose-v1\",\"entityKey\":null,\"applicabilityStatus\":\"UNREVIEWED\",\"componentClass\":\"ACCESSIBLE_ROUTE_DOOR_OPENING\",\"measurementBasis\":\"CLEAR_OPENING_WITH_LEAF_OPEN\",\"pageNumber\":22,\"widthMilliPoints\":595320,\"heightMilliPoints\":841920,\"limitValue\":\"0.9\",\"fragments\":[{\"blockIndex\":0,\"lineIndex\":0,\"rawText\":\"Ширина  дверных  проемов  в  стенах  и  перегородках,  через  которые\",\"bboxMilliPoints\":[120480,767890,556312,781930],\"usedTextRange\":{\"start\":0,\"end\":69}},{\"blockIndex\":1,\"lineIndex\":0,\"rawText\":\"может  передвигаться  инвалид  на  кресле-коляске,  а  также  выходов  на\",\"bboxMilliPoints\":[85085,743657,556334,757697],\"usedTextRange\":{\"start\":0,\"end\":73}},{\"blockIndex\":2,\"lineIndex\":0,\"rawText\":\"лестничные клетки и в лифтовые холлы принята не менее 0,9 м в свету при\",\"bboxMilliPoints\":[85085,719536,556327,733576],\"usedTextRange\":{\"start\":0,\"end\":71}},{\"blockIndex\":3,\"lineIndex\":0,\"rawText\":\"открытом  дверном  полотне.  Дверные  проемы  либо  не  имеют  порогов,  либо\",\"bboxMilliPoints\":[85085,695415,556315,709455],\"usedTextRange\":{\"start\":0,\"end\":27}}]}]}},{\"name\":\"RD-rejected\",\"patches\":[{\"op\":\"set\",\"path\":[\"source\",\"stages\"],\"value\":[\"RD\"]}],\"expected\":{\"schemaVersion\":\"matrix-project-constraints-v1\",\"objectId\":\"OBJ-TYUMENSKAYA-5-GOLD-SEED\",\"inputManifestHash\":\"eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee\",\"extractorVersion\":\"matrix-project-bound-prose-v1\",\"purpose\":\"EVIDENCE_ONLY\",\"constraints\":[]}},{\"name\":\"mixed-stage-rejected\",\"patches\":[{\"op\":\"set\",\"path\":[\"source\",\"stages\"],\"value\":[\"PD\",\"RD\"]}],\"expected\":{\"schemaVersion\":\"matrix-project-constraints-v1\",\"objectId\":\"OBJ-TYUMENSKAYA-5-GOLD-SEED\",\"inputManifestHash\":\"eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee\",\"extractorVersion\":\"matrix-project-bound-prose-v1\",\"purpose\":\"EVIDENCE_ONLY\",\"constraints\":[]}},{\"name\":\"hash-mismatch-rejected\",\"patches\":[{\"op\":\"set\",\"path\":[\"source\",\"sha256\"],\"value\":\"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\"}],\"expected\":{\"schemaVersion\":\"matrix-project-constraints-v1\",\"objectId\":\"OBJ-TYUMENSKAYA-5-GOLD-SEED\",\"inputManifestHash\":\"eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee\",\"extractorVersion\":\"matrix-project-bound-prose-v1\",\"purpose\":\"EVIDENCE_ONLY\",\"constraints\":[]}},{\"name\":\"wrong-object-rejected\",\"patches\":[{\"op\":\"set\",\"path\":[\"source\",\"objectId\"],\"value\":\"different\"}],\"expected\":{\"schemaVersion\":\"matrix-project-constraints-v1\",\"objectId\":\"OBJ-TYUMENSKAYA-5-GOLD-SEED\",\"inputManifestHash\":\"eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee\",\"extractorVersion\":\"matrix-project-bound-prose-v1\",\"purpose\":\"EVIDENCE_ONLY\",\"constraints\":[]}},{\"name\":\"float-geometry-rejected\",\"patches\":[{\"op\":\"set\",\"path\":[\"sourceArtifact\",\"pages\",21,\"blocks\",0,\"bboxMilliPoints\",0],\"value\":120480.5}],\"expected\":{\"schemaVersion\":\"matrix-project-constraints-v1\",\"objectId\":\"OBJ-TYUMENSKAYA-5-GOLD-SEED\",\"inputManifestHash\":\"eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee\",\"extractorVersion\":\"matrix-project-bound-prose-v1\",\"purpose\":\"EVIDENCE_ONLY\",\"constraints\":[]}},{\"name\":\"bool-geometry-rejected\",\"patches\":[{\"op\":\"set\",\"path\":[\"sourceArtifact\",\"pages\",21,\"blocks\",0,\"bboxMilliPoints\",0],\"value\":true}],\"expected\":{\"schemaVersion\":\"matrix-project-constraints-v1\",\"objectId\":\"OBJ-TYUMENSKAYA-5-GOLD-SEED\",\"inputManifestHash\":\"eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee\",\"extractorVersion\":\"matrix-project-bound-prose-v1\",\"purpose\":\"EVIDENCE_ONLY\",\"constraints\":[]}},{\"name\":\"bad-page-count-rejected\",\"patches\":[{\"op\":\"set\",\"path\":[\"sourceArtifact\",\"pageCount\"],\"value\":1}],\"expected\":{\"schemaVersion\":\"matrix-project-constraints-v1\",\"objectId\":\"OBJ-TYUMENSKAYA-5-GOLD-SEED\",\"inputManifestHash\":\"eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee\",\"extractorVersion\":\"matrix-project-bound-prose-v1\",\"purpose\":\"EVIDENCE_ONLY\",\"constraints\":[]}},{\"name\":\"extra-artifact-field-rejected\",\"patches\":[{\"op\":\"set\",\"path\":[\"sourceArtifact\",\"relation\"],\"value\":\"GE\"}],\"expected\":{\"schemaVersion\":\"matrix-project-constraints-v1\",\"objectId\":\"OBJ-TYUMENSKAYA-5-GOLD-SEED\",\"inputManifestHash\":\"eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee\",\"extractorVersion\":\"matrix-project-bound-prose-v1\",\"purpose\":\"EVIDENCE_ONLY\",\"constraints\":[]}},{\"name\":\"duplicate-page-rejected\",\"patches\":[{\"op\":\"set\",\"path\":[\"sourceArtifact\",\"pages\",20,\"pageNumber\"],\"value\":22}],\"expected\":{\"schemaVersion\":\"matrix-project-constraints-v1\",\"objectId\":\"OBJ-TYUMENSKAYA-5-GOLD-SEED\",\"inputManifestHash\":\"eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee\",\"extractorVersion\":\"matrix-project-bound-prose-v1\",\"purpose\":\"EVIDENCE_ONLY\",\"constraints\":[]}},{\"name\":\"source-id-and-sha-not-allowlisted\",\"patches\":[{\"op\":\"set\",\"path\":[\"source\",\"sourceFileId\"],\"value\":\"another-public-document\"},{\"op\":\"set\",\"path\":[\"sourceArtifact\",\"sourceFileId\"],\"value\":\"another-public-document\"},{\"op\":\"set\",\"path\":[\"source\",\"sha256\"],\"value\":\"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\"},{\"op\":\"set\",\"path\":[\"sourceArtifact\",\"inputSha256\"],\"value\":\"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\"}],\"expected\":{\"schemaVersion\":\"matrix-project-constraints-v1\",\"objectId\":\"OBJ-TYUMENSKAYA-5-GOLD-SEED\",\"inputManifestHash\":\"eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee\",\"extractorVersion\":\"matrix-project-bound-prose-v1\",\"purpose\":\"EVIDENCE_ONLY\",\"constraints\":[{\"id\":\"bca76c54b04e575337a58fe3da9b1ff5fd8439c848b3c2e4eda2ea21b88068a7\",\"schemaVersion\":\"matrix-project-constraint-v1\",\"kind\":\"PROJECT_AUTHORED_CONSTRAINT\",\"relation\":\"GE\",\"attribute\":\"DOOR_CLEAR_OPENING_WIDTH\",\"canonicalUnit\":\"m\",\"sourceFileId\":\"another-public-document\",\"sourceSha256\":\"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\",\"textArtifactHash\":\"72cd756daa04f1ee5cf2e862f96ea9f918574c50591c02e070e03b6f56de1339\",\"stage\":\"PD\",\"extractorVersion\":\"matrix-project-bound-prose-v1\",\"entityKey\":null,\"applicabilityStatus\":\"UNREVIEWED\",\"componentClass\":\"ACCESSIBLE_ROUTE_DOOR_OPENING\",\"measurementBasis\":\"CLEAR_OPENING_WITH_LEAF_OPEN\",\"pageNumber\":22,\"widthMilliPoints\":595320,\"heightMilliPoints\":841920,\"limitValue\":\"0.9\",\"fragments\":[{\"blockIndex\":0,\"lineIndex\":0,\"rawText\":\"Ширина  дверных  проемов  в  стенах  и  перегородках,  через  которые\",\"bboxMilliPoints\":[120480,767890,556312,781930],\"usedTextRange\":{\"start\":0,\"end\":69}},{\"blockIndex\":1,\"lineIndex\":0,\"rawText\":\"может  передвигаться  инвалид  на  кресле-коляске,  а  также  выходов  на\",\"bboxMilliPoints\":[85085,743657,556334,757697],\"usedTextRange\":{\"start\":0,\"end\":73}},{\"blockIndex\":2,\"lineIndex\":0,\"rawText\":\"лестничные клетки и в лифтовые холлы принята не менее 0,9 м в свету при\",\"bboxMilliPoints\":[85085,719536,556327,733576],\"usedTextRange\":{\"start\":0,\"end\":71}},{\"blockIndex\":3,\"lineIndex\":0,\"rawText\":\"открытом  дверном  полотне.  Дверные  проемы  либо  не  имеют  порогов,  либо\",\"bboxMilliPoints\":[85085,695415,556315,709455],\"usedTextRange\":{\"start\":0,\"end\":27}}]}]}},{\"name\":\"review-proof-never-implies-entity\",\"patches\":[{\"op\":\"set\",\"path\":[\"source\",\"entityKey\"],\"value\":\"door-D1\"},{\"op\":\"set\",\"path\":[\"source\",\"scopeProofs\"],\"value\":{\"ENTITY_SCOPE\":{\"status\":\"VERIFIED\"}}}],\"expected\":{\"schemaVersion\":\"matrix-project-constraints-v1\",\"objectId\":\"OBJ-TYUMENSKAYA-5-GOLD-SEED\",\"inputManifestHash\":\"eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee\",\"extractorVersion\":\"matrix-project-bound-prose-v1\",\"purpose\":\"EVIDENCE_ONLY\",\"constraints\":[{\"id\":\"e51a0851241b570283a8ec157f5dcafca4fddd1d67318428026bc4bd548dc419\",\"schemaVersion\":\"matrix-project-constraint-v1\",\"kind\":\"PROJECT_AUTHORED_CONSTRAINT\",\"relation\":\"GE\",\"attribute\":\"DOOR_CLEAR_OPENING_WIDTH\",\"canonicalUnit\":\"m\",\"sourceFileId\":\"F0151\",\"sourceSha256\":\"afcd36eb35b235849627a7a4a8fb6065e463c13d5bf1a8e66baae05842bb418a\",\"textArtifactHash\":\"67ed82e56120ffecd42281e9762224311c2e699a798668a8fbcae72eb7d0b737\",\"stage\":\"PD\",\"extractorVersion\":\"matrix-project-bound-prose-v1\",\"entityKey\":null,\"applicabilityStatus\":\"UNREVIEWED\",\"componentClass\":\"ACCESSIBLE_ROUTE_DOOR_OPENING\",\"measurementBasis\":\"CLEAR_OPENING_WITH_LEAF_OPEN\",\"pageNumber\":22,\"widthMilliPoints\":595320,\"heightMilliPoints\":841920,\"limitValue\":\"0.9\",\"fragments\":[{\"blockIndex\":0,\"lineIndex\":0,\"rawText\":\"Ширина  дверных  проемов  в  стенах  и  перегородках,  через  которые\",\"bboxMilliPoints\":[120480,767890,556312,781930],\"usedTextRange\":{\"start\":0,\"end\":69}},{\"blockIndex\":1,\"lineIndex\":0,\"rawText\":\"может  передвигаться  инвалид  на  кресле-коляске,  а  также  выходов  на\",\"bboxMilliPoints\":[85085,743657,556334,757697],\"usedTextRange\":{\"start\":0,\"end\":73}},{\"blockIndex\":2,\"lineIndex\":0,\"rawText\":\"лестничные клетки и в лифтовые холлы принята не менее 0,9 м в свету при\",\"bboxMilliPoints\":[85085,719536,556327,733576],\"usedTextRange\":{\"start\":0,\"end\":71}},{\"blockIndex\":3,\"lineIndex\":0,\"rawText\":\"открытом  дверном  полотне.  Дверные  проемы  либо  не  имеют  порогов,  либо\",\"bboxMilliPoints\":[85085,695415,556315,709455],\"usedTextRange\":{\"start\":0,\"end\":27}}]}]}},{\"name\":\"competing-malformed-anchor\",\"patches\":[{\"op\":\"append\",\"path\":[\"sourceArtifact\",\"pages\",21,\"blocks\"],\"value\":{\"text\":\"«Ширина дверных проемов ???»\",\"bboxMilliPoints\":[1000,1000,2000,2000]}}],\"expected\":{\"schemaVersion\":\"matrix-project-constraints-v1\",\"objectId\":\"OBJ-TYUMENSKAYA-5-GOLD-SEED\",\"inputManifestHash\":\"eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee\",\"extractorVersion\":\"matrix-project-bound-prose-v1\",\"purpose\":\"EVIDENCE_ONLY\",\"constraints\":[]}},{\"name\":\"interleaving-block\",\"patches\":[{\"op\":\"append\",\"path\":[\"sourceArtifact\",\"pages\",21,\"blocks\"],\"value\":{\"text\":\"кроме двери Д1\",\"bboxMilliPoints\":[85085,760000,556320,766000]}}],\"expected\":{\"schemaVersion\":\"matrix-project-constraints-v1\",\"objectId\":\"OBJ-TYUMENSKAYA-5-GOLD-SEED\",\"inputManifestHash\":\"eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee\",\"extractorVersion\":\"matrix-project-bound-prose-v1\",\"purpose\":\"EVIDENCE_ONLY\",\"constraints\":[]}},{\"name\":\"original-single-line-boxes-without-line-array\",\"patches\":[{\"op\":\"delete\",\"path\":[\"sourceArtifact\",\"pages\",21,\"blocks\",0,\"lineBboxesMilliPoints\"]},{\"op\":\"delete\",\"path\":[\"sourceArtifact\",\"pages\",21,\"blocks\",1,\"lineBboxesMilliPoints\"]},{\"op\":\"delete\",\"path\":[\"sourceArtifact\",\"pages\",21,\"blocks\",2,\"lineBboxesMilliPoints\"]},{\"op\":\"delete\",\"path\":[\"sourceArtifact\",\"pages\",21,\"blocks\",3,\"lineBboxesMilliPoints\"]}],\"expected\":{\"schemaVersion\":\"matrix-project-constraints-v1\",\"objectId\":\"OBJ-TYUMENSKAYA-5-GOLD-SEED\",\"inputManifestHash\":\"eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee\",\"extractorVersion\":\"matrix-project-bound-prose-v1\",\"purpose\":\"EVIDENCE_ONLY\",\"constraints\":[{\"id\":\"55638af660a024c8f0544aaa48ad2b51b43d30693cff7b8800254a5cb5aa3209\",\"schemaVersion\":\"matrix-project-constraint-v1\",\"kind\":\"PROJECT_AUTHORED_CONSTRAINT\",\"relation\":\"GE\",\"attribute\":\"DOOR_CLEAR_OPENING_WIDTH\",\"canonicalUnit\":\"m\",\"sourceFileId\":\"F0151\",\"sourceSha256\":\"afcd36eb35b235849627a7a4a8fb6065e463c13d5bf1a8e66baae05842bb418a\",\"textArtifactHash\":\"ef863176944b4394e44b9f83ad2a57b5e12ca0d98a4c23d2318f0bf9ca57f64a\",\"stage\":\"PD\",\"extractorVersion\":\"matrix-project-bound-prose-v1\",\"entityKey\":null,\"applicabilityStatus\":\"UNREVIEWED\",\"componentClass\":\"ACCESSIBLE_ROUTE_DOOR_OPENING\",\"measurementBasis\":\"CLEAR_OPENING_WITH_LEAF_OPEN\",\"pageNumber\":22,\"widthMilliPoints\":595320,\"heightMilliPoints\":841920,\"limitValue\":\"0.9\",\"fragments\":[{\"blockIndex\":0,\"lineIndex\":0,\"rawText\":\"Ширина  дверных  проемов  в  стенах  и  перегородках,  через  которые\",\"bboxMilliPoints\":[120480,767890,556312,781930],\"usedTextRange\":{\"start\":0,\"end\":69}},{\"blockIndex\":1,\"lineIndex\":0,\"rawText\":\"может  передвигаться  инвалид  на  кресле-коляске,  а  также  выходов  на\",\"bboxMilliPoints\":[85085,743657,556334,757697],\"usedTextRange\":{\"start\":0,\"end\":73}},{\"blockIndex\":2,\"lineIndex\":0,\"rawText\":\"лестничные клетки и в лифтовые холлы принята не менее 0,9 м в свету при\",\"bboxMilliPoints\":[85085,719536,556327,733576],\"usedTextRange\":{\"start\":0,\"end\":71}},{\"blockIndex\":3,\"lineIndex\":0,\"rawText\":\"открытом  дверном  полотне.  Дверные  проемы  либо  не  имеют  порогов,  либо\",\"bboxMilliPoints\":[85085,695415,556315,709455],\"usedTextRange\":{\"start\":0,\"end\":27}}]}]}}]");

const bytes = readFileSync(new URL("../../../services/worker/tests/fixtures/pd-door-bound-F0151-p22.json", import.meta.url));
const fixture = JSON.parse(bytes.toString("utf8"));
function input(f = structuredClone(fixture)): ProjectConstraintInput {
  return { objectId: f.objectId, inputManifestHash: f.inputManifestHash, sources: [f.source], textArtifacts: [f.sourceArtifact] };
}
function page(f: typeof fixture) { return f.sourceArtifact.pages[21]; }
function result(f = structuredClone(fixture)) { return extractProjectConstraints(input(f)); }
function patchFixture(patches: Array<{op: string; path: Array<string | number>; value?: unknown}>) {
  const f = structuredClone(fixture);
  for (const patch of patches) {
    let target = f;
    for (const segment of patch.path.slice(0, -1)) target = target[segment];
    const last = patch.path.at(-1)!;
    if (patch.op === "set") target[last] = structuredClone(patch.value);
    else if (patch.op === "delete") delete target[last];
    else if (patch.op === "append") target[last].push(structuredClone(patch.value));
    else throw new Error("Unknown frozen patch operation");
  }
  return f;
}

describe("independent project-authored constraint reconstruction", () => {
  it("matches the complete frozen Python golden from the original forty-page artifact", () => {
    expect(createHash("sha256").update(bytes).digest("hex")).toBe("7d281f00c070273df9a4bf437bd21dc8f10c1147435012a44adf46bd7209407a");
    const artifact = result();
    expect(artifact).toEqual(golden);
    expect(validateProjectConstraints(golden, input())).toEqual(golden);
    expect(fixture.sourceArtifact.pages).toHaveLength(40);
    expect(artifact.constraints[0].fragments.map(f => f.usedTextRange.end)).toEqual([69, 73, 71, 27]);
    expect(artifact.constraints[0].entityKey).toBeNull();
    expect(artifact.constraints[0].applicabilityStatus).toBe("UNREVIEWED");
    expect(artifact.constraints[0].fragments[3].rawText.slice(27)).toContain("либо");
  });
  it.each(wireVectors)("matches independent Python wire vector $name", ({ patches, expected }) => {
    const f = patchFixture(patches);
    expect(result(f)).toEqual(expected);
    expect(validateProjectConstraints(expected, input(f))).toEqual(expected);
  });
  it("does not mutate committed inputs, raw worker output, or return shared fragment arrays", () => {
    const f = structuredClone(fixture), before = structuredClone(f);
    const a = result(f), b = result(f), rawBefore = structuredClone(a);
    const validated = validateProjectConstraints(a, input(f))!;
    expect(f).toEqual(before); expect(a).toEqual(rawBefore);
    validated.constraints[0].fragments[0].bboxMilliPoints[0] = 0;
    a.constraints[0].fragments[3].usedTextRange.end = 0;
    expect(b).toEqual(golden); expect(result(f)).toEqual(golden); expect(f).toEqual(before);
  });
  it.each(["relation", "limitValue", "sourceSha256", "textArtifactHash", "stage", "entityKey", "applicabilityStatus", "measurementBasis"])(
    "rejects a forged %s even with a correctly recomputed ID", key => {
      const raw = structuredClone(golden) as any;
      const values: Record<string, unknown> = { relation: "LE", limitValue: "1.8", sourceSha256: "a".repeat(64),
        textArtifactHash: "b".repeat(64), stage: "RD", entityKey: "door-D1", applicabilityStatus: "VERIFIED", measurementBasis: "LEAF_WIDTH" };
      raw.constraints[0][key] = values[key]; raw.constraints[0].id = projectConstraintId(raw.constraints[0]);
      expect(validateProjectConstraints(raw, input())).toBeNull();
    });
  it("rejects changed evidence ranges, geometry, raw text and frame despite recomputed IDs", () => {
    for (const kind of ["range", "bbox", "text", "frame"]) {
      const raw = structuredClone(golden);
      const fact = raw.constraints[0];
      if (kind === "range") fact.fragments[3].usedTextRange.end--;
      else if (kind === "bbox") fact.fragments[0].bboxMilliPoints[0]++;
      else if (kind === "text") fact.fragments[0].rawText += " changed";
      else fact.widthMilliPoints++;
      fact.id = projectConstraintId(fact);
      expect(validateProjectConstraints(raw, input())).toBeNull();
    }
  });
  it("rejects omitted constraints, duplicates, missing fields and extra probability or coverage", () => {
    const dropped = structuredClone(golden); dropped.constraints = [];
    const duplicate = structuredClone(golden); duplicate.constraints.push(structuredClone(duplicate.constraints[0]));
    const missing = structuredClone(golden) as any; delete missing.purpose;
    const extraFact = structuredClone(golden) as any; extraFact.constraints[0].probability = null;
    extraFact.constraints[0].id = projectConstraintId(extraFact.constraints[0]);
    for (const raw of [dropped, duplicate, missing, extraFact, { ...golden, coverage: [] }, { ...golden, probability: 0.99 },
      { ...golden, confidence: null }, { ...golden, execution: {} }]) expect(validateProjectConstraints(raw, input())).toBeNull();
  });
  it("binds source, object and manifest; duplicated source or artifact cannot select convenient evidence", () => {
    for (const kind of ["object", "manifest", "source", "sha", "stage", "duplicate-source", "duplicate-artifact"]) {
      const x = input();
      if (kind === "object") x.objectId += "other";
      else if (kind === "manifest") x.inputManifestHash = "a".repeat(64);
      else if (kind === "source") (x.sources[0] as any).sourceFileId += "other";
      else if (kind === "sha") (x.sources[0] as any).sha256 = "a".repeat(64);
      else if (kind === "stage") (x.sources[0] as any).stages = ["PD", "RD"];
      else if (kind === "duplicate-source") x.sources.push(structuredClone(x.sources[0]));
      else x.textArtifacts.push(structuredClone(x.textArtifacts[0]));
      expect(validateProjectConstraints(golden, x)).toBeNull();
    }
  });
  it("requires complete envelope counts, quality shapes and original single-line boxes", () => {
    for (const kind of ["text-count", "summary-count", "quality-extra", "metric-missing", "metric-fraction", "reason-type", "line-box", "block-extra", "empty-pages"]) {
      const f = structuredClone(fixture), a = f.sourceArtifact, p = page(f);
      if (kind === "text-count") a.textPageCount++;
      else if (kind === "summary-count") a.qualitySummary.ocrRequiredPageCount++;
      else if (kind === "quality-extra") p.quality.probability = 0.99;
      else if (kind === "metric-missing") delete p.quality.metrics.blockCount;
      else if (kind === "metric-fraction") p.quality.metrics.blockCount = 1.5;
      else if (kind === "reason-type") p.quality.reasonCodes = [false];
      else if (kind === "line-box") p.blocks[0].lineBboxesMilliPoints[0][0]++;
      else if (kind === "block-extra") p.blocks[0].approved = true;
      else a.pages = [];
      expect(result(f).constraints, kind).toEqual([]);
      expect(validateProjectConstraints(golden, input(f)), kind).toBeNull();
    }
  });
  it.each(["0", "0,000", "00,9", "0,9-1,2", "0,9/1,2", "0,9 или 1,2", "1 000", "-0,9", "+0,9", "1e3", "NaN", "9".repeat(61)])(
    "abstains from invalid numeric form %s", value => {
      const f = structuredClone(fixture); page(f).blocks[2].text = page(f).blocks[2].text.replace("0,9", value);
      expect(result(f).constraints).toEqual([]);
    });
  it("rejects qualifiers, added exceptions, multiline blocks and unrelated overlapping text", () => {
    const variants = [
      [0, "Ширина", "Не ширина"], [2, "принята", "рекомендуется"], [2, "в свету", "по полотну"],
      [3, "полотне.", "полотне, кроме двери Д1."], [3, "Дверные", "Однако дверные"], [0, "через", "через\n"],
    ];
    for (const [index, old, replacement] of variants) {
      const f = structuredClone(fixture), block = page(f).blocks[index as number];
      block.text = block.text.replace(old, replacement);
      expect(result(f).constraints).toEqual([]);
    }
  });
  it("keeps author constraints unreviewed despite source approval and entity proofs", () => {
    const f = structuredClone(fixture);
    Object.assign(f.source, { entityKey: "door-D1", scopeProofs: { ENTITY_SCOPE: { status: "VERIFIED" } },
      approvalStatus: "APPROVED", revisionStatus: "CURRENT" });
    expect(result(f)).toEqual(golden);
    expect(result(f).constraints[0]).not.toHaveProperty("probability");
    expect(result(f)).not.toHaveProperty("coverage");
  });
  it("hashes every original page, including nonselected text", () => {
    const f = structuredClone(fixture); f.sourceArtifact.pages[0].blocks[0].text += " ";
    const changed = result(f).constraints[0];
    expect(changed.id).not.toBe(golden.constraints[0].id);
    expect(changed.textArtifactHash).not.toBe(golden.constraints[0].textArtifactHash);
    expect(changed.fragments).toEqual(golden.constraints[0].fragments);
    expect(validateProjectConstraints(golden, input(f))).toBeNull();
  });
  it("sorts source IDs by Unicode code points and computes ranges as code points", () => {
    const x = input(), a = structuredClone(x.sources[0]) as any, b = structuredClone(a);
    const first = structuredClone(x.textArtifacts[0]) as any, second = structuredClone(first);
    a.sourceFileId = first.sourceFileId = "\u{10000}"; b.sourceFileId = second.sourceFileId = "\ue000";
    const got = extractProjectConstraints({ ...x, sources: [a, b], textArtifacts: [first, second] });
    expect(got.constraints.map(c => c.sourceFileId)).toEqual(["\ue000", "\u{10000}"]);
    // Supplementary text outside the chosen grammar still participates in the full artifact hash.
    first.pages[0].blocks[0].text += "😀";
    const changed = extractProjectConstraints({ ...x, sources: [a], textArtifacts: [first] }).constraints[0];
    expect(changed.fragments.map(f => f.usedTextRange.end)).toEqual([69, 73, 71, 27]);
    expect(changed.textArtifactHash).not.toBe(got.constraints[1].textArtifactHash);
  });
  it("rejects invalid outer inputs cleanly and validator returns null", () => {
    for (const value of [{ ...input(), objectId: "" }, { ...input(), inputManifestHash: "a".repeat(64) + "\n" },
      { ...input(), sources: {} }, { ...input(), textArtifacts: null }, null]) {
      expect(() => extractProjectConstraints(value as ProjectConstraintInput)).toThrow("invalid project constraint input");
      expect(validateProjectConstraints(golden, value as ProjectConstraintInput)).toBeNull();
    }
  });
  it("leaves exact legacy execution, observations and coverage unchanged", () => {
    const exact = loadMatrixGoldenFixtures().find(f => f.name === "boundary:three-percent")!;
    const before = structuredClone(exact), accepted = validateMatrixExecution(exact.execution, exact.input);
    expect(accepted).not.toBeNull();
    const prior = canonicalJson(accepted);
    result(); validateProjectConstraints(golden, input());
    expect(exact).toEqual(before);
    expect(canonicalJson(validateMatrixExecution(exact.execution, exact.input))).toBe(prior);
    expect(accepted).not.toHaveProperty("projectConstraints");
  });
});

describe("portable project-constraint identity domain", () => {
  it("serializes numeric ASCII keys lexically without JS object-key reordering", () => {
    expect(canonicalProjectConstraintJson({ "2": "b", "10": "a", z: "😀", A: 1, _: 2 }))
      .toBe('{"10":"a","2":"b","A":1,"_":2,"z":"😀"}');
    expect(canonicalProjectConstraintJson({ b: 2, a: 1 })).toBe('{"a":1,"b":2}');
    expect(canonicalProjectConstraintJson({ text: "\u0000\b\f\n\r\t\u001f\u2028😀" }))
      .toBe('{"text":"\\u0000\\b\\f\\n\\r\\t\\u001f\u2028😀"}');
  });
  it("rejects fractions, unsafe integers, non-ASCII keys, malformed Unicode, cycles and non-JSON values", () => {
    const cycle: unknown[] = []; cycle.push(cycle);
    const deep: any[] = []; let tail = deep; for (let i = 0; i < 65; i++) { const next: any[] = []; tail.push(next); tail = next; }
    const accessor = Object.defineProperty({}, "x", { enumerable: true, get() { throw new Error("must not invoke accessor"); } });
    for (const bad of [1.5, NaN, Infinity, 2 ** 53, { а: 1 }, "\ud800", "\udfff", cycle, deep, undefined, () => 1,
      1n, new Date(), new Map(), new Array(2), { x: undefined }, accessor, { [Symbol("x")]: 1 }]) {
      expect(() => canonicalProjectConstraintJson(bad)).toThrow();
      expect(validateProjectConstraints(bad, input())).toBeNull();
    }
    const shared = { a: 1 }; expect(canonicalProjectConstraintJson([shared, shared])).toBe('[{"a":1},{"a":1}]');
  });
  it("documents the wire-number limit: 120480.0 and 120480 parse identically", () => {
    expect(JSON.parse("120480.0")).toBe(JSON.parse("120480"));
    const f = structuredClone(fixture); page(f).blocks[0].bboxMilliPoints[0] = JSON.parse("120480.0");
    expect(result(f)).toEqual(golden);
    for (const invalid of [120480.5, Number.MAX_SAFE_INTEGER + 1]) {
      page(f).blocks[0].bboxMilliPoints[0] = invalid;
      expect(result(f).constraints).toEqual([]);
    }
  });
  it("ignores only the id property when deriving IDs, and includes all semantic fields", () => {
    expect(projectConstraintId({ ...golden.constraints[0], id: "forged" })).toBe(golden.constraints[0].id);
    expect(projectConstraintId({ ...golden.constraints[0], relation: "LE" })).not.toBe(golden.constraints[0].id);
    expect(projectConstraintId({ ...golden.constraints[0], probability: null })).not.toBe(golden.constraints[0].id);
    expect(() => projectConstraintId({ ...golden.constraints[0], [Symbol("hidden")]: 1 })).toThrow();
    expect(() => projectConstraintId(Object.defineProperty({ ...golden.constraints[0] }, "extra", { value: 1 }))).toThrow();
    expect(projectConstraintId({ ...golden.constraints[0], id: undefined })).toBe(golden.constraints[0].id);
  });
});
