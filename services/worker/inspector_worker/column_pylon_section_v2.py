"""KR060 explicitly reviewed rectangular gross-section pairs. No DB/PDF/actor authority."""
from __future__ import annotations
import copy
import hashlib
import json
from json.encoder import encode_basestring
import re
from .document_text_v3 import read_document_text_v3_large_artifact
from .column_pylon_dimension_literals import extract_column_pylon_dimension_literals

_SURROGATE = re.compile(r'[\ud800-\udfff]')

class ColumnPylonSectionReviewValidationError(TypeError):
    def __init__(self, code):
        self.code = code
        super().__init__(code)

def _fail(code):
    raise ColumnPylonSectionReviewValidationError(code)

_POLICIES = {'REQUEST': (524288, 200000, 64), 'JOURNAL': (1048576, 200000, 64), 'WHOLE': (67108864, 2900000, 68)}
def _canonical(value, policy='WHOLE'):
    maximum, max_nodes, max_depth = _POLICIES[policy]
    nodes = 0
    charged = 0
    ancestors = set()
    def add(n):
        nonlocal charged
        charged += n
        if charged > maximum:
            _fail('INPUT_LIMIT')
    def visit(v, depth):
        nonlocal nodes
        nodes += 1
        if nodes > max_nodes or depth > max_depth:
            _fail('INPUT_LIMIT')
        t = type(v)
        if v is None:
            add(4)
            return 'null'
        if t is bool:
            add(4 if v else 5)
            return 'true' if v else 'false'
        if t is int:
            if abs(v) > 9007199254740991:
                _fail('INVALID_INPUT')
            s = str(v)
            add(len(s))
            return s
        if t is str:
            if len(v) > 2000000:
                _fail('INPUT_LIMIT')
            if _SURROGATE.search(v):
                _fail('INVALID_INPUT')
            s = encode_basestring(v)
            add(len(s.encode('utf8')))
            return s
        if t not in (list, dict) or id(v) in ancestors:
            _fail('INVALID_INPUT')
        if len(v) > 32768:
            _fail('INPUT_LIMIT')
        if t is dict and any(type(k) is not str for k in v):
            _fail('INVALID_INPUT')
        ancestors.add(id(v))
        add(2 + max(0, len(v)-1) + (len(v) if t is dict else 0))
        if t is list:
            out = '[' + ','.join(visit(x, depth+1) for x in v) + ']'
        else:
            out = '{' + ','.join(visit(k, depth+1)+':'+visit(v[k], depth+1) for k in sorted(v)) + '}'
        ancestors.remove(id(v))
        return out
    return visit(value, 0)

def _detach(v, p):
    return json.loads(_canonical(v, p))
def _hash(v):
    return hashlib.sha256(_canonical(v).encode('utf8')).hexdigest()
def _eq(a, b):
    return _canonical(a) == _canonical(b)
def _omit(v, keys):
    return {k: x for k, x in v.items() if k not in keys}

