import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ParameterCatalogItem } from "@inspector-ai/contracts";

interface RawEvidence {
  stage: "PD" | "RD" | "ID";
  file_id: string;
  pdf_page_number: number;
  document_sheet_number: number | null;
  rendered_image: string;
}

export interface PublicCheck {
  check_id: string;
  finding_group_id: string;
  parameter_id: number | null;
  parameter_code: string;
  location: string;
  pd_value: string | null;
  rd_value: string | null;
  id_value: string | null;
  comparison_result: string;
  protocol_status: "CRITICAL" | "WARNING" | "INFO";
  criticality: string;
  document_status: string;
  evidence: RawEvidence[];
}

interface ManifestItem {
  file_id: string;
  object_id: string;
  relative_path: string;
  sha256: string;
  stage: "PD" | "RD" | "ID" | "RD_ID_MIXED" | "UNKNOWN";
  pdf_pages: number | null;
}

export interface ReferenceData {
  publicChecks: PublicCheck[];
  parameters: ParameterCatalogItem[];
  manifest: Map<string, ManifestItem>;
}

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

export const defaultReferenceRoot = resolve(
  projectRoot,
  "datasets/reference_methodology/hackathon_gold_20260811/УЧАСТНИКАМ_БЕЗ_ОТВЕТОВ",
);

function parseJsonLines<T>(content: string): T[] {
  return content
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T);
}

export async function loadReferenceData(
  root = process.env.REFERENCE_DATASET_DIR ?? defaultReferenceRoot,
): Promise<ReferenceData> {
  const [checksText, parametersText, manifestText] = await Promise.all([
    readFile(resolve(root, "data/public_train_checks.jsonl"), "utf8"),
    readFile(resolve(root, "data/parameter_catalog_132.jsonl"), "utf8"),
    readFile(resolve(root, "data/document_manifest.jsonl"), "utf8"),
  ]);

  const manifestItems = parseJsonLines<ManifestItem>(manifestText);

  return {
    publicChecks: parseJsonLines<PublicCheck>(checksText),
    parameters: parseJsonLines<ParameterCatalogItem>(parametersText),
    manifest: new Map(manifestItems.map((item) => [item.file_id, item])),
  };
}
