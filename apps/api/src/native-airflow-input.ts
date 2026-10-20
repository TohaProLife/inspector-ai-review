import type { NativeAirflowCompareInput } from "@inspector-ai/contracts";
import { NativeSourceComparisonError } from "./native-source-comparison-error.js";

export function parseNativeAirflowInput(value: unknown): NativeAirflowCompareInput {
  const invalid = (): never => { throw new NativeSourceComparisonError(400, "INVALID_NATIVE_AIRFLOW_INPUT", "Укажите два исходника и явный состав сравниваемой группы систем"); };
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).sort().join(",") !== "pdSourceFileId,rdSourceFileId,schemaVersion,selection") return invalid();
  const input = value as NativeAirflowCompareInput;
  if (input.schemaVersion !== "native-airflow-command-v1" || ![input.pdSourceFileId, input.rdSourceFileId]
    .every(id => typeof id === "string" && /^[A-Za-z0-9_-]{1,200}$/u.test(id))) return invalid();
  if (input.pdSourceFileId === input.rdSourceFileId)
    throw new NativeSourceComparisonError(422, "NATIVE_AIRFLOW_IDENTICAL_SOURCE", "Выберите два разных исходных документа");
  const selection = input.selection, system = /^[ПВ][1-9][0-9]{0,5}(?:\.[1-9][0-9]{0,5})?$/u;
  if (!selection || typeof selection !== "object" || Array.isArray(selection)
    || Object.keys(selection).sort().join(",") !== "pdSystemId,rdSystemIds"
    || typeof selection.pdSystemId !== "string" || !system.test(selection.pdSystemId)
    || !Array.isArray(selection.rdSystemIds) || selection.rdSystemIds.length < 1 || selection.rdSystemIds.length > 16
    || selection.rdSystemIds.some(id => typeof id !== "string" || !system.test(id))
    || new Set(selection.rdSystemIds).size !== selection.rdSystemIds.length) return invalid();
  return { schemaVersion: input.schemaVersion, pdSourceFileId: input.pdSourceFileId, rdSourceFileId: input.rdSourceFileId,
    selection: { pdSystemId: selection.pdSystemId, rdSystemIds: [...selection.rdSystemIds] } };
}
