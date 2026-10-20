import type { InspectionObject, InspectionObjectPermissions } from "@inspector-ai/contracts";
import type { AuthenticatedActor } from "./identity.js";
import type { InspectionRepository } from "./repository.js";

export const finalizedObjectReason = "Проверка финализирована. Изменение комплекта и новый запуск недоступны. Для исправления нужен разрешённый отзыв финального протокола.";

export function projectObjectPermissions(object: InspectionObject, actor: AuthenticatedActor, acl: ReadonlySet<string>) {
  const inspectionLifecycle = object.inspectionLifecycle ?? (object.status === "FINALIZED" ? "FINALIZED" : "OPEN");
  const open = inspectionLifecycle === "OPEN";
  const operates = (capability: string) => actor.roles.some(role => role === "INSPECTOR" || role === "SUPERVISOR")
    || actor.capabilities.includes(capability);
  const revokeRole = actor.roles.some(role => role === "SUPERVISOR" || role === "ADMIN");
  const permissions: InspectionObjectPermissions = {
    upload: open && acl.has("UPLOAD") && operates("DOCUMENT_UPLOAD"),
    review: open && acl.has("REVIEW_DECIDE") && actor.capabilities.includes("SOURCE_REVIEW"),
    run: open && acl.has("RUN") && operates("RUN_START"),
    finalize: open && acl.has("FINALIZE") && operates("FINALIZE"),
    revoke: !open && revokeRole && acl.has("REVOKE"),
  };
  return {
    inspectionLifecycle,
    permissions,
    ...(!open ? { readOnlyReason: finalizedObjectReason } : {}),
    ...(!permissions.revoke ? { revokeUnavailableReason: !revokeRole
      ? "Отзывать протокол может руководитель или администратор с правом на этот объект."
      : !acl.has("REVOKE") ? "У вашей учётной записи нет права отзывать протокол этого объекта."
        : "Отзыв доступен только для финального протокола." } : {}),
  };
}

export async function readObjectPermissions(store: InspectionRepository, object: InspectionObject, actor: AuthenticatedActor) {
  const names = ["UPLOAD", "REVIEW_DECIDE", "RUN", "FINALIZE", "REVOKE"] as const;
  const allowed = await Promise.all(names.map(name => store.hasObjectPermission(object.id, actor, name)));
  return projectObjectPermissions(object, actor, new Set(names.filter((_, index) => allowed[index])));
}
