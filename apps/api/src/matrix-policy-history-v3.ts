/** Guarded output-only proposal. Null pins deliberately mean uninstalled. */
import { readFileSync, openSync, closeSync, fstatSync, readSync } from "node:fs";
import { canonicalJson, sha256 } from "./canonical-json.js";
import { historicalMatrixPolicyDefinitionsV2 } from "./matrix-policy-history-v2.js";
import { assertConcreteWallLeaseNativeV13 } from "./matrix-concrete-wall-native-v13.js";

// Populate only from the genuine acceptance/source-freeze promotion receipt.
// No resource is created by this proposal and no caller may supply these pins.
const INSTALLED_CAPSULE_SHA256: string | null = "0632bc8b627d7e5df0a99148d67e0669cc7219cd21759e1c84db8e63e9cf9e39";
const ACCEPTED_V12_CONFIG_HASH: string | null = "10a652201897fafc049b5fb48cc77e7d86a7bc446a9b43a9d33487d8e96c7bf2";
type SourcePins = ReadonlyArray<Readonly<{ path: string; sha256: string }>>;
// Only unchanged inherited semantic/policy/registry dependencies belong here.
// Changed repository/main/app wiring is bound by the new integration source freeze.
const ACCEPTED_V12_SOURCE_PINS: SourcePins | null = [
  {
    "path": "apps/api/src/matrix-policy-history-v2.json",
    "sha256": "398657b31858089ce360fdd67484204f425623693a2aff9c0edf78a0b7b0b430"
  },
  {
    "path": "packages/contracts/src/machine-confidence-v2.ts",
    "sha256": "f3436ef404d494849e3a64affde3c6cf4e86e4336228b3dd7071eef1c0cc70d0"
  },
  {
    "path": "services/worker/inspector_worker/ar053_inventory_comparison.py",
    "sha256": "6078e4d3cd3dd5b0b4322d51f960dcb0a9c1e7e0656d84ffeca2dcb5c9a900c3"
  },
  {
    "path": "services/worker/inspector_worker/call_inventory_execution.py",
    "sha256": "e6dc6af4bdfefeaf473758c19cd92bbba4fe758942521fb92edbe7f737d55fc5"
  },
  {
    "path": "services/worker/inspector_worker/call_inventory_source.py",
    "sha256": "327afa396d725a0597f4c16ed3dafc32bddc7b98dde2b3a674dd49a84e632892"
  },
  {
    "path": "services/worker/inspector_worker/column_pylon_dimension_literals.py",
    "sha256": "8a6b2f1ae593143b95831ac8bff853162056a751f4657e3716282d97942045ac"
  },
  {
    "path": "services/worker/inspector_worker/column_pylon_section_execution.py",
    "sha256": "5f17333feb3d83101e0c72655cff567651da0bae9760475ab5a5f7ab33e77b74"
  },
  {
    "path": "services/worker/inspector_worker/column_pylon_section_run_snapshot.py",
    "sha256": "e66b2bda954791915695ca862a1a8da40038958e7ec8ec779b67539c47c0aeec"
  },
  {
    "path": "services/worker/inspector_worker/column_pylon_section_v2.py",
    "sha256": "15d47f74bbad27f9f41fa6dab2f1020fd7b39308008e4c66abcdaff7d6040306"
  },
  {
    "path": "services/worker/inspector_worker/concrete_prose.py",
    "sha256": "a90bf3b33a334c00083294a7ae5164382bb8a8e1f7c134698cbdca07bd682d3f"
  },
  {
    "path": "services/worker/inspector_worker/document_text_v3.py",
    "sha256": "034fb41687342fae405e11de4648856fa1e271b0a2178ca9f35d8dd50bb19361"
  },
  {
    "path": "services/worker/inspector_worker/durable_call_inventory_matrix.py",
    "sha256": "4cfa821b1348f7438af32783bc6a644d849421bba39bb6a3df50dc7a39d7e6ad"
  },
  {
    "path": "services/worker/inspector_worker/durable_column_pylon_section_matrix_v12.py",
    "sha256": "b954518c74a9981ec52b2bbc73e7a61f06e303f4eac8b5d0047dbb735e5f27a7"
  },
  {
    "path": "services/worker/inspector_worker/durable_inventory_matrix.py",
    "sha256": "e8380d1ec84d9c88681023d98c8bd19b339650ffa6eb964f955f8cb6cb7fc125"
  },
  {
    "path": "services/worker/inspector_worker/durable_lighting_technology_matrix.py",
    "sha256": "0d7cedcf3060a2112b6476a3d6ae713798cbefe4acdf08a377fea9ac90ba238d"
  },
  {
    "path": "services/worker/inspector_worker/durable_rail_inventory_matrix.py",
    "sha256": "3a47a6a14e2b324445152d95dd5267417b49fe6a9345145266c936dfc0cc0704"
  },
  {
    "path": "services/worker/inspector_worker/durable_steel_comparison_matrix_v11.py",
    "sha256": "9b05c1c1c63fe94bad0cd5e24873599cd51207d95bcca5c41ef74d404aedf215"
  },
  {
    "path": "services/worker/inspector_worker/durable_water_node_matrix.py",
    "sha256": "e3b2b3aaffa7978eba7022530b14aa8d252548b7e6d557387afa5fb0c9213732"
  },
  {
    "path": "services/worker/inspector_worker/fire_resistance_table.py",
    "sha256": "130cb332ef2accb15af25181f9925bf1111c7d77fa06e179dd8191711ccdd152"
  },
  {
    "path": "services/worker/inspector_worker/inventory_execution.py",
    "sha256": "9cc41971cb370682adf0edcd036c95c85405a93d736c7ca8e0cddd335c5afca5"
  },
  {
    "path": "services/worker/inspector_worker/inventory_source.py",
    "sha256": "a1ac3c514649a5b6b5e29fb0a085cb6c806addef839d7addcba1ffa3159dcc70"
  },
  {
    "path": "services/worker/inspector_worker/lighting_technology_comparison.py",
    "sha256": "bd7a5efc41719211388b51b939db0eb6a1e3de231a29355eacafefd7278ac672"
  },
  {
    "path": "services/worker/inspector_worker/lighting_technology_execution.py",
    "sha256": "04a5231d3115548c53f3224123ea40e579fa17691a8d653f1232d60525977683"
  },
  {
    "path": "services/worker/inspector_worker/lighting_technology_source_v3.py",
    "sha256": "4c738eb3db2090227d0401913559496c7e7bc9761e682404bc150a197d3282fb"
  },
  {
    "path": "services/worker/inspector_worker/matrix_engine.py",
    "sha256": "856b733518c2d13d5ab2faa32c19399809026b4b77a4dacb2f985d72902ceaed"
  },
  {
    "path": "services/worker/inspector_worker/matrix_fact_scope.py",
    "sha256": "e90997a57398711756fca9a1b48413498aadfb473d6913b5f2533a6949549056"
  },
  {
    "path": "services/worker/inspector_worker/matrix_scalar_prepared_v12.py",
    "sha256": "73c3bce89982fc79933fd0d4b3bc230be995b003026e8764ce438ecd823f5999"
  },
  {
    "path": "services/worker/inspector_worker/odi123_call_inventory_comparison.py",
    "sha256": "f27e6fd734835197a0043c740adda12aa16ea7fa1c0356add8fe3eb53eb5df43"
  },
  {
    "path": "services/worker/inspector_worker/project_constraints.py",
    "sha256": "e194d30581bbc7ff1dbe09331129446404d0d0276d65e7fed3e429b5bd83ba44"
  },
  {
    "path": "services/worker/inspector_worker/project_zero_prose.py",
    "sha256": "ed2b9f29364b90a4334668c6acda5316a7b83c8c239e211b542a0e914682c37f"
  },
  {
    "path": "services/worker/inspector_worker/rail_inventory_comparison.py",
    "sha256": "9b56497c8ab72bb32d19885daba638f8903b69e2a5bd053100c934afe4a1a07c"
  },
  {
    "path": "services/worker/inspector_worker/rail_inventory_execution.py",
    "sha256": "af003355a4d45e424fa7d3e6fa10a33e7b7926b3160e208a95f52d508f5fd1e7"
  },
  {
    "path": "services/worker/inspector_worker/rail_inventory_source.py",
    "sha256": "6409a89c73c38b9c00956506a210443192d298608879a843be3d243b70ce83c2"
  },
  {
    "path": "services/worker/inspector_worker/rebar_prose.py",
    "sha256": "b489baf11855cac253c73e04a8753c4f629b18a524be6ab93c2b059eeccef0e1"
  },
  {
    "path": "services/worker/inspector_worker/source_declarations.py",
    "sha256": "e093dcb39481769588155beb92810a4f581f77e9ae00387552328f749ca9217e"
  },
  {
    "path": "services/worker/inspector_worker/source_declarations_v2.py",
    "sha256": "79ffc4c1c31c64aceda65c8c8414d634bfd62e15a093fe1459ffb2bac7390a0a"
  },
  {
    "path": "services/worker/inspector_worker/steel_comparison.py",
    "sha256": "1b4fd262124cff82518cbbefa04a70f8c8848e64f7657bd8ab73f42c8db04aef"
  },
  {
    "path": "services/worker/inspector_worker/steel_execution.py",
    "sha256": "a66b294e3a617b9eaa8469a37a20c6b2295b542e13724053abb1c540d51d4dd6"
  },
  {
    "path": "services/worker/inspector_worker/steel_prose.py",
    "sha256": "76a177080cb90c0f2b894b9461f27b1b1f2cf2faa3aa000462d76071410b3300"
  },
  {
    "path": "services/worker/inspector_worker/table_row_binding.py",
    "sha256": "7ff23a3740addce6b40f24fc8fde2b56b5d171e944f8d44942ad0acb725ae91f"
  },
  {
    "path": "services/worker/inspector_worker/water_node_comparison.py",
    "sha256": "02180fcfe8cf14ed8ab9e41215acede05eedc345306cf6e31ad3de7f2a33fe43"
  },
  {
    "path": "services/worker/inspector_worker/water_node_execution.py",
    "sha256": "b32becb1782d09016e9b3ed6a14ccfdcc4cd7cd5183e0c7444373a33ab4ce8b3"
  },
  {
    "path": "services/worker/inspector_worker/water_node_source.py",
    "sha256": "5fa3552002f83add06216d8a47c5aad0d069612fdbeec510f8947704441fb425"
  },
  {
    "path": "services/worker/rules/matrix-call-inventory-capabilities-v1.json",
    "sha256": "37d26ba6d5c32cb9dbf6b16737c6d190ed1d0ad0d1039b8684ddc45eb6895987"
  },
  {
    "path": "services/worker/rules/matrix-column-pylon-section-capabilities-v1.json",
    "sha256": "36eed3e10659274d1b62348d6fff426733d8893a771be6a9087e84cc7c6cad39"
  },
  {
    "path": "services/worker/rules/matrix-execution-v1.json",
    "sha256": "cc5dd08210d92434b10e316a5c01959b26ace1929ce48da4bc8f99733e17f769"
  },
  {
    "path": "services/worker/rules/matrix-inventory-capabilities-v1.json",
    "sha256": "df35db2a495143ab769c2f682eb8bbc4e1af1cc16298bb22b659d2bf44eb99d0"
  },
  {
    "path": "services/worker/rules/matrix-lighting-technology-capabilities-v1.json",
    "sha256": "4e34435a8516ef5c2e3dcc9dae172a54bc0a6dd412682434b8d752c89885918b"
  },
  {
    "path": "services/worker/rules/matrix-rail-inventory-capabilities-v1.json",
    "sha256": "aec32c4e715bb6f3965edea91e0590936a1cfd9522e206f6a0472cf1b3a1090d"
  },
  {
    "path": "services/worker/rules/matrix-steel-comparison-capabilities-v1.json",
    "sha256": "48b7aa7030632927cb1152e6476a088fa5f861688d0a550910ea8b9cbac0203b"
  },
  {
    "path": "services/worker/rules/matrix-water-node-capabilities-v1.json",
    "sha256": "94366195a37b2ad450a2dc46e7cd17a32efac8a01a4ebab34f7d9a098a777f37"
  },
  {
    "path": "services/worker/rules/parameter_catalog_132.jsonl",
    "sha256": "c6b73dffbea6bb366fc50f08392522c390bdf7b19420051802bd0bcbd32b4e4f"
  }
];
function acceptedSourcePins(): SourcePins | null { return ACCEPTED_V12_SOURCE_PINS; }
function acceptedCapsuleSha256(): string | null { return INSTALLED_CAPSULE_SHA256; }
function acceptedConfigHash(): string | null { return ACCEPTED_V12_CONFIG_HASH; }
const V12 = "matrix-text-facts-column-pylon-section-v12";
const previous = [
  ["matrix-text-facts-lighting-technology-v9", "9", "c7b195df5c43a8fb05abed342ac8402b28bf92378c6165bb7e4de7a94b7ada84"],
  ["matrix-text-facts-steel-comparison-v10", "10", "ea3cd0eb880c3d07c04a61ec794e5edf201657c06582bf8409fcf8a882aed7d6"],
  ["matrix-text-facts-steel-comparison-v11", "11", "3b23ac656edb37a6dbbc0b8da21c912db87f8bac29cde4623a032bad6f0586d7"],
] as const;
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const keys = (value: Record<string, unknown>, expected: readonly string[]): boolean =>
  Object.keys(value).length === expected.length && expected.every(key => Object.hasOwn(value, key));
