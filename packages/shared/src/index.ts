export type Role = "owner" | "admin" | "editor" | "viewer";
export type WorkspaceInviteStatus = "pending" | "accepted" | "declined" | "revoked";
export type NotificationType = "workspace_invite";

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
export type ExecutionSource = "server" | "desktop-local" | "agent-local";

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

export interface WorkspaceMembership {
  workspace: Workspace;
  role: Role;
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

export interface LocalExecutionRequest extends ExecutedRequest {
  variables?: Variable[];
  source?: ExecutionSource;
}

export interface ExecutionResponse {
  status: number;
  statusText: string;
  durationMs: number;
  headers: Record<string, string>;
  bodyText: string;
  bodyJson?: unknown;
  resolvedUrl: string;
  source: ExecutionSource;
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

export interface RegisterPayload {
  name: string;
  email: string;
  password: string;
}

export interface AuthResponse {
  token?: string;
  user: User;
  workspaceId: string;
  workspaces: WorkspaceMembership[];
}

export interface UserPreferences {
  sidebarCollapsed: boolean;
  themeMode: ThemeMode;
}

export interface WorkspaceMember {
  user: User;
  role: Role;
  createdAt: string;
}

export interface WorkspaceInvite {
  id: string;
  workspaceId: string;
  workspaceName: string;
  email: string;
  role: Role;
  status: WorkspaceInviteStatus;
  invitedBy: User;
  createdAt: string;
  updatedAt: string;
}

export interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  readAt?: string;
  createdAt: string;
  invite?: WorkspaceInvite;
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
