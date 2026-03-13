"use client";

import {
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { createPortal } from "react-dom";
import { Bell, ChevronDown, Copy, GripVertical, Pencil } from "lucide-react";
import { useRouter } from "next/navigation";
import { closestCenter, DndContext, type DragEndEvent } from "@dnd-kit/core";
import { arrayMove, SortableContext, useSortable, horizontalListSortingStrategy, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type {
  AuthResponse,
  BodyType,
  ConsoleValue,
  Environment,
  ExecutedRequest,
  ExecutionConsole,
  ExecutionResponse,
  FormDataField,
  HttpMethod,
  KeyValue,
  LocalExecutionRequest,
  Notification,
  PostmanImportResult,
  RequestDefinition,
  User,
  UserPreferences,
  UserRealtimeEvent,
  Variable,
  WorkspaceInvite,
  WorkspaceMember,
  WorkspaceMembership,
  WorkspaceRealtimeEvent,
} from "@devhttp/shared";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  connectLocalAgent,
  executeLocalAgentRequestWithRetry,
  isLocalAgentRequiredError,
  LOCAL_AGENT_REQUIRED_MESSAGE,
} from "@/lib/local-agent";
import { createRealtimeSocket } from "@/lib/realtime";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/$/, "") ?? "http://localhost:4000";
const DESKTOP_DOWNLOAD_URL = "/api/download/desktop";
const AGENT_DOWNLOAD_URL = "/api/download/agent";

type BootstrapCollection = {
  id: string;
  name: string;
  parentCollectionId?: string;
};

type BootstrapRequest = RequestDefinition & {
  collectionId?: string;
};

type BootstrapProject = {
  id: string;
  workspaceId: string;
  name: string;
  description: string;
  collections: BootstrapCollection[];
  environments: Environment[];
  requests: BootstrapRequest[];
};

type BootstrapResponse = {
  user: User;
  workspace: { id: string; name: string };
  membership: { role: string };
  projects: BootstrapProject[];
};

type SessionResponse = {
  user: User;
  workspaceId: string;
  workspaces: WorkspaceMembership[];
};

type ThemeMode = UserPreferences["themeMode"];
type SettingsTab = "profile" | "appearance" | "security" | "workspace";

type ProfileFormState = {
  name: string;
  email: string;
  avatarUrl: string;
};

type PasswordFormState = {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
};

type WorkspaceInviteFormState = {
  email: string;
  role: "admin" | "editor" | "viewer";
};

type PostmanCollectionFile = {
  name?: string;
  item?: unknown[];
  info?: { schema?: string };
};

type PostmanEnvironmentFile = {
  name?: string;
  values?: unknown[];
};

type ResponseCardError = {
  type: "agent_required";
  message: string;
};

type RemoteConflictState = {
  hasRemoteConflict: boolean;
  remoteConflictAt?: string;
  remoteConflictReason?: string;
};

type DesktopRequestTabSnapshot = {
  type: "request";
  tabId: string;
  draft: BootstrapRequest;
  savedSnapshot: string;
  isDirty: boolean;
};

type RealtimeRequestTabSnapshot = DesktopRequestTabSnapshot & {
  execution: ExecutionResponse | null;
  responseError: ResponseCardError | null;
  isExecuting: boolean;
};

type DesktopEnvironmentTabSnapshot = {
  type: "environment";
  tabId: string;
  environmentId: string;
};

type DesktopWorkspaceSnapshot = {
  schemaVersion: 1;
  userId: string;
  workspaceId: string;
  selectedProjectId: string;
  selectedCollectionId: string;
  selectedEnvironmentId: string;
  activeTabId: string;
  activeTab: "headers" | "queryParams" | "body" | "script";
  openTabs: Array<DesktopRequestTabSnapshot | DesktopEnvironmentTabSnapshot>;
  expandedCollectionIds: string[];
  sidebarCollapsed: boolean;
  sidebarWidth: number;
  requestPaneRatio: number;
  responseView: "response" | "console";
  environmentDrafts: Environment[];
  savedEnvironmentSnapshot: string;
};

type RealtimeWorkspaceSnapshot = Omit<DesktopWorkspaceSnapshot, "openTabs"> & {
  openTabs: Array<RealtimeRequestTabSnapshot | DesktopEnvironmentTabSnapshot>;
};

type RequestEditorTab = {
  tabId: string;
  type: "request";
  draft: BootstrapRequest;
  execution: ExecutionResponse | null;
  responseError: ResponseCardError | null;
  isExecuting: boolean;
  isSaving: boolean;
  isDirty: boolean;
  savedSnapshot: string;
} & RemoteConflictState;

type EnvironmentEditorTab = {
  tabId: string;
  type: "environment";
  environmentId: string;
} & RemoteConflictState;

type EditorTab = RequestEditorTab | EnvironmentEditorTab;

type CreateModalType = "workspace" | "project" | "collection" | "environment" | null;
type RenameEntityType = "workspace" | "project" | "collection" | "request";
type RenameModalState = {
  type: RenameEntityType;
  id: string;
  projectId?: string;
  currentName: string;
} | null;

type WorkspaceUiState = {
  selectedProjectId: string;
  selectedCollectionId: string;
  selectedEnvironmentId: string;
  openTabs: EditorTab[];
  activeTabId: string;
  expandedCollectionIds: string[];
  activeTab: "headers" | "queryParams" | "body" | "script";
  sidebarCollapsed?: boolean;
  sidebarWidth?: number;
  requestPaneRatio?: number;
  responseView?: "response" | "console";
  bootstrap: BootstrapResponse;
  savedEnvironmentSnapshot: string;
  hasEnvironmentRemoteConflict?: boolean;
};

type DesktopUpdateCheckResult = {
  available: boolean;
  currentVersion: string;
  latestVersion?: string;
  tag?: string;
  releaseUrl?: string;
  assetUrl?: string;
  publishedAt?: string;
  skipped?: boolean;
};

const METHODS: HttpMethod[] = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];
const DESKTOP_SNAPSHOT_SCHEMA_VERSION = 1;

function emptyKeyValue(): KeyValue {
  return {
    id: crypto.randomUUID(),
    key: "",
    value: "",
    enabled: true,
  };
}

function defaultRequest(projectId?: string, collectionId?: string): BootstrapRequest {
  return {
    id: "",
    projectId: projectId ?? "",
    collectionId,
    name: "Nova request",
    method: "GET",
    url: "",
    headers: [emptyKeyValue()],
    queryParams: [emptyKeyValue()],
    bodyType: "json",
    body: "",
    formData: [],
    postResponseScript: "",
    updatedAt: new Date().toISOString(),
  };
}

function emptyFormDataField(type: FormDataField["type"] = "text"): FormDataField {
  return {
    id: crypto.randomUUID(),
    key: "",
    value: "",
    enabled: true,
    type,
    src: "",
  };
}

function meaningfulKeyValues(items: KeyValue[]) {
  return items
    .filter((item) => item.key || item.value)
    .map((item) => ({
      key: item.key,
      value: item.value,
      enabled: item.enabled,
    }));
}

function meaningfulFormData(items: FormDataField[]) {
  return items
    .filter((item) => item.key || item.value || item.src)
    .map((item) => ({
      key: item.key,
      value: item.value,
      enabled: item.enabled,
      type: item.type,
      src: item.src ?? "",
    }));
}

function serializeRequestSnapshot(draft: BootstrapRequest) {
  return JSON.stringify({
    id: draft.id,
    projectId: draft.projectId,
    collectionId: draft.collectionId ?? "",
    name: draft.name,
    method: draft.method,
    url: draft.url,
    headers: meaningfulKeyValues(draft.headers),
    queryParams: meaningfulKeyValues(draft.queryParams),
    bodyType: draft.bodyType,
    body: draft.body,
    formData: meaningfulFormData(draft.formData),
    postResponseScript: draft.postResponseScript,
  });
}

function createRequestEditorTab(
  draft: BootstrapRequest,
  overrides: Partial<
    Pick<
      RequestEditorTab,
      | "tabId"
      | "execution"
      | "responseError"
      | "isExecuting"
      | "isSaving"
      | "hasRemoteConflict"
      | "remoteConflictAt"
      | "remoteConflictReason"
    >
  > = {},
): RequestEditorTab {
  return {
    tabId: overrides.tabId ?? draft.id,
    type: "request",
    draft,
    execution: overrides.execution ?? null,
    responseError: overrides.responseError ?? null,
    isExecuting: overrides.isExecuting ?? false,
    isSaving: overrides.isSaving ?? false,
    isDirty: false,
    savedSnapshot: serializeRequestSnapshot(draft),
    hasRemoteConflict: overrides.hasRemoteConflict ?? false,
    remoteConflictAt: overrides.remoteConflictAt,
    remoteConflictReason: overrides.remoteConflictReason,
  };
}

function createEnvironmentEditorTab(
  environmentId: string,
  overrides: Partial<Pick<EnvironmentEditorTab, "tabId" | "hasRemoteConflict" | "remoteConflictAt" | "remoteConflictReason">> = {},
): EnvironmentEditorTab {
  return {
    tabId: overrides.tabId ?? environmentId,
    type: "environment",
    environmentId,
    hasRemoteConflict: overrides.hasRemoteConflict ?? false,
    remoteConflictAt: overrides.remoteConflictAt,
    remoteConflictReason: overrides.remoteConflictReason,
  };
}

function updateSerializedRequestSnapshotName(snapshot: string, name: string) {
  try {
    const parsed = JSON.parse(snapshot) as Record<string, unknown>;
    return JSON.stringify({
      ...parsed,
      name,
    });
  } catch {
    return snapshot;
  }
}

function hasDesktopSnapshotBridge() {
  if (typeof window === "undefined" || !window.devHttpDesktop) {
    return false;
  }

  return (
    typeof window.devHttpDesktop.getWorkspaceSnapshot === "function" &&
    typeof window.devHttpDesktop.saveWorkspaceSnapshot === "function" &&
    typeof window.devHttpDesktop.clearWorkspaceSnapshot === "function"
  );
}

function getBrowserWorkspaceSnapshotKey(userId: string, workspaceId: string) {
  return `devhttp-workspace-snapshot:${userId}:${workspaceId}`;
}

function readBrowserWorkspaceSnapshot(
  userId: string,
  workspaceId: string,
): DesktopWorkspaceSnapshot | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(getBrowserWorkspaceSnapshotKey(userId, workspaceId));
    return raw ? (JSON.parse(raw) as DesktopWorkspaceSnapshot) : null;
  } catch {
    return null;
  }
}

function saveBrowserWorkspaceSnapshot(
  userId: string,
  workspaceId: string,
  snapshot: DesktopWorkspaceSnapshot,
) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(
    getBrowserWorkspaceSnapshotKey(userId, workspaceId),
    JSON.stringify(snapshot),
  );
}

function buildDefaultWorkspaceUiState(bootstrap: BootstrapResponse): WorkspaceUiState {
  const firstProject = bootstrap.projects[0] ?? null;
  const firstRequest = firstProject?.requests[0] ?? null;
  const firstEnvironment = firstProject?.environments[0] ?? null;
  const firstCollectionId = firstRequest?.collectionId ?? firstProject?.collections[0]?.id ?? "";

  const openTabs: EditorTab[] = firstRequest ? [createRequestEditorTab(firstRequest)] : [];

  return {
    selectedProjectId: firstProject?.id ?? "",
    selectedCollectionId: firstCollectionId,
    selectedEnvironmentId: firstEnvironment?.id ?? "",
    openTabs,
    activeTabId: openTabs[0]?.tabId ?? "",
    expandedCollectionIds: firstCollectionId ? [firstCollectionId] : [],
    activeTab: "headers",
    bootstrap,
    savedEnvironmentSnapshot: firstEnvironment ? JSON.stringify(firstEnvironment) : "",
  };
}

function mergeEnvironmentDrafts(
  bootstrap: BootstrapResponse,
  environmentDrafts: Environment[],
): BootstrapResponse {
  if (environmentDrafts.length === 0) {
    return bootstrap;
  }

  const draftsById = new Map(environmentDrafts.map((environment) => [environment.id, environment]));
  return {
    ...bootstrap,
    projects: bootstrap.projects.map((project) => ({
      ...project,
      environments: project.environments.map(
        (environment) => draftsById.get(environment.id) ?? environment,
      ),
    })),
  };
}

function resolveRestoredRequestDraft(
  bootstrap: BootstrapResponse,
  draft: BootstrapRequest,
  preferLocalDraft: boolean,
): BootstrapRequest | null {
  const project =
    bootstrap.projects.find((item) => item.id === draft.projectId) ??
    (draft.id
      ? bootstrap.projects.find((item) => item.requests.some((request) => request.id === draft.id))
      : null);

  if (!project) {
    return null;
  }

  const persistedRequest = draft.id
    ? project.requests.find((request) => request.id === draft.id) ?? null
    : null;

  if (draft.id && !persistedRequest) {
    return null;
  }

  const fallbackCollectionId =
    draft.collectionId && project.collections.some((collection) => collection.id === draft.collectionId)
      ? draft.collectionId
      : persistedRequest?.collectionId ?? project.collections[0]?.id;

  if (!persistedRequest) {
    return {
      ...defaultRequest(project.id, fallbackCollectionId),
      ...draft,
      projectId: project.id,
      collectionId: fallbackCollectionId,
    };
  }

  if (!preferLocalDraft) {
    return {
      ...persistedRequest,
      projectId: project.id,
      collectionId: fallbackCollectionId,
      updatedAt: persistedRequest.updatedAt,
    };
  }

  return {
    ...persistedRequest,
    ...draft,
    projectId: project.id,
    collectionId: fallbackCollectionId,
    updatedAt: persistedRequest.updatedAt,
  };
}

function restoreWorkspaceUiState(
  bootstrap: BootstrapResponse,
  snapshot: DesktopWorkspaceSnapshot | RealtimeWorkspaceSnapshot | null,
  options?: {
    realtimeEvent?: WorkspaceRealtimeEvent;
  },
): WorkspaceUiState | null {
  if (
    !snapshot ||
    snapshot.schemaVersion !== DESKTOP_SNAPSHOT_SCHEMA_VERSION ||
    snapshot.workspaceId !== bootstrap.workspace.id
  ) {
    return null;
  }

  const bootstrapWithEnvironmentDrafts = mergeEnvironmentDrafts(
    bootstrap,
    snapshot.environmentDrafts ?? [],
  );

  const restoredTabs: EditorTab[] = snapshot.openTabs.flatMap<EditorTab>((tab) => {
    if (tab.type === "environment") {
      const environmentExists = bootstrapWithEnvironmentDrafts.projects.some((project) =>
        project.environments.some((environment) => environment.id === tab.environmentId),
      );
      return environmentExists
        ? [createEnvironmentEditorTab(tab.environmentId, { tabId: tab.tabId })]
        : [];
    }

    const draft = resolveRestoredRequestDraft(
      bootstrapWithEnvironmentDrafts,
      tab.draft,
      tab.isDirty,
    );
    if (!draft) {
      return [];
    }

    const restored = createRequestEditorTab(draft, {
      tabId: tab.tabId,
      execution: "execution" in tab ? tab.execution : null,
      responseError: "responseError" in tab ? tab.responseError : null,
      isExecuting: "isExecuting" in tab ? tab.isExecuting : false,
    });
    const currentSnapshot = serializeRequestSnapshot(draft);
    restored.savedSnapshot = tab.isDirty ? tab.savedSnapshot || currentSnapshot : currentSnapshot;
    restored.isDirty = tab.isDirty;
    const persistedRequest =
      draft.id
        ? bootstrapWithEnvironmentDrafts.projects
            .flatMap((project) => project.requests)
            .find((request) => request.id === draft.id) ?? null
        : null;
    const persistedSnapshot = persistedRequest ? serializeRequestSnapshot(persistedRequest) : null;
    if (
      options?.realtimeEvent?.entityType === "request" &&
      options.realtimeEvent.entityId === draft.id &&
      restored.isDirty &&
      persistedSnapshot &&
      persistedSnapshot !== restored.savedSnapshot
    ) {
      restored.hasRemoteConflict = true;
      restored.remoteConflictAt = options.realtimeEvent.occurredAt;
      restored.remoteConflictReason = "A request foi alterada remotamente.";
    }
    return [restored];
  });

  const defaultState = buildDefaultWorkspaceUiState(bootstrapWithEnvironmentDrafts);
  const selectedProject =
    bootstrapWithEnvironmentDrafts.projects.find((project) => project.id === snapshot.selectedProjectId) ??
    (restoredTabs.find((tab): tab is RequestEditorTab => tab.type === "request")
      ? bootstrapWithEnvironmentDrafts.projects.find(
          (project) =>
            project.id ===
            (restoredTabs.find((tab): tab is RequestEditorTab => tab.type === "request")?.draft.projectId ?? ""),
        )
      : null) ??
    bootstrapWithEnvironmentDrafts.projects[0] ??
    null;

  if (!selectedProject) {
    return {
      ...defaultState,
      openTabs: restoredTabs,
      activeTabId: restoredTabs[0]?.tabId ?? "",
      bootstrap: bootstrapWithEnvironmentDrafts,
    };
  }

  const openTabs =
    snapshot.openTabs.length === 0
      ? []
      : restoredTabs.length > 0
        ? restoredTabs
        : defaultState.openTabs;
  const selectedEnvironmentId = selectedProject.environments.some(
    (environment) => environment.id === snapshot.selectedEnvironmentId,
  )
    ? snapshot.selectedEnvironmentId
    : selectedProject.environments[0]?.id ?? "";

  const activeRequestTab =
    openTabs.find((tab): tab is RequestEditorTab => tab.tabId === snapshot.activeTabId && tab.type === "request") ??
    openTabs.find((tab): tab is RequestEditorTab => tab.type === "request") ??
    null;

  const selectedCollectionId = selectedProject.collections.some(
    (collection) => collection.id === snapshot.selectedCollectionId,
  )
    ? snapshot.selectedCollectionId
    : activeRequestTab?.draft.collectionId ?? selectedProject.collections[0]?.id ?? "";

  const expandedCollectionIds = snapshot.expandedCollectionIds.filter((id) =>
    selectedProject.collections.some((collection) => collection.id === id),
  );

  return {
    selectedProjectId: selectedProject.id,
    selectedCollectionId,
    selectedEnvironmentId,
    openTabs,
    activeTabId: openTabs.some((tab) => tab.tabId === snapshot.activeTabId)
      ? snapshot.activeTabId
      : openTabs[0]?.tabId ?? "",
    expandedCollectionIds:
      expandedCollectionIds.length > 0
        ? expandedCollectionIds
        : selectedCollectionId
          ? [selectedCollectionId]
          : [],
    activeTab:
      snapshot.activeTab === "queryParams" ||
      snapshot.activeTab === "body" ||
      snapshot.activeTab === "script"
        ? snapshot.activeTab
        : "headers",
    sidebarCollapsed: snapshot.sidebarCollapsed,
    sidebarWidth: snapshot.sidebarWidth,
    requestPaneRatio: snapshot.requestPaneRatio,
    responseView: snapshot.responseView,
    bootstrap: bootstrapWithEnvironmentDrafts,
    savedEnvironmentSnapshot:
      snapshot.savedEnvironmentSnapshot ||
      JSON.stringify(
        selectedProject.environments.find((environment) => environment.id === selectedEnvironmentId) ??
          null,
      ),
    hasEnvironmentRemoteConflict:
      options?.realtimeEvent?.entityType === "environment" &&
      options.realtimeEvent.entityId === selectedEnvironmentId &&
      JSON.stringify(
        snapshot.environmentDrafts.find((environment) => environment.id === selectedEnvironmentId) ?? null,
      ) !== snapshot.savedEnvironmentSnapshot &&
      snapshot.savedEnvironmentSnapshot !==
        JSON.stringify(
          selectedProject.environments.find((environment) => environment.id === selectedEnvironmentId) ??
            null,
        ),
  };
}

function buildDesktopWorkspaceSnapshot(
  userId: string,
  workspaceId: string,
  bootstrap: BootstrapResponse,
  openTabs: EditorTab[],
  input: Omit<
    DesktopWorkspaceSnapshot,
    "schemaVersion" | "userId" | "workspaceId" | "openTabs" | "environmentDrafts"
  >,
): DesktopWorkspaceSnapshot {
  return {
    schemaVersion: DESKTOP_SNAPSHOT_SCHEMA_VERSION,
    userId,
    workspaceId,
    ...input,
    environmentDrafts: bootstrap.projects.flatMap((project) => project.environments),
    openTabs: openTabs.map((tab) =>
      tab.type === "request"
        ? {
            type: "request",
            tabId: tab.tabId,
            draft: tab.draft,
            savedSnapshot: tab.savedSnapshot,
            isDirty: tab.isDirty,
          }
        : {
            type: "environment",
            tabId: tab.tabId,
            environmentId: tab.environmentId,
          },
    ),
  };
}

function buildRealtimeWorkspaceSnapshot(
  userId: string,
  workspaceId: string,
  bootstrap: BootstrapResponse,
  openTabs: EditorTab[],
  input: Omit<
    RealtimeWorkspaceSnapshot,
    "schemaVersion" | "userId" | "workspaceId" | "openTabs" | "environmentDrafts"
  >,
): RealtimeWorkspaceSnapshot {
  return {
    schemaVersion: DESKTOP_SNAPSHOT_SCHEMA_VERSION,
    userId,
    workspaceId,
    ...input,
    environmentDrafts: bootstrap.projects.flatMap((project) => project.environments),
    openTabs: openTabs.map((tab) =>
      tab.type === "request"
        ? {
            type: "request",
            tabId: tab.tabId,
            draft: tab.draft,
            savedSnapshot: tab.savedSnapshot,
            isDirty: tab.isDirty,
            execution: tab.execution,
            responseError: tab.responseError,
            isExecuting: tab.isExecuting,
          }
        : {
            type: "environment",
            tabId: tab.tabId,
            environmentId: tab.environmentId,
          },
    ),
  };
}

function interpolateWithVariables(input: string, variables: Variable[]) {
  const variableMap = new Map(
    variables.filter((variable) => variable.enabled).map((variable) => [variable.key, variable.value]),
  );
  return input.replace(/\{\{([^}]+)\}\}/g, (_, key: string) => variableMap.get(key.trim()) ?? "");
}

type VarSegment = { type: "text"; text: string } | { type: "var"; name: string; raw: string };

function parseVariableSegments(value: string): VarSegment[] {
  const segments: VarSegment[] = [];
  const regex = /\{\{([^}]+)\}\}/g;
  let lastIndex = 0;
  let match;
  while ((match = regex.exec(value)) !== null) {
    if (match.index > lastIndex)
      segments.push({ type: "text", text: value.slice(lastIndex, match.index) });
    segments.push({ type: "var", name: match[1].trim(), raw: match[0] });
    lastIndex = regex.lastIndex;
  }
  if (lastIndex < value.length)
    segments.push({ type: "text", text: value.slice(lastIndex) });
  return segments;
}