# Trusted canonical schema payloads inserted by the local source authoring step below.
_SCHEMAS = json.loads('{"matrix-column-pylon-section-v2.schema.json":{"$schema":"https://json-schema.org/draft/2020-12/schema","$id":"matrix-column-pylon-section-v2.schema.json","title":"PROPOSED KR060 explicitly reviewed native/literal rectangular gross-section pair; candidate only","$ref":"#/$defs/comparisonInput","$defs":{"sha":{"type":"string","minLength":64,"maxLength":64,"pattern":"^[a-f0-9]{64}(?![\\\\s\\\\S])"},"key":{"type":"string","minLength":1,"maxLength":200,"pattern":"^[^\\\\u0000-\\\\u001f\\\\u007f-\\\\u009f\\\\u2028\\\\u2029\\\\ufffd]+(?![\\\\s\\\\S])"},"reference":{"type":"string","minLength":8,"maxLength":1000,"pattern":"^[^\\\\u0000-\\\\u001f\\\\u007f-\\\\u009f\\\\u2028\\\\u2029\\\\ufffd]+(?![\\\\s\\\\S])"},"uuid":{"type":"string","format":"uuid"},"utcMilliseconds":{"type":"string","pattern":"^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\\\.[0-9]{3}Z(?![\\\\s\\\\S])"},"page":{"type":"integer","minimum":1,"maximum":512},"stage":{"enum":["PD","RD","ID","UNRESOLVED"]},"stages":{"type":"array","items":{"enum":["PD","RD","ID"]},"minItems":1,"maxItems":3,"uniqueItems":true},"pageStages":{"type":"object","propertyNames":{"pattern":"^[1-9][0-9]{0,2}(?![\\\\s\\\\S])"},"additionalProperties":{"$ref":"#/$defs/stage"},"maxProperties":512},"range":{"type":"array","prefixItems":[{"type":"integer","minimum":0,"maximum":9007199254740991},{"type":"integer","minimum":1,"maximum":9007199254740991}],"items":false,"minItems":2,"maxItems":2},"area":{"type":"string","pattern":"^[1-9][0-9]{0,17}(?![\\\\s\\\\S])"},"delta":{"type":"string","pattern":"^(?:0|-?[1-9][0-9]{0,17})(?![\\\\s\\\\S])"},"identity":{"type":"object","additionalProperties":false,"required":["entityKey","buildingKey","zoneKey","levelKey","memberKey","sectionKey","componentRole"],"properties":{"entityKey":{"$ref":"#/$defs/key"},"buildingKey":{"$ref":"#/$defs/key"},"zoneKey":{"$ref":"#/$defs/key"},"levelKey":{"$ref":"#/$defs/key"},"memberKey":{"$ref":"#/$defs/key"},"sectionKey":{"$ref":"#/$defs/key"},"componentRole":{"const":"BEARING_VERTICAL_MEMBER_SECTION"}}},"originTarget":{"type":"object","additionalProperties":false,"required":["inputManifestHash","textStageContentHash","textArtifactByteSha256","textArtifactContentHash","extractorProfileHash","checkId","resourcePolicyVersion","sourceAuditProfileVersion"],"properties":{"inputManifestHash":{"$ref":"#/$defs/sha"},"textStageContentHash":{"$ref":"#/$defs/sha"},"textArtifactByteSha256":{"$ref":"#/$defs/sha"},"textArtifactContentHash":{"$ref":"#/$defs/sha"},"extractorProfileHash":{"$ref":"#/$defs/sha"},"checkId":{"$ref":"#/$defs/key"},"resourcePolicyVersion":{"const":"document-text-v3-large-source-bounds-v1"},"sourceAuditProfileVersion":{"const":"SOURCE_AUDIT_V3_LARGE_VERTICAL_V1"}}},"sourceReference":{"type":"object","additionalProperties":false,"required":["sourceFileId","sourceSha256","sourceReviewDecisionId","sourceReviewContentHash","origin","selection"],"properties":{"sourceFileId":{"$ref":"#/$defs/key"},"sourceSha256":{"$ref":"#/$defs/sha"},"sourceReviewDecisionId":{"$ref":"#/$defs/uuid"},"sourceReviewContentHash":{"$ref":"#/$defs/sha"},"origin":{"$ref":"#/$defs/originTarget"},"selection":{"$ref":"#/$defs/selectionReference"}}},"assertions":{"type":"object","additionalProperties":false,"required":["physicalMember","shape","dimensionMeaning","unit"],"properties":{"physicalMember":{"enum":["UNKNOWN","HUMAN_REVIEWED_SAME_PHYSICAL_MEMBER_AND_SECTION"]},"shape":{"enum":["UNKNOWN","HUMAN_REVIEWED_RECTANGLE"]},"dimensionMeaning":{"enum":["UNKNOWN","HUMAN_REVIEWED_GROSS_EXTERNAL_SECTION"]},"unit":{"enum":["UNKNOWN","HUMAN_REVIEWED_EXPLICIT_MM"]}}},"basisRole":{"enum":["PHYSICAL_MEMBER","SECTION_SHAPE","GROSS_SECTION","UNIT","UNIT_SCOPE"]},"basisSelection":{"type":"object","additionalProperties":false,"required":["role","pageNumber","sourcePath","rawText","usedTextRangeCodePoints"],"properties":{"role":{"$ref":"#/$defs/basisRole"},"pageNumber":{"$ref":"#/$defs/page"},"sourcePath":{"$ref":"document-text-v3.schema.json#/definitions/sourcePath"},"rawText":{"type":"string","minLength":1,"maxLength":8192},"usedTextRangeCodePoints":{"$ref":"#/$defs/range"}}},"pageFrame":{"type":"object","additionalProperties":false,"required":["widthMilliPoints","heightMilliPoints","nativeFrame"],"properties":{"widthMilliPoints":{"type":"integer","minimum":1,"maximum":9007199254740991},"heightMilliPoints":{"type":"integer","minimum":1,"maximum":9007199254740991},"nativeFrame":{"$ref":"document-text-v3.schema.json#/definitions/nativeFrame"}}},"basisFragment":{"type":"object","additionalProperties":false,"required":["role","pageNumber","sourcePath","rawText","usedTextRangeCodePoints","nativeBoxPointStrings","bboxMilliPoints","pageFrame"],"properties":{"role":{"$ref":"#/$defs/basisRole"},"pageNumber":{"$ref":"#/$defs/page"},"sourcePath":{"$ref":"document-text-v3.schema.json#/definitions/sourcePath"},"rawText":{"type":"string","minLength":1,"maxLength":8192},"usedTextRangeCodePoints":{"$ref":"#/$defs/range"},"nativeBoxPointStrings":{"$ref":"document-text-v3.schema.json#/definitions/nativeBox"},"bboxMilliPoints":{"type":"array","prefixItems":[{"type":"integer","minimum":0,"maximum":9007199254740991},{"type":"integer","minimum":0,"maximum":9007199254740991},{"type":"integer","minimum":0,"maximum":9007199254740991},{"type":"integer","minimum":0,"maximum":9007199254740991}],"items":false,"minItems":4,"maxItems":4},"pageFrame":{"$ref":"#/$defs/pageFrame"}}},"sideRequest":{"type":"object","additionalProperties":false,"required":["sourceFileId","sourceSha256","sourceReviewDecisionId","sourceReviewContentHash","origin","assertions","unitScopeAssertion","reference","selection","basis"],"properties":{"sourceFileId":{"$ref":"#/$defs/key"},"sourceSha256":{"$ref":"#/$defs/sha"},"sourceReviewDecisionId":{"$ref":"#/$defs/uuid"},"sourceReviewContentHash":{"$ref":"#/$defs/sha"},"origin":{"$ref":"#/$defs/originTarget"},"assertions":{"$ref":"#/$defs/assertions"},"unitScopeAssertion":{"$ref":"#/$defs/unitScopeAssertion"},"reference":{"$ref":"#/$defs/reference"},"selection":{"$ref":"#/$defs/selection"},"basis":{"type":"array","minItems":0,"maxItems":16,"items":{"$ref":"#/$defs/basisSelection"}}}},"sideDecision":{"type":"object","additionalProperties":false,"required":["sourceFileId","sourceSha256","sourceReviewDecisionId","sourceReviewContentHash","origin","assertions","unitScopeAssertion","reference","selection","basis"],"properties":{"sourceFileId":{"$ref":"#/$defs/key"},"sourceSha256":{"$ref":"#/$defs/sha"},"sourceReviewDecisionId":{"$ref":"#/$defs/uuid"},"sourceReviewContentHash":{"$ref":"#/$defs/sha"},"origin":{"$ref":"#/$defs/originTarget"},"assertions":{"$ref":"#/$defs/assertions"},"unitScopeAssertion":{"$ref":"#/$defs/unitScopeAssertion"},"reference":{"$ref":"#/$defs/reference"},"selection":{"$ref":"#/$defs/selectionSnapshot"},"basis":{"type":"array","minItems":0,"maxItems":16,"items":{"$ref":"#/$defs/basisFragment"}}}},"pairAssertion":{"enum":["UNKNOWN","HUMAN_REVIEWED_SAME_MEMBER_SECTION_PD_RD"]},"request":{"type":"object","additionalProperties":false,"required":["schemaVersion","status","identity","expected","actual","pairAssertion","reference","expectedReviewHash"],"properties":{"schemaVersion":{"const":"matrix-kr060-column-pylon-pair-review-input-v2"},"status":{"enum":["UNKNOWN","APPROVED","WITHDRAWN"]},"identity":{"$ref":"#/$defs/identity"},"expected":{"$ref":"#/$defs/sideRequest"},"actual":{"$ref":"#/$defs/sideRequest"},"pairAssertion":{"$ref":"#/$defs/pairAssertion"},"reference":{"$ref":"#/$defs/reference"},"expectedReviewHash":{"anyOf":[{"$ref":"#/$defs/sha"},{"type":"null"}]}}},"projection":{"type":"object","additionalProperties":false,"required":["schemaVersion","decisionId","objectId","status","identity","expected","actual","pairAssertion","reference","contentHash"],"properties":{"schemaVersion":{"const":"matrix-kr060-column-pylon-pair-projection-v2"},"decisionId":{"$ref":"#/$defs/uuid"},"objectId":{"$ref":"#/$defs/key"},"status":{"enum":["UNKNOWN","APPROVED","WITHDRAWN"]},"identity":{"$ref":"#/$defs/identity"},"expected":{"$ref":"#/$defs/sideDecision"},"actual":{"$ref":"#/$defs/sideDecision"},"pairAssertion":{"$ref":"#/$defs/pairAssertion"},"reference":{"$ref":"#/$defs/reference"},"contentHash":{"$ref":"#/$defs/sha"}}},"journal":{"type":"object","additionalProperties":false,"required":["schemaVersion","id","objectId","actorId","createdAt","previousDecisionId","previousReviewHash","projection","contentHash"],"properties":{"schemaVersion":{"const":"matrix-kr060-column-pylon-pair-journal-v2"},"id":{"$ref":"#/$defs/uuid"},"objectId":{"$ref":"#/$defs/key"},"actorId":{"$ref":"#/$defs/uuid"},"createdAt":{"$ref":"#/$defs/utcMilliseconds"},"previousDecisionId":{"anyOf":[{"$ref":"#/$defs/uuid"},{"type":"null"}]},"previousReviewHash":{"anyOf":[{"$ref":"#/$defs/sha"},{"type":"null"}]},"projection":{"$ref":"#/$defs/projection"},"contentHash":{"$ref":"#/$defs/sha"}}},"sourceReview":{"type":"object","additionalProperties":false,"required":["decisionId","contentHash","revisionStatus","approvalStatus","sectionCode","linkGroupId","pageStages"],"properties":{"decisionId":{"$ref":"#/$defs/uuid"},"contentHash":{"$ref":"#/$defs/sha"},"revisionStatus":{"enum":["CURRENT","SUPERSEDED","UNKNOWN"]},"approvalStatus":{"enum":["APPROVED","UNAPPROVED","UNKNOWN"]},"sectionCode":{"anyOf":[{"enum":["PZ","SPZU","AR","KR","IOS1","IOS2","IOS3","IOS4","IOS5","POS","POD","OOS","PPM","ODI","ZU","SM","EOM","GP","GSV","KJ","KM","NVK","OV","PP","PPR","SS","VK"]},{"type":"null"}]},"linkGroupId":{"anyOf":[{"$ref":"#/$defs/key"},{"type":"null"}]},"pageStages":{"$ref":"#/$defs/pageStages"}}},"source":{"type":"object","additionalProperties":false,"required":["sourceFileId","sourceSha256","stages","review"],"properties":{"sourceFileId":{"$ref":"#/$defs/key"},"sourceSha256":{"$ref":"#/$defs/sha"},"stages":{"$ref":"#/$defs/stages"},"review":{"anyOf":[{"$ref":"#/$defs/sourceReview"},{"type":"null"}]}}},"origin":{"type":"object","additionalProperties":false,"required":["objectId","sourceFileId","sourceSha256","target","stages","pageStages","textArtifact"],"properties":{"objectId":{"$ref":"#/$defs/key"},"sourceFileId":{"$ref":"#/$defs/key"},"sourceSha256":{"$ref":"#/$defs/sha"},"target":{"$ref":"#/$defs/originTarget"},"stages":{"$ref":"#/$defs/stages"},"pageStages":{"$ref":"#/$defs/pageStages"},"textArtifact":{"$ref":"document-text-v3.schema.json#/definitions/artifact"}}},"comparisonInput":{"type":"object","additionalProperties":false,"required":["schemaVersion","objectId","identity","sources","origins","review"],"properties":{"schemaVersion":{"const":"matrix-kr060-column-pylon-comparison-input-v2"},"objectId":{"$ref":"#/$defs/key"},"identity":{"$ref":"#/$defs/identity"},"sources":{"type":"array","items":{"$ref":"#/$defs/source"},"minItems":0,"maxItems":2},"origins":{"type":"array","items":{"$ref":"#/$defs/origin"},"minItems":0,"maxItems":2},"review":{"anyOf":[{"$ref":"#/$defs/journal"},{"type":"null"}]}}},"comparison":{"type":"object","additionalProperties":false,"required":["scope","expected","actual","expectedAreaMm2","actualAreaMm2","deltaAreaMm2","pairDecisionId","pairProjectionContentHash","pairJournalContentHash"],"properties":{"scope":{"const":"ONE_HUMAN_REVIEWED_RECTANGULAR_GROSS_SECTION_PD_RD"},"expected":{"$ref":"#/$defs/sourceReference"},"actual":{"$ref":"#/$defs/sourceReference"},"expectedAreaMm2":{"$ref":"#/$defs/area"},"actualAreaMm2":{"$ref":"#/$defs/area"},"deltaAreaMm2":{"$ref":"#/$defs/delta"},"pairDecisionId":{"$ref":"#/$defs/uuid"},"pairProjectionContentHash":{"$ref":"#/$defs/sha"},"pairJournalContentHash":{"$ref":"#/$defs/sha"}}},"abstainResult":{"type":"object","additionalProperties":false,"required":["schemaVersion","status","reasonCode","identity","comparison","calibratedProbability"],"properties":{"schemaVersion":{"const":"matrix-kr060-column-pylon-comparison-v2"},"status":{"const":"ABSTAIN"},"reasonCode":{"enum":["INVALID_INPUT","INPUT_LIMIT","SOURCE_PROVENANCE_UNVERIFIED","PAIR_REVIEW_UNVERIFIED","SELECTION_RECONSTRUCTION_UNVERIFIED","BASIS_RECONSTRUCTION_UNVERIFIED","PAIR_REVIEW_MISSING","PAIR_REVIEW_UNAPPROVED","STALE_SOURCE_REVIEW","SOURCE_REVIEW_UNVERIFIED","SOURCE_SECTION_UNVERIFIED","SOURCE_STAGE_UNVERIFIED","SOURCE_LINK_UNVERIFIED","PHYSICAL_MEMBER_UNVERIFIED","SECTION_SHAPE_UNVERIFIED","DIMENSION_MEANING_UNVERIFIED","UNIT_UNVERIFIED","PAIR_APPLICABILITY_UNVERIFIED"]},"identity":{"anyOf":[{"$ref":"#/$defs/identity"},{"type":"null"}]},"comparison":{"type":"null"},"calibratedProbability":{"type":"null"}}},"candidateResult":{"type":"object","additionalProperties":false,"required":["schemaVersion","status","reasonCode","identity","comparison","expertReviewRequired","calibratedProbability"],"properties":{"schemaVersion":{"const":"matrix-kr060-column-pylon-comparison-v2"},"status":{"const":"CANDIDATE"},"reasonCode":{"const":"REVIEWED_RECTANGULAR_GROSS_SECTION_AREA_DECREASE"},"identity":{"$ref":"#/$defs/identity"},"comparison":{"$ref":"#/$defs/comparison"},"expertReviewRequired":{"const":true},"calibratedProbability":{"type":"null"}}},"noDecreaseResult":{"type":"object","additionalProperties":false,"required":["schemaVersion","status","reasonCode","identity","comparison","calibratedProbability"],"properties":{"schemaVersion":{"const":"matrix-kr060-column-pylon-comparison-v2"},"status":{"const":"NO_DECREASE_IN_REVIEWED_PAIR"},"reasonCode":{"const":"REVIEWED_PAIR_HAS_NO_AREA_DECREASE"},"identity":{"$ref":"#/$defs/identity"},"comparison":{"$ref":"#/$defs/comparison"},"calibratedProbability":{"type":"null"}}},"result":{"oneOf":[{"$ref":"#/$defs/abstainResult"},{"$ref":"#/$defs/candidateResult"},{"$ref":"#/$defs/noDecreaseResult"}]},"materializationContext":{"type":"object","additionalProperties":false,"required":["objectId","actorId","id","createdAt","mode","previous","sources","origins"],"properties":{"objectId":{"$ref":"#/$defs/key"},"actorId":{"$ref":"#/$defs/uuid"},"id":{"$ref":"#/$defs/uuid"},"createdAt":{"$ref":"#/$defs/utcMilliseconds"},"mode":{"enum":["CURRENT","HISTORICAL"]},"previous":{"anyOf":[{"$ref":"#/$defs/journal"},{"type":"null"}]},"sources":{"type":"array","items":{"$ref":"#/$defs/source"},"minItems":2,"maxItems":2},"origins":{"type":"array","items":{"$ref":"#/$defs/origin"},"minItems":2,"maxItems":2}}},"sourcePreview":{"type":"object","additionalProperties":false,"required":["schemaVersion","objectId","sourceFileId","sourceSha256","origin","stage","pageStages","latestReviewHash","extraction","nativeSelectionPolicyVersion"],"properties":{"schemaVersion":{"const":"matrix-kr060-column-pylon-source-preview-v2"},"objectId":{"$ref":"#/$defs/key"},"sourceFileId":{"$ref":"#/$defs/key"},"sourceSha256":{"$ref":"#/$defs/sha"},"origin":{"$ref":"#/$defs/originTarget"},"stage":{"$ref":"#/$defs/stage"},"pageStages":{"$ref":"#/$defs/pageStages"},"latestReviewHash":{"anyOf":[{"$ref":"#/$defs/sha"},{"type":"null"}]},"extraction":{"$ref":"column-pylon-dimension-literals.schema.json"},"nativeSelectionPolicyVersion":{"const":"column-pylon-native-section-selection-v1"}}},"reviewList":{"type":"object","additionalProperties":false,"required":["items","canReview"],"properties":{"items":{"type":"array","items":{"$ref":"#/$defs/journal"},"minItems":0,"maxItems":16},"canReview":{"type":"boolean"}}},"comparisonPreviewRequest":{"type":"object","additionalProperties":false,"required":["reviewDecisionId"],"properties":{"reviewDecisionId":{"$ref":"#/$defs/uuid"}}},"pairKeyInput":{"type":"object","additionalProperties":false,"required":["objectId","identity","expectedSourceFileId","actualSourceFileId"],"properties":{"objectId":{"$ref":"#/$defs/key"},"identity":{"$ref":"#/$defs/identity"},"expectedSourceFileId":{"$ref":"#/$defs/key"},"actualSourceFileId":{"$ref":"#/$defs/key"}}},"tokenSelection":{"type":"object","additionalProperties":false,"required":["pageNumber","sourcePath","rawText","usedTextRangeCodePoints"],"properties":{"pageNumber":{"$ref":"#/$defs/page"},"sourcePath":{"$ref":"document-text-v3.schema.json#/definitions/sourcePath"},"rawText":{"type":"string","minLength":1,"maxLength":8192},"usedTextRangeCodePoints":{"$ref":"#/$defs/range"}}},"tokenSnapshot":{"type":"object","additionalProperties":false,"required":["pageNumber","sourcePath","rawText","usedTextRangeCodePoints","nativeBoxPointStrings","bboxMilliPoints","pageFrame","value"],"properties":{"pageNumber":{"$ref":"#/$defs/page"},"sourcePath":{"$ref":"document-text-v3.schema.json#/definitions/sourcePath"},"rawText":{"type":"string","minLength":1,"maxLength":8192},"usedTextRangeCodePoints":{"$ref":"#/$defs/range"},"nativeBoxPointStrings":{"$ref":"document-text-v3.schema.json#/definitions/nativeBox"},"bboxMilliPoints":{"type":"array","prefixItems":[{"type":"integer","minimum":0,"maximum":9007199254740991},{"type":"integer","minimum":0,"maximum":9007199254740991},{"type":"integer","minimum":0,"maximum":9007199254740991},{"type":"integer","minimum":0,"maximum":9007199254740991}],"items":false,"minItems":4,"maxItems":4},"pageFrame":{"$ref":"#/$defs/pageFrame"},"value":{"type":"string","minLength":1,"maxLength":9}}},"literalSelection":{"type":"object","additionalProperties":false,"required":["mode","pageNumber","sourcePath","literalContentHash"],"properties":{"mode":{"const":"LITERAL_T77_V1"},"pageNumber":{"$ref":"#/$defs/page"},"sourcePath":{"$ref":"document-text-v3.schema.json#/definitions/sourcePath"},"literalContentHash":{"$ref":"#/$defs/sha"}}},"literalSelectionSnapshot":{"type":"object","additionalProperties":false,"required":["mode","pageNumber","sourcePath","literalContentHash","literalSnapshot"],"properties":{"mode":{"const":"LITERAL_T77_V1"},"pageNumber":{"$ref":"#/$defs/page"},"sourcePath":{"$ref":"document-text-v3.schema.json#/definitions/sourcePath"},"literalContentHash":{"$ref":"#/$defs/sha"},"literalSnapshot":{"$ref":"column-pylon-dimension-literals.schema.json#/$defs/literal"}}},"nativeSelection":{"type":"object","additionalProperties":false,"required":["mode","first","second","unit"],"properties":{"mode":{"const":"NATIVE_SECTION_SELECTION_V1"},"first":{"$ref":"#/$defs/tokenSelection"},"second":{"$ref":"#/$defs/tokenSelection"},"unit":{"anyOf":[{"$ref":"#/$defs/tokenSelection"},{"type":"null"}]}}},"nativeSelectionSnapshot":{"type":"object","additionalProperties":false,"required":["mode","first","second","unit","selectionContentHash"],"properties":{"mode":{"const":"NATIVE_SECTION_SELECTION_V1"},"first":{"$ref":"#/$defs/tokenSnapshot"},"second":{"$ref":"#/$defs/tokenSnapshot"},"unit":{"anyOf":[{"$ref":"#/$defs/tokenSnapshot"},{"type":"null"}]},"selectionContentHash":{"$ref":"#/$defs/sha"}}},"selection":{"oneOf":[{"$ref":"#/$defs/literalSelection"},{"$ref":"#/$defs/nativeSelection"}]},"selectionSnapshot":{"oneOf":[{"$ref":"#/$defs/literalSelectionSnapshot"},{"$ref":"#/$defs/nativeSelectionSnapshot"}]},"nativeSelectionReference":{"type":"object","additionalProperties":false,"required":["mode","first","second","unit","selectionContentHash"],"properties":{"mode":{"const":"NATIVE_SECTION_SELECTION_V1"},"first":{"$ref":"#/$defs/tokenSelection"},"second":{"$ref":"#/$defs/tokenSelection"},"unit":{"anyOf":[{"$ref":"#/$defs/tokenSelection"},{"type":"null"}]},"selectionContentHash":{"$ref":"#/$defs/sha"}}},"selectionReference":{"oneOf":[{"$ref":"#/$defs/literalSelection"},{"$ref":"#/$defs/nativeSelectionReference"}]},"unitScopeAssertion":{"enum":["UNKNOWN","HUMAN_REVIEWED_UNIT_APPLIES_TO_BOTH_SELECTED_DIMENSIONS"]}},"x-status":"PROPOSED_CANONICAL_SOURCE_BEFORE_COMPARATOR_CODE","x-semantic-contract":{"wire":"ONE v2 production workflow; no deployed v1 journal to migrate. Explicit per-side discriminated LITERAL_T77_V1 or NATIVE_SECTION_SELECTION_V1. Unknown mode/extra keys invalid, no fallback.","normativeFiles":["hash-domains-v2.json","semantics-v2.json","../resource-limits.json","../semantic-clarifications-v1.json","../eligibility-diagnostic-addendum-v1.json","../calendar-and-withdrawal-addendum-v1.json"],"validationOrder":"Frozen v1 full native/shape -> retained origin -> pair journal -> selected immutable selection -> every supplied basis -> latest status -> current refs/source/section/stages/link -> member/shape/gross/unit/unit-scope/pair eligibility -> exact integer arithmetic. v2 replaces LITERAL_RECONSTRUCTION_UNVERIFIED with SELECTION_RECONSTRUCTION_UNVERIFIED.","authority":"Every supplied field is only data; scoped repository proves actors/full parent review bodies/original PDF bytes/release/job/current refs/latest sequence/CAS. Always candidate/null; no runtime or coverage change in this proposal."}},"document-text-v3.schema.json":{"$schema":"http://json-schema.org/draft-07/schema#","$id":"urn:inspector-ai:document-text-v3","title":"Complete versioned text-layer candidate with located and unlocated original lines","$ref":"#/definitions/artifact","definitions":{"nativeDecimal":{"type":"string","minLength":1,"maxLength":64,"pattern":"^-?(?:0|[1-9][0-9]*)(?:\\\\.[0-9]+)?(?:e[+-]?[0-9]+)?$"},"nativeBox":{"type":"array","items":{"$ref":"#/definitions/nativeDecimal"},"minItems":4,"maxItems":4},"sourcePath":{"type":"array","items":{"type":"integer","minimum":0,"maximum":32767},"minItems":1,"maxItems":64},"extractorProfile":{"type":"object","additionalProperties":false,"required":["schemaVersion","textLayerSourceSha256","documentTextV3SourceSha256","pdfminerVersion","geometryPolicyVersion","cropPolicyVersion","traversalPolicyVersion","qualityPolicyVersion"],"properties":{"schemaVersion":{"const":"document-text-extractor-profile-v1"},"textLayerSourceSha256":{"type":"string","pattern":"^[a-f0-9]{64}$","minLength":64,"maxLength":64},"documentTextV3SourceSha256":{"type":"string","pattern":"^[a-f0-9]{64}$","minLength":64,"maxLength":64},"pdfminerVersion":{"const":"20260107"},"geometryPolicyVersion":{"const":"document-text-v3-decimal-half-even-v1"},"cropPolicyVersion":{"const":"visible-crop-contained-epsilon-1e-6-v1"},"traversalPolicyVersion":{"enum":["pdfminer-top-level-whole-lines-v1","pdfminer-analyzed-figures-whole-lines-v1","pdfminer-analyzed-figures-boxes-flow-none-v1","pdfminer-analyzed-figures-boxes-flow-none-vertical-v1"]},"qualityPolicyVersion":{"const":"document-text-quality-v3"}}},"qualityMetrics":{"type":"object","additionalProperties":false,"required":["locatedLineCount","unlocatedLineCount","locatedNonWhitespaceCharacters","unlocatedNonWhitespaceCharacters","replacementCharacters","disallowedControlCharacters","cidPlaceholders"],"properties":{"locatedLineCount":{"type":"integer","minimum":0,"maximum":9007199254740991},"unlocatedLineCount":{"type":"integer","minimum":0,"maximum":9007199254740991},"locatedNonWhitespaceCharacters":{"type":"integer","minimum":0,"maximum":9007199254740991},"unlocatedNonWhitespaceCharacters":{"type":"integer","minimum":0,"maximum":9007199254740991},"replacementCharacters":{"type":"integer","minimum":0,"maximum":9007199254740991},"disallowedControlCharacters":{"type":"integer","minimum":0,"maximum":9007199254740991},"cidPlaceholders":{"type":"integer","minimum":0,"maximum":9007199254740991}}},"quality":{"type":"object","additionalProperties":false,"required":["disposition","reasonCodes","metrics"],"properties":{"disposition":{"enum":["TEXT_LAYER_CANDIDATE","PARTIAL_TEXT_LAYER","OCR_REQUIRED"]},"reasonCodes":{"type":"array","items":{"enum":["NO_LOCATED_TEXT","TEXT_DECODING_ANOMALY","UNLOCATED_TEXT_PRESENT"]},"minItems":0,"maxItems":3},"metrics":{"$ref":"#/definitions/qualityMetrics"}}},"nativeFrame":{"type":"object","additionalProperties":false,"required":["coordinateSystem","visibleBoxPointStrings"],"properties":{"coordinateSystem":{"const":"PDFMINER_LAYOUT_POINTS"},"visibleBoxPointStrings":{"$ref":"#/definitions/nativeBox"}}},"locatedLine":{"type":"object","additionalProperties":false,"required":["sourcePath","rawText","nativeBoxPointStrings","bboxMilliPoints"],"properties":{"sourcePath":{"$ref":"#/definitions/sourcePath"},"rawText":{"type":"string","minLength":1,"maxLength":2000000},"nativeBoxPointStrings":{"$ref":"#/definitions/nativeBox"},"bboxMilliPoints":{"type":"array","items":{"type":"integer","minimum":0,"maximum":9007199254740991},"minItems":4,"maxItems":4}}},"unlocatedLine":{"type":"object","additionalProperties":false,"required":["sourcePath","rawText","nativeBoxPointStrings","reasonCode"],"properties":{"sourcePath":{"$ref":"#/definitions/sourcePath"},"rawText":{"type":"string","minLength":1,"maxLength":2000000},"nativeBoxPointStrings":{"$ref":"#/definitions/nativeBox"},"reasonCode":{"enum":["NATIVE_ZERO_AREA","MILLI_POINT_COLLAPSE"]}}},"page":{"type":"object","additionalProperties":false,"required":["pageNumber","widthMilliPoints","heightMilliPoints","nativeFrame","locatedLines","unlocatedLines","quality"],"properties":{"pageNumber":{"type":"integer","minimum":1,"maximum":512},"widthMilliPoints":{"type":"integer","minimum":1,"maximum":9007199254740991},"heightMilliPoints":{"type":"integer","minimum":1,"maximum":9007199254740991},"nativeFrame":{"$ref":"#/definitions/nativeFrame"},"locatedLines":{"type":"array","items":{"$ref":"#/definitions/locatedLine"},"minItems":0,"maxItems":32768},"unlocatedLines":{"type":"array","items":{"$ref":"#/definitions/unlocatedLine"},"minItems":0,"maxItems":32768},"quality":{"$ref":"#/definitions/quality"}}},"qualitySummary":{"type":"object","additionalProperties":false,"required":["candidatePages","partialPages","ocrRequiredPages"],"properties":{"candidatePages":{"type":"integer","minimum":0,"maximum":512},"partialPages":{"type":"integer","minimum":0,"maximum":512},"ocrRequiredPages":{"type":"integer","minimum":0,"maximum":512}}},"artifact":{"type":"object","additionalProperties":false,"required":["schemaVersion","sourceFileId","inputSha256","coordinateSystem","pageCount","locatedTextPageCount","unlocatedTextPageCount","extractorProfile","extractorProfileHash","qualitySummary","pages"],"properties":{"schemaVersion":{"const":"document-text-v3"},"sourceFileId":{"type":"string","minLength":1,"maxLength":200},"inputSha256":{"type":"string","pattern":"^[a-f0-9]{64}$","minLength":64,"maxLength":64},"coordinateSystem":{"const":"PDF_BOTTOM_LEFT_MILLI_POINTS"},"pageCount":{"type":"integer","minimum":1,"maximum":512},"locatedTextPageCount":{"type":"integer","minimum":0,"maximum":512},"unlocatedTextPageCount":{"type":"integer","minimum":0,"maximum":512},"extractorProfile":{"$ref":"#/definitions/extractorProfile"},"extractorProfileHash":{"type":"string","pattern":"^[a-f0-9]{64}$","minLength":64,"maxLength":64},"qualitySummary":{"$ref":"#/definitions/qualitySummary"},"pages":{"type":"array","items":{"$ref":"#/definitions/page"},"minItems":1,"maxItems":512}}}},"x-semantic-contract":{"sourceIdentity":{"sourceFileId":"Unicode scalar string 1..200 codepoints; Python strip unchanged; no controls; no aliases","inputSha256":"lowercase ASCII hex64"},"portableCanonical":"Exact JSON data only; Unicode scalars, ASCII/codepoint key order, ensure_ascii false, compact separators; safe integers only; no floating JSON numbers. Native decimal values are strings. TS descriptor-first/proxy rejection; Python exact builtins; validate before hashing.","profileHash":"SHA256(UTF8(portableCanonical({hashDomain:document-text-extractor-profile-v1,profile:extractorProfile})))","contentHash":"SHA256(UTF8(portableCanonical({hashDomain:document-text-v3-content-v1,artifact:fullArtifact})))","sourcePath":{"shape":"Old top-level profile: [topLayoutIndex,lineChildIndex] for immediate original LTTextLine; [topLayoutIndex] only original LTTextLine or original text-container leaf. Analyzed-figures profile: complete native child-index ancestry from LTPage to each original whole LTTextLine or supported original text-container leaf after pinned pdfminer Form analysis; no synthetic joins.","indices":"nonnegative safe integers <=32767; exact original enumeration BEFORE filtering/sorting","ordering":"each output array lexicographic numeric sourcePath order, shorter prefix first","uniqueness":"no duplicate or prefix-overlapping sourcePath anywhere in the same page across BOTH arrays","claim":"one visited wholly-contained original line/leaf produces exactly one record; no glyph joins or synthetic line regrouping; arrays do not certify unseen PDF operators","profileLengths":"Old top-level profile accepts only path lengths1..2; analyzed-figures profile accepts1..64. Every index is original enumeration after selected pinned library layout analysis and BEFORE filtering/sorting. Explicit boxes-flow-none profile accepts1..64 from its own selected native layout; historical profile paths are not migrated or reinterpreted. Explicit boxes-flow-none-vertical profile independently accepts1..64 from its own native vertical-writing-aware layout; its paths never replace old committed paths."},"rawText":"Exact original get_text() including all original LF/separators/trailing whitespace; nonempty Unicode scalar string <=2000000 codepoints. Never strip, normalize, concatenate separate original lines, or publish a second semantic text field. LTAnno retained verbatim; its absence of geometry is not an invalid glyph.","nativeDecimalStrings":{"maxCodepoints":64,"grammar":"^-?(?:0|[1-9][0-9]*)(?:\\\\.[0-9]+)?(?:e[+-]?[0-9]+)?$","valueConstraints":"finite exact decimal, abs<=1000000000; explicit exponent if present in [-324,308]; negative zero accepted; producer uses repr(float(native value)) with lowercase e","order":"native x0<=x1 and y0<=y1, never swap inverted edges","validation":"no epsilon used for native positive vs zero classification"},"geometry":{"quantization":"Parse native repr decimal strings exactly (Decimal/rational); round-half-even(edge delta*1000) for every edge and dimension. No binary-float arithmetic in v3 quantization; v2 float-round unchanged.","frameDimensions":"width=roundHalfEven((frame.x1-frame.x0)*1000), height analogous; both positive safe integers; reject collapsed/unsafe native frame","crop":"A whole original line native box must be within visible frame with inclusive exact-decimal epsilon 0.000001 point. Wholly outside or partially crossing this containment policy is excluded exactly as legacy visible CropBox policy. Clamp already-contained rounding edges into [0,width/height]. No clipping text to manufacture an in-frame statement. No claim all off-crop raw retained.","located":"native line strictly positive and quantized bbox x0<x1,y0<y1; all safe integer edges in page frame","NATIVE_ZERO_AREA":"native width==0 OR native height==0; original whole line retained unlocated; no located bbox key","MILLI_POINT_COLLAPSE":"native strictly positive; exact quantization/clamp produces x0==x1 OR y0==y1; unlocated native strings must independently prove this reason","invalid":"nonfinite/inverted native boxes; zero parent containing positive child; positive whole line with any native zero-area LTChar; inconsistent glyph/line native positivity => whole extraction ValueError(INVALID_NATIVE_TEXT_GEOMETRY). No glyph millipoint-area gate, no deletion/splicing of invisible glyph.","unsupported":"Bounded traversal of nontext layout containers detects visible/intersecting LTChar/LTTextLine/text container outside supported immediate whole-line traversal => whole extraction ValueError(UNSUPPORTED_TEXT_LAYOUT). Pure image/vector primitives ignored; nested Form glyphs are NOT grouped into invented lines. Entirely offcrop unsupported text can be excluded."},"qualityRules":{"metrics":"Recompute from exact rawText across both arrays. No host Unicode category/alphanumeric/isalnum matching.","whitespaceCodepoints":["0009..000D","001C..0020","0085","00A0","1680","2000..200A","2028","2029","202F","205F","3000"],"nonWhitespace":"count Unicode scalar codepoints outside above fixed whitespace set in each array","replacement":"count U+FFFD in both arrays","disallowedControls":"count U+0000..001F except U+0009/U+000A/U+000D, and U+007F..009F, in both arrays (even if whitespace); fixed Cc ranges, no host category APIs","reasonOrder":["NO_LOCATED_TEXT","TEXT_DECODING_ANOMALY","UNLOCATED_TEXT_PRESENT"],"reasons":"NO_LOCATED_TEXT iff locatedNonWhitespaceCharacters==0; TEXT_DECODING_ANOMALY iff replacementCharacters>0 OR disallowedControlCharacters>0 OR cidPlaceholders>0; UNLOCATED_TEXT_PRESENT iff unlocatedLineCount>0; exact reasonOrder","disposition":"OCR_REQUIRED if NO_LOCATED_TEXT or TEXT_DECODING_ANOMALY; otherwise PARTIAL_TEXT_LAYER if UNLOCATED_TEXT_PRESENT; otherwise TEXT_LAYER_CANDIDATE. Punctuation-only can be CANDIDATE; this is no readability, semantic, geometric completeness or confidence certificate.","qualitySummaryExactKeys":["candidatePages","partialPages","ocrRequiredPages"],"counts":"summary sums page dispositions; locatedTextPageCount counts page with locatedNonWhitespaceCharacters>0; unlocatedTextPageCount counts page with unlocatedLineCount>0; pages all contiguous1..N","cidPlaceholders":"Count nonoverlapping ASCII \\\\(cid:[0-9]+\\\\) matches within each individual whole rawText, summed across both arrays; no cross-line concatenation"},"limits":{"utf8SerializedBytes":8000000,"nativeNodes":200000,"depth":64,"containerItems":32768,"stringCodepoints":2000000,"pages":512,"combinedLineRecords":100000,"pathLengthMax":64,"scope":"one whole artifact, including every page and both record arrays; reject never truncate","pathLengthByProfile":{"pdfminer-top-level-whole-lines-v1":2,"pdfminer-analyzed-figures-whole-lines-v1":64,"pdfminer-analyzed-figures-boxes-flow-none-v1":64,"pdfminer-analyzed-figures-boxes-flow-none-vertical-v1":64}},"readerSafety":"VALID requires whole artifact native/schema/geometry/reason/profilehash/quality validation. It returns no v2 block facade. Future source consumers must explicitly accept v3 and treat relevant unlocated lines or unlocated competing full-page anchors as abstention. Source authority, measurement unit, identity and confidence never inferred.","legacyPreservation":"All v1/v2 artifacts/readers/profiles and T59 text_layer.py bytes unchanged. Historical/default v3 top-level behavior and old manuals unchanged. New analyzed-figures profile is explicit opt-in; old v3 readers may reject this new policy. No implicit v2 coercion or release activation in T60/T61.","traversalProfiles":{"pdfminer-top-level-whole-lines-v1":"Historical/default producer behavior unchanged; do not call Form analysis. Visible unsupported nested primitives cause UNSUPPORTED_TEXT_LAYOUT.","pdfminer-analyzed-figures-whole-lines-v1":"Explicit opt-in only. Preflight native figure topology before recursive library analysis: page depth0, maximum native depth64, at most200000 native objects per page across analyzed figure subtrees; fail INPUT_LIMIT, never RecursionError/truncate. Call pinned pdfminer LTFigure.analyze(LAParams(all_texts=True)) exactly once on each outermost figure, never re-analyze page or descendants. Enumerate original analyzed subtrees without manual glyph grouping. Full native paths1..64. Ignore image/vector-only primitives. Same invalid-glyph, visible CropBox, raw, decimal geometry and quality policies. LTFigure bbox is not renderer clipping authority; no visibility/occlusion/completeness certificate.","pdfminer-analyzed-figures-boxes-flow-none-v1":"Explicit opt-in only. Initial page analysis uses pinned pdfminer LAParams(boxes_flow=None, all_texts=False); existing visible CropBox/CTM and vector suppression remain identical. Preflight native figure topology with the existing depth64 and200000 figure-object limits, then invoke each outermost LTFigure.analyze(LAParams(boxes_flow=None, all_texts=True)) once. Library groups original glyphs into whole lines/textboxes as before, but disables id(object)-tied hierarchical textbox grouping. Pinned library stable textbox ordering is used directly, including stable input order for geometric ties; never reorder/rename committed native paths. Full ancestry1..64 before filtering, rawText/native geometry/quality/visibility limits unchanged. No guarantee of semantic reading order, renderer visibility or completeness.","pdfminer-analyzed-figures-boxes-flow-none-vertical-v1":"Explicit opt-in only, default and historical three profiles unchanged. Initial page analysis uses pinned pdfminer20260107 LAParams(boxes_flow=None, all_texts=False, detect_vertical=True); visible CropBox/actual interpreter CTM and vector suppression identical to old stable mode. Before recursive library analysis preflight original topology: page depth0, depth maximum64 and total at most200000 native objects per page across outermost figure subtrees. Fail INPUT_LIMIT before analyze, never truncate. Invoke each outermost LTFigure.analyze(LAParams(boxes_flow=None, all_texts=True, detect_vertical=True)) once; descendants analyzed only by pinned library recursion. Enumerate exact resulting native children before filtering, maximum path64/index32767. Whole original LTTextLine.get_text() retained including LF and library child order; no manual glyph join/reversal, sorting or native-path renaming. Vertical-writing grouping is a source text heuristic, not numeric/unit/rectangle/area/member/applicability/rendered visibility authority. Same whole artifact standard/large resource policies, invalid-glyph/quantization/visible containment/quality rules. No durable audit/cache/default/profile release activation by this extension."}},"x-reader-contract":{"extract_pdf_text_artifact_v3":"(path: Path, source_file_id: str, input_sha256: str, *, traversal_policy_version: str=pdfminer-top-level-whole-lines-v1) -> dict; verifies original SHA before parsing; exact supported selector only; unknown selector ValueError(EXTRACTOR_PROFILE_MISMATCH); complete artifact or ValueError(reasonCode)","read_document_text_v3_artifact":"(value: object) -> {status: VALID, contentHash: sha64} | {status: ABSTAIN, reasonCode: INVALID_INPUT|INPUT_LIMIT|INVALID_TEXT_ARTIFACT}; validates all pages/profile/quality before VALID; no runtime-current SHA equality for historical artifacts","document_text_v3_content_hash":"(value: object) -> sha64; native/whole semantic validation first; invalid raises ValueError; no custom serialization callbacks","get_document_text_v3_extractor_profile":"(*, traversal_policy_version: str=pdfminer-top-level-whole-lines-v1) -> exact profile with selected approved traversal policy, actual installed producer/text_layer source SHA and pdfminer.six version; unknown selector/version ValueError(EXTRACTOR_PROFILE_MISMATCH)"},"x-oracle-rule":"Manual historical profile and full body frozen before implementation. Producer replay substitutes only actual installed extractorProfile and independently derived profile/content hashes; raw/path/geometry/quality remain immutable.","x-profile-trust":"Schema-valid historical profile and matching profile hash establish shape/integrity only; future admission MUST compare explicit approved release tuple. No authentication/qualification/visual completeness is certified."},"column-pylon-dimension-literals.schema.json":{"$schema":"https://json-schema.org/draft/2020-12/schema","$id":"column-pylon-dimension-literals.schema.json","title":"Complete-source column/pylon raw dimension literals; no structural authority","oneOf":[{"type":"object","additionalProperties":false,"required":["schemaVersion","resourcePolicyVersion","status","sourceFileId","inputSha256","sourceArtifactContentHash","extractorProfile","extractorProfileHash","literals","excludedPages"],"properties":{"schemaVersion":{"const":"column-pylon-dimension-literals-v1"},"resourcePolicyVersion":{"const":"document-text-v3-large-source-bounds-v1"},"status":{"const":"SOURCE_LITERALS"},"sourceFileId":{"type":"string","minLength":1,"maxLength":200},"inputSha256":{"type":"string","pattern":"^[a-f0-9]{64}$(?![\\\\s\\\\S])"},"sourceArtifactContentHash":{"type":"string","pattern":"^[a-f0-9]{64}$(?![\\\\s\\\\S])"},"extractorProfile":{"$ref":"document-text-v3.schema.json#/definitions/extractorProfile"},"extractorProfileHash":{"type":"string","pattern":"^[a-f0-9]{64}$(?![\\\\s\\\\S])"},"literals":{"type":"array","minItems":0,"maxItems":128,"items":{"$ref":"#/$defs/literal"}},"excludedPages":{"type":"array","minItems":0,"maxItems":512,"items":{"type":"object","additionalProperties":false,"required":["pageNumber","reasonCode"],"properties":{"pageNumber":{"type":"integer","minimum":1,"maximum":512},"reasonCode":{"enum":["PAGE_NOT_CANDIDATE","UNLOCATED_RECORDS"]}}}}}},{"type":"object","additionalProperties":false,"required":["schemaVersion","resourcePolicyVersion","status","reasonCode"],"properties":{"schemaVersion":{"const":"column-pylon-dimension-literals-v1"},"resourcePolicyVersion":{"const":"document-text-v3-large-source-bounds-v1"},"status":{"const":"ABSTAIN"},"reasonCode":{"enum":["INVALID_INPUT","INPUT_LIMIT","INVALID_TEXT_ARTIFACT"]}}}],"$defs":{"literal":{"type":"object","additionalProperties":false,"required":["pageNumber","sourcePath","rawText","nativeBoxPointStrings","bboxMilliPoints","pageFrame","usedTextRangeCodePoints","tokens","sourceOnly","calibratedProbability","rectangleStatus","grossSectionStatus","physicalMemberStatus","applicabilityStatus","renderedVisibilityStatus"],"properties":{"pageNumber":{"type":"integer","minimum":1,"maximum":512},"sourcePath":{"$ref":"document-text-v3.schema.json#/definitions/sourcePath"},"rawText":{"type":"string","minLength":1,"maxLength":8192},"nativeBoxPointStrings":{"$ref":"document-text-v3.schema.json#/definitions/nativeBox"},"bboxMilliPoints":{"type":"array","minItems":4,"maxItems":4,"items":{"type":"integer","minimum":0,"maximum":9007199254740991}},"pageFrame":{"type":"object","additionalProperties":false,"required":["widthMilliPoints","heightMilliPoints","nativeFrame"],"properties":{"widthMilliPoints":{"type":"integer","minimum":1,"maximum":9007199254740991},"heightMilliPoints":{"type":"integer","minimum":1,"maximum":9007199254740991},"nativeFrame":{"$ref":"document-text-v3.schema.json#/definitions/nativeFrame"}}},"usedTextRangeCodePoints":{"type":"array","minItems":2,"maxItems":2,"items":{"type":"integer","minimum":0,"maximum":8192}},"tokens":{"type":"object","additionalProperties":false,"required":["kind","first","second","unit","level","scope"],"properties":{"kind":{"type":"object","additionalProperties":false,"required":["raw","rangeCodePoints"],"properties":{"raw":{"enum":["Колонна","Пилон"]},"rangeCodePoints":{"type":"array","minItems":2,"maxItems":2,"items":{"type":"integer","minimum":0,"maximum":8192}}}},"first":{"type":"object","additionalProperties":false,"required":["raw","rangeCodePoints"],"properties":{"raw":{"type":"string","pattern":"^[1-9][0-9]{0,8}$(?![\\\\s\\\\S])"},"rangeCodePoints":{"type":"array","minItems":2,"maxItems":2,"items":{"type":"integer","minimum":0,"maximum":8192}}}},"second":{"type":"object","additionalProperties":false,"required":["raw","rangeCodePoints"],"properties":{"raw":{"type":"string","pattern":"^[1-9][0-9]{0,8}$(?![\\\\s\\\\S])"},"rangeCodePoints":{"type":"array","minItems":2,"maxItems":2,"items":{"type":"integer","minimum":0,"maximum":8192}}}},"unit":{"type":"object","additionalProperties":false,"required":["raw","rangeCodePoints"],"properties":{"raw":{"const":"мм"},"rangeCodePoints":{"type":"array","minItems":2,"maxItems":2,"items":{"type":"integer","minimum":0,"maximum":8192}}}},"level":{"type":"object","additionalProperties":false,"required":["raw","rangeCodePoints"],"properties":{"raw":{"type":"string","pattern":"^[+-]?(?:0|[1-9][0-9]{0,3})$(?![\\\\s\\\\S])"},"rangeCodePoints":{"type":"array","minItems":2,"maxItems":2,"items":{"type":"integer","minimum":0,"maximum":8192}}}},"scope":{"type":"object","additionalProperties":false,"required":["raw","rangeCodePoints"],"properties":{"raw":{"type":"string","minLength":1,"maxLength":200},"rangeCodePoints":{"type":"array","minItems":2,"maxItems":2,"items":{"type":"integer","minimum":0,"maximum":8192}}}}}},"sourceOnly":{"const":true},"calibratedProbability":{"type":"null"},"rectangleStatus":{"const":"UNVERIFIED"},"grossSectionStatus":{"const":"UNVERIFIED"},"physicalMemberStatus":{"const":"UNVERIFIED"},"applicabilityStatus":{"const":"UNVERIFIED"},"renderedVisibilityStatus":{"const":"UNVERIFIED"}}}},"x-input":"One complete original document-text-v3 artifact; explicit large policy before any source access. No outer DTO, page facade, metadata or custom budget.","x-exports":{"TS":"extractColumnPylonDimensionLiterals(value:unknown):ColumnPylonDimensionLiteralsResult","Python":"extract_column_pylon_dimension_literals(value:object)->dict"},"x-semantic-contract":"# T77 proposed contract: complete-source column/pylon dimension literals\\n\\nDESIGN ONLY. T76 actual capacity acceptance is a prerequisite for production implementation. Existing T75 frozen files remain unchanged. Independent evidence and review precede code/tests. No new external dependency.\\n\\n## One operation and one input\\n\\nTS `extractColumnPylonDimensionLiterals(value: unknown)` / Python `extract_column_pylon_dimension_literals(value: object)` accepts exactly one COMPLETE document-text-v3 artifact, without an outer DTO or optional budget/selection/metadata. It calls the explicit T76 large reader before accessing any selected page or text. Its result retains the large policy, complete source content hash, original source ID/SHA, full extractor profile and profile hash. It never changes source content or profile, approves a release, or admits an HTTP request.\\n\\nThe extractor returns ALL supported literals in original page/located-record order. Equal values/raw at distinct original paths remain separate. No first/minimum/sorting/deduplication/pairing. More than128 supported literals refuses the entire result with INPUT_LIMIT; no partial prefix.\\n\\n## Exact literal language\\n\\nRemove at most one final U000A LF and then only U0020 SPACE at both edges. Preserve full original raw unchanged. Whole remaining view must match:\\n\\n`(Колонна|Пилон) ([1-9][0-9]{0,8})х([1-9][0-9]{0,8})(мм) ([+-]?(?:0|[1-9][0-9]{0,3})) этаж \\\\[scope\\\\]`\\n\\n`х` is Cyrillic U0445. Every shown separator is exactly one ASCII SPACE. Scope has1..200 Unicode codepoints, no leading/trailing U0020 SPACE, brackets, C0/C1 controls, U2028/U2029 or UFFFD. It must contain at least one codepoint outside this exact frozen whitespace set: U0009..U000D, U001C..U0020, U0085, U00A0, U1680, U2000..U200A, U2028, U2029, U202F, U205F, U3000. Never use host trim/Unicode whitespace classes. Internal NBSP/astral characters otherwise survive unchanged. No Unicode normalization/casefold/glyph join. Complete raw over8192 codepoints is unsupported language and SKIPPED, not a whole-source resource refusal. These are finite literal-language bounds, not engineering bounds. Signed0/+0/-0 are retained as literal labels; no numeric floor/elevation interpretation. Dimensions are canonical positive decimal STRINGS, FIRST/SECOND in source order, never width/depth or sorted sides.\\n\\nAccept only originally located lines on pages whose exact validated quality is TEXT_LAYER_CANDIDATE and whose original unlocatedLines is empty. Every other page stays fully validated/hashed and is listed in excludedPages with pageNumber and finite reason PAGE_NOT_CANDIDATE or UNLOCATED_RECORDS (unlocated precedence). Unsupported raw language produces no literal and carries no absence/completeness meaning. No lines joined across records/pages.\\n\\n## Output\\n\\nShared envelope: schemaVersion `column-pylon-dimension-literals-v1`; status SOURCE_LITERALS, sourceFileId/inputSha256/sourceArtifactContentHash, resourcePolicyVersion (fixed large), exact extractorProfile/extractorProfileHash; literals array0..128; excludedPages in page order. Any invalid whole source returns ABSTAIN with same schema/policy and its INVALID_INPUT, INPUT_LIMIT or INVALID_TEXT_ARTIFACT reason, no partial source/literals.\\n\\nEach literal keeps pageNumber/full sourcePath, full rawText, original nativeBoxPointStrings+bboxMilliPoints, complete page frame (width/height/nativeFrame), usedTextRangeCodePoints and six token objects {raw,rangeCodePoints}: kind,first,second,unit,level,scope. Ranges are half-open Unicode CODEPOINT offsets into original raw. Scope excludes brackets; used range includes brackets. No source text reconstructed from tokens. Dimension values/level/scope are represented solely by these exact raw tokens; no duplicated normalized value that could disagree.\\n\\nEach literal has sourceOnly:true, calibratedProbability:null and explicit statuses rectangleStatus/grossSectionStatus/physicalMemberStatus/applicabilityStatus/renderedVisibilityStatus all UNVERIFIED. No area, structural conclusion, warning/error severity, review/approval, real-pair, parameter coverage or normative claim. No new hash helper or invented member ID. Later selectors must use full source hash+page+sourcePath+exact raw and complete original; selection does not create physical identity.\\n\\nAn empty literals array means only no supported language on eligible pages; it never means no columns/pylons, equal/no-difference, negative scope, complete audit or successful KR060 comparison. No runtime, HTTP/UI, migrations, registry/atomic rules, H100/browser/DOM in this packet.\\n\\n## Independent evidence and acceptance\\n\\nPreserved old diagnostic captures are currently REJECTED by standard policy. They contain six exact F0106 p66 literals and zero F0141 literals across full documents. After T76 acceptance, both full bodies must be admitted explicitly, with their unchanged historical profiles. Actual new producer full bodies must yield the same six/zero raw/path/frame/ranges despite the explicit new producer profile identity. These checks confer no rendered/member authority.\\n\\nBefore production: freeze schema, derived types, independent full-body goldens, all six original expected fragments, synthetic complete-artifact language/finite/native/refusal cases. Execute missing-export RED and retain it. Implement shared limits/ranges semantics in TS/Python, exact output equality to independent goldens, malformed unrelated last-page refusal, all-match/order/no-dedup, astral scope codepoint offsets, raw edge/LF refusal, page-quality/unlocated behavior,129matches all-or-nothing. Then neighbor tests/typecheck/build and actual installed wheel/sdist proof. Coverage remains61 parameters/69 partial atoms/71 unsupported; qualified real pairs remain0.\\n","x-contract-proposal-sha256":"46078442ddfc198e28ad99132178fe68079927d84a3e87012351dd1c9c61bdcc","x-required-capacity-policy-sha256":"217ca89c4ce4cbf887fcdf537d4e0c65d6e6da047fd21fd84baacd49d53a2045"}}')

