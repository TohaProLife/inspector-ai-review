"""v4 durable capabilities/pins and no scalar or historical policy drift."""
from copy import deepcopy
import hashlib
import json
from pathlib import Path
import unittest
from unittest.mock import patch

from inspector_worker import source_declarations,source_declarations_v2,fire_resistance_table,table_row_binding
from inspector_worker.durable_matrix import execute_durable_matrix
from inspector_worker.pilot_rule_adapter import PilotPz002RuleAdapter
from test_durable_matrix_source_pin import release_lease,constraints_release_lease,evidence_release_lease,refresh_config_hash
from test_source_declarations_v2 import fixture_input,expected_output


def evidence_v4_release_lease():
    lease=evidence_release_lease()
    lease['release']['providerSlot'].update(profileId='matrix-text-facts-evidence-v4',adapterVersion='4')
    d=lease['release']['rules']['matrixDefinitions']['sourceDeclarations']
    d.update(schemaVersion=source_declarations_v2.SCHEMA_VERSION,extractorVersion=source_declarations_v2.EXTRACTOR_VERSION,
             sourceSha256=hashlib.sha256(Path(source_declarations_v2.__file__).read_bytes()).hexdigest(),
             legacyExtractorVersion=source_declarations.EXTRACTOR_VERSION,
             legacySourceSha256=hashlib.sha256(Path(source_declarations.__file__).read_bytes()).hexdigest(),
             fireExtractorVersion=fire_resistance_table.EXTRACTOR_VERSION,
             fireSourceSha256=hashlib.sha256(Path(fire_resistance_table.__file__).read_bytes()).hexdigest(),
             tableBindingVersion=table_row_binding.BINDER_VERSION,
             tableBindingSourceSha256=hashlib.sha256(Path(table_row_binding.__file__).read_bytes()).hexdigest(),
             bindingPolicyVersion=fire_resistance_table.BINDING_POLICY_VERSION)
    refresh_config_hash(lease);return lease


def fixture_lease(factory=evidence_v4_release_lease):
    input=fixture_input();lease=factory()
    lease.update(objectId=input['objectId'],inputManifestHash=input['inputManifestHash'])
    lease['inputs']['sourceFiles']=[{**source,'mediaType':'application/pdf'} for source in input['sources']]
    return lease,input['textArtifacts']