function escapeHTML(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function buildHighlightHTML(value: string, variables: Variable[]): string {
  return parseVariableSegments(value)
    .map((seg) => {
      if (seg.type === "text") return escapeHTML(seg.text);
      const resolved = variables.find((v) => v.enabled && v.key === seg.name);
      const state = !resolved ? "false" : resolved.value ? "true" : "empty";
      return `<span data-var-name="${escapeHTML(seg.name)}" data-var-resolved="${state}">${escapeHTML(seg.raw)}</span>`;
    })
    .join("");
}

function getCaretOffset(el: HTMLElement): number {
  const sel = window.getSelection();
  if (!sel?.rangeCount) return 0;
  const range = sel.getRangeAt(0).cloneRange();
  range.selectNodeContents(el);
  range.setEnd(sel.getRangeAt(0).startContainer, sel.getRangeAt(0).startOffset);
  return range.toString().length;
}

function setCaretOffset(el: HTMLElement, offset: number): void {
  const sel = window.getSelection();
  if (!sel) return;
  const s = sel;
  let rem = offset;
  function find(node: Node): boolean {
    if (node.nodeType === Node.TEXT_NODE) {
      const len = (node as Text).length;
      if (rem <= len) {
        const r = document.createRange();
        r.setStart(node, rem);
        r.collapse(true);
        s.removeAllRanges();
        s.addRange(r);
        return true;
      }
      rem -= len;
      return false;
    }
    return Array.from(node.childNodes).some(find);
  }
  find(el);
}

function getAutocompleteTrigger(
  text: string,
  caretOffset: number,
): { query: string; start: number } | null {
  const before = text.slice(0, caretOffset);
  const lastOpen = before.lastIndexOf("{{");
  if (lastOpen === -1) return null;
  const afterOpen = before.slice(lastOpen + 2);
  if (afterOpen.includes("}}")) return null;
  return { query: afterOpen, start: lastOpen };
}

function VarSuggestionsDropdown({
  items,
  activeIndex,
  top,
  left,
  onSelect,
}: {
  items: Variable[];
  activeIndex: number;
  top: number;
  left: number;
  onSelect: (key: string) => void;
}) {
  if (items.length === 0) return null;
  return (
    <div
      className="fixed z-[300] min-w-48 max-h-52 overflow-y-auto rounded-lg border border-border bg-popover shadow-lg py-1"
      style={{ top, left }}
    >
      {items.map((v, i) => (
        <button
          key={v.key}
          type="button"
          onMouseDown={(e) => { e.preventDefault(); onSelect(v.key); }}
          className={cn(
            "w-full text-left px-3 py-1.5 text-sm flex items-center gap-2",
            i === activeIndex
              ? "bg-primary/15 text-primary"
              : "text-foreground hover:bg-muted/50",
          )}
        >
          <span className="font-medium truncate">{v.key}</span>
          {v.secret ? (
            <span className="ml-auto text-xs text-muted-foreground shrink-0">••••</span>
          ) : (
            <span className="ml-auto text-xs text-muted-foreground truncate max-w-[6rem]">
              {v.value || "(vazio)"}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

function VarPopover({
  name, variables, environmentName, top, left, onUpdateVariable, onMouseEnter, onMouseLeave,
}: {
  name: string;
  variables: Variable[];
  environmentName: string;
  top: number;
  left: number;
  onUpdateVariable?: (name: string, value: string) => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}) {
  const resolved = variables.find((v) => v.enabled && v.key === name);

  return (
    <div
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      className="fixed z-[200] min-w-52 rounded-lg border border-border bg-popover shadow-lg p-3 flex flex-col gap-2"
      style={{ top, left }}
    >
      <div className="flex items-center justify-between gap-4">
        <span className="text-xs font-medium text-foreground truncate">{name}</span>
        {environmentName && (
          <span className="text-xs px-1.5 py-0.5 rounded bg-primary/15 text-primary font-medium shrink-0">
            {environmentName}
          </span>
        )}
      </div>
      <input
        type={resolved?.secret ? "password" : "text"}
        defaultValue={resolved?.value ?? ""}
        disabled={!resolved || !onUpdateVariable}
        placeholder={resolved ? "(vazio)" : "variável não encontrada"}
        onChange={(e) => resolved && onUpdateVariable?.(name, e.target.value)}
        className={cn(
          "h-7 w-full rounded-md border border-input bg-transparent px-2 text-sm outline-none",
          "focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50",
          "disabled:opacity-50 disabled:cursor-not-allowed",
        )}
      />
    </div>
  );
}

function VariableHighlightInput({
  value,
  onChange,
  variables,
  placeholder,
  className,
  disabled,
  onUpdateVariable,
  environmentName,
}: {
  value: string;
  onChange: (value: string) => void;
  variables: Variable[];
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  onUpdateVariable?: (name: string, value: string) => void;
  environmentName?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [popover, setPopover] = useState<{ name: string; top: number; left: number } | null>(null);
  const [suggestions, setSuggestions] = useState<{
    items: Variable[];
    query: string;
    start: number;
    top: number;
    left: number;
  } | null>(null);
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(0);

  // Mount initial HTML
  useEffect(() => {
    if (ref.current) ref.current.innerHTML = buildHighlightHTML(value, variables);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Sync external value changes (tab switch, reset)
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if ((el.textContent ?? "") === value) return;
    el.innerHTML = buildHighlightHTML(value, variables);
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps

  // Recolor when variables change (env switch)
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const text = el.textContent ?? "";
    el.innerHTML = buildHighlightHTML(text, variables);
  }, [variables]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleInput() {
    const el = ref.current;
    if (!el) return;
    const caret = getCaretOffset(el);
    const text = el.textContent ?? "";
    onChange(text);
    el.innerHTML = buildHighlightHTML(text, variables);
    setCaretOffset(el, caret);

    // Autocomplete
    const trigger = getAutocompleteTrigger(text, caret);
    if (trigger && variables.length > 0) {
      const q = trigger.query.toLowerCase();
      const items = variables.filter(
        (v) => v.enabled && v.key.toLowerCase().includes(q),
      );
      if (items.length > 0) {
        const sel = window.getSelection();
        let top = el.getBoundingClientRect().bottom + 4;
        let left = el.getBoundingClientRect().left;
        if (sel?.rangeCount) {
          const r = sel.getRangeAt(0).getBoundingClientRect();
          if (r.height > 0) { top = r.bottom + 4; left = r.left; }
        }
        setSuggestions({ items, query: trigger.query, start: trigger.start, top, left });
        setActiveSuggestionIndex(0);
        return;
      }
    }
    setSuggestions(null);
  }

  function selectSuggestion(key: string) {
    const el = ref.current;
    if (!el || !suggestions) return;
    const text = el.textContent ?? "";
    const caret = getCaretOffset(el);
    const newText =
      text.slice(0, suggestions.start) + `{{${key}}}` + text.slice(caret);
    const newCaret = suggestions.start + key.length + 4;
    onChange(newText);
    el.innerHTML = buildHighlightHTML(newText, variables);
    setCaretOffset(el, newCaret);
    setSuggestions(null);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") e.preventDefault();

    if (suggestions) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveSuggestionIndex((i) => Math.min(i + 1, suggestions.items.length - 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveSuggestionIndex((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        const item = suggestions.items[activeSuggestionIndex];
        if (item) selectSuggestion(item.key);
        return;
      }
      if (e.key === "Escape") {
        setSuggestions(null);
        return;
      }
    }
  }

  function handlePaste(e: React.ClipboardEvent) {
    e.preventDefault();
    const text = e.clipboardData.getData("text/plain");
    document.execCommand("insertText", false, text);
  }

  function openPopover(name: string, rect: DOMRect) {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    setPopover({ name, top: rect.bottom + 4, left: rect.left });
  }

  function scheduleClose() {
    closeTimer.current = setTimeout(() => setPopover(null), 120);
  }

  function cancelClose() {
    if (closeTimer.current) clearTimeout(closeTimer.current);
  }

  function handleMouseMove(e: React.MouseEvent<HTMLDivElement>) {
    const target = e.target as HTMLElement;
    const name = target.dataset.varName;
    if (name) {
      const r = target.getBoundingClientRect();
      openPopover(name, r);
    }
  }

  return (
    <>
      <div
        ref={ref}
        contentEditable={!disabled}
        suppressContentEditableWarning
        data-placeholder={placeholder}
        onInput={handleInput}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => scheduleClose()}
        onBlur={() => setSuggestions(null)}
        className={cn(
          "var-input h-8 w-full rounded-lg border border-input bg-transparent dark:bg-input/30 px-2.5",
          "text-base md:text-sm outline-none",
          "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
          "whitespace-nowrap overflow-x-auto",
          "flex items-center",
          disabled && "opacity-50 pointer-events-none cursor-not-allowed",
          className,
        )}
      />
      {suggestions && createPortal(
        <VarSuggestionsDropdown
          items={suggestions.items}
          activeIndex={activeSuggestionIndex}
          top={suggestions.top}
          left={suggestions.left}
          onSelect={selectSuggestion}
        />,
        document.body,
      )}
      {popover && createPortal(
        <VarPopover
          name={popover.name}
          variables={variables}
          environmentName={environmentName ?? ""}
          top={popover.top}
          left={popover.left}
          onUpdateVariable={onUpdateVariable}
          onMouseEnter={cancelClose}
          onMouseLeave={() => setPopover(null)}
        />,
        document.body,
      )}
    </>
  );
}

function isPrivateHostname(hostname: string) {
  const normalized = hostname.trim().toLowerCase();
  if (!normalized) {
    return false;
  }

  if (["localhost", "127.0.0.1", "::1"].includes(normalized) || normalized.endsWith(".local")) {
    return true;
  }

  const ipv4Match = normalized.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!ipv4Match) {
    return false;
  }

  const octets = ipv4Match.slice(1).map(Number);
  if (octets.some((octet) => Number.isNaN(octet) || octet < 0 || octet > 255)) {
    return false;
  }

  return (
    octets[0] === 10 ||
    octets[0] === 127 ||
    (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
    (octets[0] === 192 && octets[1] === 168)
  );
}

function shouldUseLocalExecution(
  request: BootstrapRequest,
  environment: Environment | null,
) {
  try {
    const resolvedUrl = interpolateWithVariables(request.url, environment?.variables ?? []);
    const hostname = new URL(resolvedUrl).hostname;
    return isPrivateHostname(hostname);
  } catch {
    return false;
  }
}

function getCookieValue(name: string) {
  if (typeof document === "undefined") {
    return "";
  }

  const prefix = `${name}=`;
  return document.cookie
    .split(";")
    .map((chunk) => chunk.trim())
    .find((chunk) => chunk.startsWith(prefix))
    ?.slice(prefix.length) ?? "";
}

function isDesktopApiClient() {
  return typeof window !== "undefined" && Boolean(window.devHttpDesktop);
}

function authHeaders(_token?: string) {
  const csrfToken = getCookieValue("devhttp_csrf");
  return {
    "content-type": "application/json",
    ...(isDesktopApiClient() ? { "x-devhttp-client": "desktop" } : {}),
    ...(csrfToken ? { "x-csrf-token": decodeURIComponent(csrfToken) } : {}),
  };
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  const method = String(init?.method ?? "GET").toUpperCase();
  if (!headers.has("content-type") && init?.body && typeof init.body === "string") {
    headers.set("content-type", "application/json");
  }
  if (!headers.has("x-csrf-token") && !["GET", "HEAD", "OPTIONS"].includes(method)) {
    const csrfToken = getCookieValue("devhttp_csrf");
    if (csrfToken) {
      headers.set("x-csrf-token", decodeURIComponent(csrfToken));
    }
  }
  if (!headers.has("x-devhttp-client") && isDesktopApiClient()) {
    headers.set("x-devhttp-client", "desktop");
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    credentials: "include",
    headers,
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Falha na chamada ${path}`);
  }

  return (await response.json()) as T;
}

function formatJsonSafely(value: string) {
  if (!value.trim()) {
    return "";
  }

  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value;
  }
}

function upsertById<T extends { id: string }>(items: T[], next: T) {
  const index = items.findIndex((item) => item.id === next.id);
  if (index === -1) {
    return [next, ...items];
  }

  return items.map((item) => (item.id === next.id ? next : item));
}

function normalizeProject(project: BootstrapProject): BootstrapProject {
  const fallbackCollectionId = project.collections[0]?.id;

  return {
    ...project,
    requests: project.requests.map((request) =>
      request.collectionId || !fallbackCollectionId
        ? request
        : { ...request, collectionId: fallbackCollectionId },
    ),
  };
}

function normalizeBootstrap(data: BootstrapResponse): BootstrapResponse {
  return {
    ...data,
    projects: data.projects.map(normalizeProject),
  };
}

function truncateTabLabel(label: string, max = 22) {
  return label.length > max ? label.slice(0, max - 1) + "…" : label;
}

function buildImportSummary(result: PostmanImportResult) {
  const parts = [
    `${result.importedCount} requests importadas`,
    `${result.collectionsCreated} coleções criadas`,
  ];

  if (result.detectedVariables.length > 0) {
    const preview = result.detectedVariables.slice(0, 8).join(", ");
    const suffix =
      result.detectedVariables.length > 8
        ? ` e mais ${result.detectedVariables.length - 8}`
        : "";
    parts.push(`variáveis detectadas: ${preview}${suffix}`);
  }

  if (result.warnings.length > 0) {
    const preview = result.warnings.slice(0, 2).join(" | ");
    const suffix =
      result.warnings.length > 2 ? ` | +${result.warnings.length - 2} avisos` : "";
    parts.push(`avisos: ${preview}${suffix}`);
  }

  if (result.environmentImported) {
    parts.push(
      `${result.environmentImported.updated ? "ambiente atualizado" : "ambiente criado"}: ${result.environmentImported.name}`,
    );
  }

  return parts.join(" · ");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isPostmanCollectionFile(value: unknown): value is PostmanCollectionFile {
  if (!isRecord(value)) {
    return false;
  }

  const schema =
    isRecord(value.info) && typeof value.info.schema === "string" ? value.info.schema : "";

  return Array.isArray(value.item) || schema.includes("collection");
}

function isPostmanEnvironmentFile(value: unknown): value is PostmanEnvironmentFile {
  return isRecord(value) && Array.isArray(value.values);
}

const selectClass =
  "h-8 rounded-lg border border-input bg-muted/50 pl-2.5 pr-8 text-sm text-foreground transition-colors focus:outline-none focus:ring-1 focus:ring-ring select-custom";

const METHOD_COLORS: Record<string, string> = {
  GET: "#247E4C",
  POST: "#A87D13",
  PUT: "#2552AA",
  PATCH: "#6546AB",
  DELETE: "#9F2F22",
  HEAD: "#247E4C",
  OPTIONS: "#B93B85",
};

function MethodSelect({
  value,
  onChange,
  methods,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  methods: string[];
  className?: string;
}) {
  const [anchor, setAnchor] = useState<{ x: number; y: number; width: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!anchor) return;
    function handleClick(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setAnchor(null);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [anchor]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={cn(
          "h-8 flex items-center gap-1.5 rounded-lg border border-input bg-muted/50 pl-2.5 pr-2 text-[0.8rem] font-mono font-bold transition-colors focus:outline-none focus:ring-1 focus:ring-ring hover:bg-muted/70 shrink-0",
          className,
        )}
        style={{ color: METHOD_COLORS[value] ?? "inherit" }}
        onClick={() => {
          if (anchor) { setAnchor(null); return; }
          const rect = triggerRef.current!.getBoundingClientRect();
          setAnchor({ x: rect.left, y: rect.bottom + 4, width: rect.width });
        }}
      >
        <span className="flex-1 text-left">{value}</span>
        <ChevronDown className="size-3.5 shrink-0 opacity-60" />
      </button>
      {anchor && createPortal(
        <div
          ref={panelRef}
          style={{ position: "fixed", left: anchor.x, top: anchor.y, minWidth: anchor.width, zIndex: 9999 }}
          className="rounded-lg border border-border bg-popover p-1 shadow-xl"
        >
          {methods.map((m) => (
            <button
              key={m}
              type="button"
              className="w-full rounded-md px-3 py-1.5 text-left text-[0.8rem] font-mono font-bold hover:bg-muted/60 transition-colors"
              style={{ color: METHOD_COLORS[m] ?? "inherit" }}
              onClick={() => { onChange(m); setAnchor(null); }}
            >
              {m}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </>
  );
}

function WorkspaceSelect({
  workspaceId,
  workspaces,
  onChange,
  className,
}: {
  workspaceId: string;
  workspaces: WorkspaceMembership[];
  onChange: (id: string) => void;
  className?: string;
}) {
  const [anchor, setAnchor] = useState<{ x: number; y: number; width: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!anchor) return;
    function handleClick(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setAnchor(null);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [anchor]);

  const selected = workspaces.find((m) => m.workspace.id === workspaceId);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={cn(
          "h-8 flex items-center gap-1.5 rounded-lg border border-input bg-muted/50 pl-2.5 pr-2 text-sm text-foreground transition-colors focus:outline-none focus:ring-1 focus:ring-ring hover:bg-muted/70 flex-1",
          className,
        )}
        onClick={() => {
          if (anchor) { setAnchor(null); return; }
          const rect = triggerRef.current!.getBoundingClientRect();
          setAnchor({ x: rect.left, y: rect.bottom + 4, width: rect.width });
        }}
      >
        <span className="flex-1 text-left truncate">{selected?.workspace.name}</span>
        <ChevronDown className="size-3.5 shrink-0 opacity-60" />
      </button>
      {anchor && createPortal(
        <div
          ref={panelRef}
          style={{ position: "fixed", left: anchor.x, top: anchor.y, minWidth: anchor.width, zIndex: 9999 }}
          className="rounded-lg border border-border bg-popover p-1 shadow-xl"
        >
          {workspaces.map(({ workspace }) => (
            <button
              key={workspace.id}
              type="button"
              className="w-full rounded-md px-3 py-1.5 text-left text-sm text-foreground hover:bg-muted/60 transition-colors"
              onClick={() => { onChange(workspace.id); setAnchor(null); }}
            >
              {workspace.name}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </>
  );
}

function EnvironmentSelect({
  value,
  environments,
  onChange,
  disabled,
}: {
  value: string;
  environments: Environment[];
  onChange: (id: string) => void;
  disabled?: boolean;
}) {
  const [anchor, setAnchor] = useState<{ x: number; y: number; width: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!anchor) return;
    function handleClick(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setAnchor(null);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [anchor]);

  const selected = environments.find((e) => e.id === value);
  const label = selected?.name ?? "Sem ambiente";

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        className={cn(
          "h-8 w-full flex items-center gap-1.5 rounded-lg border border-input bg-muted/50 pl-2.5 pr-2 text-sm text-foreground transition-colors focus:outline-none focus:ring-1 focus:ring-ring hover:bg-muted/70",
          disabled && "opacity-50 cursor-not-allowed pointer-events-none",
        )}
        onClick={() => {
          if (anchor) { setAnchor(null); return; }
          const rect = triggerRef.current!.getBoundingClientRect();
          setAnchor({ x: rect.left, y: rect.bottom + 4, width: rect.width });
        }}
      >
        <span className="flex-1 text-left truncate">{label}</span>
        <ChevronDown className="size-3.5 shrink-0 opacity-60" />
      </button>
      {anchor && createPortal(
        <div
          ref={panelRef}
          style={{ position: "fixed", left: anchor.x, top: anchor.y, minWidth: anchor.width, zIndex: 9999 }}
          className="rounded-lg border border-border bg-popover p-1 shadow-xl"
        >
          <button
            type="button"
            className="w-full rounded-md px-3 py-1.5 text-left text-sm text-muted-foreground hover:bg-muted/60 transition-colors"
            onClick={() => { onChange(""); setAnchor(null); }}
          >
            Sem ambiente
          </button>
          {environments.map((env) => (
            <button
              key={env.id}
              type="button"
              className="w-full rounded-md px-3 py-1.5 text-left text-sm text-foreground hover:bg-muted/60 transition-colors"
              onClick={() => { onChange(env.id); setAnchor(null); }}
            >
              {env.name}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </>
  );
}

function getInitials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("") || "DH";
}

function resolveTheme(themeMode: ThemeMode) {
  if (
    themeMode === "system" &&
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
  ) {
    return "dark";
  }

  return themeMode === "system" ? "light" : themeMode;
}

function applyTheme(themeMode: ThemeMode) {
  const nextTheme = resolveTheme(themeMode);
  document.documentElement.classList.remove("dark", "light");
  document.documentElement.classList.add(nextTheme);
  localStorage.setItem("devhttp-theme", themeMode);
  void window.devHttpDesktop?.setTitleBarTheme?.(nextTheme);
}

function isDesktopTitleBarInteractiveTarget(target: EventTarget | null) {
  return target instanceof HTMLElement && Boolean(target.closest("[data-titlebar-no-drag='true']"));
}

function emptyProfileForm(user?: User | null): ProfileFormState {
  return {
    name: user?.name ?? "",
    email: user?.email ?? "",
    avatarUrl: user?.avatarUrl ?? "",
  };
}

function emptyPasswordForm(): PasswordFormState {
  return {
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  };
}

function SortableRequestItem({
  request,
  isActive,
  effectiveMethod,
  canRename,
  onSelect,
  onRename,
  onDuplicate,
}: {
  request: BootstrapRequest;
  isActive: boolean;
  effectiveMethod: string;
  canRename: boolean;
  onSelect: (req: BootstrapRequest) => void;
  onRename: (id: string, name: string) => void;
  onDuplicate: (req: BootstrapRequest) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: request.id,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "group/request flex items-center gap-1 w-full min-w-0 pl-2 pr-1 py-px text-xs rounded transition-colors",
        isActive
          ? "text-foreground bg-primary/8"
          : "text-muted-foreground hover:text-foreground hover:bg-white/5",
      )}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        className="flex items-center justify-center w-4 h-4 opacity-0 group-hover/request:opacity-100 text-muted-foreground cursor-grab active:cursor-grabbing shrink-0"
        title="Arrastar"
      >
        <GripVertical className="h-3 w-3" />
      </button>
      <button
        type="button"
        onClick={() => onSelect(request)}
        className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
      >
        <span className={`method-pill ${effectiveMethod.toLowerCase()} !text-[0.55rem]`}>
          {effectiveMethod}
        </span>
        <span className="truncate min-w-0 text-[0.8rem]">{request.name}</span>
      </button>
      {canRename ? (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onDuplicate(request);
          }}
          className="flex items-center justify-center w-5 h-5 rounded opacity-0 group-hover/request:opacity-100 hover:bg-muted/50 text-muted-foreground hover:text-foreground transition-all shrink-0"
          title="Duplicar request"
        >
          <Copy className="h-3 w-3" />
        </button>
      ) : null}
      {canRename ? (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onRename(request.id, request.name);
          }}
          className="flex items-center justify-center w-5 h-5 rounded opacity-0 group-hover/request:opacity-100 hover:bg-muted/50 text-muted-foreground hover:text-foreground transition-all shrink-0"
          title="Renomear request"
        >
          <Pencil className="h-3 w-3" />
        </button>
      ) : null}
    </div>
  );
}

function SortableCollectionItem({
  collection,
  collectionRequests,
  isExpanded,
  isSelected,
  canRename,
  activeTabId,
  tabMethodByRequestId,
  onSelectCollection,
  onRenameCollection,
  onOpenMenu,
  onSelectRequest,
  onRenameRequest,
  onDuplicateRequest,
  onRequestDragEnd,
}: {
  collection: BootstrapCollection;
  collectionRequests: BootstrapRequest[];
  isExpanded: boolean;
  isSelected: boolean;
  canRename: boolean;
  activeTabId: string;
  tabMethodByRequestId: Map<string, string>;
  onSelectCollection: (id: string) => void;
  onRenameCollection: (id: string, name: string) => void;
  onOpenMenu: (id: string, x: number, y: number) => void;
  onSelectRequest: (req: BootstrapRequest) => void;
  onRenameRequest: (id: string, name: string) => void;
  onDuplicateRequest: (req: BootstrapRequest) => void;
  onRequestDragEnd: (collectionId: string, event: DragEndEvent) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: collection.id,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };
  return (
    <div ref={setNodeRef} style={style} className="grid gap-1">
      <div className="flex items-center gap-1 group/collection">
        <button
          type="button"
          {...attributes}
          {...listeners}
          className="flex items-center justify-center w-4 h-4 opacity-0 group-hover/collection:opacity-100 text-muted-foreground cursor-grab active:cursor-grabbing shrink-0"
          title="Arrastar"
        >
          <GripVertical className="h-3 w-3" />
        </button>
        <button
          type="button"
          onClick={() => onSelectCollection(collection.id)}
          className={cn(
            "flex-1 flex items-center gap-1 px-1 py-0.5 text-xs rounded hover:bg-white/5 transition-colors min-w-0 text-left",
            isSelected ? "text-foreground" : "text-muted-foreground hover:text-foreground",
          )}
        >
          <span className="text-[0.65rem] shrink-0 opacity-70">{isExpanded ? "▾" : "▸"}</span>
          <span className="truncate min-w-0 text-[0.8rem]">{collection.name}</span>
        </button>
        {canRename ? (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onRenameCollection(collection.id, collection.name);
            }}
            className="flex items-center justify-center w-5 h-5 rounded opacity-0 group-hover/collection:opacity-100 hover:bg-muted/50 text-muted-foreground hover:text-foreground transition-all shrink-0"
            title="Renomear coleção"
          >
            <Pencil className="h-3 w-3" />
          </button>
        ) : null}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            const rect = e.currentTarget.getBoundingClientRect();
            onOpenMenu(collection.id, rect.left, rect.bottom + 4);
          }}
          className="flex items-center justify-center w-5 h-5 rounded opacity-0 group-hover/collection:opacity-100 hover:bg-muted/50 text-muted-foreground hover:text-foreground transition-all shrink-0"
          title="Adicionar"
        >
          +
        </button>
      </div>
      {isExpanded ? (
        <div className="grid">
          {collectionRequests.length > 0 ? (
            <DndContext
              collisionDetection={closestCenter}
              onDragEnd={(event) => onRequestDragEnd(collection.id, event)}
            >
              <SortableContext
                items={collectionRequests.map((r) => r.id)}
                strategy={verticalListSortingStrategy}
              >
                {collectionRequests.map((request) => (
                  <SortableRequestItem
                    key={request.id}
                    request={request}
                    isActive={activeTabId === request.id}
                    effectiveMethod={tabMethodByRequestId.get(request.id) ?? request.method}
                    canRename={canRename}
                    onSelect={onSelectRequest}
                    onRename={onRenameRequest}
                    onDuplicate={onDuplicateRequest}
                  />
                ))}
              </SortableContext>
            </DndContext>
          ) : (
            <p className="pl-4 text-xs text-muted-foreground">Sem requests nesta colecao.</p>
          )}
        </div>
      ) : null}
    </div>
  );
}

function SortableEnvironmentItem({
  environment,
  isActive,
  onSelect,
}: {
  environment: Environment;
  isActive: boolean;
  onSelect: (id: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: environment.id,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };
  return (
    <div ref={setNodeRef} style={style} className="flex items-center gap-1 group/env">
      <button
        type="button"
        {...attributes}
        {...listeners}
        className="flex items-center justify-center w-4 h-4 opacity-0 group-hover/env:opacity-100 text-muted-foreground cursor-grab active:cursor-grabbing shrink-0"
        title="Arrastar"
      >
        <GripVertical className="h-3 w-3" />
      </button>
      <button
        type="button"
        onClick={() => onSelect(environment.id)}
        className={cn(
          "flex items-center gap-1.5 w-full min-w-0 px-1 py-0.5 text-xs rounded transition-colors text-left",
          isActive
            ? "text-foreground"
            : "text-muted-foreground hover:text-foreground hover:bg-white/5",
        )}
      >
        <span className="text-[0.6rem] shrink-0 opacity-50">○</span>
        <span className="truncate min-w-0">{environment.name}</span>
      </button>
    </div>
  );
}

function SortableTab({
  tab,
  isActive,
  envName,
  fullLabel,
  method,
  isEnvironmentDirty,
  environmentConflictId,
  selectedEnvironmentId,
  onActivate,
  onClose,
}: {
  tab: EditorTab;
  isActive: boolean;
  envName: string;
  fullLabel: string;
  method: string | null;
  isEnvironmentDirty: boolean;
  environmentConflictId: string;
  selectedEnvironmentId: string;
  onActivate: () => void;
  onClose: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: tab.tabId,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "group flex items-center gap-1.5 px-3 py-1.5 border-b-2 whitespace-nowrap text-xs shrink-0 transition-colors select-none",
        isActive
          ? "border-primary text-foreground bg-primary/5"
          : "border-transparent text-muted-foreground hover:text-foreground hover:bg-white/3",
      )}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        onClick={(event) => event.stopPropagation()}
        className="flex items-center justify-center w-4 h-4 opacity-0 group-hover:opacity-60 text-muted-foreground cursor-grab active:cursor-grabbing shrink-0"
        title="Arrastar aba"
      >
        <GripVertical className="h-3 w-3" />
      </button>
      <button
        type="button"
        onClick={onActivate}
        className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
      >
      {method && (
        <span className={`method-pill ${method.toLowerCase()} !text-[0.6rem]`}>
          {method}
        </span>
      )}
      <span title={fullLabel} className="max-w-[140px] truncate">
        {truncateTabLabel(fullLabel)}
      </span>
      {tab.type === "request" && tab.hasRemoteConflict ? (
        <span
          className="h-2 w-2 rounded-full bg-red-500 shrink-0"
          title="Conflito com alteração remota"
        />
      ) : null}
      {tab.type === "request" && !tab.hasRemoteConflict && tab.isDirty ? (
        <span
          className="h-2 w-2 rounded-full bg-yellow-400 shrink-0"
          title="Alterações não salvas"
        />
      ) : null}
      {tab.type === "environment" &&
      environmentConflictId === tab.environmentId ? (
        <span
          className="h-2 w-2 rounded-full bg-red-500 shrink-0"
          title="Conflito com alteração remota"
        />
      ) : null}
      {tab.type === "environment" &&
      environmentConflictId !== tab.environmentId &&
      isEnvironmentDirty &&
      tab.environmentId === selectedEnvironmentId ? (
        <span
          className="h-2 w-2 rounded-full bg-yellow-400 shrink-0"
          title="Alterações não salvas"
        />
      ) : null}
      </button>
      <button
        type="button"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => { e.stopPropagation(); onClose(); }}
        className="ml-0.5 flex items-center justify-center w-4 h-4 rounded opacity-0 group-hover:opacity-60 hover:!opacity-100 hover:text-destructive transition-opacity"
        title="Fechar"
      >
        ×
      </button>
    </div>
  );
}

export function DevHttpClient() {
  const router = useRouter();
  const [auth, setAuth] = useState<AuthResponse | null>(null);
  const [bootstrap, setBootstrap] = useState<BootstrapResponse | null>(null);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [workspaceMembers, setWorkspaceMembers] = useState<WorkspaceMember[]>([]);
  const [workspaceInvites, setWorkspaceInvites] = useState<WorkspaceInvite[]>([]);
  const [isSessionLoading, setIsSessionLoading] = useState(true);
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [selectedCollectionId, setSelectedCollectionId] = useState("");
  const [selectedEnvironmentId, setSelectedEnvironmentId] = useState("");
  const [openTabs, setOpenTabs] = useState<EditorTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string>("");
  const [collectionMenu, setCollectionMenu] = useState<{ id: string; projectId: string; x: number; y: number } | null>(null);
  const [feedback, setFeedback] = useState("");
  const [hasDesktopBridge, setHasDesktopBridge] = useState(
    () => typeof window !== "undefined" && Boolean(window.devHttpDesktop?.executeLocalRequest),
  );
  const desktopPlatform =
    typeof window !== "undefined" ? (window.devHttpDesktop?.platform ?? null) : null;
  const usesNativeWindowControls = hasDesktopBridge && desktopPlatform !== "darwin";
  const [isWindowMaximized, setIsWindowMaximized] = useState(false);
  const [hasLocalAgent, setHasLocalAgent] = useState(false);
  const [localAgentToken, setLocalAgentToken] = useState("");
  const [isPending, startTransition] = useTransition();
  const [activeTab, setActiveTab] = useState<"headers" | "queryParams" | "body" | "script">(
    "headers",
  );
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [isProjectMinimized, setIsProjectMinimized] = useState(false);
  const [projectSearch, setProjectSearch] = useState("");
  const [createModalType, setCreateModalType] = useState<CreateModalType>(null);
  const [createName, setCreateName] = useState("");
  const [renameModal, setRenameModal] = useState<RenameModalState>(null);
  const [renameName, setRenameName] = useState("");
  const [deleteProjectTarget, setDeleteProjectTarget] = useState<BootstrapProject | null>(null);
  const [deleteProjectConfirmation, setDeleteProjectConfirmation] = useState("");
  const [pendingCloseTabId, setPendingCloseTabId] = useState<string | null>(null);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [expandedCollectionIds, setExpandedCollectionIds] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [sidebarWidth, setSidebarWidth] = useState(320);
  const [isDesktopEditorLayout, setIsDesktopEditorLayout] = useState(false);
  const isResizingRef = useRef(false);
  const resizeStartXRef = useRef(0);
  const resizeStartWidthRef = useRef(0);
  const [requestPaneRatio, setRequestPaneRatio] = useState(0.58);
  const [responseView, setResponseView] = useState<"response" | "console">("response");
  const requestResponseContainerRef = useRef<HTMLDivElement | null>(null);
  const isRequestResponseResizingRef = useRef(false);
  const requestResponseStartYRef = useRef(0);
  const requestResponseStartRatioRef = useRef(0);
  const titleBarPointerIdRef = useRef<number | null>(null);
  const isTitleBarDraggingRef = useRef(false);
  const [savedEnvironmentSnapshot, setSavedEnvironmentSnapshot] = useState("");
  const [environmentConflictId, setEnvironmentConflictId] = useState("");
  const [isEnvironmentSaving, setIsEnvironmentSaving] = useState(false);
  const [themeMode, setThemeMode] = useState<ThemeMode>("system");
  const [savedThemeMode, setSavedThemeMode] = useState<ThemeMode>("system");
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("profile");
  const [profileForm, setProfileForm] = useState<ProfileFormState>(emptyProfileForm());
  const [savedProfileForm, setSavedProfileForm] = useState<ProfileFormState>(emptyProfileForm());
  const [passwordForm, setPasswordForm] = useState<PasswordFormState>(emptyPasswordForm());
  const [isProfileSaving, setIsProfileSaving] = useState(false);
  const [isAppearanceSaving, setIsAppearanceSaving] = useState(false);
  const [isPasswordSaving, setIsPasswordSaving] = useState(false);
  const [avatarSource, setAvatarSource] = useState("");
  const [avatarZoom, setAvatarZoom] = useState(1);
  const [avatarOffsetX, setAvatarOffsetX] = useState(0);
  const [avatarOffsetY, setAvatarOffsetY] = useState(0);
  const [workspaceInviteForm, setWorkspaceInviteForm] = useState<WorkspaceInviteFormState>({
    email: "",
    role: "viewer",
  });
  const [isWorkspaceSaving, setIsWorkspaceSaving] = useState(false);
  const [notificationsAnchor, setNotificationsAnchor] = useState<{ x: number; y: number } | null>(null);
  const [newMenuAnchor, setNewMenuAnchor] = useState<{ x: number; y: number } | null>(null);
  const [isEditorNewMenuOpen, setIsEditorNewMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement | null>(null);
  const notificationsRef = useRef<HTMLDivElement | null>(null);
  const notificationsPanelRef = useRef<HTMLDivElement | null>(null);
  const newMenuRef = useRef<HTMLDivElement | null>(null);
  const newMenuPanelRef = useRef<HTMLDivElement | null>(null);
  const editorNewMenuRef = useRef<HTMLDivElement | null>(null);
  const skipNextProjectResetRef = useRef(false);
  const desktopSnapshotReadyRef = useRef(false);
  const desktopSnapshotSaveTimeoutRef = useRef<number | null>(null);
  const desktopUpdateCheckStartedRef = useRef(false);
  const realtimeSocketRef = useRef<ReturnType<typeof createRealtimeSocket> | null>(null);
  const realtimeRefreshInFlightRef = useRef(false);
  const latestRealtimeStateRef = useRef<{
    auth: AuthResponse | null;
    bootstrap: BootstrapResponse | null;
    openTabs: EditorTab[];
    activeTabId: string;
    selectedProjectId: string;
    selectedCollectionId: string;
    selectedEnvironmentId: string;
    activeTab: "headers" | "queryParams" | "body" | "script";
    expandedCollectionIds: string[];
    sidebarCollapsed: boolean;
    sidebarWidth: number;
    requestPaneRatio: number;
    responseView: "response" | "console";
    savedEnvironmentSnapshot: string;
    isSettingsOpen: boolean;
    settingsTab: SettingsTab;
  }>({
    auth: null,
    bootstrap: null,
    openTabs: [],
    activeTabId: "",
    selectedProjectId: "",
    selectedCollectionId: "",
    selectedEnvironmentId: "",
    activeTab: "headers",
    expandedCollectionIds: [],
    sidebarCollapsed: false,
    sidebarWidth: 320,
    requestPaneRatio: 0.58,
    responseView: "response",
    savedEnvironmentSnapshot: "",
    isSettingsOpen: false,
    settingsTab: "profile",
  });

  const selectedProject = useMemo(
    () => bootstrap?.projects.find((project) => project.id === selectedProjectId) ?? null,
    [bootstrap, selectedProjectId],
  );

  const selectedEnvironment = useMemo(
    () =>
      selectedProject?.environments.find((environment) => environment.id === selectedEnvironmentId) ??
      null,
    [selectedEnvironmentId, selectedProject],
  );

  const filteredProjects = useMemo(() => {
    const search = projectSearch.trim().toLowerCase();
    if (!search) {
      return bootstrap?.projects ?? [];
    }

    return (bootstrap?.projects ?? []).filter((project) =>
      project.name.toLowerCase().includes(search),
    );
  }, [bootstrap?.projects, projectSearch]);

  const tabMethodByRequestId = useMemo(() => {
    const map = new Map<string, string>();
    for (const tab of openTabs) {
      if (tab.type === "request" && tab.draft.id) {
        map.set(tab.draft.id, tab.draft.method);
      }
    }
    return map;
  }, [openTabs]);

  const membershipRole = bootstrap?.membership.role as WorkspaceMember["role"] | undefined;
  const canRenameWorkspace = membershipRole === "owner" || membershipRole === "admin";
  const canRenameProjectEntities =
    membershipRole === "owner" || membershipRole === "admin" || membershipRole === "editor";

  const isEnvironmentDirty = useMemo(() => {
    if (!selectedEnvironment) return false;
    return JSON.stringify(selectedEnvironment) !== savedEnvironmentSnapshot;
  }, [selectedEnvironment, savedEnvironmentSnapshot]);
  const isProfileDirty = useMemo(
    () => JSON.stringify(profileForm) !== JSON.stringify(savedProfileForm) || Boolean(avatarSource),
    [avatarSource, profileForm, savedProfileForm],
  );
  const isAppearanceDirty = themeMode !== savedThemeMode;
  const isPasswordDirty = Boolean(
    passwordForm.currentPassword || passwordForm.newPassword || passwordForm.confirmPassword,
  );

  const activeEditorTab = openTabs.find(t => t.tabId === activeTabId) ?? null;

  const draftRequest: BootstrapRequest =
    activeEditorTab?.type === "request"
      ? activeEditorTab.draft
      : defaultRequest(selectedProject?.id);

  const execution: ExecutionResponse | null =
    activeEditorTab?.type === "request" ? activeEditorTab.execution : null;
  const responseError =
    activeEditorTab?.type === "request" ? activeEditorTab.responseError : null;
  const isExecuting =
    activeEditorTab?.type === "request" ? activeEditorTab.isExecuting : false;
  const isSaving =
    activeEditorTab?.type === "request" ? activeEditorTab.isSaving : false;
  const isDirty =
    activeEditorTab?.type === "request" ? activeEditorTab.isDirty : false;

  const activePanel: "request" | "environment" =
    activeEditorTab?.type === "environment" ? "environment" : "request";

  const pendingCloseTab =
    pendingCloseTabId
      ? openTabs.find(
          (tab): tab is RequestEditorTab => tab.tabId === pendingCloseTabId && tab.type === "request",
        ) ?? null
      : null;

  function handleDesktopTitleBarDoubleClick(event: ReactMouseEvent<HTMLDivElement>) {
    if (!hasDesktopBridge || desktopPlatform === "darwin") {
      return;
    }

    if (isDesktopTitleBarInteractiveTarget(event.target)) {
      return;
    }

    event.preventDefault();
    void window.devHttpDesktop?.maximizeWindow();
  }

  function handleDesktopTitleBarPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (!hasDesktopBridge || event.button !== 0) {
      return;
    }

    if (isDesktopTitleBarInteractiveTarget(event.target)) {
      return;
    }

    if (!isWindowMaximized) {
      return;
    }

    titleBarPointerIdRef.current = event.pointerId;
    isTitleBarDraggingRef.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
    void window.devHttpDesktop?.beginTitleBarDrag({
      screenX: event.screenX,
      screenY: event.screenY,
      clientX: event.clientX,
      clientY: event.clientY,
      viewportWidth: window.innerWidth,
    });
  }

  function handleDesktopTitleBarPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!isTitleBarDraggingRef.current || titleBarPointerIdRef.current !== event.pointerId) {
      return;
    }

    event.preventDefault();
    void window.devHttpDesktop?.updateTitleBarDrag({
      screenX: event.screenX,
      screenY: event.screenY,
    });
  }

  function finishDesktopTitleBarDrag(event: ReactPointerEvent<HTMLDivElement>) {
    if (!isTitleBarDraggingRef.current || titleBarPointerIdRef.current !== event.pointerId) {
      return;
    }

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    isTitleBarDraggingRef.current = false;
    titleBarPointerIdRef.current = null;
    void window.devHttpDesktop?.endTitleBarDrag();
  }

  useEffect(() => {
    latestRealtimeStateRef.current = {
      auth,
      bootstrap,
      openTabs,
      activeTabId,
      selectedProjectId,
      selectedCollectionId,
      selectedEnvironmentId,
      activeTab,
      expandedCollectionIds,
      sidebarCollapsed,
      sidebarWidth,
      requestPaneRatio,
      responseView,
      savedEnvironmentSnapshot,
      isSettingsOpen,
      settingsTab,
    };
  }, [
    activeTab,
    activeTabId,
    auth,
    bootstrap,
    expandedCollectionIds,
    isSettingsOpen,
    openTabs,
    requestPaneRatio,
    responseView,
    savedEnvironmentSnapshot,
    selectedCollectionId,
    selectedEnvironmentId,
    selectedProjectId,
    settingsTab,
    sidebarCollapsed,
    sidebarWidth,
  ]);

  useEffect(() => {
    setHasDesktopBridge(typeof window !== "undefined" && Boolean(window.devHttpDesktop?.executeLocalRequest));
  }, []);

  useEffect(() => {
    if (!hasDesktopBridge) return;
    void window.devHttpDesktop?.isMaximized().then(setIsWindowMaximized);
    window.devHttpDesktop?.onMaximizeChange(setIsWindowMaximized);
  }, [hasDesktopBridge]);

  useEffect(() => {
    return () => {
      if (!isTitleBarDraggingRef.current) {
        return;
      }

      isTitleBarDraggingRef.current = false;
      titleBarPointerIdRef.current = null;
      void window.devHttpDesktop?.endTitleBarDrag();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function detectLocalAgent() {
      if (hasDesktopBridge) {
        if (!cancelled) {
          setHasLocalAgent(false);
          setLocalAgentToken("");
        }
        return;
      }

      const connection = await connectLocalAgent();
      if (!cancelled) {
        setHasLocalAgent(connection.available);
        setLocalAgentToken(connection.token);
      }
    }

    void detectLocalAgent();
    return () => {
      cancelled = true;
    };
  }, [hasDesktopBridge]);

  useEffect(() => {
    function syncEditorLayout() {
      setIsDesktopEditorLayout(window.innerWidth >= 1024);
    }

    syncEditorLayout();
    window.addEventListener("resize", syncEditorLayout);
    return () => window.removeEventListener("resize", syncEditorLayout);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let restoredSession = false;

    async function restoreSession() {
      try {
        const session = await requestJson<SessionResponse>("/auth/me");
        if (!cancelled) {
          restoredSession = true;
          setAuth(session);
        }
      } catch {
        if (!cancelled) {
          setAuth(null);
        }
      } finally {
        if (!cancelled && !restoredSession) {
          setIsSessionLoading(false);
        }
      }
    }

    void restoreSession();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!isSessionLoading && !auth) {
      router.replace("/login");
    }
  }, [auth, isSessionLoading, router]);

  useEffect(() => {
    if (!auth) {
      setBootstrap(null);
      setEnvironmentConflictId("");
      desktopSnapshotReadyRef.current = false;
      return;
    }

    desktopSnapshotReadyRef.current = false;
    setIsSessionLoading(true);
    startTransition(async () => {
      try {
        let nextBootstrap = normalizeBootstrap(
          await requestJson<BootstrapResponse>(`/workspaces/${auth.workspaceId}/bootstrap`, {
            headers: authHeaders(auth.token),
          }),
        );
        setBootstrap(nextBootstrap);

        const defaultUiState = buildDefaultWorkspaceUiState(nextBootstrap);
        let nextSidebarCollapsed = false;
        try {
          const prefs = await requestJson<UserPreferences>("/preferences", {
            headers: authHeaders(auth.token),
          });
          nextSidebarCollapsed = prefs.sidebarCollapsed ?? false;
          setSidebarCollapsed(nextSidebarCollapsed);
          const nextThemeMode = prefs.themeMode ?? "system";
          setThemeMode(nextThemeMode);
          setSavedThemeMode(nextThemeMode);
          applyTheme(nextThemeMode);
        } catch {
          // noop
        }

        let nextUiState = defaultUiState;
        let nextSidebarWidth = 320;

        const snapshot = hasDesktopSnapshotBridge()
          ? ((await window.devHttpDesktop!.getWorkspaceSnapshot(
              auth.user.id,
            )) as DesktopWorkspaceSnapshot | null)
          : readBrowserWorkspaceSnapshot(auth.user.id, auth.workspaceId);

        if (snapshot) {
          const restoredUiState = restoreWorkspaceUiState(nextBootstrap, snapshot);
          if (restoredUiState) {
            nextUiState = restoredUiState;
            nextBootstrap = restoredUiState.bootstrap;
            setBootstrap(restoredUiState.bootstrap);
            nextSidebarCollapsed = restoredUiState.sidebarCollapsed ?? nextSidebarCollapsed;
            nextSidebarWidth = restoredUiState.sidebarWidth ?? nextSidebarWidth;
          }
        }

        skipNextProjectResetRef.current = true;
        setSelectedProjectId(nextUiState.selectedProjectId);
        setSelectedCollectionId(nextUiState.selectedCollectionId);
        setSelectedEnvironmentId(nextUiState.selectedEnvironmentId);
        setExpandedCollectionIds(nextUiState.expandedCollectionIds);
        setOpenTabs(nextUiState.openTabs);
        setActiveTabId(nextUiState.activeTabId);
        setActiveTab(nextUiState.activeTab);
        setSidebarCollapsed(nextSidebarCollapsed);
        setSidebarWidth(nextSidebarWidth);
        setRequestPaneRatio(nextUiState.requestPaneRatio ?? 0.58);
        setResponseView(nextUiState.responseView ?? "response");
        setSavedEnvironmentSnapshot(nextUiState.savedEnvironmentSnapshot);
        setEnvironmentConflictId(
          nextUiState.hasEnvironmentRemoteConflict ? nextUiState.selectedEnvironmentId : "",
        );
        desktopSnapshotReadyRef.current = true;
      } catch (error) {
        setFeedback(error instanceof Error ? error.message : "Falha ao carregar workspace.");
      } finally {
        setIsSessionLoading(false);
      }
    });
  }, [auth, hasDesktopBridge]);

  useEffect(() => {
    if (!auth) {
      setNotifications([]);
      return;
    }

    requestJson<Notification[]>("/notifications", {
      headers: authHeaders(auth.token),
    })
      .then((items) => setNotifications(items))
      .catch(() => {});
  }, [auth]);

  useEffect(() => {
    if (!auth) {
      realtimeSocketRef.current?.disconnect();
      realtimeSocketRef.current = null;
      return;
    }

    const socket = createRealtimeSocket(API_BASE_URL);
    realtimeSocketRef.current = socket;

    socket.on("workspace.changed", (event) => {
      const current = latestRealtimeStateRef.current;
      if (event.workspaceId !== current.auth?.workspaceId) {
        return;
      }
      // Eventos disparados pelo próprio usuário já foram tratados por saveRequestTab(),
      // que atualiza o estado local otimisticamente (isDirty=false, hasRemoteConflict=false).
      // Chamar refreshWorkspaceFromServer() aqui causaria race condition: o snapshot em
      // latestRealtimeStateRef ainda tem isDirty=true (stale) e restoreWorkspaceUiState
      // preservaria esse valor incorretamente, sobrescrevendo o estado correto do save.
      if (event.actorUserId === current.auth?.user.id) {
        return;
      }
      void refreshWorkspaceFromServer(event);
    });

    socket.on("user.changed", (event) => {
      const current = latestRealtimeStateRef.current;
      if (event.userId !== current.auth?.user.id) {
        return;
      }
      void refreshUserRealtimeState(event);
    });

    socket.on("connect", () => {
      if (latestRealtimeStateRef.current.bootstrap) {
        void refreshWorkspaceFromServer();
      }
      void refreshNotifications();
    });

    return () => {
      socket.disconnect();
      if (realtimeSocketRef.current === socket) {
        realtimeSocketRef.current = null;
      }
    };
  }, [auth]);

  useEffect(() => {
    if (
      !hasDesktopBridge ||
      isSessionLoading ||
      !window.devHttpDesktop?.checkForUpdates ||
      desktopUpdateCheckStartedRef.current
    ) {
      return;
    }

    desktopUpdateCheckStartedRef.current = true;

    void window.devHttpDesktop.checkForUpdates().then((update: DesktopUpdateCheckResult) => {
      if (!update.available || !update.latestVersion) {
        return;
      }

      const targetUrl = update.assetUrl || update.releaseUrl;
      toast("Nova versão do DevHttp disponível.", {
        description: `Versão ${update.latestVersion} disponível para download.`,
        action: targetUrl && window.devHttpDesktop?.openUpdateUrl
          ? {
              label: "Atualizar",
              onClick: () => {
                void window.devHttpDesktop?.openUpdateUrl(targetUrl);
              },
            }
          : undefined,
      });
    });
  }, [hasDesktopBridge, isSessionLoading]);

  useEffect(() => {
    if (!selectedProject) {
      return;
    }

    setSelectedEnvironmentId((current) => {
      if (selectedProject.environments.some((environment) => environment.id === current)) {
        return current;
      }
      return selectedProject.environments[0]?.id ?? "";
    });

    setSelectedCollectionId((current) => {
      if (selectedProject.collections.some((collection) => collection.id === current)) {
        return current;
      }
      return (
        selectedProject.requests[0]?.collectionId ??
        selectedProject.collections[0]?.id ??
        ""
      );
    });

    setExpandedCollectionIds((current) => {
      const nextIds = current.filter((id) =>
        selectedProject.collections.some((collection) => collection.id === id),
      );
      if (nextIds.length > 0) {
        return nextIds;
      }

      const firstCollectionId =
        selectedProject.requests[0]?.collectionId ?? selectedProject.collections[0]?.id;
      return firstCollectionId ? [firstCollectionId] : [];
    });
  }, [selectedProject]);

  useEffect(() => {
    if (!selectedProject) return;
    if (skipNextProjectResetRef.current) {
      skipNextProjectResetRef.current = false;
      return;
    }
    const firstRequest = selectedProject.requests[0];
    const tabs: EditorTab[] = firstRequest
      ? [createRequestEditorTab(firstRequest)]
      : [];
    setOpenTabs(tabs);
    setActiveTabId(tabs[0]?.tabId ?? "");
  }, [selectedProjectId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!auth || !bootstrap || !desktopSnapshotReadyRef.current) {
      return;
    }

    if (desktopSnapshotSaveTimeoutRef.current) {
      window.clearTimeout(desktopSnapshotSaveTimeoutRef.current);
    }

    const snapshot = buildDesktopWorkspaceSnapshot(auth.user.id, bootstrap.workspace.id, bootstrap, openTabs, {
      selectedProjectId,
      selectedCollectionId,
      selectedEnvironmentId,
      activeTabId,
      activeTab,
      expandedCollectionIds,
      sidebarCollapsed,
      sidebarWidth,
      requestPaneRatio,
      responseView,
      savedEnvironmentSnapshot,
    });

    desktopSnapshotSaveTimeoutRef.current = window.setTimeout(() => {
      if (hasDesktopSnapshotBridge()) {
        void window.devHttpDesktop!.saveWorkspaceSnapshot(auth.user.id, snapshot);
        return;
      }

      saveBrowserWorkspaceSnapshot(auth.user.id, bootstrap.workspace.id, snapshot);
    }, 250);

    return () => {
      if (desktopSnapshotSaveTimeoutRef.current) {
        window.clearTimeout(desktopSnapshotSaveTimeoutRef.current);
      }
    };
  }, [
    activeTabId,
    auth,
    bootstrap,
    expandedCollectionIds,
    openTabs,
    activeTab,
    requestPaneRatio,
    responseView,
    savedEnvironmentSnapshot,
    selectedCollectionId,
    selectedEnvironmentId,
    selectedProjectId,
    sidebarCollapsed,
    sidebarWidth,
  ]);

  useEffect(() => {
    if (!collectionMenu) return;
    function handleClick() { setCollectionMenu(null); }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [collectionMenu]);

  useEffect(() => {
    const stored = localStorage.getItem("devhttp-theme") as ThemeMode | null;
    if (stored === "dark" || stored === "light" || stored === "system") {
      setThemeMode(stored);
      setSavedThemeMode(stored);
      applyTheme(stored);
      return;
    }

    applyTheme("system");
  }, []);

  useEffect(() => {
    if (themeMode !== "system") {
      return;
    }

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    function handleChange() {
      applyTheme("system");
    }

    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, [themeMode]);

  useEffect(() => {
    setSavedEnvironmentSnapshot(
      selectedEnvironment ? JSON.stringify(selectedEnvironment) : "",
    );
  }, [selectedEnvironmentId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!bootstrap?.user) {
      return;
    }

    const nextProfile = emptyProfileForm(bootstrap.user);
    setProfileForm(nextProfile);
    setSavedProfileForm(nextProfile);
    setAvatarSource("");
    setAvatarZoom(1);
    setAvatarOffsetX(0);
    setAvatarOffsetY(0);
  }, [bootstrap?.user]);

  useEffect(() => {
    if (!isUserMenuOpen) return;
    function handleClick(event: MouseEvent) {
      const target = event.target;
      if (target instanceof Node && userMenuRef.current?.contains(target)) {
        return;
      }
      setIsUserMenuOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [isUserMenuOpen]);

  useEffect(() => {
    if (!notificationsAnchor) return;

    function handleClick(event: MouseEvent) {
      const target = event.target;
      if (target instanceof Node && notificationsRef.current?.contains(target)) return;
      if (target instanceof Node && notificationsPanelRef.current?.contains(target)) return;
      setNotificationsAnchor(null);
    }

    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [notificationsAnchor]);

  useEffect(() => {
    if (!newMenuAnchor) return;
    function handleClick(event: MouseEvent) {
      const target = event.target;
      if (target instanceof Node && newMenuRef.current?.contains(target)) return;
      if (target instanceof Node && newMenuPanelRef.current?.contains(target)) return;
      setNewMenuAnchor(null);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [newMenuAnchor]);

  useEffect(() => {
    if (!isEditorNewMenuOpen) return;
    function handleClick(event: MouseEvent) {
      const target = event.target;
      if (target instanceof Node && editorNewMenuRef.current?.contains(target)) return;
      setIsEditorNewMenuOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [isEditorNewMenuOpen]);

  useEffect(() => {
    if (!isSettingsOpen) {
      return;
    }

    function handleSettingsEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        closeSettings();
      }
    }

    document.addEventListener("keydown", handleSettingsEscape);
    return () => document.removeEventListener("keydown", handleSettingsEscape);
  }, [isSettingsOpen, savedThemeMode, bootstrap?.user]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "s") {
        return;
      }

      const currentTab = openTabs.find(
        (tab): tab is RequestEditorTab => tab.tabId === activeTabId && tab.type === "request",
      );
      if (!currentTab) {
        return;
      }

      event.preventDefault();
      if (currentTab.isSaving) {
        return;
      }
      void saveRequestTab(currentTab.tabId);
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeTabId, openTabs, selectedCollectionId, selectedProjectId, auth]);

  async function saveRequestTab(tabId: string) {
    if (!auth || !selectedProject) {
      return null;
    }

    const currentTab = openTabs.find(
      (tab): tab is RequestEditorTab => tab.tabId === tabId && tab.type === "request",
    );
    if (!currentTab) {
      return null;
    }

    const nextCollectionId =
      currentTab.draft.collectionId ?? selectedCollectionId ?? selectedProject.collections[0]?.id;
    if (!nextCollectionId) {
      toast("Crie uma coleção antes de salvar uma request.");
      return null;
    }

    setOpenTabs((prev) => prev.map((tab) =>
      tab.tabId === tabId && tab.type === "request"
        ? { ...tab, isSaving: true }
        : tab,
    ));

    try {
      const payload = {
        ...currentTab.draft,
        collectionId: nextCollectionId,
        headers: meaningfulKeyValues(currentTab.draft.headers),
        queryParams: meaningfulKeyValues(currentTab.draft.queryParams),
        formData: meaningfulFormData(currentTab.draft.formData),
      };
      const saved = await requestJson<BootstrapRequest>(`/projects/${selectedProject.id}/requests`, {
        method: "POST",
        headers: authHeaders(auth.token),
        body: JSON.stringify(payload),
      });

      const savedDraft = saved.collectionId ? saved : { ...saved, collectionId: nextCollectionId };
      const savedSnapshot = serializeRequestSnapshot(savedDraft);

      setBootstrap((current) =>
        current
          ? {
              ...current,
              projects: current.projects.map((project) =>
                project.id === selectedProject.id
                  ? {
                      ...project,
                      requests: upsertById(project.requests, savedDraft),
                    }
                  : project,
              ),
            }
          : current,
      );
      setOpenTabs((prev) => prev.map((tab) =>
        tab.tabId === tabId && tab.type === "request"
          ? {
              ...tab,
              tabId: saved.id,
              draft: savedDraft,
              savedSnapshot,
              isDirty: false,
              isSaving: false,
              hasRemoteConflict: false,
              remoteConflictAt: undefined,
              remoteConflictReason: undefined,
            }
          : tab,
      ));
      if (activeTabId === tabId) {
        setActiveTabId(saved.id);
      }
      setSelectedCollectionId(nextCollectionId);
      setExpandedCollectionIds((current) =>
        current.includes(nextCollectionId) ? current : [...current, nextCollectionId],
      );
      toast.success("Request salva.");
      return {
        tabId: saved.id,
        draft: savedDraft,
      };
    } catch (error) {
      setOpenTabs((prev) => prev.map((tab) =>
        tab.tabId === tabId && tab.type === "request"
          ? { ...tab, isSaving: false }
          : tab,
      ));
      toast.error(error instanceof Error ? error.message : "Falha ao salvar request.");
      return null;
    }
  }

  async function handleSaveRequest() {
    await saveRequestTab(activeTabId);
  }

  function buildExecutionPayload(): ExecutedRequest {
    return {
      requestId: draftRequest.id || undefined,
      method: draftRequest.method,
      url: draftRequest.url,
      environmentId: selectedEnvironmentId || undefined,
      headers: draftRequest.headers.filter((item) => item.key || item.value),
      queryParams: draftRequest.queryParams.filter((item) => item.key || item.value),
      bodyType: draftRequest.bodyType,
      body: draftRequest.body,
      formData: draftRequest.formData.filter((item) => item.key || item.value || item.src),
      postResponseScript: draftRequest.postResponseScript,
    };
  }

  async function persistUpdatedEnvironmentVariables(updatedVariables: Variable[]) {
    if (!auth || !selectedProject || !selectedEnvironmentId || !selectedEnvironment) {
      return;
    }

    const nextEnvironment: Environment = {
      ...selectedEnvironment,
      variables: updatedVariables,
    };

    setBootstrap((current) =>
      current
        ? {
            ...current,
            projects: current.projects.map((project) =>
              project.id === selectedProject.id
                ? {
                    ...project,
                    environments: project.environments.map((environment) =>
                      environment.id === selectedEnvironment.id ? nextEnvironment : environment,
                    ),
                  }
                : project,
            ),
          }
        : current,
    );
    setSavedEnvironmentSnapshot(JSON.stringify(nextEnvironment));
    setEnvironmentConflictId("");

    try {
      await requestJson<Environment>(`/projects/${selectedProject.id}/environments`, {
        method: "POST",
        headers: authHeaders(auth.token),
        body: JSON.stringify(nextEnvironment),
      });
    } catch (error) {
      toast.error(
        error instanceof Error
          ? `A execução local funcionou, mas falhou ao persistir variáveis: ${error.message}`
          : "A execução local funcionou, mas falhou ao persistir variáveis.",
      );
    }
  }

  async function handleExecute() {
    if (!auth || !selectedProject) {
      return;
    }

    try {
      setOpenTabs((prev) => prev.map((tab) =>
        tab.tabId === activeTabId && tab.type === "request"
          ? { ...tab, execution: null, responseError: null, isExecuting: true }
          : tab,
      ));
      const payload = buildExecutionPayload();
      const useLocalExecution = shouldUseLocalExecution(draftRequest, selectedEnvironment);
      let result: ExecutionResponse;

      if (useLocalExecution && hasDesktopBridge && window.devHttpDesktop?.executeLocalRequest) {
        result = await window.devHttpDesktop.executeLocalRequest({
          ...payload,
          variables: selectedEnvironment?.variables ?? [],
          source: "desktop-local",
        } satisfies LocalExecutionRequest);
      } else if (useLocalExecution) {
        const agentExecution = await executeLocalAgentRequestWithRetry(localAgentToken, {
          ...payload,
          variables: selectedEnvironment?.variables ?? [],
          source: "agent-local",
        } satisfies LocalExecutionRequest);
        result = agentExecution.response;
        setHasLocalAgent(true);
        setLocalAgentToken(agentExecution.token);
      } else {
        result = await requestJson<ExecutionResponse>("/requests/execute", {
          method: "POST",
          headers: authHeaders(auth.token),
          body: JSON.stringify(payload),
        });
      }

      setOpenTabs((prev) => prev.map((tab) =>
        tab.tabId === activeTabId && tab.type === "request"
          ? { ...tab, execution: result, responseError: null, isExecuting: false }
          : tab,
      ));
      toast.success(
        result.source === "desktop-local"
          ? "Request executada localmente no desktop."
          : result.source === "agent-local"
            ? "Request executada localmente pelo DevHttp Agent."
            : "Request executada.",
      );

      if (useLocalExecution && result.scriptResult?.updatedVariables && selectedEnvironmentId) {
        void persistUpdatedEnvironmentVariables(result.scriptResult.updatedVariables);
      }
    } catch (error) {
      if (isLocalAgentRequiredError(error) || (error instanceof Error && error.message === LOCAL_AGENT_REQUIRED_MESSAGE)) {
        setHasLocalAgent(false);
        setLocalAgentToken("");
        setOpenTabs((prev) => prev.map((tab) =>
          tab.tabId === activeTabId && tab.type === "request"
            ? {
                ...tab,
                execution: null,
                responseError: {
                  type: "agent_required",
                  message: error.message,
                },
                isExecuting: false,
              }
            : tab,
        ));
        return;
      }

      setOpenTabs((prev) => prev.map((tab) =>
        tab.tabId === activeTabId && tab.type === "request"
          ? { ...tab, execution: null, responseError: null, isExecuting: false }
          : tab,
      ));
      toast.error(error instanceof Error ? error.message : "Falha ao executar request.");
    }
  }

  async function handleExport() {
    if (!auth || !selectedProject) {
      return;
    }

    try {
      const collection = await requestJson<Record<string, unknown>>(
        `/projects/${selectedProject.id}/export/postman`,
        {
          headers: authHeaders(auth.token),
        },
      );
      const blob = new Blob([JSON.stringify(collection, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${selectedProject.name.toLowerCase().replace(/\s+/g, "-")}.postman_collection.json`;
      link.click();
      URL.revokeObjectURL(url);
      setIsMenuOpen(false);
      toast.success("Exportação gerada.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao exportar coleção.");
    }
  }

  async function handleImport(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    if (files.length === 0 || !auth || !selectedProject) {
      return;
    }

    try {
      let collection: PostmanCollectionFile | undefined;
      let environment: PostmanEnvironmentFile | undefined;

      for (const file of files) {
        const payload = JSON.parse(await file.text()) as unknown;

        if (isPostmanCollectionFile(payload)) {
          if (collection) {
            throw new Error("Selecione apenas uma collection do Postman por importação.");
          }
          collection = payload;
          continue;
        }

        if (isPostmanEnvironmentFile(payload)) {
          if (environment) {
            throw new Error("Selecione apenas um environment do Postman por importação.");
          }
          environment = payload;
          continue;
        }

        throw new Error(`Arquivo "${file.name}" não é uma collection ou environment Postman compatível.`);
      }

      if (!collection && !environment) {
        throw new Error("Nenhum arquivo Postman válido foi selecionado.");
      }

      const result = await requestJson<PostmanImportResult>(`/projects/${selectedProject.id}/import/postman`, {
        method: "POST",
        headers: authHeaders(auth.token),
        body: JSON.stringify({ collection, environment }),
      });
      const refreshed = normalizeProject(
        await requestJson<BootstrapProject>(`/projects/${selectedProject.id}`, {
          headers: authHeaders(auth.token),
        }),
      );
      setBootstrap((current) =>
        current
          ? {
              ...current,
              projects: current.projects.map((project) =>
                project.id === selectedProject.id ? refreshed : project,
              ),
            }
          : current,
      );

      const importedEnvironment = result.environmentImported
        ? refreshed.environments.find((environmentEntry) => environmentEntry.id === result.environmentImported?.id) ?? null
        : null;
      const firstImportedRequest = result.requests[0]
        ? refreshed.requests.find((request) => request.id === result.requests[0]?.id) ?? null
        : null;

      if (importedEnvironment) {
        setSelectedEnvironmentId(importedEnvironment.id);
      }

      if (firstImportedRequest) {
        setSelectedCollectionId(
          firstImportedRequest.collectionId ?? refreshed.collections[0]?.id ?? "",
        );
        setExpandedCollectionIds(
          firstImportedRequest.collectionId ? [firstImportedRequest.collectionId] : [],
        );
        const importedTabs: EditorTab[] = [
          createRequestEditorTab(firstImportedRequest),
        ];
        setOpenTabs(importedTabs);
        setActiveTabId(firstImportedRequest.id);
      } else if (importedEnvironment) {
        const environmentTabId = `env-${importedEnvironment.id}`;
        setOpenTabs([createEnvironmentEditorTab(importedEnvironment.id, { tabId: environmentTabId })]);
        setActiveTabId(environmentTabId);
      }

      setIsMenuOpen(false);
      toast(buildImportSummary(result));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao importar arquivos do Postman.");
    } finally {
      event.target.value = "";
    }
  }

  async function handleToggleSidebar() {
    const next = !sidebarCollapsed;
    setSidebarCollapsed(next);
    if (auth) {
      requestJson("/preferences", {
        method: "PATCH",
        headers: authHeaders(auth.token),
        body: JSON.stringify({ sidebarCollapsed: next }),
      }).catch(() => {});
    }
  }

  function handleResizeStart(e: React.MouseEvent) {
    e.preventDefault();
    isResizingRef.current = true;
    resizeStartXRef.current = e.clientX;
    resizeStartWidthRef.current = sidebarWidth;

    function onMouseMove(ev: MouseEvent) {
      if (!isResizingRef.current) return;
      const delta = ev.clientX - resizeStartXRef.current;
      const maxWidth = Math.floor(window.innerWidth * 0.4);
      setSidebarWidth(Math.min(maxWidth, Math.max(260, resizeStartWidthRef.current + delta)));
    }

    function onMouseUp() {
      isResizingRef.current = false;
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    }

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  }

  function handleRequestResponseResizeStart(e: React.MouseEvent) {
    if (!isDesktopEditorLayout || !requestResponseContainerRef.current) {
      return;
    }

    e.preventDefault();
    isRequestResponseResizingRef.current = true;
    requestResponseStartYRef.current = e.clientY;
    requestResponseStartRatioRef.current = requestPaneRatio;

    function onMouseMove(ev: MouseEvent) {
      if (!isRequestResponseResizingRef.current || !requestResponseContainerRef.current) {
        return;
      }

      const containerHeight = requestResponseContainerRef.current.offsetHeight;
      if (containerHeight <= 0) {
        return;
      }

      const delta = ev.clientY - requestResponseStartYRef.current;
      const nextRatio = requestResponseStartRatioRef.current + delta / containerHeight;
      setRequestPaneRatio(Math.min(0.78, Math.max(0.32, nextRatio)));
    }

    function onMouseUp() {
      isRequestResponseResizingRef.current = false;
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    }

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  }

  async function handleSaveEnvironment() {
    if (!auth || !selectedProject || !selectedEnvironment) {
      return;
    }

    setIsEnvironmentSaving(true);
    try {
      const saved = await requestJson<Environment>(`/projects/${selectedProject.id}/environments`, {
        method: "POST",
        headers: authHeaders(auth.token),
        body: JSON.stringify(selectedEnvironment),
      });

      setBootstrap((current) =>
        current
          ? {
              ...current,
              projects: current.projects.map((project) =>
                project.id === selectedProject.id
                  ? { ...project, environments: upsertById(project.environments, saved) }
                  : project,
              ),
            }
          : current,
      );
      setSelectedEnvironmentId(saved.id);
      setSavedEnvironmentSnapshot(JSON.stringify(saved));
      setEnvironmentConflictId("");
      toast.success("Ambiente salvo.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao salvar ambiente.");
    } finally {
      setIsEnvironmentSaving(false);
    }
  }

  function openSettings(tab: SettingsTab = "profile") {
    setSettingsTab(tab);
    setIsUserMenuOpen(false);
    const nextProfile = emptyProfileForm(bootstrap?.user);
    setProfileForm(nextProfile);
    setSavedProfileForm(nextProfile);
    setThemeMode(savedThemeMode);
    applyTheme(savedThemeMode);
    setAvatarSource("");
    setAvatarZoom(1);
    setAvatarOffsetX(0);
    setAvatarOffsetY(0);
    setIsSettingsOpen(true);
    setPasswordForm(emptyPasswordForm());
    if (tab === "workspace") {
      void loadWorkspaceManagement();
    }
  }

  function closeSettings() {
    const nextProfile = emptyProfileForm(bootstrap?.user);
    setProfileForm(nextProfile);
    setSavedProfileForm(nextProfile);
    setThemeMode(savedThemeMode);
    applyTheme(savedThemeMode);
    setAvatarSource("");
    setAvatarZoom(1);
    setAvatarOffsetX(0);
    setAvatarOffsetY(0);
    setIsSettingsOpen(false);
    setPasswordForm(emptyPasswordForm());
  }

  async function refreshNotifications() {
    if (!auth) {
      return;
    }

    try {
      const nextNotifications = await requestJson<Notification[]>("/notifications", {
        headers: authHeaders(auth.token),
      });
      setNotifications(nextNotifications);
    } catch {
      // noop
    }
  }

  async function loadWorkspaceManagement() {
    if (!auth || !bootstrap) {
      return;
    }

    try {
      const members = await requestJson<WorkspaceMember[]>(
        `/workspaces/${bootstrap.workspace.id}/members`,
        {
          headers: authHeaders(auth.token),
        },
      );
      setWorkspaceMembers(members);
    } catch {
      setWorkspaceMembers([]);
    }

    try {
      const invites = await requestJson<WorkspaceInvite[]>(
        `/workspaces/${bootstrap.workspace.id}/invites`,
        {
          headers: authHeaders(auth.token),
        },
      );
      setWorkspaceInvites(invites);
    } catch {
      setWorkspaceInvites([]);
    }
  }

  async function refreshWorkspaceFromServer(event?: WorkspaceRealtimeEvent) {
    const current = latestRealtimeStateRef.current;
    if (!current.auth || !current.bootstrap || realtimeRefreshInFlightRef.current) {
      return;
    }

    realtimeRefreshInFlightRef.current = true;
    try {
      const freshBootstrap = normalizeBootstrap(
        await requestJson<BootstrapResponse>(
          `/workspaces/${current.auth.workspaceId}/bootstrap`,
          { headers: authHeaders(current.auth.token) },
        ),
      );
      const snapshot = buildRealtimeWorkspaceSnapshot(
        current.auth.user.id,
        current.bootstrap.workspace.id,
        current.bootstrap,
        current.openTabs,
        {
          selectedProjectId: current.selectedProjectId,
          selectedCollectionId: current.selectedCollectionId,
          selectedEnvironmentId: current.selectedEnvironmentId,
          activeTabId: current.activeTabId,
          activeTab: current.activeTab,
          expandedCollectionIds: current.expandedCollectionIds,
          sidebarCollapsed: current.sidebarCollapsed,
          sidebarWidth: current.sidebarWidth,
          requestPaneRatio: current.requestPaneRatio,
          responseView: current.responseView,
          savedEnvironmentSnapshot: current.savedEnvironmentSnapshot,
        },
      );
      const restoredUiState =
        restoreWorkspaceUiState(freshBootstrap, snapshot, { realtimeEvent: event }) ??
        buildDefaultWorkspaceUiState(freshBootstrap);

      setBootstrap(restoredUiState.bootstrap);
      setSelectedProjectId(restoredUiState.selectedProjectId);
      setSelectedCollectionId(restoredUiState.selectedCollectionId);
      setSelectedEnvironmentId(restoredUiState.selectedEnvironmentId);
      setExpandedCollectionIds(restoredUiState.expandedCollectionIds);
      setOpenTabs(restoredUiState.openTabs);
      setActiveTabId(restoredUiState.activeTabId);
      setActiveTab(restoredUiState.activeTab);
      setSidebarCollapsed(restoredUiState.sidebarCollapsed ?? current.sidebarCollapsed);
      setSidebarWidth(restoredUiState.sidebarWidth ?? current.sidebarWidth);
      setRequestPaneRatio(restoredUiState.requestPaneRatio ?? current.requestPaneRatio);
      setResponseView(restoredUiState.responseView ?? current.responseView);
      setSavedEnvironmentSnapshot(restoredUiState.savedEnvironmentSnapshot);
      setEnvironmentConflictId(
        restoredUiState.hasEnvironmentRemoteConflict ? restoredUiState.selectedEnvironmentId : "",
      );

      const requestConflictCount = restoredUiState.openTabs.filter(
        (tab) => tab.type === "request" && tab.hasRemoteConflict,
      ).length;
      if (requestConflictCount > 0 || restoredUiState.hasEnvironmentRemoteConflict) {
        toast("Atualizações remotas recebidas.", {
          description:
            requestConflictCount > 0
              ? "Seu draft local foi preservado; revise os itens marcados com conflito."
              : "Seu ambiente em edição foi alterado em outro dispositivo.",
        });
      }

      if (current.isSettingsOpen && current.settingsTab === "workspace") {
        await loadWorkspaceManagement();
      }
    } catch (error) {
      console.error(error);
    } finally {
      realtimeRefreshInFlightRef.current = false;
    }
  }

  async function refreshUserRealtimeState(event?: UserRealtimeEvent) {
    const current = latestRealtimeStateRef.current;
    if (!current.auth) {
      return;
    }

    try {
      const session = await requestJson<SessionResponse>("/auth/me");
      const nextWorkspaceId = session.workspaces.some(
        (membership) => membership.workspace.id === current.auth?.workspaceId,
      )
        ? current.auth.workspaceId
        : session.workspaceId;

      setAuth({
        ...session,
        workspaceId: nextWorkspaceId,
      });
      try {
        const prefs = await requestJson<UserPreferences>("/preferences", {
          headers: authHeaders(),
        });
        setSidebarCollapsed(prefs.sidebarCollapsed ?? false);
        const nextThemeMode = prefs.themeMode ?? "system";
        setThemeMode(nextThemeMode);
        setSavedThemeMode(nextThemeMode);
        applyTheme(nextThemeMode);
      } catch {
        // noop
      }
      await refreshNotifications();

      if (
        current.isSettingsOpen &&
        current.settingsTab === "workspace" &&
        current.bootstrap &&
        nextWorkspaceId === current.bootstrap.workspace.id
      ) {
        await loadWorkspaceManagement();
      }

      if (nextWorkspaceId !== current.auth.workspaceId) {
        setOpenTabs([]);
        setActiveTabId("");
        setSelectedProjectId("");
        setSelectedCollectionId("");
        setSelectedEnvironmentId("");
      } else if (
        event?.entityType === "profile" ||
        event?.workspaceId === current.bootstrap?.workspace.id
      ) {
        await refreshWorkspaceFromServer();
      }
    } catch {
      setAuth(null);
    }
  }

  function handleWorkspaceChange(workspaceId: string) {
    setAuth((current) =>
      current
        ? {
            ...current,
            workspaceId,
          }
        : current,
    );
    setNotifications([]);
    setOpenTabs([]);
    setActiveTabId("");
    setSelectedProjectId("");
    setSelectedCollectionId("");
    setSelectedEnvironmentId("");
    setEnvironmentConflictId("");
  }

  async function handleCreateWorkspaceInvite() {
    if (!auth || !bootstrap) {
      return;
    }

    if (!workspaceInviteForm.email.trim()) {
      toast("Informe o email para convidar.");
      return;
    }

    setIsWorkspaceSaving(true);
    try {
      await requestJson<WorkspaceInvite>(`/workspaces/${bootstrap.workspace.id}/invites`, {
        method: "POST",
        headers: authHeaders(auth.token),
        body: JSON.stringify({
          email: workspaceInviteForm.email.trim(),
          role: workspaceInviteForm.role,
        }),
      });
      setWorkspaceInviteForm({ email: "", role: "viewer" });
      await loadWorkspaceManagement();
      toast.success("Convite enviado.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao enviar convite.");
    } finally {
      setIsWorkspaceSaving(false);
    }
  }

  async function handleUpdateWorkspaceMemberRole(memberUserId: string, role: WorkspaceMember["role"]) {
    if (!auth || !bootstrap) {
      return;
    }

    setIsWorkspaceSaving(true);
    try {
      await requestJson<WorkspaceMember>(`/workspaces/${bootstrap.workspace.id}/members/${memberUserId}`, {
        method: "PATCH",
        headers: authHeaders(auth.token),
        body: JSON.stringify({ role }),
      });
      await loadWorkspaceManagement();
      toast.success("Permissão do membro atualizada.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao atualizar membro.");
    } finally {
      setIsWorkspaceSaving(false);
    }
  }

  async function handleRemoveWorkspaceMember(memberUserId: string) {
    if (!auth || !bootstrap) {
      return;
    }

    setIsWorkspaceSaving(true);
    try {
      await requestJson(`/workspaces/${bootstrap.workspace.id}/members/${memberUserId}`, {
        method: "DELETE",
        headers: authHeaders(auth.token),
      });
      await loadWorkspaceManagement();
      toast.success("Membro removido do workspace.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao remover membro.");
    } finally {
      setIsWorkspaceSaving(false);
    }
  }

  async function handleRevokeWorkspaceInvite(inviteId: string) {
    if (!auth || !bootstrap) {
      return;
    }

    setIsWorkspaceSaving(true);
    try {
      await requestJson(`/workspaces/${bootstrap.workspace.id}/invites/${inviteId}`, {
        method: "DELETE",
        headers: authHeaders(auth.token),
      });
      await loadWorkspaceManagement();
      await refreshNotifications();
      toast.success("Convite revogado.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao revogar convite.");
    } finally {
      setIsWorkspaceSaving(false);
    }
  }

  async function handleWorkspaceInviteAction(notification: Notification, action: "accept" | "decline") {
    if (!auth || !notification.invite) {
      return;
    }

    try {
      const path =
        action === "accept"
          ? `/workspaces/invites/${notification.invite.id}/accept`
          : `/workspaces/invites/${notification.invite.id}/decline`;
      const result = await requestJson<{ workspaces?: WorkspaceMembership[] }>(path, {
        method: "POST",
        headers: authHeaders(auth.token),
      });

      setNotifications((current) => current.filter((item) => item.id !== notification.id));
      if (result.workspaces) {
        setAuth((current) =>
          current
            ? {
                ...current,
                workspaces: result.workspaces ?? current.workspaces,
              }
            : current,
        );
      }
      await refreshNotifications();
      toast.success(action === "accept" ? "Convite aceito." : "Convite recusado.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao processar convite.");
    }
  }

  async function handleLogout() {
    if (!auth) {
      return;
    }

    try {
      await requestJson("/auth/logout", {
        method: "POST",
        headers: authHeaders(auth.token),
      });
    } catch {
      // noop
    } finally {
      setAuth(null);
      setBootstrap(null);
      setNotifications([]);
      setIsSessionLoading(false);
      setSelectedProjectId("");
      setSelectedCollectionId("");
      setSelectedEnvironmentId("");
      setOpenTabs([]);
      setActiveTabId("");
      setIsUserMenuOpen(false);
      setIsSettingsOpen(false);
      router.replace("/login");
    }
  }

  async function handleAvatarFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    if (!file.type.startsWith("image/")) {
      toast("Selecione um arquivo de imagem para o avatar.");
      event.target.value = "";
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      setAvatarSource(result);
      setAvatarZoom(1);
      setAvatarOffsetX(0);
      setAvatarOffsetY(0);
    };
    reader.readAsDataURL(file);
    event.target.value = "";
  }

  async function buildAvatarDataUrl() {
    if (!avatarSource) {
      return profileForm.avatarUrl || null;
    }

    return new Promise<string>((resolve, reject) => {
      const image = new Image();
      image.onload = () => {
        const canvas = document.createElement("canvas");
        const size = 512;
        canvas.width = size;
        canvas.height = size;
        const context = canvas.getContext("2d");
        if (!context) {
          reject(new Error("Falha ao preparar o crop do avatar."));
          return;
        }

        const cropSize = Math.max(1, Math.min(image.width, image.height) / avatarZoom);
        const maxOffsetX = Math.max(0, (image.width - cropSize) / 2);
        const maxOffsetY = Math.max(0, (image.height - cropSize) / 2);
        const sx = Math.min(
          image.width - cropSize,
          Math.max(0, (image.width - cropSize) / 2 + (avatarOffsetX / 50) * maxOffsetX),
        );
        const sy = Math.min(
          image.height - cropSize,
          Math.max(0, (image.height - cropSize) / 2 + (avatarOffsetY / 50) * maxOffsetY),
        );

        context.drawImage(image, sx, sy, cropSize, cropSize, 0, 0, size, size);
        resolve(canvas.toDataURL("image/jpeg", 0.92));
      };
      image.onerror = () => reject(new Error("Falha ao carregar a imagem selecionada."));
      image.src = avatarSource;
    });
  }

  async function handleSaveProfile() {
    if (!auth || !bootstrap) {
      return;
    }

    if (!profileForm.name.trim() || !profileForm.email.trim()) {
      toast("Nome e email são obrigatórios.");
      return;
    }

    setIsProfileSaving(true);
    try {
      const avatarUrl = await buildAvatarDataUrl();
      const saved = await requestJson<User>("/users/me", {
        method: "PATCH",
        headers: authHeaders(auth.token),
        body: JSON.stringify({
          name: profileForm.name.trim(),
          email: profileForm.email.trim(),
          avatarUrl,
        }),
      });

      setBootstrap((current) =>
        current
          ? {
              ...current,
              user: saved,
            }
          : current,
      );
      setAuth((current) =>
        current
          ? {
              ...current,
              user: saved,
            }
          : current,
      );
      const nextProfile = emptyProfileForm(saved);
      setProfileForm(nextProfile);
      setSavedProfileForm(nextProfile);
      setAvatarSource("");
      setAvatarZoom(1);
      setAvatarOffsetX(0);
      setAvatarOffsetY(0);
      toast.success("Perfil atualizado.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao salvar perfil.");
    } finally {
      setIsProfileSaving(false);
    }
  }

  async function handleSaveAppearance() {
    if (!auth) {
      return;
    }

    setIsAppearanceSaving(true);
    try {
      const saved = await requestJson<UserPreferences>("/preferences", {
        method: "PATCH",
        headers: authHeaders(auth.token),
        body: JSON.stringify({ themeMode }),
      });
      setSidebarCollapsed(saved.sidebarCollapsed ?? sidebarCollapsed);
      setThemeMode(saved.themeMode);
      setSavedThemeMode(saved.themeMode);
      applyTheme(saved.themeMode);
      toast.success("Aparência atualizada.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao salvar aparência.");
    } finally {
      setIsAppearanceSaving(false);
    }
  }

  async function handleChangePassword() {
    if (!auth) {
      return;
    }

    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      toast("A confirmação da nova senha não confere.");
      return;
    }

    if (!passwordForm.currentPassword || !passwordForm.newPassword) {
      toast("Preencha a senha atual e a nova senha.");
      return;
    }

    setIsPasswordSaving(true);
    try {
      await requestJson("/users/me/password", {
        method: "PATCH",
        headers: authHeaders(auth.token),
        body: JSON.stringify({
          currentPassword: passwordForm.currentPassword,
          newPassword: passwordForm.newPassword,
        }),
      });
      await handleLogout();
      toast("Senha alterada. Faça login novamente.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao alterar senha.");
    } finally {
      setIsPasswordSaving(false);
      setPasswordForm(emptyPasswordForm());
    }
  }

  async function handleCreateEntity() {
    if (!auth || !bootstrap || !createModalType) {
      return;
    }

    const name = createName.trim();
    if (!name) {
      toast("Informe um nome para criar o item.");
      return;
    }

    try {
      if (createModalType === "workspace") {
        const created = await requestJson<WorkspaceMembership>(
          `/workspaces`,
          {
            method: "POST",
            headers: authHeaders(auth.token),
            body: JSON.stringify({ name }),
          },
        );
        setAuth((current) =>
          current
            ? {
                ...current,
                workspaceId: created.workspace.id,
                workspaces: [...current.workspaces, created],
              }
            : current,
        );
        setBootstrap(null);
        setSelectedProjectId("");
        setSelectedCollectionId("");
        setSelectedEnvironmentId("");
        setOpenTabs([]);
        setActiveTabId("");
        toast.success("Workspace criado.");
      }

      if (createModalType === "project") {
        const created = await requestJson<BootstrapProject>(
          `/workspaces/${bootstrap.workspace.id}/projects`,
          {
            method: "POST",
            headers: authHeaders(auth.token),
            body: JSON.stringify({ name, description: "" }),
          },
        );

        const nextProject = normalizeProject({
          ...created,
          collections: [],
          environments: [],
          requests: [],
        });

        setBootstrap({
          ...bootstrap,
          projects: [nextProject, ...bootstrap.projects],
        });
        setSelectedProjectId(nextProject.id);
        setSelectedCollectionId("");
        setSelectedEnvironmentId("");
        toast.success("Projeto criado.");
      }

      if (createModalType === "collection" && selectedProject) {
        const created = await requestJson<BootstrapCollection>(
          `/projects/${selectedProject.id}/collections`,
          {
            method: "POST",
            headers: authHeaders(auth.token),
            body: JSON.stringify({ name }),
          },
        );

        setBootstrap((current) =>
          current
            ? {
                ...current,
                projects: current.projects.map((project) =>
                  project.id === selectedProject.id
                    ? { ...project, collections: upsertById(project.collections, created) }
                    : project,
                ),
              }
            : current,
        );
        setSelectedCollectionId(created.id);
        setExpandedCollectionIds((current) =>
          current.includes(created.id) ? current : [...current, created.id],
        );
        toast.success("Coleção criada.");
      }

      if (createModalType === "environment" && selectedProject) {
        const created = await requestJson<Environment>(`/projects/${selectedProject.id}/environments`, {
          method: "POST",
          headers: authHeaders(auth.token),
          body: JSON.stringify({
            name,
            scope: "project",
            variables: [],
          }),
        });

        setBootstrap((current) =>
          current
            ? {
                ...current,
                projects: current.projects.map((project) =>
                  project.id === selectedProject.id
                    ? { ...project, environments: upsertById(project.environments, created) }
                    : project,
                ),
              }
            : current,
        );
        selectEnvironment(created.id);
        toast.success("Ambiente criado.");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao criar item.");
    } finally {
      setCreateModalType(null);
      setCreateName("");
    }
  }

  async function handleDeleteProject() {
    if (!auth || !bootstrap || !deleteProjectTarget) {
      return;
    }

    if (deleteProjectConfirmation.trim() !== deleteProjectTarget.name) {
      toast("Confirmação inválida para remover o projeto.");
      return;
    }

    try {
      await requestJson<{ projectId: string; removed: boolean }>(`/projects/${deleteProjectTarget.id}`, {
        method: "DELETE",
        headers: authHeaders(auth.token),
      });

      const isDeletingActiveProject = selectedProjectId === deleteProjectTarget.id;

      setBootstrap({
        ...bootstrap,
        projects: bootstrap.projects.filter((project) => project.id !== deleteProjectTarget.id),
      });

      if (isDeletingActiveProject) {
        setSelectedProjectId("");
        setSelectedCollectionId("");
        setSelectedEnvironmentId("");
        setOpenTabs([]);
        setActiveTabId("");
      } else {
        const deletedRequestIds = new Set(deleteProjectTarget.requests.map((request) => request.id));
        const deletedEnvironmentTabIds = new Set(
          deleteProjectTarget.environments.map((environment) => `env-${environment.id}`),
        );
        setOpenTabs((current) =>
          current.filter((tab) => {
            if (tab.type === "request") {
              return !deletedRequestIds.has(tab.draft.id);
            }
            return !deletedEnvironmentTabIds.has(tab.tabId);
          }),
        );
      }

      setCollectionMenu(null);
      setIsMenuOpen(false);
      setPendingCloseTabId(null);
      setDeleteProjectTarget(null);
      setDeleteProjectConfirmation("");
      toast.success("Projeto removido.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao remover projeto.");
    }
  }

  function openCreateModal(type: CreateModalType) {
    setCreateModalType(type);
    setCreateName("");
    setIsMenuOpen(false);
    setNewMenuAnchor(null);
    setIsEditorNewMenuOpen(false);
    setCollectionMenu(null);
  }

  function openDeleteProjectModal(project: BootstrapProject) {
    setDeleteProjectTarget(project);
    setDeleteProjectConfirmation("");
    setIsMenuOpen(false);
    setCollectionMenu(null);
    setCreateModalType(null);
  }

  function openRenameModal(
    type: RenameEntityType,
    id: string,
    currentName: string,
    projectId?: string,
  ) {
    setRenameModal({ type, id, currentName, projectId });
    setRenameName(currentName);
    setIsMenuOpen(false);
    setCollectionMenu(null);
  }

  async function handleRenameEntity() {
    if (!auth || !bootstrap || !renameModal) {
      return;
    }

    const nextName = renameName.trim();
    if (!nextName) {
      toast("Informe um nome válido para renomear o item.");
      return;
    }

    if (nextName === renameModal.currentName.trim()) {
      setRenameModal(null);
      setRenameName("");
      return;
    }

    try {
      if (renameModal.type === "workspace") {
        const updated = await requestJson<{ id: string; name: string }>(
          `/workspaces/${renameModal.id}`,
          {
            method: "PATCH",
            headers: authHeaders(auth.token),
            body: JSON.stringify({ name: nextName }),
          },
        );

        setBootstrap((current) =>
          current
            ? {
                ...current,
                workspace: updated,
              }
            : current,
        );
        setAuth((current) =>
          current
            ? {
                ...current,
                workspaces: current.workspaces.map((membership) =>
                  membership.workspace.id === updated.id
                    ? {
                        ...membership,
                        workspace: {
                          ...membership.workspace,
                          name: updated.name,
                        },
                      }
                    : membership,
                ),
              }
            : current,
        );
        toast.success("Workspace renomeado.");
      }

      if (renameModal.type === "project") {
        const updated = await requestJson<{ id: string; workspaceId: string; name: string; description: string }>(
          `/projects/${renameModal.id}`,
          {
            method: "PATCH",
            headers: authHeaders(auth.token),
            body: JSON.stringify({ name: nextName }),
          },
        );

        setBootstrap((current) =>
          current
            ? {
                ...current,
                projects: current.projects.map((project) =>
                  project.id === updated.id
                    ? {
                        ...project,
                        name: updated.name,
                        description: updated.description,
                      }
                    : project,
                ),
              }
            : current,
        );
        toast.success("Projeto renomeado.");
      }

      if (renameModal.type === "collection" && renameModal.projectId) {
        const updated = await requestJson<BootstrapCollection>(
          `/projects/${renameModal.projectId}/collections/${renameModal.id}`,
          {
            method: "PATCH",
            headers: authHeaders(auth.token),
            body: JSON.stringify({ name: nextName }),
          },
        );

        setBootstrap((current) =>
          current
            ? {
                ...current,
                projects: current.projects.map((project) =>
                  project.id === renameModal.projectId
                    ? {
                        ...project,
                        collections: project.collections.map((collection) =>
                          collection.id === updated.id ? { ...collection, name: updated.name } : collection,
                        ),
                      }
                    : project,
                ),
              }
            : current,
        );
        toast.success("Coleção renomeada.");
      }

      if (renameModal.type === "request" && renameModal.projectId) {
        const updated = await requestJson<BootstrapRequest>(
          `/projects/${renameModal.projectId}/requests/${renameModal.id}`,
          {
            method: "PATCH",
            headers: authHeaders(auth.token),
            body: JSON.stringify({ name: nextName }),
          },
        );

        setBootstrap((current) =>
          current
            ? {
                ...current,
                projects: current.projects.map((project) =>
                  project.id === renameModal.projectId
                    ? {
                        ...project,
                        requests: project.requests.map((request) =>
                          request.id === updated.id ? { ...request, name: updated.name } : request,
                        ),
                      }
                    : project,
                ),
              }
            : current,
        );
        setOpenTabs((current) =>
          current.map((tab) => {
            if (tab.type !== "request" || tab.draft.id !== updated.id) {
              return tab;
            }

            const draft = {
              ...tab.draft,
              name: updated.name,
            };
            const savedSnapshot = updateSerializedRequestSnapshotName(tab.savedSnapshot, updated.name);
            return {
              ...tab,
              draft,
              savedSnapshot,
              isDirty: serializeRequestSnapshot(draft) !== savedSnapshot,
            };
          }),
        );
        toast.success("Request renomeada.");
      }

      setRenameModal(null);
      setRenameName("");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao renomear item.");
    }
  }

  function updateRequestTabDraft(
    tabId: string,
    updater: (draft: BootstrapRequest) => BootstrapRequest,
  ) {
    setOpenTabs((prev) => prev.map((tab) => {
      if (tab.tabId !== tabId || tab.type !== "request") {
        return tab;
      }

      const draft = updater(tab.draft);
      const nextSnapshot = serializeRequestSnapshot(draft);
      return {
        ...tab,
        draft,
        isDirty: nextSnapshot !== tab.savedSnapshot,
      };
    }));
  }

  function updateDraft<K extends keyof BootstrapRequest>(key: K, value: BootstrapRequest[K]) {
    updateRequestTabDraft(activeTabId, (draft) => ({
      ...draft,
      [key]: value,
      projectId: selectedProject?.id ?? draft.projectId,
    }));
  }

  function updateKeyValue(
    field: "headers" | "queryParams",
    rowId: string,
    key: keyof KeyValue,
    value: string | boolean,
  ) {
    updateRequestTabDraft(activeTabId, (draft) => ({
      ...draft,
      [field]: draft[field].map((item) => item.id === rowId ? { ...item, [key]: value } : item),
    }));
  }

  function addRow(field: "headers" | "queryParams") {
    updateRequestTabDraft(activeTabId, (draft) => ({
      ...draft,
      [field]: [...draft[field], emptyKeyValue()],
    }));
  }

  function removeRow(field: "headers" | "queryParams", rowId: string) {
    updateRequestTabDraft(activeTabId, (draft) => ({
      ...draft,
      [field]: draft[field].filter((item) => item.id !== rowId),
    }));
  }

  function updateFormDataField(
    rowId: string,
    key: keyof FormDataField,
    value: string | boolean,
  ) {
    updateRequestTabDraft(activeTabId, (draft) => ({
      ...draft,
      formData: draft.formData.map((item) =>
        item.id === rowId ? { ...item, [key]: value } : item,
      ),
    }));
  }

  function addFormDataField(type: FormDataField["type"] = "text") {
    updateRequestTabDraft(activeTabId, (draft) => ({
      ...draft,
      formData: [...draft.formData, emptyFormDataField(type)],
    }));
  }

  function handleCreateNewRequest(collectionId?: string) {
    if (!selectedProject) return;
    const targetCollectionId = collectionId ?? selectedCollectionId ?? selectedProject.collections[0]?.id;
    if (!targetCollectionId) {
      toast("Crie uma coleção antes de adicionar uma request.");
      return;
    }
    const tabId = crypto.randomUUID();
    const draft = defaultRequest(selectedProject.id, targetCollectionId);
    setOpenTabs((prev) => [...prev, createRequestEditorTab(draft, { tabId })]);
    setActiveTabId(tabId);
    setSelectedCollectionId(targetCollectionId);
    setExpandedCollectionIds((current) =>
      current.includes(targetCollectionId) ? current : [...current, targetCollectionId],
    );
    setCollectionMenu(null);
  }

  function selectProject(projectId: string) {
    setSelectedProjectId(projectId);
    setIsMenuOpen(false);
    setCollectionMenu(null);
  }

  function selectCollection(collectionId: string) {
    setSelectedCollectionId(collectionId);
    setExpandedCollectionIds((current) =>
      current.includes(collectionId)
        ? current.filter((id) => id !== collectionId)
        : [...current, collectionId],
    );
    setCollectionMenu(null);
  }

  function selectRequest(request: BootstrapRequest) {
    const tabId = request.id;
    setOpenTabs((prev) => {
      if (prev.some((t) => t.tabId === tabId)) return prev;
      return [...prev, createRequestEditorTab(request)];
    });
    setActiveTabId(tabId);
    setSelectedCollectionId(request.collectionId ?? "");
    if (request.collectionId) {
      setExpandedCollectionIds((current) =>
        current.includes(request.collectionId!) ? current : [...current, request.collectionId!],
      );
    }
    setCollectionMenu(null);
  }

  function selectEnvironment(environmentId: string) {
    const tabId = `env-${environmentId}`;
    setOpenTabs((prev) => {
      if (prev.some((t) => t.tabId === tabId)) return prev;
      return [...prev, createEnvironmentEditorTab(environmentId, { tabId })];
    });
    setActiveTabId(tabId);
    setSelectedEnvironmentId(environmentId);
    setCollectionMenu(null);
  }

  function activateTab(tabId: string) {
    setActiveTabId(tabId);
    const tab = openTabs.find((t) => t.tabId === tabId);
    if (tab?.type === "environment") {
      setSelectedEnvironmentId(tab.environmentId);
    } else if (tab?.type === "request") {
      setSelectedCollectionId(tab.draft.collectionId ?? "");
    }
  }

  function closeTabImmediately(tabId: string) {
    setOpenTabs((prev) => {
      const next = prev.filter((t) => t.tabId !== tabId);
      if (tabId === activeTabId) {
        const idx = prev.findIndex((t) => t.tabId === tabId);
        const nextActive = next[idx - 1] ?? next[0];
        setActiveTabId(nextActive?.tabId ?? "");
        if (nextActive?.type === "environment") {
          setSelectedEnvironmentId(nextActive.environmentId);
        } else if (nextActive?.type === "request") {
          setSelectedCollectionId(nextActive.draft.collectionId ?? "");
        }
      }
      return next;
    });
  }

  function requestCloseTab(tabId: string) {
    const targetTab = openTabs.find((tab) => tab.tabId === tabId);
    if (targetTab?.type === "request" && targetTab.isDirty) {
      setPendingCloseTabId(tabId);
      return;
    }

    closeTabImmediately(tabId);
  }

  async function handleSaveAndCloseTab() {
    if (!pendingCloseTabId) {
      return;
    }

    const result = await saveRequestTab(pendingCloseTabId);
    if (!result) {
      return;
    }

    closeTabImmediately(result.tabId);
    setPendingCloseTabId(null);
  }

  function handleDiscardAndCloseTab() {
    if (!pendingCloseTabId) {
      return;
    }

    closeTabImmediately(pendingCloseTabId);
    setPendingCloseTabId(null);
  }

  async function handleCollectionDragEnd(projectId: string, event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const project = bootstrap?.projects.find((p) => p.id === projectId);
    if (!project) return;

    const oldIndex = project.collections.findIndex((c) => c.id === active.id);
    const newIndex = project.collections.findIndex((c) => c.id === over.id);
    const newOrder = arrayMove(project.collections, oldIndex, newIndex);

    setBootstrap((current) =>
      current
        ? {
            ...current,
            projects: current.projects.map((p) =>
              p.id === projectId ? { ...p, collections: newOrder } : p,
            ),
          }
        : current,
    );

    try {
      await requestJson(`/projects/${projectId}/collections/reorder`, {
        method: "PATCH",
        body: JSON.stringify({ ids: newOrder.map((c) => c.id) }),
      });
    } catch {
      toast.error("Falha ao reordenar coleções.");
    }
  }

  function handleTabDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setOpenTabs((current) => {
      const oldIndex = current.findIndex((t) => t.tabId === String(active.id));
      const newIndex = current.findIndex((t) => t.tabId === String(over.id));
      return arrayMove(current, oldIndex, newIndex);
    });
  }

  async function handleRequestDragEnd(
    projectId: string,
    collectionId: string,
    event: DragEndEvent,
  ) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    let reorderedIds: string[] = [];

    setBootstrap((current) => {
      if (!current) return current;
      const currentProject = current.projects.find((p) => p.id === projectId);
      if (!currentProject) return current;
      const collectionRequests = currentProject.requests.filter(
        (r) => r.collectionId === collectionId,
      );
      const oldIndex = collectionRequests.findIndex((r) => r.id === active.id);
      const newIndex = collectionRequests.findIndex((r) => r.id === over.id);
      if (oldIndex === -1 || newIndex === -1) return current;
      const reordered = arrayMove(collectionRequests, oldIndex, newIndex);
      reorderedIds = reordered.map((r) => r.id);
      const otherRequests = currentProject.requests.filter(
        (r) => r.collectionId !== collectionId,
      );
      return {
        ...current,
        projects: current.projects.map((p) =>
          p.id === projectId ? { ...p, requests: [...otherRequests, ...reordered] } : p,
        ),
      };
    });

    try {
      await requestJson(`/projects/${projectId}/requests/reorder`, {
        method: "PATCH",
        body: JSON.stringify({ ids: reorderedIds }),
      });
    } catch {
      toast.error("Falha ao reordenar requests.");
    }
  }

  async function handleEnvironmentDragEnd(projectId: string, event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const project = bootstrap?.projects.find((p) => p.id === projectId);
    if (!project) return;

    const oldIndex = project.environments.findIndex((e) => e.id === active.id);
    const newIndex = project.environments.findIndex((e) => e.id === over.id);
    const newOrder = arrayMove(project.environments, oldIndex, newIndex);

    setBootstrap((current) =>
      current
        ? {
            ...current,
            projects: current.projects.map((p) =>
              p.id === projectId ? { ...p, environments: newOrder } : p,
            ),
          }
        : current,
    );

    try {
      await requestJson(`/projects/${projectId}/environments/reorder`, {
        method: "PATCH",
        body: JSON.stringify({ ids: newOrder.map((e) => e.id) }),
      });
    } catch {
      toast.error("Falha ao reordenar ambientes.");
    }
  }

  async function handleDuplicateCollection(collection: BootstrapCollection, projectId: string) {
    try {
      const newCollection = await requestJson<BootstrapCollection>(
        `/projects/${projectId}/collections`,
        {
          method: "POST",
          body: JSON.stringify({ name: `${collection.name} (cópia)` }),
        },
      );

      const project = bootstrap?.projects.find((p) => p.id === projectId);
      const collectionRequests =
        project?.requests.filter((r) => r.collectionId === collection.id) ?? [];

      const newRequests: BootstrapRequest[] = [];
      for (const request of collectionRequests) {
        const newRequest = await requestJson<BootstrapRequest>(
          `/projects/${projectId}/requests`,
          {
            method: "POST",
            body: JSON.stringify({
              name: `${request.name} (cópia)`,
              method: request.method,
              url: request.url,
              collectionId: newCollection.id,
              headers: meaningfulKeyValues(request.headers),
              queryParams: meaningfulKeyValues(request.queryParams),
              bodyType: request.bodyType,
              body: request.body,
              formData: meaningfulFormData(request.formData),
              postResponseScript: request.postResponseScript,
            }),
          },
        );
        newRequests.push({ ...newRequest, collectionId: newCollection.id });
      }

      setBootstrap((current) =>
        current
          ? {
              ...current,
              projects: current.projects.map((p) =>
                p.id === projectId
                  ? {
                      ...p,
                      collections: [...p.collections, newCollection],
                      requests: [...p.requests, ...newRequests],
                    }
                  : p,
              ),
            }
          : current,
      );
      setCollectionMenu(null);
      toast.success("Coleção duplicada.");
    } catch {
      toast.error("Falha ao duplicar coleção.");
    }
  }

  async function handleDuplicateRequest(request: BootstrapRequest, projectId: string) {
    try {
      const newRequest = await requestJson<BootstrapRequest>(
        `/projects/${projectId}/requests`,
        {
          method: "POST",
          body: JSON.stringify({
            name: `${request.name} (cópia)`,
            method: request.method,
            url: request.url,
            collectionId: request.collectionId,
            headers: meaningfulKeyValues(request.headers),
            queryParams: meaningfulKeyValues(request.queryParams),
            bodyType: request.bodyType,
            body: request.body,
            formData: meaningfulFormData(request.formData),
            postResponseScript: request.postResponseScript,
          }),
        },
      );

      setBootstrap((current) =>
        current
          ? {
              ...current,
              projects: current.projects.map((p) =>
                p.id === projectId
                  ? {
                      ...p,
                      requests: [
                        ...p.requests,
                        { ...newRequest, collectionId: request.collectionId },
                      ],
                    }
                  : p,
              ),
            }
          : current,
      );
      toast.success("Request duplicada.");
    } catch {
      toast.error("Falha ao duplicar request.");
    }
  }

  function updateEnvironmentState(
    updater: (environment: Environment) => Environment,
  ) {
    if (!selectedProject || !selectedEnvironment) {
      return;
    }

    setBootstrap((current) =>
      current
        ? {
            ...current,
            projects: current.projects.map((project) =>
              project.id === selectedProject.id
                ? {
                    ...project,
                    environments: project.environments.map((environment) =>
                      environment.id === selectedEnvironment.id
                        ? updater(environment)
                        : environment,
                    ),
                  }
                : project,
            ),
          }
        : current,
    );
  }

  if (isSessionLoading) {
    return (
      <main className="min-h-screen grid place-items-center p-8">
        <Card className="w-full max-w-lg backdrop-blur-xl">
          <CardHeader>
            <p className="text-[0.7rem] uppercase tracking-widest text-primary font-semibold">
              DevHttp
            </p>
            <CardTitle className="text-2xl font-bold">Restaurando sessão</CardTitle>
            <CardDescription>
              Validando cookies de sessão e carregando seu workspace.
            </CardDescription>
          </CardHeader>
        </Card>
      </main>
    );
  }

  if (!auth) {
    return (
      <main className="min-h-screen grid place-items-center p-8">
        <Card className="w-full max-w-lg backdrop-blur-xl">
          <CardHeader className="items-center text-center gap-2">
            <p className="text-4xl font-bold tracking-tight text-primary">DevHttp</p>
            <CardTitle className="text-2xl font-bold">Redirecionando para login</CardTitle>
            <CardDescription>
              Sua sessão não está ativa. Encaminhando para a tela de autenticação.
            </CardDescription>
          </CardHeader>
          <CardContent>{feedback ? <p className="text-sm text-destructive">{feedback}</p> : null}</CardContent>
        </Card>
      </main>
    );
  }

  if (!bootstrap) {
    return (
      <main className="min-h-screen grid place-items-center p-8">
        <Card className="w-full max-w-lg backdrop-blur-xl">
          <CardHeader>
            <p className="text-[0.7rem] uppercase tracking-widest text-primary font-semibold">
              DevHttp
            </p>
            <CardTitle className="text-2xl font-bold">Falha ao carregar o workspace</CardTitle>
            <CardDescription>
              Não foi possível carregar os dados da sessão atual.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            {feedback ? <p className="text-sm text-destructive">{feedback}</p> : null}
            <Button
              onClick={() => {
                setAuth(null);
              }}
              size="lg"
              className="w-full"
            >
              Voltar para login
            </Button>
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <>
      <div className="h-screen flex flex-col overflow-hidden">
        {hasDesktopBridge && (
          <div
            className={cn(
              "shrink-0 h-9 flex items-center bg-sidebar border-b border-border/30 select-none",
              desktopPlatform !== "darwin" && "desktop-titlebar-drag",
            )}
            onDoubleClick={handleDesktopTitleBarDoubleClick}
            onPointerDown={handleDesktopTitleBarPointerDown}
            onPointerMove={handleDesktopTitleBarPointerMove}
            onPointerUp={finishDesktopTitleBarDrag}
            onPointerCancel={finishDesktopTitleBarDrag}
            style={{ touchAction: isWindowMaximized ? "none" : "auto" }}
          >
            <div
              className="flex items-center flex-1 px-3"
              style={
                desktopPlatform === "darwin"
                  ? { paddingLeft: 76 }
                  : usesNativeWindowControls
                    ? { paddingRight: 138 }
                    : undefined
              }
            >
              <span className="text-sm font-semibold">DevHttp</span>
            </div>
            {!usesNativeWindowControls && desktopPlatform !== "darwin" && (
              <div
                className="flex h-full desktop-titlebar-no-drag"
                data-titlebar-no-drag="true"
              >
                <button
                  onClick={() => window.devHttpDesktop?.minimizeWindow()}
                  data-titlebar-no-drag="true"
                  className="flex items-center justify-center w-11 h-full text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors desktop-titlebar-no-drag"
                  title="Minimizar"
                  type="button"
                >
                  ─
                </button>
                <button
                  onClick={() => window.devHttpDesktop?.maximizeWindow()}
                  data-titlebar-no-drag="true"
                  className="flex items-center justify-center w-11 h-full text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors desktop-titlebar-no-drag"
                  title={isWindowMaximized ? "Restaurar" : "Maximizar"}
                  type="button"
                >
                  {isWindowMaximized ? "❐" : "□"}
                </button>
                <button
                  onClick={() => window.devHttpDesktop?.closeWindow()}
                  data-titlebar-no-drag="true"
                  className="flex items-center justify-center w-11 h-full text-muted-foreground hover:bg-red-500/80 hover:text-white transition-colors desktop-titlebar-no-drag"
                  title="Fechar"
                  type="button"
                >
                  ✕
                </button>
              </div>
            )}
          </div>
        )}
      <main
        className={cn(
          "flex-1 overflow-hidden grid transition-[grid-template-columns] duration-200 max-[1180px]:grid-cols-1",
          sidebarCollapsed && "grid-cols-[0px_minmax(0,1fr)]",
        )}
        style={sidebarCollapsed ? undefined : { gridTemplateColumns: `${sidebarWidth}px minmax(0, 1fr)` }}
      >
        <aside
          className={cn(
            "relative border-r border-border bg-sidebar backdrop-blur-md flex flex-col gap-3 overflow-hidden min-w-0 transition-all duration-200 max-[1180px]:border-r-0 max-[1180px]:border-b",
            sidebarCollapsed ? "p-0 w-0 opacity-0" : "p-3",
          )}
        >
          <div className="min-h-0 flex-1 overflow-y-auto pl-0.5 pr-1 grid gap-3 content-start">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h1 className="text-lg font-bold leading-tight">DevHttp</h1>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {bootstrap.user.name} · {bootstrap.membership.role}
                </p>
              </div>
              <button
                onClick={handleToggleSidebar}
                className="flex items-center justify-center w-6 h-6 rounded-md border border-border/50 hover:bg-muted/50 text-muted-foreground hover:text-foreground transition-colors"
                title="Recolher sidebar"
                type="button"
              >
                ←
              </button>
            </div>

            <div className="flex items-center gap-2">
              <WorkspaceSelect
                workspaceId={auth.workspaceId}
                workspaces={auth.workspaces}
                onChange={handleWorkspaceChange}
              />
              <div ref={notificationsRef}>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8 shrink-0"
                  onClick={() => {
                    if (notificationsAnchor) {
                      setNotificationsAnchor(null);
                    } else if (notificationsRef.current) {
                      const rect = notificationsRef.current.getBoundingClientRect();
                      setNotificationsAnchor({ x: rect.left, y: rect.bottom + 4 });
                    }
                  }}
                  title="Notificações"
                >
                  <Bell className="size-4" />
                  {notifications.some((item) => !item.readAt) ? (
                    <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-destructive" />
                  ) : null}
                </Button>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Input
                value={projectSearch}
                onChange={(event) => setProjectSearch(event.target.value)}
                placeholder="Pesquisar projeto"
                className="h-8"
              />
              <div ref={newMenuRef}>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8 shrink-0"
                  onClick={() => {
                    if (newMenuAnchor) {
                      setNewMenuAnchor(null);
                    } else if (newMenuRef.current) {
                      const rect = newMenuRef.current.getBoundingClientRect();
                      setNewMenuAnchor({ x: rect.left, y: rect.bottom + 4 });
                    }
                  }}
                  title="Novo"
                >
                  +
                </Button>
              </div>
              <div className="relative">
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8 shrink-0"
                  onClick={() => setIsMenuOpen((current) => !current)}
                  title="Acoes do projeto"
                  disabled={!selectedProject}
                >
                  ...
                </Button>
                {isMenuOpen ? (
                  <div className="absolute right-0 top-10 z-20 min-w-44 rounded-lg border border-border bg-popover p-1 shadow-xl">
                    <button
                      type="button"
                      className="w-full rounded-md px-3 py-2 text-left text-sm hover:bg-muted"
                      onClick={() => fileInputRef.current?.click()}
                    >
                      Importar
                    </button>
                    <button
                      type="button"
                      className="w-full rounded-md px-3 py-2 text-left text-sm hover:bg-muted"
                      onClick={() => void handleExport()}
                    >
                      Exportar
                    </button>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="application/json"
                      multiple
                      className="hidden"
                      onChange={handleImport}
                    />
                  </div>
                ) : null}
              </div>
            </div>

            <EnvironmentSelect
              value={selectedEnvironmentId}
              environments={selectedProject?.environments ?? []}
              onChange={setSelectedEnvironmentId}
              disabled={!selectedProject}
            />

            <div className="grid gap-2">
            {filteredProjects.map((project) => {
              const isActiveProject = project.id === selectedProjectId;

              return (
                <section
                  key={project.id}
                  className={cn(
                    "rounded-lg border transition-colors overflow-hidden",
                    isActiveProject ? "border-primary/40 bg-primary/5" : "border-border/70",
                  )}
                >
                  <div className="flex items-start gap-2 px-3 py-2">
                    <button
                      type="button"
                      onClick={() => {
                        if (project.id === selectedProjectId) {
                          setIsProjectMinimized((prev) => !prev);
                        } else {
                          selectProject(project.id);
                          setIsProjectMinimized(false);
                        }
                      }}
                      className="flex-1 text-left min-w-0"
                    >
                      <div className="flex items-center gap-1">
                        <strong className="block text-sm font-medium truncate">{project.name}</strong>
                        {isActiveProject ? (
                          <ChevronDown
                            className={cn(
                              "h-3.5 w-3.5 transition-transform shrink-0 text-muted-foreground",
                              isProjectMinimized && "-rotate-90",
                            )}
                          />
                        ) : null}
                      </div>
                      {project.description ? (
                        <span className="text-xs text-muted-foreground truncate">{project.description}</span>
                      ) : null}
                    </button>
                    {canRenameProjectEntities ? (
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          openRenameModal("project", project.id, project.name, project.id);
                        }}
                        className="mt-0.5 flex items-center justify-center w-6 h-6 rounded-md border border-transparent text-muted-foreground hover:border-border hover:bg-muted/40 hover:text-foreground transition-colors shrink-0"
                        title="Renomear projeto"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        openDeleteProjectModal(project);
                      }}
                      className="mt-0.5 flex items-center justify-center w-6 h-6 rounded-md border border-transparent text-muted-foreground hover:border-destructive/40 hover:bg-destructive/10 hover:text-destructive transition-colors shrink-0"
                      title="Remover projeto"
                    >
                      x
                    </button>
                  </div>

                  {isActiveProject && !isProjectMinimized ? (
                    <div className="border-t border-border/60 px-3 py-2 grid gap-3">
                      <div className="grid gap-0.5">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[0.65rem] uppercase tracking-widest text-muted-foreground font-semibold">
                            Colecoes
                          </span>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => openCreateModal("collection")}
                            title="Nova colecao"
                          >
                            +
                          </Button>
                        </div>

                        {project.collections.length > 0 ? (
                          <DndContext
                            collisionDetection={closestCenter}
                            onDragEnd={(event) => void handleCollectionDragEnd(project.id, event)}
                          >
                            <SortableContext
                              items={project.collections.map((c) => c.id)}
                              strategy={verticalListSortingStrategy}
                            >
                              {project.collections.map((collection) => (
                                <SortableCollectionItem
                                  key={collection.id}
                                  collection={collection}
                                  collectionRequests={project.requests.filter(
                                    (r) => r.collectionId === collection.id,
                                  )}
                                  isExpanded={expandedCollectionIds.includes(collection.id)}
                                  isSelected={selectedCollectionId === collection.id}
                                  canRename={canRenameProjectEntities}
                                  activeTabId={activeTabId}
                                  tabMethodByRequestId={tabMethodByRequestId}
                                  onSelectCollection={selectCollection}
                                  onRenameCollection={(id, name) =>
                                    openRenameModal("collection", id, name, project.id)
                                  }
                                  onOpenMenu={(id, x, y) =>
                                    setCollectionMenu((prev) =>
                                      prev?.id === id
                                        ? null
                                        : { id, projectId: project.id, x, y },
                                    )
                                  }
                                  onSelectRequest={selectRequest}
                                  onRenameRequest={(id, name) =>
                                    openRenameModal("request", id, name, project.id)
                                  }
                                  onDuplicateRequest={(req) =>
                                    void handleDuplicateRequest(req, project.id)
                                  }
                                  onRequestDragEnd={(collId, event) =>
                                    void handleRequestDragEnd(project.id, collId, event)
                                  }
                                />
                              ))}
                            </SortableContext>
                          </DndContext>
                        ) : (
                          <p className="text-xs text-muted-foreground px-1">
                            Nenhuma colecao criada.
                          </p>
                        )}
                      </div>

                      <div className="grid gap-2">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[0.65rem] uppercase tracking-widest text-muted-foreground font-semibold">
                            Ambientes
                          </span>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => openCreateModal("environment")}
                            title="Novo ambiente"
                          >
                            +
                          </Button>
                        </div>

                        {project.environments.length > 0 ? (
                          <DndContext
                            collisionDetection={closestCenter}
                            onDragEnd={(event) => void handleEnvironmentDragEnd(project.id, event)}
                          >
                            <SortableContext
                              items={project.environments.map((e) => e.id)}
                              strategy={verticalListSortingStrategy}
                            >
                              {project.environments.map((environment) => (
                                <SortableEnvironmentItem
                                  key={environment.id}
                                  environment={environment}
                                  isActive={activeTabId === `env-${environment.id}`}
                                  onSelect={selectEnvironment}
                                />
                              ))}
                            </SortableContext>
                          </DndContext>
                        ) : (
                          <p className="text-xs text-muted-foreground px-1">
                            Nenhum ambiente criado.
                          </p>
                        )}
                      </div>
                    </div>
                  ) : null}
                </section>
              );
            })}

            {filteredProjects.length === 0 ? (
              <p className="text-xs text-muted-foreground px-1">
                Nenhum projeto encontrado.
              </p>
            ) : null}
            </div>
          </div>

          <div className="mt-auto border-t border-border/60 pt-2">
            <div ref={userMenuRef} className="relative">
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded-lg border border-border/60 bg-card/70 px-3 py-2 text-left hover:bg-muted/40 transition-colors"
                onClick={() => setIsUserMenuOpen((current) => !current)}
              >
                <UserAvatar user={bootstrap.user} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{bootstrap.user.name}</p>
                  <p className="truncate text-xs text-muted-foreground">{bootstrap.user.email}</p>
                </div>
                <span className="text-muted-foreground">⋯</span>
              </button>

              {isUserMenuOpen ? (
                <div className="absolute bottom-[calc(100%+0.5rem)] left-0 right-0 z-30 rounded-xl border border-border bg-popover p-1 shadow-xl">
                  <button
                    type="button"
                    className="w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-muted"
                    onClick={() => openSettings("profile")}
                  >
                    Configurações
                  </button>
                  <button
                    type="button"
                    className="w-full rounded-lg px-3 py-2 text-left text-sm text-destructive hover:bg-destructive/10"
                    onClick={() => void handleLogout()}
                  >
                    Sair
                  </button>
                </div>
              ) : null}
            </div>
          </div>

          {!sidebarCollapsed && (
            <div
              className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-primary/40 active:bg-primary/60 transition-colors z-10"
              onMouseDown={handleResizeStart}
            />
          )}
        </aside>

        <section className="p-3 flex flex-col gap-2 min-h-0 overflow-hidden">
          {sidebarCollapsed ? (
            <div className="shrink-0">
              <button
                onClick={handleToggleSidebar}
                className="flex items-center justify-center w-6 h-6 rounded-md border border-border/50 hover:bg-muted/50 text-muted-foreground hover:text-foreground transition-colors shrink-0"
                title="Expandir sidebar"
                type="button"
              >
                →
              </button>
            </div>
          ) : null}

          {openTabs.length > 0 && (
            <DndContext collisionDetection={closestCenter} onDragEnd={handleTabDragEnd}>
              <SortableContext
                items={openTabs.map((t) => t.tabId)}
                strategy={horizontalListSortingStrategy}
              >
                <div className="flex items-stretch overflow-x-auto -mx-3 border-b border-border/60 shrink-0">
                  {openTabs.map((tab) => {
                    const isActive = tab.tabId === activeTabId;
                    const envName =
                      tab.type === "environment"
                        ? (selectedProject?.environments.find((e) => e.id === tab.environmentId)?.name ?? "Ambiente")
                        : "";
                    const fullLabel = tab.type === "request" ? tab.draft.name : envName;
                    const method = tab.type === "request" ? tab.draft.method : null;

                    return (
                      <SortableTab
                        key={tab.tabId}
                        tab={tab}
                        isActive={isActive}
                        envName={envName}
                        fullLabel={fullLabel}
                        method={method}
                        isEnvironmentDirty={isEnvironmentDirty}
                        environmentConflictId={environmentConflictId}
                        selectedEnvironmentId={selectedEnvironmentId}
                        onActivate={() => activateTab(tab.tabId)}
                        onClose={() => requestCloseTab(tab.tabId)}
                      />
                    );
                  })}
                </div>
              </SortableContext>
            </DndContext>
          )}

          {openTabs.length === 0 ? (
            <div className="grid place-items-center py-24">
              <div className="text-center grid gap-3">
                {selectedProject ? (
                  <>
                    <p className="text-muted-foreground text-sm">Nenhuma request aberta</p>
                    <Button onClick={() => handleCreateNewRequest()}>
                      + Nova request
                    </Button>
                  </>
                ) : (
                  <div ref={editorNewMenuRef} className="relative inline-block">
                    <Button
                      onClick={() => setIsEditorNewMenuOpen((c) => !c)}
                    >
                      + Novo
                    </Button>
                    {isEditorNewMenuOpen ? (
                      <div className="absolute left-1/2 -translate-x-1/2 top-10 z-20 min-w-36 rounded-lg border border-border bg-popover p-1 shadow-xl">
                        <button
                          type="button"
                          className="w-full rounded-md px-3 py-2 text-left text-sm hover:bg-muted"
                          onClick={() => openCreateModal("workspace")}
                        >
                          Workspace
                        </button>
                        <button
                          type="button"
                          className="w-full rounded-md px-3 py-2 text-left text-sm hover:bg-muted"
                          onClick={() => openCreateModal("project")}
                        >
                          Projeto
                        </button>
                      </div>
                    ) : null}
                  </div>
                )}
              </div>
            </div>
          ) : activePanel === "request" ? (
            <div
              ref={requestResponseContainerRef}
              className="flex-1 min-h-0 grid lg:gap-0"
              style={
                isDesktopEditorLayout
                  ? {
                      gridTemplateRows: `${requestPaneRatio * 100}% 12px minmax(0, 1fr)`,
                    }
                  : undefined
              }
            >
              <div className="flex flex-col gap-3 lg:min-h-0 lg:overflow-hidden lg:h-full pt-3">
                  <div className="flex gap-2 max-[720px]:grid max-[720px]:grid-cols-1 shrink-0">
                    <MethodSelect
                      value={draftRequest.method}
                      onChange={(method) => updateDraft("method", method as HttpMethod)}
                      methods={METHODS}
                      className="w-28"
                    />
                    <VariableHighlightInput
                      value={draftRequest.url}
                      onChange={(val) => updateDraft("url", val)}
                      variables={selectedEnvironment?.variables ?? []}
                      environmentName={selectedEnvironment?.name}
                      onUpdateVariable={(name, val) =>
                        updateEnvironmentState((env) => ({
                          ...env,
                          variables: env.variables.map((v) =>
                            v.key === name ? { ...v, value: val } : v,
                          ),
                        }))
                      }
                      placeholder="https://api.exemplo.com/resource"
                      className="flex-1"
                    />
                    {isDirty || isSaving ? (
                      <Button
                        variant="outline"
                        onClick={handleSaveRequest}
                        className="shrink-0 px-4"
                        disabled={isSaving}
                      >
                        {isSaving ? "Salvando..." : "Salvar"}
                      </Button>
                    ) : null}
                    <Button onClick={handleExecute} className="shrink-0 px-4" disabled={isExecuting}>
                      {isExecuting ? "Enviando..." : "Enviar"}
                    </Button>
                  </div>

                  <Tabs
                    value={activeTab}
                    onValueChange={(value) => setActiveTab(value as typeof activeTab)}
                    className="flex-1 min-h-0 flex flex-col overflow-hidden"
                  >
                    <TabsList className="shrink-0">
                      <TabsTrigger value="headers">Headers</TabsTrigger>
                      <TabsTrigger value="queryParams">Query Params</TabsTrigger>
                      <TabsTrigger value="body">Body</TabsTrigger>
                      <TabsTrigger value="script">Script</TabsTrigger>
                    </TabsList>

                    <TabsContent value="headers" className="flex-1 min-h-0 overflow-y-auto mt-2">
                      <div className="flex items-center justify-between mb-3">
                        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          Headers
                        </span>
                        <Button variant="ghost" size="sm" onClick={() => addRow("headers")}>
                          + Adicionar
                        </Button>
                      </div>
                      <KeyValueEditor
                        rows={draftRequest.headers}
                        onChange={(rowId, key, value) => updateKeyValue("headers", rowId, key, value)}
                        onRemove={(rowId) => removeRow("headers", rowId)}
                        variables={selectedEnvironment?.variables ?? []}
                        environmentName={selectedEnvironment?.name}
                        onUpdateVariable={(name, val) =>
                          updateEnvironmentState((env) => ({
                            ...env,
                            variables: env.variables.map((v) =>
                              v.key === name ? { ...v, value: val } : v,
                            ),
                          }))
                        }
                      />
                    </TabsContent>

                    <TabsContent value="queryParams" className="flex-1 min-h-0 overflow-y-auto mt-2">
                      <div className="flex items-center justify-between mb-3">
                        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          Query Params
                        </span>
                        <Button variant="ghost" size="sm" onClick={() => addRow("queryParams")}>
                          + Adicionar
                        </Button>
                      </div>
                      <KeyValueEditor
                        rows={draftRequest.queryParams}
                        onChange={(rowId, key, value) =>
                          updateKeyValue("queryParams", rowId, key, value)
                        }
                        onRemove={(rowId) => removeRow("queryParams", rowId)}
                        variables={selectedEnvironment?.variables ?? []}
                        environmentName={selectedEnvironment?.name}
                        onUpdateVariable={(name, val) =>
                          updateEnvironmentState((env) => ({
                            ...env,
                            variables: env.variables.map((v) =>
                              v.key === name ? { ...v, value: val } : v,
                            ),
                          }))
                        }
                      />
                    </TabsContent>

                    <TabsContent value="body" className="flex-1 min-h-0 overflow-y-auto mt-2">
                      <div className="flex items-center justify-between mb-3">
                        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          Body
                        </span>
                        <div className="flex items-center gap-2">
                          <select
                            value={draftRequest.bodyType}
                            onChange={(event) => {
                              const nextBodyType = event.target.value as BodyType;
                              updateDraft("bodyType", nextBodyType);
                              if (nextBodyType === "form-data" && draftRequest.formData.length === 0) {
                                addFormDataField("text");
                              }
                            }}
                            className={cn(selectClass, "h-7 text-xs pl-2")}
                          >
                            <option value="json">JSON</option>
                            <option value="text">Texto</option>
                            <option value="form-urlencoded">Form URL Encoded</option>
                            <option value="form-data">Form Data</option>
                          </select>
                          {draftRequest.bodyType !== "form-data" ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => updateDraft("body", formatJsonSafely(draftRequest.body))}
                            >
                              Formatar
                            </Button>
                          ) : null}
                        </div>
                      </div>
                      {draftRequest.bodyType === "form-data" ? (
                        <FormDataEditor
                          rows={draftRequest.formData}
                          onChange={updateFormDataField}
                          onAddText={() => addFormDataField("text")}
                          onAddFile={() => addFormDataField("file")}
                        />
                      ) : (
                        <Textarea
                          value={draftRequest.body}
                          onChange={(event) => updateDraft("body", event.target.value)}
                          placeholder={`{\n  "hello": "world"\n}`}
                          className="font-mono min-h-[160px]"
                        />
                      )}
                    </TabsContent>

                    <TabsContent value="script" className="flex-1 min-h-0 overflow-y-auto mt-2">
                      <div className="mb-3">
                        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          Script pos-request
                        </span>
                      </div>
                      <Textarea
                        value={draftRequest.postResponseScript}
                        onChange={(event) => updateDraft("postResponseScript", event.target.value)}
                        placeholder={`const body = response.json();\nenv.set("token", body.token);\ntest("status 200", response.status === 200);`}
                        className="font-mono min-h-[120px]"
                      />
                    </TabsContent>
                  </Tabs>
              </div>

              <div
                className="hidden lg:flex items-center justify-center cursor-row-resize select-none"
                onMouseDown={handleRequestResponseResizeStart}
              >
                <div className="h-2 w-full rounded-full bg-border/70 hover:bg-primary/50 transition-colors" />
              </div>

              <div className="flex flex-col gap-2 lg:min-h-0 lg:overflow-hidden lg:h-full border-t border-border/40 lg:border-t-0 lg:border-l pt-2">
                  <Tabs
                    value={responseView}
                    onValueChange={(value) => setResponseView(value as "response" | "console")}
                    className="flex-1 min-h-0 flex flex-col overflow-hidden"
                  >
                    <div className="flex items-center justify-between gap-3 shrink-0">
                      <TabsList>
                        <TabsTrigger value="response">Resposta</TabsTrigger>
                        <TabsTrigger value="console">Console</TabsTrigger>
                      </TabsList>
                      {execution ? (
                        <div className="flex items-center gap-2">
                          <Badge
                            variant="outline"
                            className={cn(
                              "font-mono text-xs",
                              execution.status >= 200 &&
                                execution.status < 300 &&
                                "border-green-500/40 text-green-400",
                              execution.status >= 400 &&
                                execution.status < 500 &&
                                "border-yellow-500/40 text-yellow-400",
                              execution.status >= 500 && "border-red-500/40 text-red-400",
                            )}
                          >
                            {execution.status} · {execution.durationMs}ms
                          </Badge>
                          <span className="text-[0.65rem] text-muted-foreground/70" title="Origem da execução">
                            {execution.source === "desktop-local" ? "local" : execution.source === "agent-local" ? "agent" : "srv"}
                          </span>
                        </div>
                      ) : null}
                    </div>

                    <TabsContent value="response" className="mt-2 flex-1 min-h-0 overflow-y-auto">
                      {execution ? (
                        <div className="grid gap-4">
                          <pre>{formatJsonSafely(execution.bodyText || "") || execution.bodyText}</pre>
                          {execution.scriptResult ? (
                            <div className="text-sm grid gap-1">
                              <span className="font-medium text-foreground">Script</span>
                              <p className="text-muted-foreground">
                                Variaveis atualizadas: {execution.scriptResult.updatedVariables.length}
                              </p>
                              {execution.scriptResult.tests.map((test) => (
                                <p key={test.name} className="text-muted-foreground">
                                  <span className={test.passed ? "text-green-400" : "text-red-400"}>
                                    {test.passed ? "PASS" : "FAIL"}
                                  </span>
                                  {" · "}
                                  {test.name}
                                </p>
                              ))}
                              {execution.scriptResult.error ? (
                                <p className="text-destructive">{execution.scriptResult.error}</p>
                              ) : null}
                            </div>
                          ) : null}
                        </div>
                      ) : responseError?.type === "agent_required" ? (
                        <div className="grid gap-4">
                          <div className="grid gap-1.5">
                            <p className="text-sm font-medium text-foreground">
                              Destino local detectado
                            </p>
                            <p className="text-sm text-muted-foreground">
                              {responseError.message}
                            </p>
                            <p className="text-sm text-muted-foreground">
                              Para executar requests para localhost e rede privada no navegador,
                              instale o DevHttp Agent ou use o DevHttp Desktop.
                            </p>
                          </div>
                          <div className="flex flex-wrap gap-3">
                            <a
                              href={AGENT_DOWNLOAD_URL}
                              className={buttonVariants({ variant: "default" })}
                            >
                              Baixar DevHttp Agent
                            </a>
                            <a
                              href={DESKTOP_DOWNLOAD_URL}
                              className={buttonVariants({ variant: "outline" })}
                            >
                              Baixar DevHttp Desktop
                            </a>
                          </div>
                        </div>
                      ) : (
                        <p className="text-sm text-muted-foreground">
                          Execute uma request para visualizar status, headers e payload.
                        </p>
                      )}
                    </TabsContent>

                    <TabsContent value="console" className="mt-2 flex-1 min-h-0 overflow-y-auto">
                      {execution ? (
                        <ExecutionConsoleViewer consoleData={execution.console} />
                      ) : (
                        <p className="text-sm text-muted-foreground">
                          Execute uma request para visualizar o console da execução.
                        </p>
                      )}
                    </TabsContent>
                  </Tabs>
              </div>
            </div>
          ) : (
            <Card className="backdrop-blur-md flex-1 min-h-0 overflow-y-auto">
              <CardContent className="p-4 grid gap-4">
                <div>
                  <p className="text-[0.65rem] uppercase tracking-widest text-primary font-semibold mb-1">
                    Variaveis de ambiente
                  </p>
                  <h3 className="text-lg font-semibold">
                    {selectedEnvironment?.name ?? "Selecione um ambiente"}
                  </h3>
                </div>

                {selectedEnvironment ? (
                  <>
                    <Input
                      value={selectedEnvironment.name}
                      onChange={(event) =>
                        updateEnvironmentState((environment) => ({
                          ...environment,
                          name: event.target.value,
                        }))
                      }
                      placeholder="Nome do ambiente"
                    />
                    <VariableEditor
                      variables={selectedEnvironment.variables}
                      onChange={(variables) =>
                        updateEnvironmentState((environment) => ({
                          ...environment,
                          variables,
                        }))
                      }
                    />
                    {(isEnvironmentDirty || isEnvironmentSaving) ? (
                      <Button
                        onClick={() => void handleSaveEnvironment()}
                        disabled={isEnvironmentSaving}
                        size="sm"
                        className="self-start"
                      >
                        {isEnvironmentSaving ? "Salvando..." : "Salvar"}
                      </Button>
                    ) : null}
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Selecione um ambiente no sidebar para editar suas variaveis.
                  </p>
                )}
              </CardContent>
            </Card>
          )}

        </section>
      </main>
      </div>

      <CreateItemModal
        open={createModalType !== null}
        title={
          createModalType === "workspace"
            ? "Novo workspace"
            : createModalType === "project"
              ? "Novo projeto"
              : createModalType === "collection"
                ? "Nova colecao"
                : "Novo ambiente"
        }
        value={createName}
        onChange={setCreateName}
        onClose={() => {
          setCreateModalType(null);
          setCreateName("");
        }}
        onSubmit={() => void handleCreateEntity()}
      />

      <DeleteProjectModal
        open={deleteProjectTarget !== null}
        projectName={deleteProjectTarget?.name ?? ""}
        confirmationValue={deleteProjectConfirmation}
        onChange={setDeleteProjectConfirmation}
        onClose={() => {
          setDeleteProjectTarget(null);
          setDeleteProjectConfirmation("");
        }}
        onSubmit={() => void handleDeleteProject()}
      />

      <UnsavedRequestModal
        open={pendingCloseTab !== null}
        requestName={pendingCloseTab?.draft.name ?? ""}
        isSaving={pendingCloseTab?.isSaving ?? false}
        onCancel={() => setPendingCloseTabId(null)}
        onDiscard={handleDiscardAndCloseTab}
        onSave={() => void handleSaveAndCloseTab()}
      />

      <SettingsModal
        open={isSettingsOpen}
        tab={settingsTab}
        user={bootstrap?.user ?? null}
        profileForm={profileForm}
        avatarSource={avatarSource}
        avatarZoom={avatarZoom}
        avatarOffsetX={avatarOffsetX}
        avatarOffsetY={avatarOffsetY}
        themeMode={themeMode}
        passwordForm={passwordForm}
        isProfileDirty={isProfileDirty}
        isAppearanceDirty={isAppearanceDirty}
        isPasswordDirty={isPasswordDirty}
        isProfileSaving={isProfileSaving}
        isAppearanceSaving={isAppearanceSaving}
        isPasswordSaving={isPasswordSaving}
        workspaceName={bootstrap?.workspace.name ?? ""}
        workspaceRole={(bootstrap?.membership.role ?? "viewer") as WorkspaceMember["role"]}
        workspaceMembers={workspaceMembers}
        workspaceInvites={workspaceInvites}
        workspaceInviteForm={workspaceInviteForm}
        isWorkspaceSaving={isWorkspaceSaving}
        canRenameWorkspace={canRenameWorkspace}
        onTabChange={setSettingsTab}
        onClose={closeSettings}
        onProfileFieldChange={(key, value) =>
          setProfileForm((current) => ({
            ...current,
            [key]: value,
          }))
        }
        onAvatarFileChange={(event) => void handleAvatarFileChange(event)}
        onAvatarRemove={() => {
          setProfileForm((current) => ({ ...current, avatarUrl: "" }));
          setAvatarSource("");
          setAvatarZoom(1);
          setAvatarOffsetX(0);
          setAvatarOffsetY(0);
        }}
        onAvatarZoomChange={setAvatarZoom}
        onAvatarOffsetXChange={setAvatarOffsetX}
        onAvatarOffsetYChange={setAvatarOffsetY}
        onSaveProfile={() => void handleSaveProfile()}
        onThemeModeChange={(value) => {
          setThemeMode(value);
          applyTheme(value);
        }}
        onSaveAppearance={() => void handleSaveAppearance()}
        onPasswordFieldChange={(key, value) =>
          setPasswordForm((current) => ({
            ...current,
            [key]: value,
          }))
        }
        onSavePassword={() => void handleChangePassword()}
        onWorkspaceInviteFieldChange={(key, value) =>
          setWorkspaceInviteForm((current) => ({
            ...current,
            [key]: value,
          }))
        }
        onSaveWorkspaceInvite={() => void handleCreateWorkspaceInvite()}
        onRenameWorkspace={() => openRenameModal("workspace", bootstrap.workspace.id, bootstrap.workspace.name)}
        onUpdateWorkspaceMemberRole={(memberUserId, role) =>
          void handleUpdateWorkspaceMemberRole(memberUserId, role)
        }
        onRemoveWorkspaceMember={(memberUserId) => void handleRemoveWorkspaceMember(memberUserId)}
        onRevokeWorkspaceInvite={(inviteId) => void handleRevokeWorkspaceInvite(inviteId)}
      />

      <RenameItemModal
        open={renameModal !== null}
        title={
          renameModal?.type === "workspace"
            ? "Renomear workspace"
            : renameModal?.type === "project"
              ? "Renomear projeto"
              : renameModal?.type === "collection"
                ? "Renomear coleção"
                : "Renomear request"
        }
        value={renameName}
        onChange={setRenameName}
        onClose={() => {
          setRenameModal(null);
          setRenameName("");
        }}
        onSubmit={() => void handleRenameEntity()}
      />

      {notificationsAnchor && createPortal(
        <div
          ref={notificationsPanelRef}
          style={{ position: "fixed", left: notificationsAnchor.x, top: notificationsAnchor.y, zIndex: 9999 }}
          className="w-80 rounded-xl border border-border bg-popover p-2 shadow-xl"
        >
          <div className="mb-2 flex items-center justify-between px-2">
            <p className="text-sm font-semibold">Notificações</p>
            <span className="text-xs text-muted-foreground">{notifications.length}</span>
          </div>
          <div className="grid gap-2">
            {notifications.length === 0 ? (
              <p className="px-2 py-3 text-sm text-muted-foreground">
                Nenhuma notificação pendente.
              </p>
            ) : (
              notifications.map((notification) => (
                <div
                  key={notification.id}
                  className="rounded-lg border border-border/60 bg-card/70 p-3"
                >
                  <p className="text-sm font-medium">{notification.title}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{notification.body}</p>
                  {notification.invite ? (
                    <div className="mt-3 flex gap-2">
                      <Button
                        size="sm"
                        onClick={() => void handleWorkspaceInviteAction(notification, "accept")}
                      >
                        Aceitar
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => void handleWorkspaceInviteAction(notification, "decline")}
                      >
                        Recusar
                      </Button>
                    </div>
                  ) : null}
                </div>
              ))
            )}
          </div>
        </div>,
        document.body,
      )}

      {newMenuAnchor && createPortal(
        <div
          ref={newMenuPanelRef}
          style={{ position: "fixed", left: newMenuAnchor.x, top: newMenuAnchor.y, zIndex: 9999 }}
          className="min-w-36 rounded-lg border border-border bg-popover p-1 shadow-xl"
        >
          <button
            type="button"
            className="w-full rounded-md px-3 py-2 text-left text-sm hover:bg-muted"
            onClick={() => { setNewMenuAnchor(null); openCreateModal("workspace"); }}
          >
            Workspace
          </button>
          <button
            type="button"
            className="w-full rounded-md px-3 py-2 text-left text-sm hover:bg-muted"
            onClick={() => { setNewMenuAnchor(null); openCreateModal("project"); }}
          >
            Projeto
          </button>
        </div>,
        document.body,
      )}

      {collectionMenu && createPortal(
        <div
          style={{ position: "fixed", left: collectionMenu.x, top: collectionMenu.y, zIndex: 9999 }}
          className="min-w-44 rounded-lg border border-border bg-popover p-1 shadow-xl"
        >
          <button
            type="button"
            className="w-full rounded-md px-3 py-2 text-left text-sm hover:bg-muted"
            onClick={() => { setCollectionMenu(null); handleCreateNewRequest(collectionMenu.id); }}
          >
            Nova request
          </button>
          <button
            type="button"
            className="w-full rounded-md px-3 py-2 text-left text-sm hover:bg-muted"
            onClick={() => { setCollectionMenu(null); openCreateModal("collection"); }}
          >
            Nova coleção
          </button>
          {canRenameProjectEntities ? (
            <button
              type="button"
              className="w-full rounded-md px-3 py-2 text-left text-sm hover:bg-muted"
              onClick={() => {
                const col = bootstrap?.projects
                  .find((p) => p.id === collectionMenu.projectId)
                  ?.collections.find((c) => c.id === collectionMenu.id);
                if (col) void handleDuplicateCollection(col, collectionMenu.projectId);
              }}
            >
              Duplicar coleção
            </button>
          ) : null}
        </div>,
        document.body,
      )}
    </>
  );
}

function KeyValueEditor({
  rows,
  onChange,
  onRemove,
  variables = [],
  onUpdateVariable,
  environmentName,
}: {
  rows: KeyValue[];
  onChange: (rowId: string, key: keyof KeyValue, value: string | boolean) => void;
  onRemove: (rowId: string) => void;
  variables?: Variable[];
  onUpdateVariable?: (name: string, value: string) => void;
  environmentName?: string;
}) {
  return (
    <div className="grid gap-2">
      {rows.map((row) => (
        <div key={row.id} className="grid grid-cols-[1fr_1.5fr_auto_auto] gap-2 items-center max-[720px]:grid-cols-1">
          <VariableHighlightInput
            value={row.key}
            onChange={(val) => onChange(row.id, "key", val)}
            variables={variables}
            environmentName={environmentName}
            onUpdateVariable={onUpdateVariable}
            placeholder="Chave"
          />
          <VariableHighlightInput
            value={row.value}
            onChange={(val) => onChange(row.id, "value", val)}
            variables={variables}
            environmentName={environmentName}
            onUpdateVariable={onUpdateVariable}
            placeholder="Valor"
          />
          <label className="flex items-center gap-1.5 whitespace-nowrap text-xs text-muted-foreground cursor-pointer select-none">
            <Checkbox
              checked={row.enabled}
              onCheckedChange={(checked) => onChange(row.id, "enabled", checked === true)}
            />
            Ativo
          </label>
          <button
            type="button"
            onClick={() => onRemove(row.id)}
            className="flex items-center justify-center w-6 h-6 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
            title="Remover"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}

function FormDataEditor({
  rows,
  onChange,
  onAddText,
  onAddFile,
}: {
  rows: FormDataField[];
  onChange: (rowId: string, key: keyof FormDataField, value: string | boolean) => void;
  onAddText: () => void;
  onAddFile: () => void;
}) {
  return (
    <div className="grid gap-3">
      {rows.length > 0 ? (
        rows.map((row) => (
          <div
            key={row.id}
            className="grid grid-cols-[minmax(0,1fr)_110px_minmax(0,1.2fr)_auto] gap-2 items-center max-[900px]:grid-cols-1"
          >
            <Input
              value={row.key}
              onChange={(event) => onChange(row.id, "key", event.target.value)}
              placeholder="Campo"
            />
            <select
              value={row.type}
              onChange={(event) => onChange(row.id, "type", event.target.value)}
              className={cn(selectClass, "h-10")}
            >
              <option value="text">Texto</option>
              <option value="file">Arquivo</option>
            </select>
            {row.type === "file" ? (
              <Input
                value={row.src || row.value}
                onChange={(event) => {
                  onChange(row.id, "src", event.target.value);
                  onChange(row.id, "value", event.target.value);
                }}
                placeholder="Arquivo pendente de seleção"
              />
            ) : (
              <Input
                value={row.value}
                onChange={(event) => onChange(row.id, "value", event.target.value)}
                placeholder="Valor"
              />
            )}
            <label className="flex items-center gap-1.5 whitespace-nowrap text-xs text-muted-foreground cursor-pointer select-none">
              <Checkbox
                checked={row.enabled}
                onCheckedChange={(checked) => onChange(row.id, "enabled", checked === true)}
              />
              Ativo
            </label>
          </div>
        ))
      ) : (
        <p className="text-sm text-muted-foreground">
          Nenhum campo configurado para este body.
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <Button variant="ghost" size="sm" onClick={onAddText}>
          + Campo texto
        </Button>
        <Button variant="ghost" size="sm" onClick={onAddFile}>
          + Campo arquivo
        </Button>
      </div>
    </div>
  );
}

function VariableEditor({
  variables,
  onChange,
}: {
  variables: Variable[];
  onChange: (variables: Variable[]) => void;
}) {
  return (
    <div className="grid gap-2">
      {variables.map((variable, index) => (
        <div
          key={index}
          className="grid grid-cols-[1fr_1.5fr_auto] gap-2 items-center max-[720px]:grid-cols-1"
        >
          <Input
            value={variable.key}
            onChange={(event) =>
              onChange(
                variables.map((item, itemIndex) =>
                  itemIndex === index ? { ...item, key: event.target.value } : item,
                ),
              )
            }
            placeholder="Variavel"
          />
          <Input
            value={variable.value}
            onChange={(event) =>
              onChange(
                variables.map((item, itemIndex) =>
                  itemIndex === index ? { ...item, value: event.target.value } : item,
                ),
              )
            }
            placeholder="Valor"
          />
          <label className="flex items-center gap-1.5 whitespace-nowrap text-xs text-muted-foreground cursor-pointer select-none">
            <Checkbox
              checked={variable.enabled}
              onCheckedChange={(checked) =>
                onChange(
                  variables.map((item, itemIndex) =>
                    itemIndex === index ? { ...item, enabled: checked === true } : item,
                  ),
                )
              }
            />
            Ativo
          </label>
        </div>
      ))}
      <Button
        variant="ghost"
        size="sm"
        className="w-full justify-start text-muted-foreground hover:text-foreground"
        onClick={() =>
          onChange([
            ...variables,
            {
              key: "",
              value: "",
              enabled: true,
            },
          ])
        }
      >
        + Variavel
      </Button>
    </div>
  );
}

function CreateItemModal({
  open,
  title,
  value,
  onChange,
  onClose,
  onSubmit,
}: {
  open: boolean;
  title: string;
  value: string;
  onChange: (value: string) => void;
  onClose: () => void;
  onSubmit: () => void;
}) {
  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/65 p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          <CardDescription>Informe apenas o nome para criar.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <Input
            autoFocus
            value={value}
            onChange={(event) => onChange(event.target.value)}
            placeholder="Nome"
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                onSubmit();
              }
              if (event.key === "Escape") {
                onClose();
              }
            }}
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>
              Cancelar
            </Button>
            <Button onClick={onSubmit}>Criar</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function RenameItemModal({
  open,
  title,
  value,
  onChange,
  onClose,
  onSubmit,
}: {
  open: boolean;
  title: string;
  value: string;
  onChange: (value: string) => void;
  onClose: () => void;
  onSubmit: () => void;
}) {
  if (!open) {
    return null;
  }

  const canSubmit = Boolean(value.trim());

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/65 p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          <CardDescription>Informe o novo nome do item.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <Input
            autoFocus
            value={value}
            onChange={(event) => onChange(event.target.value)}
            placeholder="Nome"
            onKeyDown={(event) => {
              if (event.key === "Enter" && canSubmit) {
                onSubmit();
              }
              if (event.key === "Escape") {
                onClose();
              }
            }}
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>
              Cancelar
            </Button>
            <Button onClick={onSubmit} disabled={!canSubmit}>
              Salvar
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function DeleteProjectModal({
  open,
  projectName,
  confirmationValue,
  onChange,
  onClose,
  onSubmit,
}: {
  open: boolean;
  projectName: string;
  confirmationValue: string;
  onChange: (value: string) => void;
  onClose: () => void;
  onSubmit: () => void;
}) {
  if (!open) {
    return null;
  }

  const canDelete = confirmationValue.trim() === projectName;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/65 p-4">
      <Card className="w-full max-w-md border-destructive/30">
        <CardHeader>
          <CardTitle>Remover projeto</CardTitle>
          <CardDescription>
            Essa ação remove o projeto, todas as coleções, ambientes e requests vinculadas.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-muted-foreground">
            Digite <strong className="text-foreground">{projectName}</strong> para confirmar.
          </div>
          <Input
            autoFocus
            value={confirmationValue}
            onChange={(event) => onChange(event.target.value)}
            placeholder="Nome do projeto"
            onKeyDown={(event) => {
              if (event.key === "Enter" && canDelete) {
                onSubmit();
              }
              if (event.key === "Escape") {
                onClose();
              }
            }}
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>
              Cancelar
            </Button>
            <Button variant="destructive" disabled={!canDelete} onClick={onSubmit}>
              Remover
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function UnsavedRequestModal({
  open,
  requestName,
  isSaving,
  onCancel,
  onDiscard,
  onSave,
}: {
  open: boolean;
  requestName: string;
  isSaving: boolean;
  onCancel: () => void;
  onDiscard: () => void;
  onSave: () => void;
}) {
  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/65 p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Salvar alterações?</CardTitle>
          <CardDescription>
            A request <strong className="text-foreground">{requestName}</strong> tem alterações não salvas.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onCancel}>
            Cancelar
          </Button>
          <Button variant="outline" onClick={onDiscard}>
            Não salvar
          </Button>
          <Button onClick={onSave} disabled={isSaving}>
            {isSaving ? "Salvando..." : "Salvar"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function UserAvatar({
  user,
  size = "md",
  srcOverride,
}: {
  user: User | null | undefined;
  size?: "sm" | "md" | "lg";
  srcOverride?: string;
}) {
  const initials = getInitials(user?.name ?? "");
  const src = srcOverride || user?.avatarUrl || "";
  const sizeClass = size === "sm" ? "h-9 w-9" : size === "lg" ? "h-20 w-20" : "h-10 w-10";

  if (src) {
    return (
      <div className={cn("shrink-0 overflow-hidden rounded-full border border-border/60 bg-muted", sizeClass)}>
        <img src={src} alt={user?.name ?? "Avatar do usuário"} className="h-full w-full object-cover" />
      </div>
    );
  }

  return (
    <div
      className={cn(
        "shrink-0 grid place-items-center rounded-full border border-border/60 bg-muted text-xs font-semibold uppercase text-foreground",
        sizeClass,
      )}
    >
      {initials}
    </div>
  );
}

function SettingsModal({
  open,
  tab,
  user,
  profileForm,
  avatarSource,
  avatarZoom,
  avatarOffsetX,
  avatarOffsetY,
  themeMode,
  passwordForm,
  isProfileDirty,
  isAppearanceDirty,
  isPasswordDirty,
  isProfileSaving,
  isAppearanceSaving,
  isPasswordSaving,
  workspaceName,
  workspaceRole,
  workspaceMembers,
  workspaceInvites,
  workspaceInviteForm,
  isWorkspaceSaving,
  canRenameWorkspace,
  onTabChange,
  onClose,
  onProfileFieldChange,
  onAvatarFileChange,
  onAvatarRemove,
  onAvatarZoomChange,
  onAvatarOffsetXChange,
  onAvatarOffsetYChange,
  onSaveProfile,
  onThemeModeChange,
  onSaveAppearance,
  onPasswordFieldChange,
  onSavePassword,
  onWorkspaceInviteFieldChange,
  onSaveWorkspaceInvite,
  onRenameWorkspace,
  onUpdateWorkspaceMemberRole,
  onRemoveWorkspaceMember,
  onRevokeWorkspaceInvite,
}: {
  open: boolean;
  tab: SettingsTab;
  user: User | null;
  profileForm: ProfileFormState;
  avatarSource: string;
  avatarZoom: number;
  avatarOffsetX: number;
  avatarOffsetY: number;
  themeMode: ThemeMode;
  passwordForm: PasswordFormState;
  isProfileDirty: boolean;
  isAppearanceDirty: boolean;
  isPasswordDirty: boolean;
  isProfileSaving: boolean;
  isAppearanceSaving: boolean;
  isPasswordSaving: boolean;
  workspaceName: string;
  workspaceRole: WorkspaceMember["role"];
  workspaceMembers: WorkspaceMember[];
  workspaceInvites: WorkspaceInvite[];
  workspaceInviteForm: WorkspaceInviteFormState;
  isWorkspaceSaving: boolean;
  canRenameWorkspace: boolean;
  onTabChange: (tab: SettingsTab) => void;
  onClose: () => void;
  onProfileFieldChange: (key: keyof ProfileFormState, value: string) => void;
  onAvatarFileChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onAvatarRemove: () => void;
  onAvatarZoomChange: (value: number) => void;
  onAvatarOffsetXChange: (value: number) => void;
  onAvatarOffsetYChange: (value: number) => void;
  onSaveProfile: () => void;
  onThemeModeChange: (value: ThemeMode) => void;
  onSaveAppearance: () => void;
  onPasswordFieldChange: (key: keyof PasswordFormState, value: string) => void;
  onSavePassword: () => void;
  onWorkspaceInviteFieldChange: (key: keyof WorkspaceInviteFormState, value: string) => void;
  onSaveWorkspaceInvite: () => void;
  onRenameWorkspace: () => void;
  onUpdateWorkspaceMemberRole: (memberUserId: string, role: WorkspaceMember["role"]) => void;
  onRemoveWorkspaceMember: (memberUserId: string) => void;
  onRevokeWorkspaceInvite: (inviteId: string) => void;
}) {
  if (!open) {
    return null;
  }

  const avatarPreview = avatarSource || profileForm.avatarUrl;
  const canManageWorkspace = workspaceRole === "owner" || workspaceRole === "admin";

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/65 p-4">
      <Card className="w-full max-w-4xl overflow-hidden bg-background">
        <div className="grid max-h-[85vh] min-h-[32rem] md:grid-cols-[220px_minmax(0,1fr)]">
          <div className="border-b border-border/60 bg-muted/20 p-4 md:border-b-0 md:border-r">
            <div className="mb-6 flex items-center gap-3">
              <UserAvatar user={user} size="lg" srcOverride={avatarPreview} />
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{profileForm.name || user?.name || "Usuário"}</p>
                <p className="truncate text-xs text-muted-foreground">{profileForm.email || user?.email || ""}</p>
              </div>
            </div>

            <div className="grid gap-1.5">
              {[
                { id: "profile", label: "Dados Pessoais" },
                { id: "appearance", label: "Aparência" },
                { id: "security", label: "Segurança" },
                { id: "workspace", label: "Workspace" },
              ].map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onTabChange(item.id as SettingsTab)}
                  className={cn(
                    "rounded-xl px-3 py-2 text-left text-sm transition-colors",
                    tab === item.id ? "bg-primary text-primary-foreground" : "hover:bg-muted",
                  )}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex min-h-0 flex-col">
            <CardHeader className="border-b border-border/60">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <CardTitle>
                    {tab === "profile"
                      ? "Dados Pessoais"
                      : tab === "appearance"
                        ? "Aparência"
                        : tab === "security"
                          ? "Segurança"
                          : "Workspace"}
                  </CardTitle>
                  <CardDescription>
                    {tab === "profile"
                      ? "Atualize nome, email e avatar do usuário."
                      : tab === "appearance"
                        ? "Escolha como o DevHttp deve aplicar o tema."
                        : tab === "security"
                          ? "Altere a senha da sua conta com validação da senha atual."
                          : "Gerencie membros e convites do workspace atual."}
                  </CardDescription>
                </div>
                <Button variant="ghost" size="sm" onClick={onClose}>
                  Fechar
                </Button>
              </div>
            </CardHeader>

            <CardContent className="min-h-0 flex-1 overflow-y-auto p-6">
              {tab === "profile" ? (
                <div className="grid gap-6">
                  <div className="grid gap-4 lg:grid-cols-[240px_minmax(0,1fr)]">
                    <div className="grid gap-3">
                      <Label>Avatar</Label>
                      <div className="relative aspect-square overflow-hidden rounded-2xl border border-border/60 bg-muted">
                        {avatarPreview ? (
                          <img
                            src={avatarPreview}
                            alt="Preview do avatar"
                            className="absolute left-1/2 top-1/2 h-full w-full max-w-none object-cover"
                            style={{
                              transform: `translate(calc(-50% + ${avatarOffsetX}px), calc(-50% + ${avatarOffsetY}px)) scale(${avatarZoom})`,
                            }}
                          />
                        ) : (
                          <div className="grid h-full place-items-center">
                            <UserAvatar user={user} size="lg" />
                          </div>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Label className="inline-flex cursor-pointer items-center">
                          <input type="file" accept="image/*" className="hidden" onChange={onAvatarFileChange} />
                          <span className="inline-flex h-9 items-center rounded-md border border-input bg-background px-4 text-sm font-medium">
                            Escolher imagem
                          </span>
                        </Label>
                        <Button
                          variant="outline"
                          type="button"
                          onClick={onAvatarRemove}
                          disabled={!avatarPreview}
                        >
                          Remover avatar
                        </Button>
                      </div>
                    </div>

                    <div className="grid gap-4">
                      <div className="grid gap-2">
                        <Label htmlFor="profile-name">Nome</Label>
                        <Input
                          id="profile-name"
                          value={profileForm.name}
                          onChange={(event) => onProfileFieldChange("name", event.target.value)}
                          placeholder="Seu nome"
                        />
                      </div>
                      <div className="grid gap-2">
                        <Label htmlFor="profile-email">Email</Label>
                        <Input
                          id="profile-email"
                          value={profileForm.email}
                          onChange={(event) => onProfileFieldChange("email", event.target.value)}
                          placeholder="voce@empresa.com"
                          type="email"
                        />
                      </div>

                      {avatarSource ? (
                        <div className="grid gap-4 rounded-2xl border border-border/60 bg-muted/15 p-4">
                          <p className="text-sm font-medium">Ajuste do avatar</p>
                          <div className="grid gap-2">
                            <Label htmlFor="avatar-zoom">Zoom</Label>
                            <input
                              id="avatar-zoom"
                              type="range"
                              min={1}
                              max={3}
                              step={0.05}
                              value={avatarZoom}
                              onChange={(event) => onAvatarZoomChange(Number(event.target.value))}
                            />
                          </div>
                          <div className="grid gap-2">
                            <Label htmlFor="avatar-offset-x">Posição horizontal</Label>
                            <input
                              id="avatar-offset-x"
                              type="range"
                              min={-120}
                              max={120}
                              step={1}
                              value={avatarOffsetX}
                              onChange={(event) => onAvatarOffsetXChange(Number(event.target.value))}
                            />
                          </div>
                          <div className="grid gap-2">
                            <Label htmlFor="avatar-offset-y">Posição vertical</Label>
                            <input
                              id="avatar-offset-y"
                              type="range"
                              min={-120}
                              max={120}
                              step={1}
                              value={avatarOffsetY}
                              onChange={(event) => onAvatarOffsetYChange(Number(event.target.value))}
                            />
                          </div>
                        </div>
                      ) : null}
                    </div>
                  </div>

                  <div className="flex justify-end gap-2">
                    <Button variant="ghost" onClick={onClose}>
                      Cancelar
                    </Button>
                    <Button onClick={onSaveProfile} disabled={!isProfileDirty || isProfileSaving}>
                      {isProfileSaving ? "Salvando..." : "Salvar alterações"}
                    </Button>
                  </div>
                </div>
              ) : null}

              {tab === "appearance" ? (
                <div className="grid gap-6">
                  <div className="grid gap-3">
                    {[
                      {
                        value: "light" as ThemeMode,
                        label: "Claro",
                        description: "Superfície clara com contraste suave.",
                      },
                      {
                        value: "dark" as ThemeMode,
                        label: "Escuro",
                        description: "Modo escuro para sessões longas e contraste alto.",
                      },
                      {
                        value: "system" as ThemeMode,
                        label: "Sistema",
                        description: "Segue automaticamente o tema configurado no sistema operacional.",
                      },
                    ].map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => onThemeModeChange(option.value)}
                        className={cn(
                          "rounded-2xl border px-4 py-4 text-left transition-colors",
                          themeMode === option.value
                            ? "border-primary bg-primary/10"
                            : "border-border/60 hover:bg-muted/25",
                        )}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <p className="text-sm font-semibold">{option.label}</p>
                            <p className="text-sm text-muted-foreground">{option.description}</p>
                          </div>
                          <span
                            className={cn(
                              "h-3 w-3 rounded-full border",
                              themeMode === option.value
                                ? "border-primary bg-primary"
                                : "border-muted-foreground/40 bg-transparent",
                            )}
                          />
                        </div>
                      </button>
                    ))}
                  </div>

                  <div className="flex justify-end gap-2">
                    <Button variant="ghost" onClick={onClose}>
                      Cancelar
                    </Button>
                    <Button onClick={onSaveAppearance} disabled={!isAppearanceDirty || isAppearanceSaving}>
                      {isAppearanceSaving ? "Salvando..." : "Salvar aparência"}
                    </Button>
                  </div>
                </div>
              ) : null}

              {tab === "security" ? (
                <div className="grid gap-6">
                  <div className="grid gap-4">
                    <div className="grid gap-2">
                      <Label htmlFor="current-password">Senha atual</Label>
                      <Input
                        id="current-password"
                        type="password"
                        value={passwordForm.currentPassword}
                        onChange={(event) => onPasswordFieldChange("currentPassword", event.target.value)}
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="new-password">Nova senha</Label>
                      <Input
                        id="new-password"
                        type="password"
                        value={passwordForm.newPassword}
                        onChange={(event) => onPasswordFieldChange("newPassword", event.target.value)}
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="confirm-password">Confirmar nova senha</Label>
                      <Input
                        id="confirm-password"
                        type="password"
                        value={passwordForm.confirmPassword}
                        onChange={(event) => onPasswordFieldChange("confirmPassword", event.target.value)}
                      />
                    </div>
                  </div>

                  <div className="rounded-xl border border-border/60 bg-muted/20 px-4 py-3 text-sm text-muted-foreground">
                    Ao trocar a senha, todas as sessões ativas serão encerradas por segurança.
                  </div>

                  <div className="flex justify-end gap-2">
                    <Button variant="ghost" onClick={onClose}>
                      Cancelar
                    </Button>
                    <Button onClick={onSavePassword} disabled={!isPasswordDirty || isPasswordSaving}>
                      {isPasswordSaving ? "Alterando..." : "Alterar senha"}
                    </Button>
                  </div>
                </div>
              ) : null}

              {tab === "workspace" ? (
                <div className="grid gap-6">
                  <div className="rounded-2xl border border-border/60 bg-muted/20 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold">{workspaceName || "Workspace atual"}</p>
                        <p className="text-sm text-muted-foreground">
                          Seu papel atual: <span className="font-medium text-foreground">{workspaceRole}</span>
                        </p>
                      </div>
                      {canRenameWorkspace ? (
                        <Button variant="outline" size="sm" onClick={onRenameWorkspace}>
                          <Pencil className="mr-2 h-3.5 w-3.5" />
                          Renomear
                        </Button>
                      ) : null}
                    </div>
                  </div>

                  {canManageWorkspace ? (
                    <div className="grid gap-4 rounded-2xl border border-border/60 p-4">
                      <div>
                        <p className="text-sm font-semibold">Convidar por email</p>
                        <p className="text-sm text-muted-foreground">
                          O usuário receberá uma notificação para aceitar ou recusar o acesso.
                        </p>
                      </div>
                      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_180px_auto]">
                        <Input
                          type="email"
                          placeholder="usuario@empresa.com"
                          value={workspaceInviteForm.email}
                          onChange={(event) =>
                            onWorkspaceInviteFieldChange("email", event.target.value)
                          }
                        />
                        <select
                          value={workspaceInviteForm.role}
                          onChange={(event) =>
                            onWorkspaceInviteFieldChange("role", event.target.value)
                          }
                          className={selectClass}
                        >
                          <option value="viewer">Viewer</option>
                          <option value="editor">Editor</option>
                          <option value="admin">Admin</option>
                        </select>
                        <Button onClick={onSaveWorkspaceInvite} disabled={isWorkspaceSaving}>
                          {isWorkspaceSaving ? "Enviando..." : "Convidar"}
                        </Button>
                      </div>
                    </div>
                  ) : null}

                  <div className="grid gap-3">
                    <div>
                      <p className="text-sm font-semibold">Membros</p>
                      <p className="text-sm text-muted-foreground">
                        Usuários com acesso ao workspace atual.
                      </p>
                    </div>
                    <div className="grid gap-2">
                      {workspaceMembers.length === 0 ? (
                        <p className="text-sm text-muted-foreground">Nenhum membro encontrado.</p>
                      ) : (
                        workspaceMembers.map((member) => (
                          <div
                            key={member.user.id}
                            className="grid gap-3 rounded-xl border border-border/60 bg-card/70 p-3 md:grid-cols-[minmax(0,1fr)_180px_auto]"
                          >
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium">{member.user.name}</p>
                              <p className="truncate text-xs text-muted-foreground">{member.user.email}</p>
                            </div>
                            <select
                              value={member.role}
                              onChange={(event) =>
                                onUpdateWorkspaceMemberRole(
                                  member.user.id,
                                  event.target.value as WorkspaceMember["role"],
                                )
                              }
                              className={selectClass}
                              disabled={!canManageWorkspace}
                            >
                              <option value="owner">Owner</option>
                              <option value="admin">Admin</option>
                              <option value="editor">Editor</option>
                              <option value="viewer">Viewer</option>
                            </select>
                            <Button
                              variant="outline"
                              onClick={() => onRemoveWorkspaceMember(member.user.id)}
                              disabled={!canManageWorkspace || member.user.id === user?.id}
                            >
                              Remover
                            </Button>
                          </div>
                        ))
                      )}
                    </div>
                  </div>

                  {canManageWorkspace ? (
                    <div className="grid gap-3">
                      <div>
                        <p className="text-sm font-semibold">Convites pendentes</p>
                        <p className="text-sm text-muted-foreground">
                          Convites enviados e ainda não respondidos.
                        </p>
                      </div>
                      <div className="grid gap-2">
                        {workspaceInvites.length === 0 ? (
                          <p className="text-sm text-muted-foreground">
                            Nenhum convite pendente neste workspace.
                          </p>
                        ) : (
                          workspaceInvites.map((invite) => (
                            <div
                              key={invite.id}
                              className="grid gap-3 rounded-xl border border-border/60 bg-card/70 p-3 md:grid-cols-[minmax(0,1fr)_140px_auto]"
                            >
                              <div className="min-w-0">
                                <p className="truncate text-sm font-medium">{invite.email}</p>
                                <p className="truncate text-xs text-muted-foreground">
                                  Convidado por {invite.invitedBy.name}
                                </p>
                              </div>
                              <Badge variant="secondary" className="justify-center">
                                {invite.role}
                              </Badge>
                              <Button
                                variant="outline"
                                onClick={() => onRevokeWorkspaceInvite(invite.id)}
                                disabled={isWorkspaceSaving}
                              >
                                Revogar
                              </Button>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </CardContent>
          </div>
        </div>
      </Card>
    </div>
  );
}

function ExecutionConsoleViewer({ consoleData }: { consoleData: ExecutionConsole }) {
  return (
    <div className="grid gap-3 text-sm">
      <div className="rounded-lg border border-border/60 bg-muted/15 px-3 py-2 font-mono text-xs text-foreground break-all">
        {consoleData.requestLine}
      </div>

      <div className="grid gap-0 rounded-lg border border-border/40 bg-muted/40 py-2 font-mono text-xs overflow-hidden">
        {Object.entries(consoleData.sections).map(([label, value]) => (
          <ConsoleNode key={label} label={label} value={value} depth={0} defaultExpanded />
        ))}
      </div>
    </div>
  );
}

function ConsoleNode({
  label,
  value,
  depth,
  defaultExpanded = false,
}: {
  label: string;
  value: ConsoleValue;
  depth: number;
  defaultExpanded?: boolean;
}) {
  const isArray = Array.isArray(value);
  const isObject = value !== null && typeof value === "object" && !isArray;
  const isBranch = isArray || isObject;
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);

  if (!isBranch) {
    const leafValue = value as string | number | boolean | null;
    const isMultiline = typeof leafValue === "string" && leafValue.includes("\n");

    if (isMultiline) {
      return (
        <div style={{ marginLeft: `${depth * 14}px` }} className="grid gap-0.5 px-2 py-0.5 font-mono text-xs">
          <span className="text-muted-foreground">{label}:</span>
          <pre className="pl-2 whitespace-pre-wrap break-words text-green-600 dark:text-green-400/90">{leafValue}</pre>
        </div>
      );
    }

    return (
      <div
        className="flex items-baseline gap-1 px-2 py-0.5 rounded-sm hover:bg-muted/30 font-mono text-xs"
        style={{ marginLeft: `${depth * 14}px` }}
      >
        <span className="text-muted-foreground shrink-0">{label}:</span>
        <span className={consoleValueColor(leafValue)}>{formatConsoleLeaf(leafValue)}</span>
      </div>
    );
  }

  const entries = isArray
    ? value.map((entry, index) => [String(index), entry] as const)
    : Object.entries(value);

  return (
    <div className="grid gap-1" style={{ marginLeft: `${depth * 14}px` }}>
      <button
        type="button"
        className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-muted/50 transition-colors"
        onClick={() => setIsExpanded((current) => !current)}
      >
        <span className="text-[0.65rem] opacity-70">{isExpanded ? "▾" : "▸"}</span>
        <span className="text-muted-foreground">{label}</span>
        <span className="text-[0.72rem] text-muted-foreground/70">
          {isArray ? `[${entries.length}]` : `{${entries.length}}`}
        </span>
      </button>

      {isExpanded ? (
        <div className="grid gap-1">
          {entries.length > 0 ? (
            entries.map(([entryLabel, entryValue]) => (
              <ConsoleNode
                key={`${label}-${entryLabel}`}
                label={entryLabel}
                value={entryValue}
                depth={depth + 1}
              />
            ))
          ) : (
            <div
              className="px-2 py-1 text-xs text-muted-foreground"
              style={{ marginLeft: `${(depth + 1) * 14}px` }}
            >
              Vazio
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

function consoleValueColor(value: string | number | boolean | null): string {
  if (value === null) return "text-red-500/80";
  if (typeof value === "number") return "text-blue-500";
  if (typeof value === "boolean") return "text-orange-500";
  if (typeof value === "string") return "text-green-600 dark:text-green-400/90";
  return "text-foreground";
}

function formatConsoleLeaf(value: Exclude<ConsoleValue, ConsoleValue[] | { [key: string]: ConsoleValue }>) {
  if (value === null) return "null";
  if (typeof value === "string") return `"${value}"`;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}