def _shape(v, n, file='matrix-column-pylon-section-v2.schema.json'):
    if n is False:
        return False
    if n is True:
        return True
    if '$ref' in n:
        f, _, pointer = n['$ref'].partition('#')
        base = f or file
        ref = _SCHEMAS.get(base)
        for k in pointer.split('/')[1:]:
            ref = ref.get(k.replace('~1', '/').replace('~0', '~')) if type(ref) is dict else None
        return ref is not None and _shape(v, ref, base)
    if 'const' in n:
        return _eq(v, n['const'])
    if 'enum' in n:
        return any(_eq(v, x) for x in n['enum'])
    if 'oneOf' in n:
        return sum(_shape(v, x, file) for x in n['oneOf']) == 1
    if 'anyOf' in n:
        return any(_shape(v, x, file) for x in n['anyOf'])
    if 'allOf' in n:
        return all(_shape(v, x, file) for x in n['allOf'])
    kind = n.get('type')
    if kind == 'null':
        return v is None
    if kind == 'string' or kind is None and 'pattern' in n:
        if type(v) is not str or not n.get('minLength', 0) <= len(v) <= n.get('maxLength', float('inf')):
            return False
        if 'pattern' in n and re.search(n['pattern'], v) is None:
            return False
        if n.get('format') == 'uuid' and re.fullmatch(r'[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}', v) is None:
            return False
        return True
    if kind in ('number', 'integer'):
        return type(v) is int and n.get('minimum', -float('inf')) <= v <= n.get('maximum', float('inf'))
    if kind == 'boolean':
        return type(v) is bool
    if kind == 'array':
        if type(v) is not list or not n.get('minItems', 0) <= len(v) <= n.get('maxItems', float('inf')):
            return False
        if n.get('uniqueItems') and len({_canonical(x) for x in v}) != len(v):
            return False
        prefix = n.get('prefixItems', [])
        return all(_shape(x, prefix[i] if i < len(prefix) else n.get('items', True), file) for i, x in enumerate(v))
    if kind == 'object':
        if type(v) is not dict or len(v) > n.get('maxProperties', float('inf')) or any(k not in v for k in n.get('required', [])):
            return False
        for k, x in v.items():
            if 'propertyNames' in n and not _shape(k, n['propertyNames'], file):
                return False
            p = n.get('properties', {}).get(k, n.get('additionalProperties', True))
            if not _shape(x, p, file):
                return False
        return True
    return False