class MatrixSourceDeclarationsV2IntegrationTests(unittest.TestCase):
    def test_v4_both_siblings_and_scalar_count_only(self):
        lease,artifacts=fixture_lease();scalar={'results':[{'id':'unchanged'}],'observations':[]}
        with patch('inspector_worker.durable_matrix.download_text_artifact',side_effect=artifacts),patch(
                'inspector_worker.durable_matrix.build_matrix_execution',return_value=scalar):
            result=execute_durable_matrix(lease,{})
        self.assertEqual(result['sourceDeclarations'],expected_output());self.assertIn('projectConstraints',result)
        self.assertIs(result['execution'],scalar);self.assertEqual(result['outputCount'],1)
        self.assertNotIn('sourceDeclarations',scalar);self.assertNotIn('projectConstraints',scalar)
        self.assertEqual(result['providerProfileId'],'matrix-text-facts-evidence-v4')
        self.assertEqual(result['providerConfigHash'],lease['release']['providerSlot']['configHash'])

    def test_v4_every_pin_field_missing_changed_and_extra_reject_before_download(self):
        fields=list(evidence_v4_release_lease()['release']['rules']['matrixDefinitions']['sourceDeclarations'])
        for field in fields+['extra']:
            for remove in ([False] if field=='extra' else [False,True]):
                lease=evidence_v4_release_lease();d=lease['release']['rules']['matrixDefinitions']['sourceDeclarations']
                if remove:d.pop(field)
                else:d[field]='incorrect'
                refresh_config_hash(lease)
                with self.subTest(field=field,remove=remove),patch('inspector_worker.durable_matrix.download_text_artifact') as download,patch(
                        'inspector_worker.durable_matrix.build_matrix_execution') as build:
                    with self.assertRaisesRegex(ValueError,'matrix source declarations differ from pinned release'):
                        execute_durable_matrix(lease,{})
                download.assert_not_called();build.assert_not_called()
        for value in [None,{}]:
            lease=evidence_v4_release_lease();d=lease['release']['rules']['matrixDefinitions']
            if value is None:d.pop('sourceDeclarations')
            else:d['sourceDeclarations']=value
            refresh_config_hash(lease)
            with patch('inspector_worker.durable_matrix.download_text_artifact') as download:
                with self.assertRaisesRegex(ValueError,'matrix source declarations differ from pinned release'):execute_durable_matrix(lease,{})
            download.assert_not_called()

    def test_older_profiles_cannot_receive_v2_evidence_pin_or_v4_adapter(self):
        v4policy=evidence_v4_release_lease()['release']['rules']['matrixDefinitions']['sourceDeclarations']
        for factory in [release_lease,constraints_release_lease,evidence_release_lease]:
            lease=factory();lease['release']['rules']['matrixDefinitions']['sourceDeclarations']=deepcopy(v4policy);refresh_config_hash(lease)
            with patch('inspector_worker.durable_matrix.download_text_artifact') as download:
                with self.assertRaisesRegex(ValueError,'source declarations'):execute_durable_matrix(lease,{})
            download.assert_not_called()
            lease=factory();lease['release']['providerSlot']['adapterVersion']='4'
            with self.assertRaisesRegex(ValueError,'invalid matrix execution release'):execute_durable_matrix(lease,{})
        for adapter in ['1','2','3','5']:
            lease=evidence_v4_release_lease();lease['release']['providerSlot']['adapterVersion']=adapter
            with self.assertRaisesRegex(ValueError,'invalid matrix execution release'):execute_durable_matrix(lease,{})

    def test_real_scalar_full182_bytes_equal_across_all_four_profiles(self):
        outputs=[]
        for factory in [release_lease,constraints_release_lease,evidence_release_lease,evidence_v4_release_lease]:
            lease,artifacts=fixture_lease(factory)
            with patch('inspector_worker.durable_matrix.download_text_artifact',side_effect=artifacts):
                result=execute_durable_matrix(lease,{})
            outputs.append(json.dumps(result['execution'],ensure_ascii=False,sort_keys=True,separators=(',',':')).encode())
            self.assertEqual(result['outputCount'],len(result['execution']['results']))
            self.assertEqual('projectConstraints' in result,factory!=release_lease)
            self.assertEqual('sourceDeclarations' in result,factory in [evidence_release_lease,evidence_v4_release_lease])
            if factory==evidence_release_lease:self.assertEqual(len(result['sourceDeclarations']['declarations']),2)
            if factory==evidence_v4_release_lease:self.assertEqual(result['sourceDeclarations'],expected_output())
        self.assertTrue(all(output==outputs[0] for output in outputs[1:]))
        execution=json.loads(outputs[-1]);coverage=next(c for c in execution['coverage'] if c['parameterCode']=='KR-066')
        self.assertEqual(coverage['executionStatus'],'UNSUPPORTED')
        self.assertFalse(any(o.get('attribute')=='FIRE_RESISTANCE' for o in execution['observations']))
        self.assertFalse(any(r['parameterCode']=='KR-066' for r in execution['results']))

    def test_v3_policy_and_old_factory_config_hashes_byte_unchanged(self):
        # These are synthetic unit fixture definitions, not signed runtime release config hashes.
        baseline=json.loads((Path(__file__).parent/'fixtures/matrix-steel-v1/research-v1-v2-definition-baseline.json').read_text())
        for factory,row in zip([release_lease,constraints_release_lease],baseline):
            lease=factory();self.assertEqual(lease['release']['rules']['matrixDefinitions'],row['definitions'])
            self.assertEqual(lease['release']['providerSlot']['configHash'],row['configHash'])
        old=evidence_release_lease();new=evidence_v4_release_lease()
        olddefs=deepcopy(old['release']['rules']['matrixDefinitions']);newdefs=deepcopy(new['release']['rules']['matrixDefinitions'])
        olddefs.pop('sourceDeclarations');newdefs.pop('sourceDeclarations');self.assertEqual(olddefs,newdefs)
        self.assertEqual(set(old['release']['rules']['matrixDefinitions']['sourceDeclarations']),
            {'schemaVersion','extractorVersion','sourceSha256','steelExtractorVersion','steelSourceSha256','hashPolicyVersion','purpose'})
        self.assertEqual(old['release']['rules']['matrixDefinitions']['sourceDeclarations']['sourceSha256'],
                         'e093dcb39481769588155beb92810a4f581f77e9ae00387552328f749ca9217e')

    def test_v4_requires_constraint_pin_before_download_and_empty_siblings_are_explicit(self):
        lease=evidence_v4_release_lease();lease['release']['rules']['matrixDefinitions'].pop('projectConstraints');refresh_config_hash(lease)
        with patch('inspector_worker.durable_matrix.download_text_artifact') as download:
            with self.assertRaisesRegex(ValueError,'matrix project constraints differ'):execute_durable_matrix(lease,{})
        download.assert_not_called()
        with patch('inspector_worker.durable_matrix.build_matrix_execution',return_value={'results':[]}):
            result=execute_durable_matrix(evidence_v4_release_lease(),{})
        self.assertEqual(result['sourceDeclarations']['declarations'],[]);self.assertEqual(result['projectConstraints']['constraints'],[])
        self.assertEqual(result['sourceDeclarations']['schemaVersion'],'matrix-source-declarations-v2')

    def test_v4_pilot_dispatch_and_fail_stage_on_malformed_committed_input(self):
        lease=evidence_v4_release_lease()
        with patch('inspector_worker.durable_matrix.execute_durable_matrix',return_value={'marker':'v4'}) as execute:
            self.assertEqual(PilotPz002RuleAdapter().execute(lease,{}),{'marker':'v4'})
        execute.assert_called_once_with(lease,{})
        lease,artifacts=fixture_lease();artifacts[-1]['pages'][0]['extra']=True
        with patch('inspector_worker.durable_matrix.download_text_artifact',side_effect=artifacts),patch(
                'inspector_worker.durable_matrix.build_matrix_execution',return_value={'results':[]}):
            with self.assertRaisesRegex(ValueError,'invalid source declaration text artifact'):execute_durable_matrix(lease,{})

if __name__=='__main__':unittest.main()
