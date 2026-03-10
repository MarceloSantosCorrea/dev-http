export type RequestMethod =
  | "GET"
  | "POST"
  | "PUT"
  | "PATCH"
  | "DELETE"
  | "HEAD"
  | "OPTIONS";

export type BodyMode = "json" | "text";

export type LoadState = "loading" | "connected" | "mock";

export type KeyValueRow = {
  id: string;
  key: string;
  value: string;
  enabled: boolean;
};

export type EnvironmentVariable = KeyValueRow & {
  secret?: boolean;
};

export type RequestDraft = {
  id: string;
  name: string;
  description?: string;
  method: RequestMethod;
  url: string;
  queryParams: KeyValueRow[];
  headers: KeyValueRow[];
  bodyMode: BodyMode;
  body: string;
};

export type RequestItem = {
  id: string;
  name: string;
  summary?: string;
  method: RequestMethod;
  url: string;
  draft: RequestDraft;
};

export type Collection = {
  id: string;
  name: string;
  description?: string;
  requests: RequestItem[];
};

export type Project = {
  id: string;
  name: string;
  description?: string;
  collections: Collection[];
};

export type Environment = {
  id: string;
  name: string;
  variables: EnvironmentVariable[];
};

export type ApiConnectionInfo = {
  state: LoadState;
  message: string;
  baseUrl: string | null;
};

export type ResolvedRequest = {
  method: RequestMethod;
  url: string;
  queryParams: KeyValueRow[];
  headers: KeyValueRow[];
  bodyMode: BodyMode;
  body: string;
};

export type ResponseSnapshot = {
  ok: boolean;
  status: number;
  statusText: string;
  durationMs: number;
  sizeBytes: number;
  headers: Array<{ key: string; value: string }>;
  body: string;
  bodyFormat: "json" | "text";
  source: "proxy" | "browser";
  requestedUrl: string;
};

export type WorkspaceData = {
  projects: Project[];
  environments: Environment[];
  connection: ApiConnectionInfo;
};
