"use client";

import { ResponseSnapshot } from "@/lib/types";

type ResponsePanelProps = {
  response: ResponseSnapshot | null;
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  return `${(bytes / 1024).toFixed(1)} KB`;
}

export function ResponsePanel({ response }: ResponsePanelProps) {
  if (!response) {
    return (
      <section className="response-panel response-panel--empty">
        <div>
          <p className="eyebrow">Response</p>
          <h2>Nenhuma resposta ainda</h2>
          <p className="muted">
            Envie uma request para inspecionar status, headers, tamanho do payload e corpo formatado.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="response-panel">
      <div className="response-panel__header">
        <div>
          <p className="eyebrow">Response</p>
          <h2>{response.ok ? "Request concluída" : "Request com erro"}</h2>
        </div>
        <div className="response-metrics">
          <span className={`status-pill${response.ok ? " status-pill--ok" : " status-pill--error"}`}>
            {response.status} {response.statusText}
          </span>
          <span>{response.durationMs.toFixed(0)} ms</span>
          <span>{formatBytes(response.sizeBytes)}</span>
          <span>{response.source}</span>
        </div>
      </div>

      <div className="response-meta">
        <div>
          <span>Requested URL</span>
          <code>{response.requestedUrl}</code>
        </div>
      </div>

      <div className="response-grid">
        <article className="response-card">
          <div className="response-card__header">
            <h3>Body</h3>
            <span>{response.bodyFormat.toUpperCase()}</span>
          </div>
          <pre>{response.body || "Empty response body"}</pre>
        </article>

        <article className="response-card">
          <div className="response-card__header">
            <h3>Headers</h3>
            <span>{response.headers.length}</span>
          </div>
          <div className="headers-list">
            {response.headers.length > 0 ? (
              response.headers.map((header) => (
                <div className="headers-list__item" key={`${header.key}-${header.value}`}>
                  <strong>{header.key}</strong>
                  <span>{header.value}</span>
                </div>
              ))
            ) : (
              <p className="muted">Sem headers na resposta.</p>
            )}
          </div>
        </article>
      </div>
    </section>
  );
}
