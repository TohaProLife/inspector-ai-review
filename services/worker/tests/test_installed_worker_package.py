"""Build real distribution artifacts; run installed worker outside its checkout.

The production image sets INSPECTOR_RULES_DIR for legacy adapters. New frozen
inventory helpers also resolve site-packages/rules relative to their own module.
A copied checkout or a PYTHONPATH-only test cannot exercise this packaging edge.
"""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tarfile
import tempfile
import unittest
import zipfile

WORKER = Path(__file__).resolve().parents[1]
ROOT = WORKER.parents[1]


class InstalledWorkerPackageTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.temporary = tempfile.TemporaryDirectory(prefix="inspector-installed-worker-")
        cls.addClassCleanup(cls.temporary.cleanup)
        cls.directory = Path(cls.temporary.name)
        cls.tools = cls.directory / "build-tools"
        cls.distributions = cls.directory / "dist"
        cls.installed = cls.directory / "installed"
        cls.distributions.mkdir()
        cls.build_python = shutil.which("python3") or sys.executable
        cls.environment = dict(os.environ)
        cls.environment.pop("PYTHONPATH", None)
        cls.environment.pop("INSPECTOR_RULES_DIR", None)
        # Build tooling is temporary. No project environment or global install changes.
        cls.run_command([cls.build_python, "-m", "pip", "install", "--disable-pip-version-check",
                         "--no-input", "--target", str(cls.tools), "hatchling"], timeout=120)
        cls.run_command([cls.build_python, "-I", "-c",
                         "import sys;sys.path.insert(0,sys.argv[1]);"
                         "from hatchling.build import build_wheel,build_sdist;"
                         "build_wheel(sys.argv[2]);build_sdist(sys.argv[2])",
                         str(cls.tools), str(cls.distributions)], cwd=WORKER, timeout=60)
        cls.wheel = next(cls.distributions.glob("*.whl"))
        cls.sdist = next(cls.distributions.glob("*.tar.gz"))
        cls.run_command([cls.build_python, "-m", "pip", "install", "--disable-pip-version-check",
                         "--no-input", "--no-deps", "--target", str(cls.installed), str(cls.wheel)], timeout=60)

    @classmethod
    def run_command(cls, command: list[str], *, cwd: Path | None = None,
                    input_text: str | None = None, timeout: int = 60) -> str:
        result = subprocess.run(command, cwd=cwd or cls.directory, env=cls.environment,
                                input=input_text, text=True, stdout=subprocess.PIPE,
                                stderr=subprocess.PIPE, timeout=timeout, check=False)
        # Do not serialize environment, package-index URLs, or subprocess credentials.
        if result.returncode:
            raise AssertionError(f"Packaging subprocess failed with exit {result.returncode}")
        return result.stdout

    def test_real_wheel_and_sdist_contain_every_unchanged_rule_resource(self) -> None:
        resources = {p.relative_to(WORKER).as_posix(): p.read_bytes()
                     for p in (WORKER / "rules").rglob("*") if p.is_file()}
        self.assertIn("rules/matrix-inventory-capabilities-v1.json", resources)
        self.assertIn("rules/matrix-execution-v1.json", resources)
        with zipfile.ZipFile(self.wheel) as archive:
            for name, expected in resources.items():
                with self.subTest(kind="wheel", resource=name):
                    self.assertEqual(archive.read(name), expected)
        with tarfile.open(self.sdist, "r:gz") as archive:
            members = {"/".join(item.name.split("/")[1:]): item
                       for item in archive.getmembers() if item.isfile()}
            for name, expected in resources.items():
                with self.subTest(kind="sdist", resource=name):
                    stream = archive.extractfile(members[name])
                    self.assertIsNotNone(stream)
                    with stream:
                        self.assertEqual(stream.read(), expected)

    def test_installed_v5_dispatch_and_v4_are_coherent_without_checkout_or_env_rules(self) -> None:
        base = json.loads((ROOT / "fixtures/matrix-inventory-execution-v1/base-v4-definitions.json").read_text())
        expected_resources = {p.name: hashlib.sha256(p.read_bytes()).hexdigest()
                              for p in (WORKER / "rules").iterdir() if p.is_file()}
        # Existing interpreter supplies already-installed runtime dependencies; the
        # worker itself is a genuinely pip-installed wheel in a fresh target.
        # -I ignores PYTHONPATH and the working directory. Every imported worker
        # module and both helper-relative registry paths are asserted below.
        script = r'''
import hashlib,json,pathlib,sys
from copy import deepcopy
from unittest.mock import patch
site = pathlib.Path(sys.argv[1]); sys.path.insert(0,str(site))
payload = json.load(sys.stdin)
from inspector_worker import durable_inventory_matrix as worker, durable_matrix, inventory_execution, matrix_engine
from inspector_worker.pilot_rule_adapter import PilotPz002RuleAdapter
for name,module in list(sys.modules.items()):
    if name == 'inspector_worker' or name.startswith('inspector_worker.'):
        if getattr(module,'__file__',None): assert pathlib.Path(module.__file__).is_relative_to(site), name
rules = pathlib.Path(worker.__file__).resolve().parents[1] / 'rules'
assert rules == site / 'rules'
assert pathlib.Path(inventory_execution.__file__).resolve().parents[1] / 'rules' == rules
assert {p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in rules.iterdir() if p.is_file()} == payload['resourceHashes']
cap = worker._load_capability_registry()
scalar_registry = matrix_engine.load_matrix_registry()
assert scalar_registry == payload['base']['registry']
package = {'schemaVersion':'matrix-ar053-loader-inputs-v1','objectId':'INSTALLED-SYNTHETIC-ONLY',
           'inputManifestHash':'a'*64,'sources':[],'origins':[],'identities':[]}
def digest(value):
    return hashlib.sha256(json.dumps(value,sort_keys=True,ensure_ascii=False,separators=(',',':')).encode()).hexdigest()
def lease(version):
    definitions = deepcopy(payload['base'])
    if version == 5: definitions['inventoryExecution'] = worker._inventory_policy(cap)
    return {'jobId':'installed-synthetic-job','objectId':package['objectId'],'inputManifestHash':package['inputManifestHash'],
      'inputs':{'sourceFiles':[],'sourceDecisions':{}},
      'release':{'lifecycle':'DRAFT','externalNetworkAllowed':False,'rules':{'matrixDefinitions':definitions},
      'providerSlot':{'profileId':worker.PROFILE_ID if version == 5 else worker.BASE_PROFILE_ID,
        'adapterVersion':str(version),'providerKind':'RULE_ENGINE','stageJobType':'RULE_EVALUATION',
        'status':'CONFIGURED','configHash':digest(definitions)}}}
with patch.object(worker,'download_inventory_comparison_inputs',return_value=package) as loader, \
     patch.object(worker,'download_text_artifact',side_effect=AssertionError('unexpected text I/O')), \
     patch.object(durable_matrix,'download_text_artifact',side_effect=AssertionError('unexpected legacy text I/O')):
    result = PilotPz002RuleAdapter().execute(lease(5),{'attemptId':'installed-test','fencingToken':1})
    legacy = PilotPz002RuleAdapter().execute(lease(4),{'attemptId':'installed-test','fencingToken':1})
loader.assert_called_once()
assert result['execution'] == legacy['execution']
assert result['projectConstraints'] == legacy['projectConstraints']
assert result['sourceDeclarations'] == legacy['sourceDeclarations']
assert len(result['effectiveCoverage']) == 132
assert result['inventoryComparisons']['results'][0]['reasonCode'] == 'REVIEWED_INVENTORY_IDENTITY_MISSING'
assert result['outputCount'] == len(result['execution']['results']) + 1
row = next(r for r in result['effectiveCoverage'] if r['parameterCode'] == 'AR-053')
assert row['enabledAtomicRules'] == 1 and row['executionStatus'] == 'PARTIAL'
print(json.dumps({'status':'PASS','installedOnly':True,'unmodifiedResources':len(payload['resourceHashes']),
 'scalarRows':len(result['execution']['results']),'typedRows':len(result['inventoryComparisons']['results']),
 'coverageRows':132,'legacyV4ScalarAndEvidenceEqual':True,'capabilityRegistryUnmocked':True,
 'scalarRegistryUnmocked':True,'actualProductionAdapterDispatch':True,'v5ConfigHash':result['providerConfigHash']}))
'''
        output = self.run_command([sys.executable, "-I", "-c", script, str(self.installed)],
                                  input_text=json.dumps({"base": base, "resourceHashes": expected_resources}), timeout=60)
        receipt = json.loads(output)
        self.assertEqual(receipt["status"], "PASS")
        self.assertTrue(receipt["installedOnly"])
        self.assertEqual(receipt["typedRows"], 1)
        self.assertEqual(receipt["coverageRows"], 132)
        self.assertTrue(receipt["actualProductionAdapterDispatch"])
        print("Installed wheel receipt: " + json.dumps(receipt, sort_keys=True))

    def test_installed_v6_dispatch_retains_v5_and_v4_without_checkout_or_env_rules(self) -> None:
        base = json.loads((ROOT / "fixtures/matrix-inventory-execution-v1/base-v4-definitions.json").read_text())
        expected_resources = {p.name: hashlib.sha256(p.read_bytes()).hexdigest()
                              for p in (WORKER / "rules").iterdir() if p.is_file()}
        # Existing interpreter supplies already-installed runtime dependencies; the
        # worker itself is a genuinely pip-installed wheel in a fresh target.
        # -I ignores PYTHONPATH and the working directory. Every imported worker
        # module and both helper-relative registry paths are asserted below.
        script = r'''
import hashlib,json,pathlib,sys
from copy import deepcopy
from unittest.mock import patch
site = pathlib.Path(sys.argv[1]); sys.path.insert(0,str(site))
payload = json.load(sys.stdin)
from inspector_worker import durable_inventory_matrix as worker, durable_matrix, inventory_execution, matrix_engine
from inspector_worker import durable_call_inventory_matrix as call_worker, call_inventory_execution
from inspector_worker.pilot_rule_adapter import PilotPz002RuleAdapter
for name,module in list(sys.modules.items()):
    if name == 'inspector_worker' or name.startswith('inspector_worker.'):
        if getattr(module,'__file__',None): assert pathlib.Path(module.__file__).is_relative_to(site), name
rules = pathlib.Path(worker.__file__).resolve().parents[1] / 'rules'
assert rules == site / 'rules'
assert pathlib.Path(inventory_execution.__file__).resolve().parents[1] / 'rules' == rules
assert {p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in rules.iterdir() if p.is_file()} == payload['resourceHashes']
cap = worker._load_capability_registry()
scalar_registry = matrix_engine.load_matrix_registry()
assert scalar_registry == payload['base']['registry']
package = {'schemaVersion':'matrix-ar053-loader-inputs-v1','objectId':'INSTALLED-SYNTHETIC-ONLY',
           'inputManifestHash':'a'*64,'sources':[],'origins':[],'identities':[]}
def digest(value):
    return hashlib.sha256(json.dumps(value,sort_keys=True,ensure_ascii=False,separators=(',',':')).encode()).hexdigest()
def lease(version):
    definitions = deepcopy(payload['base'])
    if version >= 5: definitions['inventoryExecution'] = worker._inventory_policy(cap)
    if version == 6: definitions['callInventoryExecution'] = call_worker._call_inventory_policy(call_worker._load_capability_registries()[1])
    return {'jobId':'installed-synthetic-job','objectId':package['objectId'],'inputManifestHash':package['inputManifestHash'],
      'inputs':{'sourceFiles':[],'sourceDecisions':{}},
      'release':{'lifecycle':'DRAFT','externalNetworkAllowed':False,'rules':{'matrixDefinitions':definitions},
      'providerSlot':{'profileId':call_worker.PROFILE_ID if version == 6 else worker.PROFILE_ID if version == 5 else worker.BASE_PROFILE_ID,
        'adapterVersion':str(version),'providerKind':'RULE_ENGINE','stageJobType':'RULE_EVALUATION',
        'status':'CONFIGURED','configHash':digest(definitions)}}}
with patch.object(worker,'download_inventory_comparison_inputs',return_value=package) as loader, \
     patch.object(worker,'download_text_artifact',side_effect=AssertionError('unexpected text I/O')), \
     patch.object(durable_matrix,'download_text_artifact',side_effect=AssertionError('unexpected legacy text I/O')):
    result = PilotPz002RuleAdapter().execute(lease(5),{'attemptId':'installed-test','fencingToken':1})
    legacy = PilotPz002RuleAdapter().execute(lease(4),{'attemptId':'installed-test','fencingToken':1})
loader.assert_called_once()
call_package = {**deepcopy(package),'schemaVersion':'matrix-odi123-call-loader-inputs-v1'}
combined = {'schemaVersion':'matrix-reviewed-inventory-loader-inputs-v2','objectId':package['objectId'],
            'inputManifestHash':package['inputManifestHash'],'inventory':package,'callInventory':call_package}
with patch.object(call_worker,'download_reviewed_inventory_comparison_inputs',return_value=combined) as call_loader, \
     patch.object(call_worker,'download_text_artifact',side_effect=AssertionError('unexpected call text I/O')):
    v6 = PilotPz002RuleAdapter().execute(lease(6),{'attemptId':'installed-test','fencingToken':1})
call_loader.assert_called_once()
assert v6['execution'] == result['execution'] == legacy['execution']
assert v6['inventoryComparisons'] == result['inventoryComparisons']
assert v6['sourceDeclarations'] == legacy['sourceDeclarations']
assert v6['projectConstraints'] == legacy['projectConstraints']
assert v6['callInventoryComparisons']['results'][0]['reasonCode'] == 'REVIEWED_CALL_INVENTORY_IDENTITY_MISSING'
assert v6['outputCount'] == len(v6['execution']['results']) + 2
assert len(v6['effectiveCoverage']) == 132
call_row = next(r for r in v6['effectiveCoverage'] if r['parameterCode'] == 'ODI-123')
assert call_row['enabledAtomicRules'] == 1 and call_row['executionStatus'] == 'PARTIAL'
assert v6['providerProfileId'] == 'matrix-text-facts-call-inventory-v6'

assert result['execution'] == legacy['execution']
assert result['projectConstraints'] == legacy['projectConstraints']
assert result['sourceDeclarations'] == legacy['sourceDeclarations']
assert len(result['effectiveCoverage']) == 132
assert result['inventoryComparisons']['results'][0]['reasonCode'] == 'REVIEWED_INVENTORY_IDENTITY_MISSING'
assert result['outputCount'] == len(result['execution']['results']) + 1
row = next(r for r in result['effectiveCoverage'] if r['parameterCode'] == 'AR-053')
assert row['enabledAtomicRules'] == 1 and row['executionStatus'] == 'PARTIAL'
print(json.dumps({'status':'PASS','installedOnly':True,'unmodifiedResources':len(payload['resourceHashes']),
 'scalarRows':len(result['execution']['results']),'typedRows':len(result['inventoryComparisons']['results']),
 'coverageRows':132,'legacyV4ScalarAndEvidenceEqual':True,'capabilityRegistryUnmocked':True,
 'scalarRegistryUnmocked':True,'actualProductionAdapterDispatch':True,'v5ConfigHash':result['providerConfigHash'],'v6ConfigHash':v6['providerConfigHash'],'callTypedRows':len(v6['callInventoryComparisons']['results'])}))
'''
        output = self.run_command([sys.executable, "-I", "-c", script, str(self.installed)],
                                  input_text=json.dumps({"base": base, "resourceHashes": expected_resources}), timeout=60)
        receipt = json.loads(output)
        self.assertEqual(receipt["status"], "PASS")
        self.assertTrue(receipt["installedOnly"])
        self.assertEqual(receipt["typedRows"], 1)
        self.assertEqual(receipt["coverageRows"], 132)
        self.assertTrue(receipt["actualProductionAdapterDispatch"])
        print("Installed wheel receipt: " + json.dumps(receipt, sort_keys=True))


    def test_installed_v7_dispatch_and_three_domains_without_checkout_or_legacy_release(self) -> None:
        base = json.loads((ROOT / "fixtures/matrix-inventory-execution-v1/base-v4-definitions.json").read_text())
        names = ["rail_inventory_source.py", "rail_inventory_comparison.py", "rail_inventory_execution.py", "durable_rail_inventory_matrix.py"]
        pins = {name: hashlib.sha256((WORKER / "inspector_worker" / name).read_bytes()).hexdigest() for name in names}
        script = r'''
import hashlib,json,pathlib,sys
from copy import deepcopy
from unittest.mock import patch
site=pathlib.Path(sys.argv[1]);sys.path.insert(0,str(site));payload=json.load(sys.stdin)
from inspector_worker import durable_rail_inventory_matrix as worker, durable_call_inventory_matrix as v6, durable_inventory_matrix as v5
from inspector_worker import rail_inventory_source,rail_inventory_comparison,rail_inventory_execution
from inspector_worker.pilot_rule_adapter import PilotPz002RuleAdapter
for name,module in list(sys.modules.items()):
    if name=='inspector_worker' or name.startswith('inspector_worker.'):
        if getattr(module,'__file__',None):assert pathlib.Path(module.__file__).is_relative_to(site),name
for module in [worker,rail_inventory_source,rail_inventory_comparison,rail_inventory_execution]:
    path=pathlib.Path(module.__file__);assert hashlib.sha256(path.read_bytes()).hexdigest()==payload['pins'][path.name]
ar,call,rail=worker._load_capability_registries()
assert rail['schemaVersion']=='matrix-rail-inventory-capabilities-v1'
def canonical(x):return json.dumps(x,ensure_ascii=False,sort_keys=True,separators=(',',':'),allow_nan=False)
def sha(x):return hashlib.sha256(canonical(x).encode()).hexdigest()
assert sha(rail)=='1a50046599c3c2c0965919a33615da4254dc9e0a1e05f4bedb723d94de2be409'
definitions=deepcopy(payload['base']);definitions['inventoryExecution']=v5._inventory_policy(ar)
assert sha(definitions)=='26f8a2d425296c27573c11358ad394c3c0cd911861bb9b2b11b88fe6c87fb060'
definitions['callInventoryExecution']=v6._call_inventory_policy(call)
assert sha(definitions)=='dcb6df67d8fa876e090bcaf58452d32098f409e569ee4cecfe66abf0db0cf3ad'
definitions['railExecution']={
 'schemaVersion':'matrix-rail-inventory-comparisons-v1','purpose':'MACHINE_COMPARISON',
 'baseProfileId':'matrix-text-facts-call-inventory-v6','baseConfigHash':'dcb6df67d8fa876e090bcaf58452d32098f409e569ee4cecfe66abf0db0cf3ad',
 'capabilityRegistry':rail,'capabilityRegistryHash':sha(rail),
 'comparisonVersion':'matrix-odi120-rail-inventory-comparison-v1','comparisonSourceSha256':payload['pins']['rail_inventory_comparison.py'],
 'sourceReconstructionVersion':'matrix-odi120-rail-inventory-source-v1','sourceReconstructionSourceSha256':payload['pins']['rail_inventory_source.py'],
 'typedExecutionVersion':'matrix-rail-inventory-execution-v1','typedExecutionSourceSha256':payload['pins']['rail_inventory_execution.py'],
 'durableWrapperVersion':'matrix-rail-inventory-execution-v1','durableWrapperSourceSha256':payload['pins']['durable_rail_inventory_matrix.py'],
 'coveragePolicyVersion':'matrix-rail-inventory-coverage-v1','submissionPolicyVersion':'matrix-rail-inventory-submission-v1','hashPolicyVersion':'matrix-rail-inventory-result-json-v1'}
object_id='INSTALLED-SYNTHETIC-V7-ONLY';manifest='a'*64
lease={'jobId':'installed-v7-job','objectId':object_id,'inputManifestHash':manifest,'inputs':{'sourceFiles':[],'sourceDecisions':{}},
 'release':{'lifecycle':'DRAFT','externalNetworkAllowed':False,'rules':{'matrixDefinitions':definitions},
 'providerSlot':{'profileId':'matrix-text-facts-rail-inventory-v7','adapterVersion':'7','providerKind':'RULE_ENGINE','stageJobType':'RULE_EVALUATION','status':'CONFIGURED','configHash':sha(definitions)}}}
def package(version):return {'schemaVersion':version,'objectId':object_id,'inputManifestHash':manifest,'sources':[],'origins':[],'identities':[]}
combined={'schemaVersion':'matrix-reviewed-inventory-loader-inputs-v3','objectId':object_id,'inputManifestHash':manifest,
 'inventory':package('matrix-ar053-loader-inputs-v1'),'callInventory':package('matrix-odi123-call-loader-inputs-v1'),'railInventory':package('matrix-odi120-rail-loader-inputs-v1')}
with patch.object(worker,'download_reviewed_inventory_comparison_inputs',return_value=combined) as loader, \
     patch.object(worker,'download_text_artifact',side_effect=AssertionError('unexpected installed text IO')), \
     patch.object(v6,'execute_durable_call_inventory_matrix',side_effect=AssertionError('legacy execute forbidden')), \
     patch.object(v5,'execute_durable_inventory_matrix',side_effect=AssertionError('legacy execute forbidden')), \
     patch.object(v6,'_validate_release',side_effect=AssertionError('legacy release forbidden')), \
     patch.object(v5,'_validate_release',side_effect=AssertionError('legacy release forbidden')):
    result=PilotPz002RuleAdapter().execute(lease,{'attemptId':'installed-v7-attempt','fencingToken':1})
loader.assert_called_once()
assert result['providerProfileId']=='matrix-text-facts-rail-inventory-v7'
assert result['providerConfigHash']==sha(definitions)
assert len(result['execution']['results'])==63 and result['outputCount']==66
assert len(result['effectiveCoverage'])==132
assert sum(r['executionStatus']=='UNSUPPORTED' for r in result['effectiveCoverage'])==74
for name,reason in [('inventoryComparisons','REVIEWED_INVENTORY_IDENTITY_MISSING'),('callInventoryComparisons','REVIEWED_CALL_INVENTORY_IDENTITY_MISSING'),('railInventoryComparisons','REVIEWED_RAIL_INVENTORY_IDENTITY_MISSING')]:
    rows=result[name]['results'];assert len(rows)==1 and rows[0]['kind']=='UNBOUND_ATOM_ABSTENTION'
    assert rows[0]['reasonCode']==reason and rows[0]['calibratedProbability'] is None
assert result['sourceDeclarations']['schemaVersion']=='matrix-source-declarations-v2'
print(json.dumps({'status':'PASS','installedOnly':True,'actualProductionAdapterDispatch':True,'legacyExecutionTraps':0,'scalarRows':63,'typedRows':3,'outputCount':66,'unsupported':74,'v7ConfigHash':sha(definitions)}))
'''
        output=self.run_command([sys.executable,"-I","-c",script,str(self.installed)],
                                input_text=json.dumps({"base":base,"pins":pins}),timeout=60)
        receipt=json.loads(output)
        self.assertEqual(receipt["status"],"PASS")
        self.assertTrue(receipt["installedOnly"])
        self.assertEqual(receipt["outputCount"],66)
        self.assertEqual(receipt["unsupported"],74)
        print("Installed v7 wheel receipt: "+json.dumps(receipt,sort_keys=True))


if __name__ == "__main__":
    unittest.main()
