"""Durable v3 evidence integration: legacy profiles and scalar execution stay separate."""
from copy import deepcopy
import hashlib
import json
from pathlib import Path
import unittest
from unittest.mock import patch

from inspector_worker.durable_matrix import execute_durable_matrix
from inspector_worker.pilot_rule_adapter import PilotPz002RuleAdapter
from inspector_worker.source_declarations import extract_source_declarations
from test_durable_matrix_source_pin import (
    constraints_release_lease, evidence_release_lease, refresh_config_hash, release_lease,
)
from test_source_declarations import fixture_input, expected_output

_BASE = Path(__file__).resolve().parent / 'fixtures/matrix-steel-v1'


def fixture_lease(factory=evidence_release_lease):
    input=fixture_input();lease=factory()
    lease.update(objectId=input['objectId'],inputManifestHash=input['inputManifestHash'])
    lease['inputs']['sourceFiles']=[{**x,'mediaType':'application/pdf'} for x in input['sources']]
    return lease,input['textArtifacts']


class MatrixSourceDeclarationsIntegrationTests(unittest.TestCase):
    def test_v3_returns_both_evidence_siblings_and_count_stays_scalar(self):
        lease,artifacts=fixture_lease();scalar={'results':[{'id':'scalar-result'}],'observations':[{'id':'scalar-fact'}]}
        with patch('inspector_worker.durable_matrix.download_text_artifact',side_effect=artifacts),patch(
                'inspector_worker.durable_matrix.build_matrix_execution',return_value=scalar):
            result=execute_durable_matrix(lease,{})
        self.assertEqual(result['sourceDeclarations'],expected_output())
        self.assertEqual(result['projectConstraints']['constraints'],[])
        self.assertEqual(result['outputCount'],1)
        self.assertIs(result['execution'],scalar)
        self.assertNotIn('sourceDeclarations',scalar);self.assertNotIn('projectConstraints',scalar)
        self.assertEqual(result['providerProfileId'],'matrix-text-facts-evidence-v3')

    def test_actual_scalar_payload_results_and_coverage_identical_v1_v2_v3(self):
        # Exercise the real engine on all43 authentic pages. No mocked scalar
        # result can conceal accidental evidence-to-observation integration.
        outputs=[]
        for factory in [release_lease,constraints_release_lease,evidence_release_lease]:
            lease,artifacts=fixture_lease(factory)
            with patch('inspector_worker.durable_matrix.download_text_artifact',side_effect=artifacts):
                result=execute_durable_matrix(lease,{})
            outputs.append(result['execution'])
            self.assertEqual(result['outputCount'],len(result['execution']['results']))
            self.assertEqual('projectConstraints' in result,factory!=release_lease)
            self.assertEqual('sourceDeclarations' in result,factory==evidence_release_lease)
        self.assertEqual(outputs[0],outputs[1]);self.assertEqual(outputs[1],outputs[2])
        canonical=[json.dumps(x,ensure_ascii=False,sort_keys=True,separators=(',',':')).encode() for x in outputs]
        self.assertEqual(canonical[0],canonical[1]);self.assertEqual(canonical[1],canonical[2])
        self.assertFalse(any(o.get('canonicalUnit')=='steel_catalog_example' or o.get('unit')=='steel_catalog_example'
                             for o in outputs[2]['observations']))
        coverage=next(r for r in outputs[2]['coverage'] if r['parameterCode']=='KR-056')
        self.assertEqual(coverage['executionStatus'],'UNSUPPORTED')
        self.assertFalse(any(r['parameterCode']=='KR-056' for r in outputs[2]['results']))

    def test_old_definitions_hashes_exclude_evidence_pin_and_are_not_rewritten(self):
        # Frozen current-compatible scalar source bytes are the T32 baseline;
        # adding the new evidence implementation cannot alter these policies.
        baseline=json.loads((_BASE/'research-v1-v2-definition-baseline.json').read_text())
        for factory,row in zip([release_lease,constraints_release_lease],baseline):
            lease=factory();self.assertEqual(lease['release']['rules']['matrixDefinitions'],row['definitions'])
            self.assertEqual(lease['release']['providerSlot']['configHash'],row['configHash'])
            self.assertNotIn('sourceDeclarations',lease['release']['rules']['matrixDefinitions'])
        v3=evidence_release_lease();d=deepcopy(v3['release']['rules']['matrixDefinitions']);d.pop('sourceDeclarations')
        self.assertEqual(d,constraints_release_lease()['release']['rules']['matrixDefinitions'])

    def test_source_declarations_pin_all_fields_exact_before_download(self):
        for field,value in [('schemaVersion','other'),('extractorVersion','other'),('sourceSha256','0'*64),
                            ('steelExtractorVersion','other'),('steelSourceSha256','0'*64),
                            ('hashPolicyVersion','other'),('purpose','COMPARISON'),('extra',True)]:
            lease=evidence_release_lease();lease['inputs']['sourceFiles']=[{'sourceFileId':'must-not-download'}]
            lease['release']['rules']['matrixDefinitions']['sourceDeclarations'][field]=value;refresh_config_hash(lease)
            with patch('inspector_worker.durable_matrix.download_text_artifact') as download,patch(
                    'inspector_worker.durable_matrix.build_matrix_execution') as build:
                with self.assertRaisesRegex(ValueError,'matrix source declarations differ from pinned release'):
                    execute_durable_matrix(lease,{})
            download.assert_not_called();build.assert_not_called()
        lease=evidence_release_lease();lease['release']['rules']['matrixDefinitions'].pop('sourceDeclarations');refresh_config_hash(lease)
        with patch('inspector_worker.durable_matrix.download_text_artifact') as download:
            with self.assertRaisesRegex(ValueError,'matrix source declarations differ from pinned release'):
                execute_durable_matrix(lease,{})
        download.assert_not_called()

    def test_v3_constraints_remain_mandatory_before_download(self):
        lease=evidence_release_lease();lease['release']['rules']['matrixDefinitions'].pop('projectConstraints');refresh_config_hash(lease)
        with patch('inspector_worker.durable_matrix.download_text_artifact') as download:
            with self.assertRaisesRegex(ValueError,'matrix project constraints differ from pinned release'):
                execute_durable_matrix(lease,{})
        download.assert_not_called()

    def test_older_profiles_forbid_evidence_pin_before_download(self):
        for factory in [release_lease,constraints_release_lease]:
            lease=factory();lease['release']['rules']['matrixDefinitions']['sourceDeclarations']=evidence_release_lease()['release']['rules']['matrixDefinitions']['sourceDeclarations'];refresh_config_hash(lease)
            with patch('inspector_worker.durable_matrix.download_text_artifact') as download:
                with self.assertRaisesRegex(ValueError,'older matrix profile cannot carry source declarations'):
                    execute_durable_matrix(lease,{})
            download.assert_not_called()

    def test_profile_adapter_mismatch_and_missing_sibling_cannot_silently_downgrade(self):
        for factory,adapter in [(release_lease,'3'),(constraints_release_lease,'3'),(evidence_release_lease,'1'),(evidence_release_lease,'2')]:
            lease=factory();lease['release']['providerSlot']['adapterVersion']=adapter
            with patch('inspector_worker.durable_matrix.download_text_artifact') as download:
                with self.assertRaisesRegex(ValueError,'invalid matrix execution release'):execute_durable_matrix(lease,{})
            download.assert_not_called()
        lease=evidence_release_lease()
        with patch('inspector_worker.durable_matrix.build_matrix_execution',return_value={'results':[]}):
            result=execute_durable_matrix(lease,{})
        self.assertEqual(result['sourceDeclarations']['declarations'],[])
        self.assertEqual(result['projectConstraints']['constraints'],[])

    def test_v3_dispatch_and_honest_stage_failure_on_malformed_committed_artifact(self):
        lease=evidence_release_lease()
        with patch('inspector_worker.durable_matrix.execute_durable_matrix',return_value={'marker':'v3'}) as execute:
            self.assertEqual(PilotPz002RuleAdapter().execute(lease,{}),{'marker':'v3'})
        execute.assert_called_once_with(lease,{})
        lease,artifacts=fixture_lease();artifacts[0]['pages'][0]['extra']=True
        with patch('inspector_worker.durable_matrix.download_text_artifact',side_effect=artifacts),patch(
                'inspector_worker.durable_matrix.build_matrix_execution',return_value={'results':[]}):
            with self.assertRaisesRegex(ValueError,'invalid source declaration text artifact'):
                execute_durable_matrix(lease,{})


if __name__=='__main__':unittest.main()