def _dto(v, name):
    return _shape(v, _SCHEMAS['matrix-column-pylon-section-v2.schema.json']['$defs'][name])
_CLEAN_KEYS = frozenset(('entityKey','buildingKey','zoneKey','levelKey','memberKey','sectionKey','sourceFileId','objectId','checkId','linkGroupId','reference'))
def _clean(v):
    return bool(v) and ord(v[0]) not in _WS and ord(v[-1]) not in _WS
def _clean_known(v):
    if type(v) is list:
        return all(_clean_known(x) for x in v)
    if type(v) is dict:
        return all((k not in _CLEAN_KEYS or type(x) is not str or _clean(x)) and _clean_known(x) for k, x in v.items())
    return True

def _calendar(v):
    if type(v) is not str or re.fullmatch(r'[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z',v) is None:
        return False
    year,month,day,hour,minute,second = (int(v[a:b]) for a,b in [(0,4),(5,7),(8,10),(11,13),(14,16),(17,19)])
    if not 1 <= month <= 12 or hour > 23 or minute > 59 or second > 59:
        return False
    leap = year % 4 == 0 and (year % 100 != 0 or year % 400 == 0)
    return 1 <= day <= [31,29 if leap else 28,31,30,31,30,31,31,30,31,30,31][month-1]

