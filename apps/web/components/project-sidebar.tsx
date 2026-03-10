"use client";

import { Project, RequestItem } from "@/lib/types";

type ProjectSidebarProps = {
  projects: Project[];
  activeRequestId: string;
  onSelectRequest: (request: RequestItem) => void;
};

function methodClass(method: RequestItem["method"]) {
  if (method === "GET") return "method method-get";
  if (method === "POST") return "method method-post";
  if (method === "DELETE") return "method method-delete";
  if (method === "PATCH") return "method method-patch";
  if (method === "PUT") return "method method-put";

  return "method";
}

export function ProjectSidebar({
  projects,
  activeRequestId,
  onSelectRequest,
}: ProjectSidebarProps) {
  return (
    <aside className="sidebar">
      <div className="sidebar__header">
        <p className="eyebrow">Workspace</p>
        <h1>DevHttp</h1>
        <p className="muted">
          Projetos, coleções e requests organizados como uma estação de trabalho HTTP.
        </p>
      </div>

      <div className="sidebar__content">
        {projects.map((project) => (
          <section className="project-card" key={project.id}>
            <div className="project-card__header">
              <h2>{project.name}</h2>
              {project.description ? <p>{project.description}</p> : null}
            </div>

            {project.collections.map((collection) => (
              <div className="collection-card" key={collection.id}>
                <div className="collection-card__header">
                  <h3>{collection.name}</h3>
                  {collection.description ? <p>{collection.description}</p> : null}
                </div>

                <div className="request-list">
                  {collection.requests.map((request) => {
                    const isActive = request.id === activeRequestId;

                    return (
                      <button
                        className={`request-item${isActive ? " request-item--active" : ""}`}
                        key={request.id}
                        onClick={() => onSelectRequest(request)}
                        type="button"
                      >
                        <span className={methodClass(request.method)}>{request.method}</span>
                        <span className="request-item__body">
                          <strong>{request.name}</strong>
                          <small>{request.url}</small>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </section>
        ))}
      </div>
    </aside>
  );
}
