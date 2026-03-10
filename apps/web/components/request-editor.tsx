"use client";

import { buildRequestUrl, formatBody, resolveRequest } from "@/lib/request-utils";
import { Environment, KeyValueRow, RequestDraft, RequestMethod } from "@/lib/types";

const METHODS: RequestMethod[] = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];

type RequestEditorProps = {
  draft: RequestDraft;
  environment: Environment | null;
  isSending: boolean;
  sendError: string | null;
  onChange: (nextDraft: RequestDraft) => void;
  onSend: () => void;
  onAddRow: (section: "queryParams" | "headers") => void;
};

type SectionProps = {
  title: string;
  subtitle: string;
  rows: KeyValueRow[];
  section: "queryParams" | "headers";
  onChange: (
    section: "queryParams" | "headers",
    rowId: string,
    field: keyof KeyValueRow,
    value: string | boolean,
  ) => void;
  onAddRow: (section: "queryParams" | "headers") => void;
  onRemoveRow: (section: "queryParams" | "headers", rowId: string) => void;
};

function RowsSection({
  title,
  subtitle,
  rows,
  section,
  onChange,
  onAddRow,
  onRemoveRow,
}: SectionProps) {
  return (
    <section className="editor-card">
      <div className="editor-card__header">
        <div>
          <h3>{title}</h3>
          <p>{subtitle}</p>
        </div>
        <button className="ghost-button" onClick={() => onAddRow(section)} type="button">
          Add row
        </button>
      </div>

      <div className="rows-grid">
        {rows.map((row) => (
          <div className="row-editor" key={row.id}>
            <label className="toggle">
              <input
                checked={row.enabled}
                onChange={(event) =>
                  onChange(section, row.id, "enabled", event.currentTarget.checked)
                }
                type="checkbox"
              />
              <span />
            </label>
            <input
              className="text-input"
              onChange={(event) => onChange(section, row.id, "key", event.currentTarget.value)}
              placeholder="Key"
              type="text"
              value={row.key}
            />
            <input
              className="text-input"
              onChange={(event) => onChange(section, row.id, "value", event.currentTarget.value)}
              placeholder="Value"
              type="text"
              value={row.value}
            />
            <button
              className="icon-button"
              onClick={() => onRemoveRow(section, row.id)}
              type="button"
            >
              Remove
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}

export function RequestEditor({
  draft,
  environment,
  isSending,
  sendError,
  onChange,
  onSend,
  onAddRow,
}: RequestEditorProps) {
  const resolvedRequest = resolveRequest(draft, environment);
  let resolvedPreview = resolvedRequest.url;

  try {
    if (resolvedRequest.url) {
      resolvedPreview = buildRequestUrl(resolvedRequest.url, resolvedRequest.queryParams);
    }
  } catch {
    resolvedPreview = resolvedRequest.url;
  }

  function updateRow(
    section: "queryParams" | "headers",
    rowId: string,
    field: keyof KeyValueRow,
    value: string | boolean,
  ) {
    onChange({
      ...draft,
      [section]: draft[section].map((row) =>
        row.id === rowId ? { ...row, [field]: value } : row,
      ),
    });
  }

  function removeRow(section: "queryParams" | "headers", rowId: string) {
    onChange({
      ...draft,
      [section]: draft[section].filter((row) => row.id !== rowId),
    });
  }

  function handleMethodChange(method: RequestMethod) {
    onChange({ ...draft, method });
  }

  function handleBodyFormat() {
    try {
      onChange({
        ...draft,
        body: formatBody(draft.bodyMode, draft.body),
      });
    } catch {
      // Keep invalid JSON untouched so the user can correct it manually.
    }
  }

  return (
    <div className="editor-stack">
      <section className="request-surface">
        <div className="request-surface__topline">
          <div>
            <p className="eyebrow">Request Editor</p>
            <h2>{draft.name}</h2>
            {draft.description ? <p className="muted">{draft.description}</p> : null}
          </div>
          <div className="resolved-badge">
            <span>Environment</span>
            <strong>{environment?.name ?? "No environment"}</strong>
          </div>
        </div>

        <div className="request-bar">
          <select
            className="method-select"
            onChange={(event) => handleMethodChange(event.currentTarget.value as RequestMethod)}
            value={draft.method}
          >
            {METHODS.map((method) => (
              <option key={method} value={method}>
                {method}
              </option>
            ))}
          </select>

          <input
            className="url-input"
            onChange={(event) => onChange({ ...draft, url: event.currentTarget.value })}
            placeholder="https://api.example.dev/v1/resource"
            type="url"
            value={draft.url}
          />

          <button className="primary-button" disabled={isSending} onClick={onSend} type="button">
            {isSending ? "Sending..." : "Send"}
          </button>
        </div>

        <div className="resolved-preview">
          <p>Resolved URL</p>
          <code>{resolvedPreview}</code>
        </div>
      </section>

      <div className="editor-grid">
        <RowsSection
          onAddRow={onAddRow}
          onChange={updateRow}
          onRemoveRow={removeRow}
          rows={draft.queryParams}
          section="queryParams"
          subtitle="Query params aceitam interpolação como {{token}}."
          title="Query Params"
        />

        <RowsSection
          onAddRow={onAddRow}
          onChange={updateRow}
          onRemoveRow={removeRow}
          rows={draft.headers}
          section="headers"
          subtitle="Headers habilitados entram no envio final."
          title="Headers"
        />
      </div>

      <section className="editor-card">
        <div className="editor-card__header">
          <div>
            <h3>Body</h3>
            <p>Suporte a payload JSON formatado ou texto bruto.</p>
          </div>
          <div className="body-toolbar">
            <select
              className="body-mode"
              onChange={(event) =>
                onChange({
                  ...draft,
                  bodyMode: event.currentTarget.value as RequestDraft["bodyMode"],
                })
              }
              value={draft.bodyMode}
            >
              <option value="json">JSON</option>
              <option value="text">Text</option>
            </select>
            <button className="ghost-button" onClick={handleBodyFormat} type="button">
              Format
            </button>
          </div>
        </div>

        <textarea
          className="body-editor"
          onChange={(event) => onChange({ ...draft, body: event.currentTarget.value })}
          placeholder={
            draft.bodyMode === "json"
              ? '{\n  "message": "payload"\n}'
              : "Raw text payload"
          }
          spellCheck={false}
          value={draft.body}
        />
      </section>

      {sendError ? <div className="alert alert--error">{sendError}</div> : null}
    </div>
  );
}