def _projection_hash(p):
    return _hash({'hashDomain':'matrix-kr060-column-pylon-pair-projection-json-v2','projection':_omit(p, ['contentHash'])})
def _journal_hash(j):
    return _hash({'hashDomain':'matrix-kr060-column-pylon-pair-journal-json-v2','journal':_omit(j, ['contentHash'])})
def _valid_journal(j):
    return (_dto(j, 'journal') and _clean_known(j) and _calendar(j['createdAt']) and j['id'] == j['projection']['decisionId']
            and j['objectId'] == j['projection']['objectId'] and (j['previousDecisionId'] is None) == (j['previousReviewHash'] is None)
            and j['id'] != j['previousDecisionId'] and j['contentHash'] != j['previousReviewHash']
            and (j['projection']['status'] != 'WITHDRAWN' or j['previousDecisionId'] is not None)
            and _projection_hash(j['projection']) == j['projection']['contentHash'] and _journal_hash(j) == j['contentHash'])

def parse_column_pylon_section_review_input(value):
    try:
        x = _detach(value, 'REQUEST')
        return x if _dto(x, 'request') and _clean_known(x) else None
    except Exception:
        return None

def validate_column_pylon_section_review_decision(value):
    j = _detach(value, 'JOURNAL')
    if not _valid_journal(j) or not _standalone_side(j['projection']['expected']) or not _standalone_side(j['projection']['actual']):
        _fail('INVALID_DECISION')
    return j

