import type { CheckRun, InspectionObject, SessionUser } from "@inspector-ai/contracts";

export function protocolRevocationBlock(object: InspectionObject, user: SessionUser | null): string | null {
  if (!user?.roles.some(role => role === "SUPERVISOR" || role === "ADMIN"))
    return "Отзыв финального протокола доступен руководителю или администратору с правом на этот объект.";
  if (object.permissions?.revoke !== true)
    return object.revokeUnavailableReason ?? "Право отзыва протокола этого объекта не подтверждено. Обновите объект или обратитесь к администратору.";
  return null;
}

export function protocolRequiresGapAcknowledgement(check: CheckRun): boolean {
  return check.mode === "NORMAL" && (check.status === "PARTIAL" || check.stats.unsupported > 0);
}

/** Reflect only permissions and readiness exposed by the API; object scope is checked by finalize. */
export function protocolFinalizationBlock(check: CheckRun, user: SessionUser | null): string | null {
  if (check.status === "FINALIZED") return "Финальная версия уже зафиксирована.";
  if (check.status === "FAILED") return "Анализ завершился с ошибкой. Запустите новую проверку перед выпуском протокола.";
  if (["DRAFT", "UPLOADING", "VALIDATING", "PROCESSING"].includes(check.status)
    || (check.mode === "NORMAL" && !check.completedAt)) {
    return "Дождитесь завершения анализа перед выпуском протокола.";
  }
  if (check.mode === "NORMAL" && !user?.roles.some((role) => role === "INSPECTOR" || role === "SUPERVISOR")
    && !user?.capabilities.includes("FINALIZE")) {
    return "У вашей учётной записи нет права выпускать протоколы.";
  }
  if (check.stats.candidates > 0) return `Осталось обработать ${check.stats.candidates} кандидатов.`;
  return null;
}
