"use client";

import { useEffect, useState } from "react";
import { ProjectSidebar } from "@/components/project-sidebar";
import { RequestEditor } from "@/components/request-editor";
import { ResponsePanel } from "@/components/response-panel";
import { executeRequest, loadWorkspace } from "@/lib/api";
import { defaultEnvironments, defaultProjects, initialRequest } from "@/lib/default-data";
import { cloneDraft, createRow } from "@/lib/request-utils";
import {
  ApiConnectionInfo,
  Environment,
  Project,
  RequestDraft,
  RequestItem,
  ResponseSnapshot,
} from "@/lib/types";

const defaultConnection: ApiConnectionInfo = {
  state: "loading",
  message: "Carregando workspace...",
  baseUrl: null,
};

export function DevHttpShell() {
  const [projects, setProjects] = useState<Project[]>(defaultProjects);
  const [environments, setEnvironments] = useState<Environment[]>(defaultEnvironments);
  const [activeRequestId, setActiveRequestId] = useState(initialRequest.id);
  const [draft, setDraft] = useState<RequestDraft>(cloneDraft(initialRequest));
  const [selectedEnvironmentId, setSelectedEnvironmentId] = useState(
    defaultEnvironments[0]?.id ?? "",
  );
  const [connection, setConnection] = useState<ApiConnectionInfo>(defaultConnection);
  const [response, setResponse] = useState<ResponseSnapshot | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);

  const activeEnvironment =
    environments.find((environment) => environment.id === selectedEnvironmentId) ?? null;

  useEffect(() => {
    let isMounted = true;

    async function bootstrap() {
      const workspace = await loadWorkspace();

      if (!isMounted) {
        return;
      }

      setProjects(workspace.projects);
      setEnvironments(workspace.environments);
      setConnection(workspace.connection);

      const firstRequest = workspace.projects[0]?.collections[0]?.requests[0];
      const firstEnvironment = workspace.environments[0];

      if (firstRequest) {
        setActiveRequestId(firstRequest.id);
        setDraft(cloneDraft(firstRequest.draft));
      }

      if (firstEnvironment) {
        setSelectedEnvironmentId(firstEnvironment.id);
      }
    }

    void bootstrap();

    return () => {
      isMounted = false;
    };
  }, []);

  function handleSelectRequest(request: RequestItem) {
    setActiveRequestId(request.id);
    setDraft(cloneDraft(request.draft));
    setSendError(null);
  }

  function handleAddRow(section: "queryParams" | "headers") {
    setDraft((current) => ({
      ...current,
      [section]: [...current[section], createRow(section)],
    }));
  }

  async function handleSend() {
    setIsSending(true);
    setSendError(null);

    try {
      const nextResponse = await executeRequest(draft, activeEnvironment);
      setResponse(nextResponse);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Falha inesperada ao executar a request.";

      setSendError(message);
      setResponse(null);
    } finally {
      setIsSending(false);
    }
  }

  return (
    <main className="app-shell">
      <ProjectSidebar
        activeRequestId={activeRequestId}
        onSelectRequest={handleSelectRequest}
        projects={projects}
      />

      <section className="workspace">
        <header className="workspace__header">
          <div>
            <p className="eyebrow">API Connection</p>
            <h2>{connection.state === "connected" ? "REST integration online" : "Fallback local"}</h2>
            <p className="muted">{connection.message}</p>
          </div>

          <div className="workspace__controls">
            <label className="environment-select">
              <span>Environment</span>
              <select
                onChange={(event) => setSelectedEnvironmentId(event.currentTarget.value)}
                value={selectedEnvironmentId}
              >
                {environments.map((environment) => (
                  <option key={environment.id} value={environment.id}>
                    {environment.name}
                  </option>
                ))}
              </select>
            </label>

            <div className="base-url-chip">
              <span>Base URL</span>
              <strong>{connection.baseUrl ?? "not set"}</strong>
            </div>
          </div>
        </header>

        <div className="workspace__body">
          <RequestEditor
            draft={draft}
            environment={activeEnvironment}
            isSending={isSending}
            onAddRow={handleAddRow}
            onChange={setDraft}
            onSend={() => void handleSend()}
            sendError={sendError}
          />
          <ResponsePanel response={response} />
        </div>
      </section>
    </main>
  );
}