def _token_selection(t):
    return _omit(t, ['nativeBoxPointStrings','bboxMilliPoints','pageFrame','value'])
def _request_side(s):
    q = s['selection']
    selection = _omit(q, ['literalSnapshot']) if q['mode'] == 'LITERAL_T77_V1' else {'mode':q['mode'],'first':_token_selection(q['first']),'second':_token_selection(q['second']),'unit':None if q['unit'] is None else _token_selection(q['unit'])}
    return {**s,'selection':selection,'basis':[_omit(b, ['nativeBoxPointStrings','bboxMilliPoints','pageFrame']) for b in s['basis']]}
def _project(j):
    p = j['projection']
    return {'schemaVersion':'matrix-kr060-column-pylon-pair-review-input-v2','status':p['status'],'identity':p['identity'],
            'expected':_request_side(p['expected']),'actual':_request_side(p['actual']),'pairAssertion':p['pairAssertion'],
            'reference':p['reference'],'expectedReviewHash':j['contentHash']}
def project_column_pylon_section_review_decision(value):
    try:
        return _project(validate_column_pylon_section_review_decision(value))
    except Exception:
        return None

def column_pylon_section_pair_key(value):
    x = _detach(value, 'REQUEST')
    if (type(x) is not dict or set(x) != {'objectId','identity','expectedSourceFileId','actualSourceFileId'}
        or not _dto(x['objectId'], 'key') or not _clean(x['objectId']) or not _dto(x['identity'], 'identity') or not _clean_known(x['identity'])
        or any(not _dto(x[k], 'key') or not _clean(x[k]) for k in ['expectedSourceFileId','actualSourceFileId']) or x['expectedSourceFileId'] == x['actualSourceFileId']):
        _fail('INVALID_INPUT')
    return _hash({'hashDomain':'matrix-kr060-column-pylon-pair-key-v2',**x})

