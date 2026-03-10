export type Role = "owner" | "admin" | "editor" | "viewer";

export type HttpMethod =
  | "GET"
  | "POST"
  | "PUT"
  | "PATCH"
  | "DELETE"
  | "HEAD"
  | "OPTIONS";

export type VariableScope = "workspace" | "project";
export type BodyType = "json" | "text" | "form-urlencoded" | "form-data";
export type FormDataFieldType = "text" | "file";
export type ThemeMode = "light" | "dark" | "system";

export interface User {
  id: string;
  name: string;
  email: string;
  avatarUrl?: string;
}

export interface Membership {
  userId: string;
  workspaceId: string;
  role: Role;
}

export interface Workspace {
  id: string;
  name: string;
}

export interface Project {
  id: string;
  workspaceId: string;
  name: string;
  description: string;
}

export interface Variable {
  key: string;
  value: string;
  enabled: boolean;
  secret?: boolean;
}

export interface Environment {
  id: string;
  projectId: string;
  scope: VariableScope;
  name: string;
  variables: Variable[];
}

export interface KeyValue {
  id: string;
  key: string;
  value: string;
  enabled: boolean;
}

export interface FormDataField {
  id: string;
  key: string;
  value: string;
  enabled: boolean;
  type: FormDataFieldType;
  src?: string;
}

export interface RequestScriptResult {
  tests: Array<{ name: string; passed: boolean }>;
  logs: string[];
  updatedVariables: Variable[];
  error?: string;
}

export type ConsoleValue =
  | string
  | number
  | boolean
  | null
  | ConsoleValue[]
  | { [key: string]: ConsoleValue };

export interface ExecutionConsole {
  requestLine: string;
  sections: Record<string, ConsoleValue>;
}

export interface RequestDefinition {
  id: string;
  projectId: string;
  collectionId?: string;
  name: string;
  method: HttpMethod;
  url: string;
  headers: KeyValue[];
  queryParams: KeyValue[];
  bodyType: BodyType;
  body: string;
  formData: FormDataField[];
  postResponseScript: string;
  updatedAt: string;
}

export interface ExecutedRequest {
  requestId?: string;
  method: HttpMethod;
  url: string;
  environmentId?: string;
  headers: KeyValue[];
  queryParams: KeyValue[];
  bodyType: BodyType;
  body: string;
  formData: FormDataField[];
  postResponseScript?: string;
}

export interface ExecutionResponse {
  status: number;
  statusText: string;
  durationMs: number;
  headers: Record<string, string>;
  bodyText: string;
  bodyJson?: unknown;
  resolvedUrl: string;
  console: ExecutionConsole;
  scriptResult?: RequestScriptResult;
}

export interface ProjectBundle {
  project: Project;
  requests: RequestDefinition[];
  environments: Environment[];
}

export interface LoginPayload {
  email: string;
  password: string;
}

export interface AuthResponse {
  token?: string;
  user: User;
  workspaceId: string;
}

export interface UserPreferences {
  sidebarCollapsed: boolean;
  themeMode: ThemeMode;
}

export interface PostmanImportResult {
  importedCount: number;
  collectionsCreated: number;
  requests: RequestDefinition[];
  warnings: string[];
  detectedVariables: string[];
  environmentImported?: {
    id: string;
    name: string;
    created: boolean;
    updated: boolean;
  };
}