const hash = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}(?![\s\S])/u.test(value);
function resourceBytes(url: URL): Buffer {
  const descriptor = openSync(url, "r");
  try {
    const stat = fstatSync(descriptor);
    if (!stat.isFile() || stat.size > 2_097_152) throw Error("Historical capsule limit");
    const buffer = Buffer.alloc(2_097_153);
    const size = readSync(descriptor, buffer, 0, buffer.length, 0);
    if (size > 2_097_152) throw Error("Historical capsule limit");
    return buffer.subarray(0, size);
  } finally { closeSync(descriptor); }
}

export interface HistoricalMatrixBaseV12 {
  readonly profileId: typeof V12;
  readonly adapterVersion: "12";
  readonly configHash: string;
  readonly definitions: Record<string, unknown>;
  readonly capsuleHash: string;
}
export interface AcceptedMatrixBaseV12 extends HistoricalMatrixBaseV12 {
  readonly installedIdentity: string;
}

/** Historical identity is independent from current runtime-source availability. */
export function historicalMatrixBaseV12IdentityV3(): HistoricalMatrixBaseV12 | null {
  const capsuleHash = acceptedCapsuleSha256(), configHash = acceptedConfigHash();
  if (!hash(capsuleHash) || !hash(configHash)) return null;
  try {
    const apiBytes = resourceBytes(new URL("./matrix-policy-history-v3.json", import.meta.url));
    const workerBytes = resourceBytes(new URL("../../../services/worker/inspector_worker/matrix-policy-history-v3.json", import.meta.url));
    if (!apiBytes.equals(workerBytes)
      || sha256(apiBytes) !== capsuleHash) return null;
    const capsule: unknown = JSON.parse(apiBytes.toString("utf8"));
    assertConcreteWallLeaseNativeV13(capsule);
    if (!object(capsule) || !keys(capsule, ["schemaVersion", "purpose", "entries"])
      || capsule.schemaVersion !== "matrix-policy-history-v3"
      || capsule.purpose !== "FINITE_HISTORICAL_MATRIX_IDENTITIES"
      || !Array.isArray(capsule.entries) || capsule.entries.length !== 4) return null;
    const expected: ReadonlyArray<readonly [string, string, string]> = [
      ...previous, [V12, "12", configHash],
    ];
    const seen = new Set<string>();
    let accepted: Record<string, unknown> | null = null;
    for (const [index, row] of capsule.entries.entries()) {
      const identity = expected[index];
      if (!identity || !object(row) || !keys(row, ["profileId", "adapterVersion", "configHash", "definitions"])
        || row.profileId !== identity[0] || row.adapterVersion !== identity[1]
        || row.configHash !== identity[2] || !object(row.definitions) || seen.has(identity[0])
        || sha256(canonicalJson(row.definitions)) !== identity[2]) return null;
      seen.add(identity[0]);
      if (index < previous.length) {
        const old = historicalMatrixPolicyDefinitionsV2(identity[0], identity[2]);
        if (!old || canonicalJson(old) !== canonicalJson(row.definitions)) return null;
      } else accepted = row.definitions;
    }
    if (!accepted) return null;
    return { profileId: V12, adapterVersion: "12", configHash, capsuleHash,
      definitions: JSON.parse(canonicalJson(accepted)) as Record<string, unknown> };
  } catch { return null; }
}

