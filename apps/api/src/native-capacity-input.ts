import type { NativeCapacityCompareInput } from "@inspector-ai/contracts";

import { NativeSourceComparisonError as NativeCapacityError } from "./native-source-comparison-error.js";
export { NativeSourceComparisonError as NativeCapacityError } from "./native-source-comparison-error.js";

export function parseNativeCapacityInput(value: unknown): NativeCapacityCompareInput {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).sort().join(",") !== "pdSourceFileId,rdSourceFileId,schemaVersion")
    throw new NativeCapacityError(400, "INVALID_NATIVE_CAPACITY_INPUT", "Укажите только два исходных файла и версию команды");
  const input = value as NativeCapacityCompareInput;
  if (input.schemaVersion !== "native-capacity-command-v1" || ![input.pdSourceFileId, input.rdSourceFileId]
    .every(id => typeof id === "string" && /^[A-Za-z0-9_-]{1,200}$/u.test(id)))
    throw new NativeCapacityError(400, "INVALID_NATIVE_CAPACITY_INPUT", "Некорректные идентификаторы исходников");
  if (input.pdSourceFileId === input.rdSourceFileId)
    throw new NativeCapacityError(422, "NATIVE_CAPACITY_IDENTICAL_SOURCE", "Выберите два разных исходных документа");
  return { schemaVersion: input.schemaVersion, pdSourceFileId: input.pdSourceFileId, rdSourceFileId: input.rdSourceFileId };
}
