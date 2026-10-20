"""Explicit v12 scalar prepared leaf; output-only, unqualified candidate.

Historical matrix_engine remains byte-exact. No monkeypatch or shared string
cache. All untouched semantics resolve through explicitly pinned legacy aliases.
"""
from __future__ import annotations

from . import matrix_engine as _legacy

Any = _legacy.Any
EXTRACTOR_VERSION = _legacy.EXTRACTOR_VERSION
_EGRESS_ROLE_BASIS = _legacy._EGRESS_ROLE_BASIS
_FENCE_RULE_ID = _legacy._FENCE_RULE_ID
_FactBindings = _legacy._FactBindings
_NUMBER = _legacy._NUMBER
_PROJECT_ZERO_RULE_ID = _legacy._PROJECT_ZERO_RULE_ID
_RD_CONCRETE_CLASS_SENTENCE = _legacy._RD_CONCRETE_CLASS_SENTENCE
_RD_SLAB_THICKNESS_SENTENCE = _legacy._RD_SLAB_THICKNESS_SENTENCE
_REBAR_RULE_ID = _legacy._REBAR_RULE_ID
_SHA = _legacy._SHA
_SIDEWALK_RULE_ID = _legacy._SIDEWALK_RULE_ID
_STAIR_DIMENSION_POLICIES = _legacy._STAIR_DIMENSION_POLICIES
_STAIR_NUMBER = _legacy._STAIR_NUMBER
_STAIR_ROLE_BASIS = _legacy._STAIR_ROLE_BASIS
_STAIR_UNIT = _legacy._STAIR_UNIT
_UNIT_ADDITIONS = _legacy._UNIT_ADDITIONS
_bbox = _legacy._bbox
_clean = _legacy._clean
_concrete_prose_rows = _legacy._concrete_prose_rows
_evaluate = _legacy._evaluate
_flags = _legacy._flags
_hash = _legacy._hash
_match = _legacy._match
_normalized_value = _legacy._normalized_value
_page_lines = _legacy._page_lines
_page_stage = _legacy._page_stage
_patterns = _legacy._patterns
_pd_concrete_table_rows = _legacy._pd_concrete_table_rows
_pd_sidewalk_tile_table_rows = _legacy._pd_sidewalk_tile_table_rows
_pd_slab_table_rows = _legacy._pd_slab_table_rows
_project_zero_rows = _legacy._project_zero_rows
_proof = _legacy._proof
_rebar_rows = _legacy._rebar_rows
_sources = _legacy._sources
_stair_dimensions_prose_rows = _legacy._stair_dimensions_prose_rows
_stamps = _legacy._stamps
_territory_fence_prose_rows = _legacy._territory_fence_prose_rows
_unit_pattern = _legacy._unit_pattern
_validate_artifact = _legacy._validate_artifact
_validate_registry = _legacy._validate_registry
canonical_registry_hash = _legacy.canonical_registry_hash
copy = _legacy.copy
load_matrix_registry = _legacy.load_matrix_registry
re = _legacy.re


def _prepare_rows_rule(rule: dict[str, Any]) -> dict[str, Any]:
    """Operation-local metadata for already validated rules; never authority."""
    additions = [] if rule.get('subruleContext') else _UNIT_ADDITIONS.get(rule['canonicalUnit'], [])
    aliases = set(rule['unitAliases'] + additions)
    if rule['attribute'] in {'TERRITORY_FENCE_HEIGHT', *[p['attribute'] for p in _STAIR_DIMENSION_POLICIES.values()]}:
        label = '|'.join(re.escape(value) for value in rule['labels'])
        patterns = (re.compile(r'(?i:(?:' + label + r'))\s*(?:[:,;=|—–-]\s*|\s+)'
                               r'(?P<value>' + _STAIR_NUMBER + r')\s*(?P<unit>' + _STAIR_UNIT + r')\s*[.;]?'),)
    else:
        patterns = _patterns(tuple(rule['labels']), tuple(sorted(aliases)), rule['valueKind'], tuple(rule['allowedValues']))
    return {'patterns': patterns,
            'labels': {_clean(label).casefold().rstrip(':,;') for label in rule['labels']},
            'headers': tuple((re.compile(r'(?i:(?:В гр\. ГПЗУ|Значение|Показатель|Площадь)\s*[,;:]?)\s*'
                                        + _unit_pattern(unit)), unit)
                             for unit in sorted(aliases, key=len, reverse=True))}


