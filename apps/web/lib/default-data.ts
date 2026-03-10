import { createRow } from "@/lib/request-utils";
import { Environment, Project, RequestDraft } from "@/lib/types";

const exampleRequest: RequestDraft = {
  id: "request-users-list",
  name: "List users",
  description: "Consulta paginada com filtro por status.",
  method: "GET",
  url: "https://api.example.dev/v1/users",
  queryParams: [
    { ...createRow("page"), key: "page", value: "1", enabled: true },
    { ...createRow("status"), key: "status", value: "{{userStatus}}", enabled: true },
  ],
  headers: [
    { ...createRow("accept"), key: "Accept", value: "application/json", enabled: true },
    {
      ...createRow("authorization"),
      key: "Authorization",
      value: "Bearer {{authToken}}",
      enabled: true,
    },
  ],
  bodyMode: "json",
  body: "",
};

const createOrderRequest: RequestDraft = {
  id: "request-orders-create",
  name: "Create order",
  description: "Payload JSON com itens, metadata e callback.",
  method: "POST",
  url: "https://api.example.dev/v1/orders",
  queryParams: [{ ...createRow("dry-run"), key: "dryRun", value: "false", enabled: true }],
  headers: [
    {
      ...createRow("content-type"),
      key: "Content-Type",
      value: "application/json",
      enabled: true,
    },
    {
      ...createRow("authorization"),
      key: "Authorization",
      value: "Bearer {{authToken}}",
      enabled: true,
    },
  ],
  bodyMode: "json",
  body: JSON.stringify(
    {
      customerId: "cust_123",
      items: [
        { sku: "keyboard-ergonomic", quantity: 1 },
        { sku: "usb-c-dock", quantity: 2 },
      ],
      metadata: {
        source: "dev-http",
      },
      callbackUrl: "{{callbackUrl}}",
    },
    null,
    2,
  ),
};

export const defaultProjects: Project[] = [
  {
    id: "project-core",
    name: "Core Platform",
    description: "Requests recorrentes do time de plataforma.",
    collections: [
      {
        id: "collection-users",
        name: "Users",
        description: "Autenticação, perfis e listagens.",
        requests: [
          {
            id: exampleRequest.id,
            name: exampleRequest.name,
            summary: exampleRequest.description,
            method: exampleRequest.method,
            url: exampleRequest.url,
            draft: exampleRequest,
          },
        ],
      },
      {
        id: "collection-orders",
        name: "Orders",
        description: "Operações transacionais.",
        requests: [
          {
            id: createOrderRequest.id,
            name: createOrderRequest.name,
            summary: createOrderRequest.description,
            method: createOrderRequest.method,
            url: createOrderRequest.url,
            draft: createOrderRequest,
          },
        ],
      },
    ],
  },
  {
    id: "project-integrations",
    name: "Partner Integrations",
    description: "Coleções isoladas por conector.",
    collections: [
      {
        id: "collection-webhooks",
        name: "Webhooks",
        description: "Validação e replay de entregas.",
        requests: [
          {
            id: "request-webhook-replay",
            name: "Replay webhook",
            summary: "Dispara reprocessamento de evento.",
            method: "POST",
            url: "https://hooks.example.dev/v2/events/replay",
            draft: {
              id: "request-webhook-replay",
              name: "Replay webhook",
              description: "Reprocessamento via idempotency key.",
              method: "POST",
              url: "https://hooks.example.dev/v2/events/replay",
              queryParams: [],
              headers: [
                {
                  ...createRow("content-type"),
                  key: "Content-Type",
                  value: "application/json",
                  enabled: true,
                },
              ],
              bodyMode: "json",
              body: JSON.stringify(
                {
                  eventId: "evt_001",
                  replayReason: "manual_retry",
                },
                null,
                2,
              ),
            },
          },
        ],
      },
    ],
  },
];

export const defaultEnvironments: Environment[] = [
  {
    id: "env-local",
    name: "Local",
    variables: [
      { ...createRow("authToken"), key: "authToken", value: "local-dev-token", enabled: true },
      { ...createRow("userStatus"), key: "userStatus", value: "active", enabled: true },
      {
        ...createRow("callbackUrl"),
        key: "callbackUrl",
        value: "http://localhost:3000/api/callback",
        enabled: true,
      },
    ],
  },
  {
    id: "env-staging",
    name: "Staging",
    variables: [
      { ...createRow("authToken"), key: "authToken", value: "staging-token", enabled: true },
      { ...createRow("userStatus"), key: "userStatus", value: "pending", enabled: true },
      {
        ...createRow("callbackUrl"),
        key: "callbackUrl",
        value: "https://staging.dev-http.app/callback",
        enabled: true,
      },
    ],
  },
];

export const initialRequest = defaultProjects[0].collections[0].requests[0].draft;