def _retained(x, sides):
    sources, origins = x['sources'], x['origins']
    if len(sources) != len(origins) or len({s['sourceFileId'] for s in sources}) != len(sources) or len({s['sourceFileId'] for s in origins}) != len(origins):
        return False
    if sides and (len(sources) != 2 or sides[0]['sourceFileId'] == sides[1]['sourceFileId'] or sides[0]['sourceSha256'] == sides[1]['sourceSha256']):
        return False
    if sides is None and any(sources[i-1]['sourceFileId'] >= sources[i]['sourceFileId'] for i in range(1, len(sources))):
        return False
    for i, (s, o) in enumerate(zip(sources, origins)):
        a, t = o['textArtifact'], o['target']
        if s['sourceFileId'] != o['sourceFileId'] or s['sourceSha256'] != o['sourceSha256'] or o['objectId'] != x['objectId'] or a['sourceFileId'] != s['sourceFileId'] or a['inputSha256'] != s['sourceSha256']:
            return False
        read = read_document_text_v3_large_artifact(a)
        if (read['status'] != 'VALID' or read['contentHash'] != t['textArtifactContentHash'] or _hash(a) != t['textArtifactByteSha256']
            or t['textStageContentHash'] != t['textArtifactByteSha256'] or a['extractorProfileHash'] != t['extractorProfileHash']
            or a['extractorProfile']['traversalPolicyVersion'] != 'pdfminer-analyzed-figures-boxes-flow-none-vertical-v1'):
            return False
        for stages in (o['pageStages'], s['review']['pageStages'] if s['review'] else {}):
            if any(int(k) > a['pageCount'] for k in stages):
                return False
        if sides:
            side = sides[i]
            if side['sourceFileId'] != s['sourceFileId'] or side['sourceSha256'] != s['sourceSha256'] or not _eq(side['origin'], t):
                return False
    return True

_WS = frozenset(list(range(9,14))+list(range(28,33))+[0x85,0xa0,0x1680]+list(range(0x2000,0x200b))+[0x2028,0x2029,0x202f,0x205f,0x3000])
def _digit(v):
    return v is not None and '0' <= v <= '9'
def _located(o, t):
    pages = o['textArtifact']['pages']
    if t['pageNumber'] > len(pages):
        return None
    p = pages[t['pageNumber']-1]
    if p['pageNumber'] != t['pageNumber'] or p['quality']['disposition'] != 'TEXT_LAYER_CANDIDATE' or p['unlocatedLines']:
        return None
    line = next((l for l in p['locatedLines'] if _eq(l['sourcePath'], t['sourcePath'])), None)
    if not line or line['rawText'] != t['rawText']:
        return None
    lo, hi = t['usedTextRangeCodePoints']
    if lo >= hi or hi > len(line['rawText']):
        return None
    return {**t,'nativeBoxPointStrings':line['nativeBoxPointStrings'],'bboxMilliPoints':line['bboxMilliPoints'],
            'pageFrame':{'widthMilliPoints':p['widthMilliPoints'],'heightMilliPoints':p['heightMilliPoints'],'nativeFrame':p['nativeFrame']}}
def _token_value(t, unit):
    chars = t['rawText']; lo, hi = t['usedTextRangeCodePoints']
    if lo >= hi or hi > len(chars):
        return None
    value = chars[lo:hi]; left = chars[lo-1] if lo else None; right = chars[hi] if hi < len(chars) else None
    if unit:
        if (value != 'мм' or left is not None and ord(left) not in _WS and not _digit(left) and left not in '=:([{;,.'
            or right is not None and ord(right) not in _WS and right not in ',.;:)]}'):
            return None
    elif (re.fullmatch(r'[1-9][0-9]{0,8}', value) is None or _digit(left) or _digit(right) or left is not None and left in '+-−'
          or left is not None and left in '.,' and lo >= 2 and _digit(chars[lo-2])
          or right is not None and right in '.,' and hi+1 < len(chars) and _digit(chars[hi+1])):
        return None
    return value

def _token(o,t,unit):
    b = _located(o,t); value = _token_value(t,unit)
    return {**b,'value':value} if b is not None and value is not None else None
def _same_target(a, b):
    return a['pageNumber'] == b['pageNumber'] and _eq(a['sourcePath'], b['sourcePath'])
def _overlap(a, b):
    return _same_target(a, b) and a['usedTextRangeCodePoints'][0] < b['usedTextRangeCodePoints'][1] and b['usedTextRangeCodePoints'][0] < a['usedTextRangeCodePoints'][1]
def _selection_snapshot(s, o):
    q = s['selection']
    if q['mode'] == 'LITERAL_T77_V1':
        r = extract_column_pylon_dimension_literals(o['textArtifact'])
        if r['status'] != 'SOURCE_LITERALS':
            return None
        literal = next((l for l in r['literals'] if l['pageNumber'] == q['pageNumber'] and _eq(l['sourcePath'], q['sourcePath'])), None)
        if literal is None:
            return None
        h = _hash({'hashDomain':'matrix-kr060-column-pylon-literal-v1','sourceFileId':s['sourceFileId'],'sourceSha256':s['sourceSha256'],'textArtifactContentHash':o['target']['textArtifactContentHash'],'literal':literal})
        return {**_omit(q, ['literalSnapshot']),'literalSnapshot':literal} if h == q['literalContentHash'] else None
    first = _token(o, _token_selection(q['first']), False); second = _token(o, _token_selection(q['second']), False)
    unit = None if q['unit'] is None else _token(o, _token_selection(q['unit']), True)
    if first is None or second is None or q['unit'] is not None and unit is None or _overlap(first, second) or unit and (_overlap(first, unit) or _overlap(second, unit)):
        return None
    out = {'mode':q['mode'],'first':first,'second':second,'unit':unit}
    return {**out,'selectionContentHash':_hash({'hashDomain':'matrix-kr060-column-pylon-native-selection-v1','sourceFileId':s['sourceFileId'],'sourceSha256':s['sourceSha256'],'textArtifactContentHash':o['target']['textArtifactContentHash'],'selection':out})}
def _standalone_side(s):
    q = s['selection']
    if q['mode'] == 'LITERAL_T77_V1':
        l = q['literalSnapshot']; lo,hi = l['usedTextRangeCodePoints']
        if l['pageNumber'] != q['pageNumber'] or not _eq(l['sourcePath'],q['sourcePath']) or lo >= hi or hi > len(l['rawText']):
            return False
        for t in l['tokens'].values():
            lo,hi = t['rangeCodePoints']
            if lo >= hi or hi > len(l['rawText']) or l['rawText'][lo:hi] != t['raw']:
                return False
        if _hash({'hashDomain':'matrix-kr060-column-pylon-literal-v1','sourceFileId':s['sourceFileId'],'sourceSha256':s['sourceSha256'],'textArtifactContentHash':s['origin']['textArtifactContentHash'],'literal':l}) != q['literalContentHash']:
            return False
    else:
        if (_token_value(q['first'],False) != q['first']['value'] or _token_value(q['second'],False) != q['second']['value']
            or q['unit'] is not None and _token_value(q['unit'],True) != q['unit']['value'] or _overlap(q['first'],q['second'])
            or q['unit'] and (_overlap(q['first'],q['unit']) or _overlap(q['second'],q['unit']))):
            return False
        if _hash({'hashDomain':'matrix-kr060-column-pylon-native-selection-v1','sourceFileId':s['sourceFileId'],'sourceSha256':s['sourceSha256'],'textArtifactContentHash':s['origin']['textArtifactContentHash'],'selection':_omit(q,['selectionContentHash'])}) != q['selectionContentHash']:
            return False
    seen = set()
    for b in s['basis']:
        lo,hi = b['usedTextRangeCodePoints']; key = _canonical([b['role'],b['pageNumber'],b['sourcePath'],b['usedTextRangeCodePoints']])
        if lo >= hi or hi > len(b['rawText']) or key in seen:
            return False
        seen.add(key)
    return True

def _basis_snapshot(s, o):
    out = []; seen = set()
    for b in s['basis']:
        q = _omit(b, ['nativeBoxPointStrings','bboxMilliPoints','pageFrame']); key = _canonical([q['role'],q['pageNumber'],q['sourcePath'],q['usedTextRangeCodePoints']])
        v = _located(o, q)
        if v is None or key in seen:
            return None
        seen.add(key); out.append(v)
    return out

def _stage(s, page):
    return s.get('pageStages', {}).get(str(page), s['stages'][0] if len(s['stages']) == 1 else 'UNRESOLVED')
