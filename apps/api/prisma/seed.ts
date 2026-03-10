import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { config } from "dotenv";
import { resolve } from "node:path";

config({ path: resolve(process.cwd(), ".env") });
config({ path: resolve(process.cwd(), "../../.env"), override: false });

const prisma = new PrismaClient();

async function main() {
  const adminName = process.env.SEED_ADMIN_NAME ?? "Marcelo Correa";
  const adminEmail = process.env.SEED_ADMIN_EMAIL ?? "admin@devhttp.local";
  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? "devhttp123";
  const passwordHash = await bcrypt.hash(adminPassword, 10);
  const user = await prisma.user.upsert({
    where: {
      email: adminEmail,
    },
    update: {
      name: adminName,
      passwordHash,
    },
    create: {
      id: "user-1",
      name: adminName,
      email: adminEmail,
      passwordHash,
    },
  });

  await prisma.userPreference.upsert({
    where: {
      userId: user.id,
    },
    update: {},
    create: {
      userId: user.id,
      sidebarCollapsed: false,
      themeMode: "system",
    },
  });

  await prisma.workspace.upsert({
    where: {
      id: "workspace-1",
    },
    update: {
      name: "DevHttp Labs",
    },
    create: {
      id: "workspace-1",
      name: "DevHttp Labs",
    },
  });

  await prisma.membership.upsert({
    where: {
      userId_workspaceId: {
        userId: user.id,
        workspaceId: "workspace-1",
      },
    },
    update: {
      role: "owner",
    },
    create: {
      userId: user.id,
      workspaceId: "workspace-1",
      role: "owner",
    },
  });

  await prisma.project.upsert({
    where: {
      id: "project-1",
    },
    update: {
      name: "API pública",
      description: "Coleção inicial para testar endpoints REST.",
    },
    create: {
      id: "project-1",
      workspaceId: "workspace-1",
      name: "API pública",
      description: "Coleção inicial para testar endpoints REST.",
    },
  });

  await prisma.collection.upsert({
    where: {
      id: "collection-1",
    },
    update: {
      name: "Autenticacao",
      projectId: "project-1",
      parentCollectionId: null,
    },
    create: {
      id: "collection-1",
      projectId: "project-1",
      name: "Autenticacao",
      parentCollectionId: null,
    },
  });

  await prisma.environment.upsert({
    where: {
      id: "env-1",
    },
    update: {
      projectId: "project-1",
      scope: "project",
      name: "Local",
      variables: [
        { key: "baseUrl", value: "https://jsonplaceholder.typicode.com", enabled: true },
        { key: "postId", value: "1", enabled: true },
      ],
    },
    create: {
      id: "env-1",
      projectId: "project-1",
      scope: "project",
      name: "Local",
      variables: [
        { key: "baseUrl", value: "https://jsonplaceholder.typicode.com", enabled: true },
        { key: "postId", value: "1", enabled: true },
      ],
    },
  });

  await prisma.request.upsert({
    where: {
      id: "request-1",
    },
    update: {
      projectId: "project-1",
      collectionId: "collection-1",
      name: "Buscar post",
      method: "GET",
      url: "{{baseUrl}}/posts/{{postId}}",
      headers: [],
      queryParams: [],
      bodyType: "json",
      body: "",
      formData: [],
      postResponseScript:
        "const body = response.json();\\nif (body?.id) env.set('lastPostId', String(body.id));\\ntest('status 200', response.status === 200);",
    },
    create: {
      id: "request-1",
      projectId: "project-1",
      collectionId: "collection-1",
      name: "Buscar post",
      method: "GET",
      url: "{{baseUrl}}/posts/{{postId}}",
      headers: [],
      queryParams: [],
      bodyType: "json",
      body: "",
      formData: [],
      postResponseScript:
        "const body = response.json();\\nif (body?.id) env.set('lastPostId', String(body.id));\\ntest('status 200', response.status === 200);",
    },
  });
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
