FROM python:3.13-slim@sha256:cc9dffa47c8294ba9bb795a8dfaeb7b76f2b30acade2c52a461a2999d127eb00
WORKDIR /worker
COPY pyproject.toml ./
COPY inspector_worker inspector_worker
COPY rules rules
ENV INSPECTOR_RULES_DIR=/worker/rules
RUN pip install --no-cache-dir .
# Isolated mode excludes /worker from imports: verify the installed wheel, not COPY.
RUN python -I - <<'PY'
from pathlib import Path
import sysconfig
from inspector_worker import durable_inventory_matrix as worker, inventory_execution, matrix_engine
installed = Path(sysconfig.get_path("purelib"))
assert Path(worker.__file__).is_relative_to(installed)
registry = worker._load_capability_registry()
package = {"schemaVersion": "matrix-ar053-loader-inputs-v1", "objectId": "PACKAGING-SELF-CHECK",
           "inputManifestHash": "a" * 64, "sources": [], "origins": [], "identities": []}
scalar = matrix_engine.build_matrix_execution(object_id=package["objectId"],
    input_manifest_hash=package["inputManifestHash"], sources=[], text_artifacts=[],
    registry=matrix_engine.load_matrix_registry())
comparison = inventory_execution.build_inventory_comparisons(package, registry)
coverage = inventory_execution.merge_inventory_coverage(scalar["coverage"], comparison, registry)
assert len(coverage) == 132
assert next(row for row in coverage if row["parameterCode"] == "AR-053")["enabledAtomicRules"] == 1
from inspector_worker import durable_call_inventory_matrix as call_worker, call_inventory_execution
assert Path(call_worker.__file__).is_relative_to(installed)
_, call_registry = call_worker._load_capability_registries()
call_package = {**package, "schemaVersion": "matrix-odi123-call-loader-inputs-v1"}
call_comparison = call_inventory_execution.build_call_inventory_comparisons(call_package, call_registry)
combined = call_inventory_execution.merge_call_inventory_coverage(coverage, call_comparison, call_registry)
assert len(combined) == 132
assert next(row for row in combined if row["parameterCode"] == "ODI-123")["enabledAtomicRules"] == 1
PY
# Verify the actual installed v13 package only after genuine accepted capsule promotion.
RUN python -I - <<'PY'
from pathlib import Path
import hashlib
import importlib
import sysconfig
from inspector_worker import durable_concrete_wall_matrix_v13 as concrete
installed = Path(sysconfig.get_path("purelib")).resolve()
names = ("concrete_wall_native_v13", "concrete_wall_prose_v1", "concrete_wall_scope_v1",
         "concrete_wall_fact_scope_v13", "concrete_wall_matrix_engine_v13",
         "concrete_wall_transport_v13", "concrete_wall_execution_v13", "durable_concrete_wall_matrix_v13")
actual_sources = {}
for name in names:
    module = importlib.import_module("inspector_worker." + name)
    origin = Path(module.__file__).resolve()
    assert origin.is_relative_to(installed), "Concrete wall module is not installed"
    actual_sources[name + ".py"] = hashlib.sha256(origin.read_bytes()).hexdigest()
capsule = Path(concrete.__file__).with_name("matrix-policy-history-v3.json").resolve()
assert capsule.is_relative_to(installed), "Historical capsule is not installed"
# This genuine bounded loader deliberately refuses absent accepted pins/resource.
# A self-consistent draft file cannot satisfy the installed identity.
definitions = concrete._accepted_v12_definitions()
base_hash = concrete._v12._sha(definitions)
assert base_hash == concrete._ACCEPTED_V12_CONFIG_HASH
registries = concrete._v12._load_capability_registries()
concrete._validate_base_runtime(definitions, registries)
assert concrete._concrete_wall_policy(base_hash)["sourcePins"] == actual_sources
PY
CMD ["inspector-worker", "--queue", "rules.evaluate"]