def _unit_target(q):
    if q['mode'] != 'LITERAL_T77_V1':
        return q['unit']
    l = q['literalSnapshot']
    return {'pageNumber':l['pageNumber'],'sourcePath':l['sourcePath'],'rawText':l['rawText'],'usedTextRangeCodePoints':l['tokens']['unit']['rangeCodePoints']}
def _eligibility(x, p):
    sides = [p['expected'],p['actual']]; sources = x['sources']
    for i in range(2):
        r = sources[i]['review']
        if r is None or r['decisionId'] != sides[i]['sourceReviewDecisionId'] or r['contentHash'] != sides[i]['sourceReviewContentHash']:
            return 'STALE_SOURCE_REVIEW'
    if any(s['review']['revisionStatus'] != 'CURRENT' or s['review']['approvalStatus'] != 'APPROVED' for s in sources):
        return 'SOURCE_REVIEW_UNVERIFIED'
    if sources[0]['review']['sectionCode'] != 'KR' or sources[1]['review']['sectionCode'] != 'KJ':
        return 'SOURCE_SECTION_UNVERIFIED'
    for i, s in enumerate(sides):
        q = s['selection']; pages = [q['pageNumber']] if q['mode'] == 'LITERAL_T77_V1' else [q['first']['pageNumber'],q['second']['pageNumber']] + ([q['unit']['pageNumber']] if q['unit'] else [])
        for page in pages:
            expected = 'PD' if i == 0 else 'RD'
            if _stage(x['origins'][i], page) != expected or _stage({'stages':sources[i]['stages'],'pageStages':sources[i]['review']['pageStages']}, page) != expected:
                return 'SOURCE_STAGE_UNVERIFIED'
    if not sources[0]['review']['linkGroupId'] or sources[0]['review']['linkGroupId'] != sources[1]['review']['linkGroupId']:
        return 'SOURCE_LINK_UNVERIFIED'
    def has(s, role):
        return any(b['role'] == role for b in s['basis'])
    if any(s['assertions']['physicalMember'] != 'HUMAN_REVIEWED_SAME_PHYSICAL_MEMBER_AND_SECTION' or not has(s, 'PHYSICAL_MEMBER') for s in sides):
        return 'PHYSICAL_MEMBER_UNVERIFIED'
    if any(s['assertions']['shape'] != 'HUMAN_REVIEWED_RECTANGLE' or not has(s, 'SECTION_SHAPE') for s in sides):
        return 'SECTION_SHAPE_UNVERIFIED'
    if any(s['assertions']['dimensionMeaning'] != 'HUMAN_REVIEWED_GROSS_EXTERNAL_SECTION' or not has(s, 'GROSS_SECTION') for s in sides):
        return 'DIMENSION_MEANING_UNVERIFIED'
    for s in sides:
        q = s['selection']; u = _unit_target(q)
        if (s['assertions']['unit'] != 'HUMAN_REVIEWED_EXPLICIT_MM' or s['unitScopeAssertion'] != 'HUMAN_REVIEWED_UNIT_APPLIES_TO_BOTH_SELECTED_DIMENSIONS' or u is None
            or not any(b['role'] == 'UNIT' and _eq(_omit(b, ['role','nativeBoxPointStrings','bboxMilliPoints','pageFrame']), _token_selection(u)) for b in s['basis'])):
            return 'UNIT_UNVERIFIED'
        if q['mode'] != 'LITERAL_T77_V1' and (not _same_target(q['first'], u) or not _same_target(q['second'], u)) and not has(s, 'UNIT_SCOPE'):
            return 'UNIT_UNVERIFIED'
    if p['pairAssertion'] != 'HUMAN_REVIEWED_SAME_MEMBER_SECTION_PD_RD':
        return 'PAIR_APPLICABILITY_UNVERIFIED'
    return None

def _abstain(reason, identity=None):
    return {'schemaVersion':'matrix-kr060-column-pylon-comparison-v2','status':'ABSTAIN','reasonCode':reason,'identity':identity,'comparison':None,'calibratedProbability':None}
def _source_reference(s):
    q = s['selection']
    selection = _omit(q, ['literalSnapshot']) if q['mode'] == 'LITERAL_T77_V1' else {'mode':q['mode'],'first':_token_selection(q['first']),'second':_token_selection(q['second']),'unit':None if q['unit'] is None else _token_selection(q['unit']),'selectionContentHash':q['selectionContentHash']}
    return {**_omit(s, ['assertions','unitScopeAssertion','reference','basis','selection']),'selection':selection}
def compare_kr060_column_pylon_section(value):
    try:
        x = _detach(value, 'WHOLE')
    except Exception as error:
        return _abstain('INPUT_LIMIT' if type(error) is ColumnPylonSectionReviewValidationError and error.code == 'INPUT_LIMIT' else 'INVALID_INPUT')
    try:
        if not _dto(x, 'comparisonInput') or not _clean_known(x):
            return _abstain('INVALID_INPUT')
        identity = x['identity']; j = x['review']; p = j['projection'] if j else None; sides = [p['expected'],p['actual']] if p else None
        if not _retained(x, sides):
            return _abstain('SOURCE_PROVENANCE_UNVERIFIED', identity)
        if j and (not _valid_journal(j) or j['objectId'] != x['objectId'] or not _eq(p['identity'], identity)):
            return _abstain('PAIR_REVIEW_UNVERIFIED', identity)
        if sides:
            for i, s in enumerate(sides):
                q = _selection_snapshot(s, x['origins'][i])
                if q is None or not _eq(q, s['selection']):
                    return _abstain('SELECTION_RECONSTRUCTION_UNVERIFIED', identity)
            for i, s in enumerate(sides):
                b = _basis_snapshot(s, x['origins'][i])
                if b is None or not _eq(b, s['basis']):
                    return _abstain('BASIS_RECONSTRUCTION_UNVERIFIED', identity)
        if j is None:
            return _abstain('PAIR_REVIEW_MISSING', identity)
        if p['status'] != 'APPROVED':
            return _abstain('PAIR_REVIEW_UNAPPROVED', identity)
        reason = _eligibility(x, p)
        if reason:
            return _abstain(reason, identity)
        def area(s):
            q = s['selection']
            return int(q['literalSnapshot']['tokens']['first']['raw']) * int(q['literalSnapshot']['tokens']['second']['raw']) if q['mode'] == 'LITERAL_T77_V1' else int(q['first']['value']) * int(q['second']['value'])
        a = area(p['expected']); b = area(p['actual'])
        comparison = {'scope':'ONE_HUMAN_REVIEWED_RECTANGULAR_GROSS_SECTION_PD_RD','expected':_source_reference(p['expected']),'actual':_source_reference(p['actual']),
                      'expectedAreaMm2':str(a),'actualAreaMm2':str(b),'deltaAreaMm2':str(b-a),'pairDecisionId':j['id'],'pairProjectionContentHash':p['contentHash'],'pairJournalContentHash':j['contentHash']}
        return {'schemaVersion':'matrix-kr060-column-pylon-comparison-v2','status':'CANDIDATE' if b < a else 'NO_DECREASE_IN_REVIEWED_PAIR',
                'reasonCode':'REVIEWED_RECTANGULAR_GROSS_SECTION_AREA_DECREASE' if b < a else 'REVIEWED_PAIR_HAS_NO_AREA_DECREASE','identity':identity,'comparison':comparison,
                **({'expertReviewRequired':True} if b < a else {}),'calibratedProbability':None}
    except Exception:
        return _abstain('INVALID_INPUT')

def materialize_column_pylon_section_review(value, context):
    request = _detach(value, 'REQUEST'); ctx = _detach(context, 'WHOLE')
    if not _dto(request, 'request') or not _clean_known(request) or not _dto(ctx, 'materializationContext') or not _clean_known(ctx) or not _calendar(ctx['createdAt']):
        _fail('INVALID_INPUT')
    previous = ctx['previous']
    if previous is not None and not _valid_journal(previous):
        _fail('INVALID_DECISION')
    if request['expectedReviewHash'] != (previous['contentHash'] if previous else None):
        _fail('STALE_REVIEW')
    def key(p):
        return column_pylon_section_pair_key({'objectId':ctx['objectId'],'identity':p['identity'],'expectedSourceFileId':p['expected']['sourceFileId'],'actualSourceFileId':p['actual']['sourceFileId']})
    if previous and (previous['objectId'] != ctx['objectId'] or previous['id'] == ctx['id'] or key(previous['projection']) != key(request)):
        _fail('PAIR_MISMATCH')
    if not _retained(ctx, [request['expected'],request['actual']]):
        _fail('INVALID_PACKAGE')
    withdraw = request['status'] == 'WITHDRAWN'
    if withdraw:
        if previous is None or ctx['mode'] != 'HISTORICAL' or not _eq(_omit(request, ['status','expectedReviewHash']), _omit(_project(previous), ['status','expectedReviewHash'])):
            _fail('WITHDRAWAL_MISMATCH')
    elif ctx['mode'] != 'CURRENT':
        _fail('INVALID_PACKAGE')
    sides = []
    for i, s in enumerate([request['expected'],request['actual']]):
        q = _selection_snapshot(s, ctx['origins'][i]); b = _basis_snapshot(s, ctx['origins'][i])
        if q is None or b is None:
            _fail('INVALID_PACKAGE')
        sides.append({**s,'selection':q,'basis':b})
    if withdraw and (not _eq(sides[0], previous['projection']['expected']) or not _eq(sides[1], previous['projection']['actual'])):
        _fail('WITHDRAWAL_MISMATCH')
    if not withdraw:
        for i, side in enumerate(sides):
            r = ctx['sources'][i]['review']
            if r is None or r['decisionId'] != side['sourceReviewDecisionId'] or r['contentHash'] != side['sourceReviewContentHash']:
                _fail('STALE_REVIEW')
        if request['status'] == 'APPROVED' and _eligibility(ctx, {**request,'expected':sides[0],'actual':sides[1]}):
            _fail('APPROVAL_NOT_ELIGIBLE')
    p = {'schemaVersion':'matrix-kr060-column-pylon-pair-projection-v2','decisionId':ctx['id'],'objectId':ctx['objectId'],'status':request['status'],'identity':request['identity'],
         'expected':sides[0],'actual':sides[1],'pairAssertion':request['pairAssertion'],'reference':request['reference']}
    p['contentHash'] = _projection_hash(p)
    j = {'schemaVersion':'matrix-kr060-column-pylon-pair-journal-v2','id':ctx['id'],'objectId':ctx['objectId'],'actorId':ctx['actorId'],'createdAt':ctx['createdAt'],
         'previousDecisionId':previous['id'] if previous else None,'previousReviewHash':previous['contentHash'] if previous else None,'projection':p}
    j['contentHash'] = _journal_hash(j)
    return validate_column_pylon_section_review_decision(j)