def _match_prepared(text: str, prepared: dict[str, Any]) -> re.Match[str] | None:
    """Match an already cleaned string with unchanged cardinality and order."""
    matches = [m for pattern in prepared['patterns'] if (m := pattern.fullmatch(text)) is not None]
    return matches[0] if len(matches) == 1 else None


def _rows(lines: list[dict[str, Any]], rule: dict[str, Any], *, stage: str | None = None,
          _prepared: tuple[dict[int, str], dict[str, Any]] | None = None) -> list[tuple[str, list[dict[str, Any]], re.Match[str], list[str]]]:
    # Datum prose requires complete floor wording and independent unit authority.
    # A generic label/value row must never bypass the frozen source grammar.
    if rule['ruleId'] in {_PROJECT_ZERO_RULE_ID, _REBAR_RULE_ID}:
        return []
    result = []
    occupied: set[str] = set()
    for line in lines:
        cleaned = _prepared[0][id(line)] if _prepared is not None else None
        # A complete RD compressive-strength statement can contain distinct F/W
        # marks. They do not become strength values or establish element scope.
        # Full-line matching rejects surface classes, alternatives and ranges.
        if (stage == 'RD' and rule['attribute'] == 'CONCRETE_CLASS'
                and rule['valueKind'] == 'CONCRETE_CLASS'
                and (m := _RD_CONCRETE_CLASS_SENTENCE.fullmatch((cleaned if _prepared is not None else _clean(line['text'])))) is not None):
            result.append((line['text'], [line], m, []))
            occupied.add(line['blockId'])
            continue
        # The complete statement explicitly names two components. Only the
        # slab's named value is a fact; the capital remains in original text.
        if (stage == 'RD' and rule['attribute'] == 'SLAB_THICKNESS'
                and rule['valueKind'] == 'DECIMAL'
                and (m := _RD_SLAB_THICKNESS_SENTENCE.fullmatch((cleaned if _prepared is not None else _clean(line['text'])))) is not None):
            result.append((line['text'], [line], m, []))
            occupied.add(line['blockId'])
            continue
        if rule.get('prosePolicy') == 'FIRE_CLASS_SENTENCE_V1' and re.match(
                r'(?i)^(?:Здание|Комплекс|Объект)\s+запроектирован(?:о|а|ы)?\s+', (cleaned if _prepared is not None else _clean(line['text']))):
            pattern = (r'(?<!\w)(?P<value>I|II|III|IV|V)\s+степени\s+огнестойкости\b'
                       if rule['attribute'] == 'FIRE_RESISTANCE_DEGREE' else
                       r'(?<!\w)(?P<value>[CС][0-3])\s+класса\s+конструктивной\s+пожарной\s+опасности\b')
            matches = list(re.finditer(pattern, (cleaned if _prepared is not None else _clean(line['text']))))
            if len(matches) == 1:
                result.append((line['text'], [line], matches[0], []))
                occupied.add(line['blockId'])
                continue
        if (m := (_match_prepared(cleaned, _prepared[1]) if _prepared is not None else _match(line['text'], rule))) is not None:
            result.append((line['text'], [line], m, []))
            occupied.add(line['blockId'])
    if rule.get('subruleContext', {}).get('componentRole') in {'SIDEWALK_TILE_PAVING', 'TERRITORY_FENCE_SEGMENT', *_EGRESS_ROLE_BASIS, *_STAIR_ROLE_BASIS}:
        # These bounded policies require label, value and unit on one full line.
        # Public tables need a separate reviewed layout grammar.
        return result
    labels = (_prepared[1]['labels'] if _prepared is not None else
              {_clean(label).casefold().rstrip(':,;') for label in rule['labels']})
    for label in lines:
        if label['blockId'] in occupied or not label['exactLineBox']:
            continue
        # Only a literal whole label may initiate a cross-block table row.
        text = (_prepared[0][id(label)] if _prepared is not None else _clean(label['text'])).casefold().rstrip(':,;')
        if text not in labels:
            continue
        box = label['box']; height = max(1, box[3] - box[1]); center = (box[1] + box[3]) / 2
        cells = [line for line in lines if line is not label and line['exactLineBox']
                 and line['box'][0] >= box[2] and line['box'][0] - box[2] <= height * 32
                 and abs((line['box'][1] + line['box'][3]) / 2 - center) <= height * .25]
        cells.sort(key=lambda item: item['box'][0])
        # More than two cells or overlapping columns may be alternatives, never pick one.
        if not 1 <= len(cells) <= 2 or any(cells[i]['box'][2] > cells[i + 1]['box'][0]
                                          for i in range(len(cells) - 1)):
            continue
        fragments = [label, *cells]
        text = ' '.join(f['text'] for f in fragments)
        if (m := (_match_prepared(_clean(text), _prepared[1]) if _prepared is not None else _match(text, rule))) is not None:
            result.append((text, fragments, m, []))
            continue
        if len(cells) == 1 and re.fullmatch(_NUMBER, _prepared[0][id(cells[0])] if _prepared is not None else _clean(cells[0]['text'])):
            value_cell = cells[0]
            if _prepared is None:
                additions = [] if rule.get('subruleContext') else _UNIT_ADDITIONS.get(rule['canonicalUnit'], [])
                aliases = set(rule['unitAliases'] + additions)
            headers = []
            for header in lines:
                hb = header['box']
                if (not header['exactLineBox'] or hb[1] <= box[3] or hb[1] - box[3] > height * 20
                        or hb[0] > value_cell['box'][2] or hb[2] < value_cell['box'][0]):
                    continue
                # Explicit table-column wording only. Unit binding remains a candidate.
                if _prepared is not None:
                    for pattern, unit in _prepared[1]['headers']:
                        if pattern.fullmatch(_prepared[0][id(header)]):
                            headers.append((header, unit))
                else:
                    for unit in sorted(aliases, key=len, reverse=True):
                        pattern = r'(?i:(?:В гр\. ГПЗУ|Значение|Показатель|Площадь)\s*[,;:]?)\s*' + _unit_pattern(unit)
                        if re.fullmatch(pattern, _clean(header['text'])):
                            headers.append((header, unit))
            if len(headers) == 1:
                header, unit = headers[0]
                if (m := (_match_prepared(_clean(label['text'].rstrip(':,;') + ' ' + value_cell['text'] + ' ' + unit), _prepared[1])
                         if _prepared is not None else _match(label['text'].rstrip(':,;') + ' ' + value_cell['text'] + ' ' + unit, rule))) is not None:
                    fragments = [label, value_cell, header]
                    result.append((' '.join(f['text'] for f in fragments), fragments, m,
                                   ['TABLE_HEADER_UNIT_SCOPE_UNVERIFIED']))
    return result


