import {
  PROJECT_MODULES,
  normalizeProjectSlug,
  type RequestedProjectModule
} from "./creator-application";

export const PROJECT_ASSIGNMENT_SCHEMA_VERSION = 1 as const;
export const MODULE_ACTIVATION_REQUEST_SCHEMA_VERSION = 1 as const;

export type ProjectAssignment = {
  schemaVersion: typeof PROJECT_ASSIGNMENT_SCHEMA_VERSION;
  projectSlug: string;
  ownerId: string;
  allowedModules: RequestedProjectModule[];
  createdAt?: unknown;
  updatedAt?: unknown;
};

export type ModuleActivationRequestStatus = "requested" | "reviewing" | "ready" | "declined";

export type ModuleActivationRequest = {
  schemaVersion: typeof MODULE_ACTIVATION_REQUEST_SCHEMA_VERSION;
  module: RequestedProjectModule;
  status: ModuleActivationRequestStatus;
  requestedAt?: unknown;
  updatedAt?: unknown;
};

function validModules(value: unknown) {
  return Array.from(new Set(
    Array.isArray(value)
      ? value.filter((module): module is RequestedProjectModule => (
          PROJECT_MODULES.includes(module as RequestedProjectModule)
        ))
      : []
  ));
}

export function parseProjectAssignment(value: unknown): ProjectAssignment | null {
  if (!value || typeof value !== "object") return null;
  const data = value as Partial<ProjectAssignment>;
  const projectSlug = normalizeProjectSlug(data.projectSlug);
  const allowedModules = validModules(data.allowedModules);
  if (
    data.schemaVersion !== PROJECT_ASSIGNMENT_SCHEMA_VERSION
    || !projectSlug
    || typeof data.ownerId !== "string"
    || data.ownerId.length < 1
    || data.ownerId.length > 128
    || allowedModules.length === 0
  ) return null;
  return {
    schemaVersion: PROJECT_ASSIGNMENT_SCHEMA_VERSION,
    projectSlug,
    ownerId: data.ownerId,
    allowedModules,
    createdAt: data.createdAt,
    updatedAt: data.updatedAt
  };
}

export function parseModuleActivationRequest(
  module: RequestedProjectModule,
  value: unknown
): ModuleActivationRequest | null {
  if (!value || typeof value !== "object") return null;
  const data = value as Partial<ModuleActivationRequest>;
  if (
    data.schemaVersion !== MODULE_ACTIVATION_REQUEST_SCHEMA_VERSION
    || data.module !== module
    || !["requested", "reviewing", "ready", "declined"].includes(data.status ?? "")
  ) return null;
  return {
    schemaVersion: MODULE_ACTIVATION_REQUEST_SCHEMA_VERSION,
    module,
    status: data.status as ModuleActivationRequestStatus,
    requestedAt: data.requestedAt,
    updatedAt: data.updatedAt
  };
}