/** Files and source pins are package-relative constants, never HTTP/environment input. */
export function installedAcceptedMatrixBaseV12(): AcceptedMatrixBaseV12 | null {
  const sourcePins = acceptedSourcePins();
  if (sourcePins === null || sourcePins.length === 0) return null;
  const base = historicalMatrixBaseV12IdentityV3();
  if (!base) return null;
  try {
    const sourcePaths = new Set<string>();
    for (const pin of sourcePins) {
      if (!keys(pin, ["path", "sha256"]) || typeof pin.path !== "string"
        || !/^(?:apps\/api\/src|packages\/contracts\/src|services\/worker\/(?:inspector_worker|rules))\/[A-Za-z0-9_./-]+(?![\s\S])/u.test(pin.path)
        || pin.path.split("/").includes("..") || sourcePaths.has(pin.path) || !hash(pin.sha256)) return null;
      sourcePaths.add(pin.path);
      if (sha256(readFileSync(new URL("../../../" + pin.path, import.meta.url))) !== pin.sha256) return null;
    }
    return { ...base, installedIdentity: sha256(canonicalJson({ capsuleSha256: base.capsuleHash,
      acceptedV12ConfigHash: base.configHash, acceptedSourcePins: sourcePins })) };
  } catch { return null; }
}

/** Finite read identity only. This lookup never decides execution availability. */
export function historicalMatrixPolicyDefinitionsV3(profileId: unknown, configHash: unknown): Record<string, unknown> | null {
  if (profileId !== V12) return historicalMatrixPolicyDefinitionsV2(profileId, configHash);
  const base = historicalMatrixBaseV12IdentityV3();
  return base && configHash === base.configHash ? base.definitions : null;
}