def build_matrix_execution(*, object_id: str, input_manifest_hash: str, sources: list[dict[str, Any]],
                           text_artifacts: list[dict[str, Any]], registry: dict[str, Any] | None = None) -> dict[str, Any]:
    """Build immutable observations, scoped decisions, and all-132 honest coverage.

    Optional ``scopeProofs`` are trusted reviewed input, not extracted metadata.
    Each proof binds status/reference/sourceFileId/sourceSha256/objectId/
    inputManifestHash/entityKey. Norm applicability additionally binds attribute,
    threshold, canonicalUnit, parameterCode and applicable=true.
    """
    if not isinstance(object_id, str) or not object_id.strip() or not isinstance(input_manifest_hash, str) or not _SHA.fullmatch(input_manifest_hash):
        raise ValueError('matrix object or input manifest invalid')
    registry = copy.deepcopy(registry) if registry is not None else load_matrix_registry()
    _validate_registry(registry)
    source_index = _sources(object_id, sources)
    if not isinstance(text_artifacts, list):
        raise ValueError('matrix text artifacts must be array')
    artifact_index = {}
    for artifact in text_artifacts:
        if not isinstance(artifact, dict) or artifact.get('sourceFileId') not in source_index or artifact['sourceFileId'] in artifact_index:
            raise ValueError('matrix unknown or duplicate text artifact')
        src = source_index[artifact['sourceFileId']]
        _validate_artifact(artifact, src)
        if any(int(n) > artifact['pageCount'] for n in src['pageStages']):
            raise ValueError('matrix source page stage exceeds artifact')
        artifact_index[artifact['sourceFileId']] = artifact
    atomic = [(entry, rule) for entry in registry['entries'] for rule in entry['atomicRules'] if rule['enabled']]
    for source_id, src in source_index.items():
        if isinstance(src.get('scopeProofs'), dict) and 'FACT_BINDINGS' in src['scopeProofs']:
            src['_factBindings'] = _FactBindings(src, artifact_index.get(source_id), atomic, object_id, input_manifest_hash)
    prepared_row_rules: dict[int, dict[str, Any]] = {}
    observations: dict[str, dict[str, Any]] = {}
    metadata = []
    for source_id, src in sorted(source_index.items()):
        artifact = artifact_index.get(source_id)
        meta = {'sourceFileId': source_id, 'sourceSha256': src['sha256'],
                'stage': src['stages'][0] if len(src['stages']) == 1 else 'UNRESOLVED',
                'sectionCode': src.get('sectionCode'), 'revisionStatus': src['revisionStatus'],
                'approvalStatus': src['approvalStatus'], 'linkGroupId': src.get('linkGroupId'),
                'pageCount': artifact['pageCount'] if artifact else 0, 'stampCandidates': [],
                'reasonCodes': [] if artifact else ['TEXT_ARTIFACT_MISSING']}
        if artifact is None:
            metadata.append(meta); continue
        proof = _proof(src, 'ENTITY_SCOPE', object_id, input_manifest_hash)
        entity = proof['entityKey'] if proof else None
        pages = {page['pageNumber']: page for page in artifact['pages']}
        for page in sorted(pages.values(), key=lambda p: p['pageNumber']):
            stage = _page_stage(src, page)
            lines = _page_lines(page)
            table_rows = _pd_concrete_table_rows(page, [pages[n] for n in [page['pageNumber'] - 1, page['pageNumber']]
                                                       if n in pages], src)
            slab_rows = _pd_slab_table_rows(page, src)
            sidewalk_rows = _pd_sidewalk_tile_table_rows(page, src)
            stair_rows = _stair_dimensions_prose_rows(page, stage=stage)
            fence_rows = _territory_fence_prose_rows(page, stage=stage)
            project_zero_rows = _project_zero_rows(page, stage)
            rebar_rows = _rebar_rows(page, stage)
            concrete_prose_rows = _concrete_prose_rows(page, src, pages)
            meta['stampCandidates'].extend(_stamps(lines, page['pageNumber']))
            cleaned_lines = {id(line): _clean(line['text']) for line in lines}
            for entry, rule in atomic:
                if rule['ruleId'] in {_PROJECT_ZERO_RULE_ID, _REBAR_RULE_ID}:
                    rows = []
                else:
                    rule_key = id(rule)
                    if rule_key not in prepared_row_rules:
                        prepared_row_rules[rule_key] = _prepare_rows_rule(rule)
                    rows = [(*row, []) for row in _rows(lines, rule, stage=stage,
                                _prepared=(cleaned_lines, prepared_row_rules[rule_key]))]
                if rule['attribute'] == 'CONCRETE_CLASS' and rule['valueKind'] == 'CONCRETE_CLASS':
                    rows.extend(table_rows)
                if rule['ruleId'] == 'matrix-kr-055-concrete_class':
                    rows.extend(concrete_prose_rows)
                if rule['attribute'] == 'SLAB_THICKNESS' and rule['valueKind'] == 'DECIMAL':
                    rows.extend(slab_rows)
                if entry['parameterCode'] == 'SPZU-026' and rule['ruleId'] == _SIDEWALK_RULE_ID:
                    rows.extend(sidewalk_rows)
                if entry['parameterCode'] == 'AR-048':
                    rows.extend(stair_rows.get(rule['attribute'], []))
                if rule['ruleId'] == _FENCE_RULE_ID:
                    rows.extend(fence_rows)
                if rule['ruleId'] == _PROJECT_ZERO_RULE_ID:
                    rows.extend(project_zero_rows)
                if rule['ruleId'] == _REBAR_RULE_ID:
                    rows.extend(rebar_rows)
                for raw_text, fragments, match, row_flags, context in rows:
                    # Signed decimal and categorical glyph aliases are admitted
                    # only by their separate, frozen source grammars.
                    # Generic numeric normalization and all legacy fact IDs stay unchanged.
                    normalized = ((match['value'], match['rawUnit']) if rule['ruleId'] in {_PROJECT_ZERO_RULE_ID, _REBAR_RULE_ID}
                                  else _normalized_value(match, rule))
                    if normalized is None:
                        continue
                    value, raw_unit = normalized
                    identity_payload = {'sourceFileId': source_id, 'sourceSha256': src['sha256'], 'stage': stage,
                                        'pageNumber': page['pageNumber'], 'blockIds': [f['blockId'] for f in fragments],
                                        'attribute': rule['attribute'], 'value': value, 'unit': rule['canonicalUnit']}
                    if context:
                        identity_payload['contextFragments'] = context
                    identity = _hash(identity_payload)
                    if identity in observations:
                        observations[identity]['parameterCodes'] = sorted(set(observations[identity]['parameterCodes'] + [entry['parameterCode']]))
                        continue
                    boxes = [f['box'] for f in fragments]
                    union = [min(b[0] for b in boxes), min(b[1] for b in boxes),
                             max(b[2] for b in boxes), max(b[3] for b in boxes)]
                    observations[identity] = {'id': identity, 'sourceFileId': source_id, 'sourceSha256': src['sha256'],
                        'stage': stage, 'pageNumber': page['pageNumber'], 'blockId': fragments[0]['blockId'],
                        'bbox': _bbox(union, page), 'rawText': raw_text, 'rawValue': (match['rawValue'] if rule['ruleId'] in {_PROJECT_ZERO_RULE_ID, _REBAR_RULE_ID} else match.group('value')),
                        'rawUnit': raw_unit, 'attribute': rule['attribute'], 'value': value,
                        'unit': rule['canonicalUnit'], 'entityKey': entity, 'method': 'TEXT_LAYER',
                        'extractorVersion': EXTRACTOR_VERSION, 'parameterCodes': [entry['parameterCode']],
                        'sourceFlags': sorted(set(_flags(src, stage, page['quality']['disposition']) + row_flags)),
                        'evidenceFragments': [{'blockId': f['blockId'], 'rawText': f['text'], 'bbox': f['bbox']} for f in fragments]}
                    if context:
                        observations[identity]['contextFragments'] = context
        meta['stampCandidates'].sort(key=lambda s: (s['pageNumber'], s['blockId'], s['field']))
        metadata.append(meta)
    observation_rows = sorted(observations.values(), key=lambda o: (o['sourceFileId'], o['pageNumber'], o['blockId'], o['attribute'], o['id']))
    for fact in observation_rows:
        src = source_index[fact['sourceFileId']]
        if '_factBindings' in src:
            fact['entityKey'] = src['_factBindings'].entity(fact)
    results = []
    for entry, rule in atomic:
        for expected_stage, actual_stage in rule['allowedStagePairs']:
            if actual_stage == 'ID' and not any('ID' in src['stages'] for src in source_index.values()):
                continue
            results.extend(_evaluate(entry, rule, observation_rows, source_index, object_id, input_manifest_hash,
                                     expected_stage, actual_stage))
    coverage = []
    for entry in registry['entries']:
        rules = entry['atomicRules']; enabled = [r for r in rules if r['enabled']]
        rows = [r for r in results if r['parameterCode'] == entry['parameterCode']]
        failures = sum(r['executionStatus'] == 'FAILED' for r in rows)
        comparisons = sum(r['qualified'] for r in rows)
        abstentions = sum(not r['qualified'] and r['executionStatus'] == 'SUCCEEDED' for r in rows)
        complete_sources = [s for s in source_index.values() if any(o['sourceFileId'] == s['sourceFileId'] and
                            entry['parameterCode'] in o['parameterCodes'] for o in observation_rows)]
        complete = (entry.get('gap') is None and bool(rows) and comparisons == len(rows) and bool(complete_sources)
                    and all(_proof(s, 'PARAMETER_SCOPE_COMPLETE:' + entry['parameterCode'], object_id, input_manifest_hash)
                            is not None and _proof(s, 'PARAMETER_SCOPE_COMPLETE:' + entry['parameterCode'], object_id, input_manifest_hash)['entityKey'] ==
                            _proof(s, 'ENTITY_SCOPE', object_id, input_manifest_hash)['entityKey'] for s in complete_sources))
        status = ('UNSUPPORTED' if not rules else 'TECHNICAL_FAILURE' if failures and not comparisons and not abstentions
                  else 'EVALUATED' if complete and len(enabled) == len(rules) else 'PARTIAL')
        coverage.append({'parameterCode': entry['parameterCode'], 'implementedAtomicRules': len(rules),
                         'enabledAtomicRules': len(enabled), 'evaluatedAtomicRules': len({r['ruleId'] for r in rows}),
                         'successfulComparisons': comparisons, 'abstentions': abstentions, 'failures': failures,
                         'executionStatus': status, 'reason': entry['gap'] if entry.get('gap') else
                         ('ALL_CONFIGURED_RULE_SCOPES_VERIFIED' if complete else 'SCOPED_EXECUTION_WITH_GAPS')})
    return {'schemaVersion': 'matrix-execution-v1', 'objectId': object_id, 'inputManifestHash': input_manifest_hash,
            'registryHash': canonical_registry_hash(registry), 'observations': observation_rows,
            'metadata': metadata, 'results': results, 'coverage': coverage}
