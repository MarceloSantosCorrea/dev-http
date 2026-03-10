import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { compare, hash } from "bcryptjs";
import { Prisma, type User as PrismaUser } from "@prisma/client";
import type {
  AuthResponse,
  Environment,
  FormDataField,
  KeyValue,
  Membership,
  Notification,
  PostmanImportResult,
  Project,
  RequestDefinition,
  User,
  Variable,
  Workspace,
  WorkspaceInvite,
  WorkspaceMember,
  WorkspaceMembership,
} from "@devhttp/shared";
import { createHash, randomBytes, randomUUID } from "node:crypto";

import { PrismaService } from "../prisma/prisma.service";

interface CollectionNode {
  id: string;
  projectId: string;
  name: string;
  parentCollectionId?: string;
}

interface PostmanCollection {
  name?: string;
  item?: PostmanItem[];
  variable?: Array<{ key?: string; value?: string }>;
  auth?: PostmanAuth;
}

interface PostmanEnvironment {
  name?: string;
  values?: Array<{
    key?: string;
    value?: string;
    enabled?: boolean;
    type?: string;
  }>;
}

interface PostmanItem {
  name?: string;
  item?: PostmanItem[];
  request?: PostmanRequest;
  auth?: PostmanAuth;
  event?: PostmanEvent[];
}

interface PostmanRequest {
  method?: RequestDefinition["method"] | string;
  header?: Array<{ key?: string; value?: string; disabled?: boolean }>;
  url?:
    | string
    | {
        raw?: string;
        protocol?: string;
        host?: string[];
        path?: string[];
        query?: Array<{ key?: string; value?: string; disabled?: boolean }>;
      };
  body?: {
    mode?: string;
    raw?: string;
    options?: { raw?: { language?: string } };
    formdata?: Array<{
      key?: string;
      value?: string;
      type?: "text" | "file";
      src?: string | string[];
      disabled?: boolean;
    }>;
    urlencoded?: Array<{ key?: string; value?: string; disabled?: boolean }>;
  };
  auth?: PostmanAuth;
}

interface PostmanAuth {
  type?: string;
  bearer?: Array<{ key?: string; value?: string }>;
}

interface PostmanEvent {
  listen?: string;
  script?: {
    exec?: string[];
  };
}

interface ImportTraversalContext {
  parentCollectionId?: string;
  inheritedAuth?: PostmanAuth;
}

type ProjectWithRelations = Prisma.ProjectGetPayload<{
  include: {
    collections: true;
    environments: true;
    requests: true;
  };
}>;

type InviteWithRelations = Prisma.WorkspaceInviteGetPayload<{
  include: {
    workspace: true;
    invitedBy: true;
  };
}>;

type NotificationWithRelations = Prisma.NotificationGetPayload<{
  include: {
    invite: {
      include: {
        workspace: true;
        invitedBy: true;
      };
    };
  };
}>;

@Injectable()
export class StoreService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async getUserPreferences(userId: string) {
    const preference = await this.prisma.userPreference.findUnique({
      where: { userId },
    });

    return {
      sidebarCollapsed: preference?.sidebarCollapsed ?? false,
      themeMode: (preference?.themeMode ?? "system") as "light" | "dark" | "system",
    };
  }

  async saveUserPreferences(
    userId: string,
    prefs: { sidebarCollapsed?: boolean; themeMode?: "light" | "dark" | "system" },
  ) {
    const current = await this.getUserPreferences(userId);
    const saved = await this.prisma.userPreference.upsert({
      where: { userId },
      update: {
        sidebarCollapsed: prefs.sidebarCollapsed ?? current.sidebarCollapsed,
        themeMode: prefs.themeMode ?? current.themeMode,
      },
      create: {
        userId,
        sidebarCollapsed: prefs.sidebarCollapsed ?? current.sidebarCollapsed,
        themeMode: prefs.themeMode ?? current.themeMode,
      },
    });

    return {
      sidebarCollapsed: saved.sidebarCollapsed,
      themeMode: saved.themeMode as "light" | "dark" | "system",
    };
  }

  async listWorkspacesForUser(userId: string) {
    const memberships = await this.prisma.membership.findMany({
      where: { userId },
      include: { workspace: true },
      orderBy: { createdAt: "asc" },
    });

    return memberships.map((membership) => ({
      workspace: this.toWorkspace(membership.workspace),
      role: membership.role as Membership["role"],
    }));
  }

  async register(input: { name?: string; email: string; password: string }): Promise<AuthResponse> {
    const email = input.email.trim().toLowerCase();
    const name = input.name?.trim() || email.split("@")[0] || "Novo usuário";
    const password = input.password.trim();

    if (!email || !password) {
      throw new BadRequestException("Nome, email e senha são obrigatórios.");
    }

    const existing = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });
    if (existing) {
      throw new BadRequestException("Já existe uma conta com este email.");
    }

    const passwordHash = await hash(password, 10);
    const userId = randomUUID();
    const workspaceId = randomUUID();

    const user = await this.prisma.user.create({
      data: {
        id: userId,
        name,
        email,
        passwordHash,
      },
    });

    await this.prisma.userPreference.create({
      data: {
        userId,
        sidebarCollapsed: false,
        themeMode: "system",
      },
    });

    await this.prisma.workspace.create({
      data: {
        id: workspaceId,
        name: "Geral",
      },
    });

    await this.prisma.membership.create({
      data: {
        userId,
        workspaceId,
        role: "owner",
      },
    });

    await this.createNotificationsForPendingInvites(user);

    const token = randomBytes(32).toString("hex");
    await this.prisma.sessionToken.create({
      data: {
        id: randomUUID(),
        userId,
        tokenHash: this.hashToken(token),
      },
    });

    return {
      token,
      user: this.sanitizeUser(user),
      workspaceId,
      workspaces: await this.listWorkspacesForUser(userId),
    };
  }

  async getBootstrap(userId: string, workspaceId: string) {
    const membership = await this.prisma.membership.findUnique({
      where: {
        userId_workspaceId: {
          userId,
          workspaceId,
        },
      },
      include: {
        workspace: true,
      },
    });
    if (!membership) {
      throw new NotFoundException("Workspace não encontrado para o usuário.");
    }

    const user = await this.findUserById(userId);
    const projects = await this.prisma.project.findMany({
      where: { workspaceId },
      orderBy: { createdAt: "desc" },
      include: {
        collections: { orderBy: { createdAt: "desc" } },
        environments: { orderBy: { createdAt: "desc" } },
        requests: { orderBy: { createdAt: "desc" } },
      },
    });

    return {
      user: this.sanitizeUser(user),
      workspace: this.toWorkspace(membership.workspace),
      membership: {
        userId: membership.userId,
        workspaceId: membership.workspaceId,
        role: membership.role as Membership["role"],
      },
      projects: projects.map((project) => this.toProjectBundle(project)),
    };
  }

  async login(email: string, password: string): Promise<AuthResponse> {
    const user = await this.prisma.user.findUnique({
      where: { email },
    });
    if (!user || !(await compare(password, user.passwordHash))) {
      throw new UnauthorizedException("Credenciais inválidas.");
    }

    const workspaceId = (
      await this.prisma.membership.findFirst({
        where: { userId: user.id },
        orderBy: { createdAt: "asc" },
      })
    )?.workspaceId;
    if (!workspaceId) {
      throw new NotFoundException("Nenhum workspace associado a este usuário.");
    }

    const token = randomBytes(32).toString("hex");
    await this.prisma.sessionToken.create({
      data: {
        id: randomUUID(),
        userId: user.id,
        tokenHash: this.hashToken(token),
      },
    });

    return {
      token,
      user: this.sanitizeUser(user),
      workspaceId,
      workspaces: await this.listWorkspacesForUser(user.id),
    };
  }

  async validateToken(token: string | undefined) {
    if (!token) {
      return null;
    }

    const session = await this.prisma.sessionToken.findUnique({
      where: {
        tokenHash: this.hashToken(token),
      },
      include: {
        user: true,
      },
    });
    if (!session) {
      return null;
    }

    return this.sanitizeUser(session.user);
  }

  async logout(token: string | undefined) {
    if (!token) {
      return { loggedOut: true };
    }

    await this.prisma.sessionToken.deleteMany({
      where: {
        tokenHash: this.hashToken(token),
      },
    });

    return { loggedOut: true };
  }

  async getUserProfile(userId: string) {
    const user = await this.findUserById(userId);
    return this.sanitizeUser(user);
  }

  async updateUserProfile(
    userId: string,
    input: { name: string; email: string; avatarUrl?: string | null },
  ) {
    const name = input.name.trim();
    const email = input.email.trim().toLowerCase();
    if (!name || !email) {
      throw new BadRequestException("Nome e email são obrigatórios.");
    }

    const existingByEmail = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });
    if (existingByEmail && existingByEmail.id !== userId) {
      throw new BadRequestException("Já existe um usuário com este email.");
    }

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: {
        name,
        email,
        avatarUrl: input.avatarUrl ?? null,
      },
    });

    await this.createNotificationsForPendingInvites(updated);

    return this.sanitizeUser(updated);
  }

  async changePassword(userId: string, currentPassword: string, newPassword: string) {
    if (!currentPassword || !newPassword) {
      throw new BadRequestException("Senha atual e nova senha são obrigatórias.");
    }

    const user = await this.findUserById(userId);
    const validCurrentPassword = await compare(currentPassword, user.passwordHash);
    if (!validCurrentPassword) {
      throw new UnauthorizedException("Senha atual inválida.");
    }

    const passwordHash = await hash(newPassword, 10);
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        passwordHash,
      },
    });

    await this.prisma.sessionToken.deleteMany({
      where: { userId },
    });

    return { passwordChanged: true };
  }

  async listNotifications(userId: string): Promise<Notification[]> {
    const notifications = await this.prisma.notification.findMany({
      where: { userId },
      include: {
        invite: {
          include: {
            workspace: true,
            invitedBy: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    return notifications.map((notification) => this.toNotification(notification));
  }

  async markNotificationAsRead(userId: string, notificationId: string) {
    const notification = await this.prisma.notification.findUnique({
      where: { id: notificationId },
      select: { id: true, userId: true, readAt: true },
    });
    if (!notification || notification.userId !== userId) {
      throw new NotFoundException("Notificação não encontrada.");
    }

    await this.prisma.notification.update({
      where: { id: notificationId },
      data: {
        readAt: notification.readAt ?? new Date(),
      },
    });

    return { notificationId, read: true };
  }

  async listWorkspaceMembers(userId: string, workspaceId: string): Promise<WorkspaceMember[]> {
    await this.requireWorkspaceRole(userId, workspaceId, ["owner", "admin", "editor", "viewer"]);

    const memberships = await this.prisma.membership.findMany({
      where: { workspaceId },
      include: { user: true },
      orderBy: { createdAt: "asc" },
    });

    return memberships.map((membership) => ({
      user: this.sanitizeUser(membership.user),
      role: membership.role as WorkspaceMember["role"],
      createdAt: membership.createdAt.toISOString(),
    }));
  }

  async listWorkspaceInvites(userId: string, workspaceId: string): Promise<WorkspaceInvite[]> {
    await this.requireWorkspaceRole(userId, workspaceId, ["owner", "admin"]);

    const invites = await this.prisma.workspaceInvite.findMany({
      where: {
        workspaceId,
        status: "pending",
      },
      include: {
        workspace: true,
        invitedBy: true,
      },
      orderBy: { createdAt: "desc" },
    });

    return invites.map((invite) => this.toWorkspaceInvite(invite));
  }

  async createWorkspaceInvite(
    actorUserId: string,
    workspaceId: string,
    input: { email: string; role: "admin" | "editor" | "viewer" },
  ) {
    await this.requireWorkspaceRole(actorUserId, workspaceId, ["owner", "admin"]);

    const email = input.email.trim().toLowerCase();
    if (!email) {
      throw new BadRequestException("Email é obrigatório para convite.");
    }

    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { id: true, name: true },
    });
    if (!workspace) {
      throw new NotFoundException("Workspace não encontrado.");
    }

    const existingUser = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });
    if (existingUser) {
      const existingMembership = await this.prisma.membership.findUnique({
        where: {
          userId_workspaceId: {
            userId: existingUser.id,
            workspaceId,
          },
        },
      });
      if (existingMembership) {
        throw new BadRequestException("Esse usuário já faz parte do workspace.");
      }
    }

    const existingInvite = await this.prisma.workspaceInvite.findFirst({
      where: {
        workspaceId,
        email,
        status: "pending",
      },
      select: { id: true },
    });
    if (existingInvite) {
      throw new BadRequestException("Já existe um convite pendente para esse email neste workspace.");
    }

    const invite = await this.prisma.workspaceInvite.create({
      data: {
        id: randomUUID(),
        workspaceId,
        email,
        role: input.role,
        status: "pending",
        invitedByUserId: actorUserId,
      },
      include: {
        workspace: true,
        invitedBy: true,
      },
    });

    if (existingUser) {
      await this.ensureInviteNotification(existingUser.id, invite);
    }

    return this.toWorkspaceInvite(invite);
  }

  async revokeWorkspaceInvite(actorUserId: string, workspaceId: string, inviteId: string) {
    await this.requireWorkspaceRole(actorUserId, workspaceId, ["owner", "admin"]);

    const invite = await this.prisma.workspaceInvite.findUnique({
      where: { id: inviteId },
      include: {
        workspace: true,
        invitedBy: true,
      },
    });
    if (!invite || invite.workspaceId !== workspaceId) {
      throw new NotFoundException("Convite não encontrado.");
    }

    const updated = await this.prisma.workspaceInvite.update({
      where: { id: inviteId },
      data: {
        status: "revoked",
        revokedAt: new Date(),
      },
      include: {
        workspace: true,
        invitedBy: true,
      },
    });

    await this.prisma.notification.updateMany({
      where: {
        inviteId,
      },
      data: {
        actedAt: new Date(),
      },
    });

    return this.toWorkspaceInvite(updated);
  }

  async acceptWorkspaceInvite(userId: string, inviteId: string) {
    const user = await this.findUserById(userId);
    const invite = await this.prisma.workspaceInvite.findUnique({
      where: { id: inviteId },
      include: {
        workspace: true,
        invitedBy: true,
      },
    });
    if (!invite || invite.status !== "pending") {
      throw new NotFoundException("Convite não encontrado.");
    }
    if (invite.email.toLowerCase() !== user.email.toLowerCase()) {
      throw new UnauthorizedException("Este convite não pertence ao usuário autenticado.");
    }

    const existingMembership = await this.prisma.membership.findUnique({
      where: {
        userId_workspaceId: {
          userId,
          workspaceId: invite.workspaceId,
        },
      },
    });
    if (!existingMembership) {
      await this.prisma.membership.create({
        data: {
          userId,
          workspaceId: invite.workspaceId,
          role: invite.role,
        },
      });
    }

    const actedAt = new Date();
    await this.prisma.workspaceInvite.update({
      where: { id: inviteId },
      data: {
        status: "accepted",
        acceptedAt: actedAt,
      },
    });
    await this.prisma.notification.updateMany({
      where: {
        inviteId,
        userId,
      },
      data: {
        readAt: actedAt,
        actedAt,
      },
    });

    return {
      inviteId,
      accepted: true,
      workspaceId: invite.workspaceId,
      workspaces: await this.listWorkspacesForUser(userId),
    };
  }

  async declineWorkspaceInvite(userId: string, inviteId: string) {
    const user = await this.findUserById(userId);
    const invite = await this.prisma.workspaceInvite.findUnique({
      where: { id: inviteId },
      select: {
        id: true,
        email: true,
        status: true,
      },
    });
    if (!invite || invite.status !== "pending") {
      throw new NotFoundException("Convite não encontrado.");
    }
    if (invite.email.toLowerCase() !== user.email.toLowerCase()) {
      throw new UnauthorizedException("Este convite não pertence ao usuário autenticado.");
    }

    const actedAt = new Date();
    await this.prisma.workspaceInvite.update({
      where: { id: inviteId },
      data: {
        status: "declined",
        declinedAt: actedAt,
      },
    });
    await this.prisma.notification.updateMany({
      where: {
        inviteId,
        userId,
      },
      data: {
        readAt: actedAt,
        actedAt,
      },
    });

    return {
      inviteId,
      declined: true,
    };
  }

  async updateWorkspaceMemberRole(
    actorUserId: string,
    workspaceId: string,
    memberUserId: string,
    role: WorkspaceMember["role"],
  ) {
    const actorMembership = await this.requireWorkspaceRole(actorUserId, workspaceId, ["owner", "admin"]);
    const targetMembership = await this.prisma.membership.findUnique({
      where: {
        userId_workspaceId: {
          userId: memberUserId,
          workspaceId,
        },
      },
      include: {
        user: true,
      },
    });
    if (!targetMembership) {
      throw new NotFoundException("Membro não encontrado.");
    }

    if (actorMembership.role !== "owner" && role === "owner") {
      throw new UnauthorizedException("Apenas owner pode promover outro membro a owner.");
    }

    if (targetMembership.role === "owner" && actorMembership.role !== "owner") {
      throw new UnauthorizedException("Apenas owner pode alterar o papel de outro owner.");
    }

    if (targetMembership.role === "owner" && role !== "owner") {
      const ownerCount = await this.prisma.membership.count({
        where: {
          workspaceId,
          role: "owner",
        },
      });
      if (ownerCount <= 1) {
        throw new BadRequestException("O workspace precisa manter pelo menos um owner.");
      }
    }

    const updated = await this.prisma.membership.update({
      where: {
        userId_workspaceId: {
          userId: memberUserId,
          workspaceId,
        },
      },
      data: {
        role,
      },
      include: {
        user: true,
      },
    });

    return {
      user: this.sanitizeUser(updated.user),
      role: updated.role as WorkspaceMember["role"],
      createdAt: updated.createdAt.toISOString(),
    };
  }

  async removeWorkspaceMember(actorUserId: string, workspaceId: string, memberUserId: string) {
    const actorMembership = await this.requireWorkspaceRole(actorUserId, workspaceId, ["owner", "admin"]);
    const targetMembership = await this.prisma.membership.findUnique({
      where: {
        userId_workspaceId: {
          userId: memberUserId,
          workspaceId,
        },
      },
    });
    if (!targetMembership) {
      throw new NotFoundException("Membro não encontrado.");
    }

    if (targetMembership.role === "owner") {
      if (actorMembership.role !== "owner") {
        throw new UnauthorizedException("Apenas owner pode remover outro owner.");
      }

      const ownerCount = await this.prisma.membership.count({
        where: {
          workspaceId,
          role: "owner",
        },
      });
      if (ownerCount <= 1) {
        throw new BadRequestException("O workspace precisa manter pelo menos um owner.");
      }
    }

    await this.prisma.membership.delete({
      where: {
        userId_workspaceId: {
          userId: memberUserId,
          workspaceId,
        },
      },
    });

    return {
      userId: memberUserId,
      removed: true,
    };
  }

  async listProjects(userId: string, workspaceId: string) {
    await this.requireWorkspaceRole(userId, workspaceId, ["owner", "admin", "editor", "viewer"]);

    const projects = await this.prisma.project.findMany({
      where: { workspaceId },
      orderBy: { createdAt: "desc" },
    });

    return projects.map((project) => this.toProject(project));
  }

  async updateWorkspace(userId: string, workspaceId: string, input: { name?: string }) {
    await this.requireWorkspaceRole(userId, workspaceId, ["owner", "admin"]);

    const nextName = input.name?.trim();
    if (!nextName) {
      throw new BadRequestException("Nome do workspace é obrigatório.");
    }

    const workspace = await this.prisma.workspace.update({
      where: { id: workspaceId },
      data: {
        name: nextName,
      },
    });

    return this.toWorkspace(workspace);
  }

  async createWorkspace(userId: string, input: { name: string }): Promise<WorkspaceMembership> {
    const workspaceId = randomUUID();
    const workspace = await this.prisma.workspace.create({
      data: { id: workspaceId, name: input.name },
    });
    await this.prisma.membership.create({
      data: { userId, workspaceId, role: "owner" },
    });
    return { workspace: this.toWorkspace(workspace), role: "owner" };
  }

  async getProject(userId: string, projectId: string) {
    const projectWorkspace = await this.getProjectWorkspace(projectId);
    await this.requireWorkspaceRole(userId, projectWorkspace.workspaceId, ["owner", "admin", "editor", "viewer"]);

    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      include: {
        collections: { orderBy: { createdAt: "desc" } },
        environments: { orderBy: { createdAt: "desc" } },
        requests: { orderBy: { createdAt: "desc" } },
      },
    });
    if (!project) {
      throw new NotFoundException("Projeto não encontrado.");
    }

    return this.toProjectBundle(project);
  }

  async createProject(userId: string, workspaceId: string, input: { name: string; description: string }) {
    await this.requireWorkspaceRole(userId, workspaceId, ["owner", "admin"]);

    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { id: true },
    });
    if (!workspace) {
      throw new NotFoundException("Workspace não encontrado.");
    }

    const project = await this.prisma.project.create({
      data: {
        id: randomUUID(),
        workspaceId,
        name: input.name,
        description: input.description,
      },
    });

    return this.toProject(project);
  }

  async updateProject(
    userId: string,
    projectId: string,
    input: { name?: string; description?: string },
  ) {
    const projectWorkspace = await this.getProjectWorkspace(projectId);
    await this.requireWorkspaceRole(userId, projectWorkspace.workspaceId, ["owner", "admin", "editor"]);

    const data: { name?: string; description?: string } = {};
    if (input.name !== undefined) {
      const nextName = input.name.trim();
      if (!nextName) {
        throw new BadRequestException("Nome do projeto é obrigatório.");
      }
      data.name = nextName;
    }
    if (input.description !== undefined) {
      data.description = input.description.trim();
    }
    if (Object.keys(data).length === 0) {
      throw new BadRequestException("Nenhuma alteração foi informada para o projeto.");
    }

    const project = await this.prisma.project.update({
      where: { id: projectId },
      data,
    });

    return this.toProject(project);
  }

  async removeProject(userId: string, projectId: string) {
    const projectWorkspace = await this.getProjectWorkspace(projectId);
    await this.requireWorkspaceRole(userId, projectWorkspace.workspaceId, ["owner", "admin"]);

    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true },
    });
    if (!project) {
      throw new NotFoundException("Projeto não encontrado.");
    }

    await this.prisma.project.delete({
      where: { id: projectId },
    });

    return {
      projectId,
      removed: true,
    };
  }

  async createCollection(
    userId: string,
    projectId: string,
    input: { name: string; parentCollectionId?: string },
  ) {
    const projectWorkspace = await this.getProjectWorkspace(projectId);
    await this.requireWorkspaceRole(userId, projectWorkspace.workspaceId, ["owner", "admin", "editor"]);

    if (input.parentCollectionId) {
      const parent = await this.prisma.collection.findUnique({
        where: { id: input.parentCollectionId },
        select: { projectId: true },
      });
      if (!parent || parent.projectId !== projectId) {
        throw new NotFoundException("Coleção pai não encontrada no projeto.");
      }
    }

    const collection = await this.prisma.collection.create({
      data: {
        id: randomUUID(),
        projectId,
        name: input.name,
        parentCollectionId: input.parentCollectionId,
      },
    });

    return this.toCollection(collection);
  }

  async updateCollection(
    userId: string,
    projectId: string,
    collectionId: string,
    input: { name?: string },
  ) {
    const projectWorkspace = await this.getProjectWorkspace(projectId);
    await this.requireWorkspaceRole(userId, projectWorkspace.workspaceId, ["owner", "admin", "editor"]);

    const nextName = input.name?.trim();
    if (!nextName) {
      throw new BadRequestException("Nome da coleção é obrigatório.");
    }

    const collection = await this.prisma.collection.findUnique({
      where: { id: collectionId },
      select: { id: true, projectId: true },
    });
    if (!collection || collection.projectId !== projectId) {
      throw new NotFoundException("Coleção não encontrada.");
    }

    const updated = await this.prisma.collection.update({
      where: { id: collectionId },
      data: {
        name: nextName,
      },
    });

    return this.toCollection(updated);
  }

  async saveEnvironment(
    userId: string,
    projectId: string,
    payload: { id?: string; name: string; scope: "workspace" | "project"; variables: Variable[] },
  ) {
    const projectWorkspace = await this.getProjectWorkspace(projectId);
    await this.requireWorkspaceRole(userId, projectWorkspace.workspaceId, ["owner", "admin", "editor"]);

    if (payload.id) {
      const existing = await this.prisma.environment.findUnique({
        where: { id: payload.id },
        select: { id: true, projectId: true },
      });
      if (!existing || existing.projectId !== projectId) {
        throw new NotFoundException("Ambiente não encontrado.");
      }

      const environment = await this.prisma.environment.update({
        where: { id: payload.id },
        data: {
          name: payload.name,
          scope: payload.scope,
          variables: this.variablesToJson(payload.variables),
        },
      });
      return this.toEnvironment(environment);
    }

    const environment = await this.prisma.environment.create({
      data: {
        id: randomUUID(),
        projectId,
        name: payload.name,
        scope: payload.scope,
        variables: this.variablesToJson(payload.variables),
      },
    });

    return this.toEnvironment(environment);
  }

  async saveRequest(
    userId: string,
    projectId: string,
    payload: Omit<RequestDefinition, "projectId" | "updatedAt" | "id"> & { id?: string },
  ) {
    const projectWorkspace = await this.getProjectWorkspace(projectId);
    await this.requireWorkspaceRole(userId, projectWorkspace.workspaceId, ["owner", "admin", "editor"]);

    if (payload.collectionId) {
      const collection = await this.prisma.collection.findUnique({
        where: { id: payload.collectionId },
        select: { id: true, projectId: true },
      });
      if (!collection || collection.projectId !== projectId) {
        throw new NotFoundException("Coleção não encontrada.");
      }
    }

    if (payload.id) {
      const existing = await this.prisma.request.findUnique({
        where: { id: payload.id },
        select: { id: true, projectId: true },
      });
      if (!existing || existing.projectId !== projectId) {
        throw new NotFoundException("Request não encontrada.");
      }

      const request = await this.prisma.request.update({
        where: { id: payload.id },
        data: {
          name: payload.name,
          collectionId: payload.collectionId,
          method: payload.method,
          url: payload.url,
          headers: this.keyValuesToJson(payload.headers),
          queryParams: this.keyValuesToJson(payload.queryParams),
          bodyType: payload.bodyType,
          body: payload.body,
          formData: this.formDataToJson(payload.formData),
          postResponseScript: payload.postResponseScript,
        },
      });

      return this.toRequest(request);
    }

    const request = await this.prisma.request.create({
      data: {
        id: randomUUID(),
        projectId,
        collectionId: payload.collectionId,
        name: payload.name,
        method: payload.method,
        url: payload.url,
        headers: this.keyValuesToJson(payload.headers),
        queryParams: this.keyValuesToJson(payload.queryParams),
        bodyType: payload.bodyType,
        body: payload.body,
        formData: this.formDataToJson(payload.formData),
        postResponseScript: payload.postResponseScript,
      },
    });

    return this.toRequest(request);
  }

  async updateRequest(
    userId: string,
    projectId: string,
    requestId: string,
    input: { name?: string },
  ) {
    const projectWorkspace = await this.getProjectWorkspace(projectId);
    await this.requireWorkspaceRole(userId, projectWorkspace.workspaceId, ["owner", "admin", "editor"]);

    const nextName = input.name?.trim();
    if (!nextName) {
      throw new BadRequestException("Nome da request é obrigatório.");
    }

    const existing = await this.prisma.request.findUnique({
      where: { id: requestId },
      select: { id: true, projectId: true },
    });
    if (!existing || existing.projectId !== projectId) {
      throw new NotFoundException("Request não encontrada.");
    }

    const updated = await this.prisma.request.update({
      where: { id: requestId },
      data: {
        name: nextName,
      },
    });

    return this.toRequest(updated);
  }

  async getEnvironment(environmentId?: string) {
    if (!environmentId) {
      return null;
    }

    const environment = await this.prisma.environment.findUnique({
      where: { id: environmentId },
    });

    return environment ? this.toEnvironment(environment) : null;
  }

  async upsertVariables(environmentId: string, variables: Variable[]) {
    try {
      const environment = await this.prisma.environment.update({
        where: { id: environmentId },
        data: {
          variables: this.variablesToJson(variables),
        },
      });
      return this.toEnvironment(environment);
    } catch {
      throw new NotFoundException("Ambiente não encontrado.");
    }
  }

  async importPostman(
    userId: string,
    projectId: string,
    input: { collection?: PostmanCollection; environment?: PostmanEnvironment },
  ): Promise<PostmanImportResult> {
    const projectWorkspace = await this.getProjectWorkspace(projectId);
    await this.requireWorkspaceRole(userId, projectWorkspace.workspaceId, ["owner", "admin", "editor"]);

    const imported: RequestDefinition[] = [];
    const warnings = new Set<string>();
    const detectedVariables = new Set<string>();
    let collectionsCreated = 0;
    let environmentImported:
      | {
          id: string;
          name: string;
          created: boolean;
          updated: boolean;
        }
      | undefined;

    const collectionInput = input.collection;
    const environmentInput = input.environment;

    if (!collectionInput && !environmentInput) {
      throw new BadRequestException("Nenhum arquivo Postman válido foi enviado para importação.");
    }

    for (const variable of collectionInput?.variable ?? []) {
      if (variable.key?.trim()) {
        detectedVariables.add(variable.key.trim());
      }
    }

    if (!environmentInput && (collectionInput?.variable?.length ?? 0) > 0) {
      const collectionVariables = collectionInput?.variable ?? [];
      warnings.add(
        `A coleção do Postman define ${collectionVariables.length} variáveis. Configure um ambiente no DevHttp para preenchê-las.`,
      );
    }

    if (collectionInput) {
      const importedItems = await this.importPostmanItems(
        projectId,
        collectionInput.item ?? [],
        {
          inheritedAuth: collectionInput.auth,
        },
        collectionInput.name ?? "Importada do Postman",
        warnings,
        detectedVariables,
      );

      imported.push(...importedItems.requests);
      collectionsCreated += importedItems.collectionsCreated;
    }

    if (environmentInput) {
      environmentImported = await this.importPostmanEnvironment(
        projectId,
        environmentInput,
        warnings,
        detectedVariables,
      );

      if (collectionInput?.variable?.length) {
        const environmentKeys = new Set(
          (environmentInput.values ?? [])
            .map((entry) => entry.key?.trim())
            .filter((entry): entry is string => Boolean(entry)),
        );
        const missingKeys = (collectionInput.variable ?? [])
          .map((entry) => entry.key?.trim())
          .filter((entry): entry is string => Boolean(entry))
          .filter((entry) => !environmentKeys.has(entry));

        if (missingKeys.length > 0) {
          warnings.add(
            `O environment importado não contém ${missingKeys.length} variáveis esperadas pela coleção.`,
          );
        }
      }
    }

    return {
      importedCount: imported.length,
      collectionsCreated,
      requests: imported,
      warnings: Array.from(warnings),
      detectedVariables: Array.from(detectedVariables).sort((left, right) => left.localeCompare(right)),
      environmentImported,
    };
  }

  async exportProject(projectId: string) {
    const project = await this.getProjectBundleForExport(projectId);
    const rootCollections = project.collections.filter((collection) => !collection.parentCollectionId);
    const rootRequests = project.requests.filter((request) => !request.collectionId);

    return {
      info: {
        name: project.name,
        schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
      },
      item: [
        ...rootCollections.map((collection) =>
          this.buildExportCollectionItem(project.collections, project.requests, collection),
        ),
        ...rootRequests.map((request) => this.buildExportRequestItem(request)),
      ],
      variable: project.environments.flatMap((environment) =>
        environment.variables.map((variable) => ({
          key: variable.key,
          value: variable.value,
        })),
      ),
    };
  }

  private async importPostmanItems(
    projectId: string,
    items: PostmanItem[],
    context: ImportTraversalContext,
    fallbackCollectionName: string,
    warnings: Set<string>,
    detectedVariables: Set<string>,
  ) {
    const requests: RequestDefinition[] = [];
    let collectionsCreated = 0;

    for (const item of items) {
      const effectiveAuth = item.request?.auth ?? item.auth ?? context.inheritedAuth;

      if (item.item?.length) {
        const ensured = await this.ensureImportCollection(
          projectId,
          String(item.name ?? "Coleção importada"),
          context.parentCollectionId,
        );
        collectionsCreated += ensured.created ? 1 : 0;

        const nested = await this.importPostmanItems(
          projectId,
          item.item,
          {
            parentCollectionId: ensured.collection.id,
            inheritedAuth: item.auth ?? context.inheritedAuth,
          },
          fallbackCollectionName,
          warnings,
          detectedVariables,
        );
        requests.push(...nested.requests);
        collectionsCreated += nested.collectionsCreated;
        continue;
      }

      let importCollectionId = context.parentCollectionId ?? "";
      if (!context.parentCollectionId) {
        const ensured = await this.ensureImportCollection(projectId, fallbackCollectionName);
        importCollectionId = ensured.id;
        collectionsCreated += ensured.created ? 1 : 0;
      }

      const parsed = this.parsePostmanRequest(
        item,
        importCollectionId,
        effectiveAuth,
        warnings,
        detectedVariables,
      );

      if (parsed) {
        requests.push(await this.saveRequestSystem(projectId, parsed));
      }
    }

    return {
      requests,
      collectionsCreated,
    };
  }

  private async importPostmanEnvironment(
    projectId: string,
    input: PostmanEnvironment,
    warnings: Set<string>,
    detectedVariables: Set<string>,
  ) {
    await this.ensureProjectExists(projectId);

    const environmentName = input.name?.trim() || "Environment importado";
    const variables = (input.values ?? [])
      .filter((entry) => entry.key?.trim())
      .map<Variable>((entry) => {
        const key = entry.key!.trim();
        detectedVariables.add(key);
        return {
          key,
          value: String(entry.value ?? ""),
          enabled: entry.enabled !== false,
        };
      });

    const existing = await this.prisma.environment.findFirst({
      where: {
        projectId,
        name: environmentName,
      },
    });

    if (existing) {
      const updated = await this.prisma.environment.update({
        where: { id: existing.id },
        data: {
          scope: "project",
          variables: this.variablesToJson(variables),
        },
      });

      warnings.add(`Ambiente "${environmentName}" atualizado a partir do arquivo do Postman.`);

      return {
        id: updated.id,
        name: updated.name,
        created: false,
        updated: true,
      };
    }

    const created = await this.saveEnvironmentSystem(projectId, {
      name: environmentName,
      scope: "project",
      variables,
    });

    return {
      id: created.id,
      name: created.name,
      created: true,
      updated: false,
    };
  }

  private parsePostmanRequest(
    item: PostmanItem,
    collectionId: string,
    auth: PostmanAuth | undefined,
    warnings: Set<string>,
    detectedVariables: Set<string>,
  ) {
    const request = item.request;
    const method = String(request?.method ?? "").toUpperCase();
    if (!this.isHttpMethod(method)) {
      warnings.add(`Request "${item.name ?? "Sem nome"}" ignorada por usar método não suportado.`);
      return null;
    }

    const { url, queryParams } = this.extractUrlAndQueryParams(request?.url);
    if (!url) {
      warnings.add(`Request "${item.name ?? "Sem nome"}" ignorada por não possuir URL válida.`);
      return null;
    }

    this.collectTemplateVariables(url, detectedVariables);
    for (const queryParam of queryParams) {
      this.collectTemplateVariables(queryParam.value, detectedVariables);
    }

    const headerMap = new Map<string, KeyValue>();
    for (const header of request?.header ?? []) {
      const key = String(header.key ?? "").trim();
      if (!key) {
        continue;
      }

      const value = String(header.value ?? "");
      headerMap.set(key.toLowerCase(), {
        id: randomUUID(),
        key,
        value,
        enabled: header.disabled !== true,
      });
      this.collectTemplateVariables(value, detectedVariables);
    }

    const authHeader = this.buildAuthHeader(auth, item.name ?? "Sem nome", warnings, detectedVariables);
    if (authHeader && !headerMap.has(authHeader.key.toLowerCase())) {
      headerMap.set(authHeader.key.toLowerCase(), authHeader);
    }

    const { bodyType, body, formData } = this.extractBody(
      request?.body,
      item.name ?? "Sem nome",
      warnings,
      detectedVariables,
    );

    const testScripts = (item.event ?? [])
      .filter((event) => event.listen === "test")
      .flatMap((event) => event.script?.exec ?? []);
    const translatedScript = this.translatePostmanScript(
      item.name ?? "Sem nome",
      testScripts.join("\n"),
      warnings,
    );

    return {
      name: String(item.name ?? "Request importada"),
      collectionId,
      method,
      url,
      headers: Array.from(headerMap.values()),
      queryParams,
      bodyType,
      body,
      formData,
      postResponseScript: translatedScript,
    } satisfies Omit<RequestDefinition, "projectId" | "updatedAt" | "id">;
  }

  private extractUrlAndQueryParams(urlInput: PostmanRequest["url"]) {
    const rawUrl = this.resolveRawUrl(urlInput);
    const inlineQueryIndex = rawUrl.indexOf("?");
    const baseUrl = inlineQueryIndex >= 0 ? rawUrl.slice(0, inlineQueryIndex) : rawUrl;
    const querySource =
      typeof urlInput === "string"
        ? this.parseQueryString(rawUrl)
        : (urlInput?.query ?? this.parseQueryString(rawUrl));

    return {
      url: baseUrl,
      queryParams: (querySource ?? []).map<KeyValue>((entry) => ({
        id: randomUUID(),
        key: String(entry.key ?? ""),
        value: String(entry.value ?? ""),
        enabled: entry.disabled !== true,
      })),
    };
  }

  private resolveRawUrl(urlInput: PostmanRequest["url"]) {
    if (typeof urlInput === "string") {
      return urlInput;
    }

    if (urlInput?.raw) {
      return urlInput.raw;
    }

    const protocol = urlInput?.protocol ? `${urlInput.protocol}://` : "";
    const host = urlInput?.host?.join(".") ?? "";
    const path = urlInput?.path?.join("/") ?? "";
    const pathname = path ? `/${path}` : "";
    return `${protocol}${host}${pathname}`;
  }

  private parseQueryString(rawUrl: string) {
    const queryString = rawUrl.split("?")[1];
    if (!queryString) {
      return [];
    }

    return Array.from(new URLSearchParams(queryString).entries()).map(([key, value]) => ({
      key,
      value,
      disabled: false,
    }));
  }

  private buildAuthHeader(
    auth: PostmanAuth | undefined,
    requestName: string,
    warnings: Set<string>,
    detectedVariables: Set<string>,
  ) {
    if (!auth?.type) {
      return null;
    }

    if (auth.type !== "bearer") {
      warnings.add(`Auth "${auth.type}" da request "${requestName}" não foi convertida automaticamente.`);
      return null;
    }

    const token = auth.bearer?.find((entry) => entry.key === "token")?.value ?? "";
    this.collectTemplateVariables(token, detectedVariables);

    return {
      id: randomUUID(),
      key: "Authorization",
      value: `Bearer ${token}`,
      enabled: true,
    } satisfies KeyValue;
  }

  private extractBody(
    body: PostmanRequest["body"],
    requestName: string,
    warnings: Set<string>,
    detectedVariables: Set<string>,
  ) {
    if (!body) {
      return {
        bodyType: "json" as const,
        body: "",
        formData: [] as FormDataField[],
      };
    }

    if (body.mode === "formdata") {
      const formData = (body.formdata ?? []).map<FormDataField>((field) => {
        const value = String(field.value ?? "");
        const src = Array.isArray(field.src) ? field.src[0] : field.src;
        const type = field.type === "file" ? "file" : "text";
        const normalizedValue =
          type === "file" && !value && !src ? "Arquivo pendente de seleção" : value;

        this.collectTemplateVariables(value, detectedVariables);
        this.collectTemplateVariables(src ?? "", detectedVariables);

        if (type === "file" && !src) {
          warnings.add(
            `Request "${requestName}" importada com arquivo pendente em form-data. Selecione o arquivo antes de executar.`,
          );
        }

        return {
          id: randomUUID(),
          key: String(field.key ?? ""),
          value: normalizedValue,
          enabled: field.disabled !== true,
          type,
          src,
        };
      });

      return {
        bodyType: "form-data" as const,
        body: "",
        formData,
      };
    }

    if (body.mode === "urlencoded") {
      const encodedBody = new URLSearchParams(
        (body.urlencoded ?? [])
          .filter((field) => field.disabled !== true && field.key)
          .map((field) => {
            const value = String(field.value ?? "");
            this.collectTemplateVariables(value, detectedVariables);
            return [String(field.key), value];
          }),
      ).toString();

      return {
        bodyType: "form-urlencoded" as const,
        body: encodedBody,
        formData: [] as FormDataField[],
      };
    }

    const rawBody = body.raw ?? "";
    this.collectTemplateVariables(rawBody, detectedVariables);

    return {
      bodyType: body.options?.raw?.language === "json" ? ("json" as const) : ("text" as const),
      body: rawBody,
      formData: [] as FormDataField[],
    };
  }

  private translatePostmanScript(
    requestName: string,
    source: string,
    warnings: Set<string>,
  ) {
    if (!source.trim()) {
      return "";
    }

    let translated = source;

    translated = translated.replace(/pm\.response\.json\(\)/g, "response.json()");
    translated = translated.replace(/pm\.environment\.get\(/g, "env.get(");
    translated = translated.replace(/pm\.environment\.unset\(/g, "env.unset(");
    translated = translated.replace(
      /pm\.test\(\s*(['"`])([^'"`]+)\1\s*,\s*function\s*\(\)\s*\{\s*throw\s+\w+;\s*\}\s*\);?/g,
      (_, quote: string, name: string) => `test(${quote}${name}${quote}, false);`,
    );
    translated = translated.replace(
      /pm\.test\(\s*(['"`])([^'"`]+)\1\s*,\s*function\s*\(\)\s*\{\s*pm\.expect\(([\s\S]*?)\)\.to\.be\.a\(\s*(['"`])string\4\s*\)\.and\.not\.empty;\s*\}\s*\);?/g,
      (_, quote: string, name: string, expression: string) =>
        `test(${quote}${name}${quote}, typeof (${expression.trim()}) === "string" && (${expression.trim()}).length > 0);`,
    );
    translated = translated.replace(
      /pm\.test\(\s*(['"`])([^'"`]+)\1\s*,\s*function\s*\(\)\s*\{\s*pm\.expect\(([\s\S]*?)\)\.to\.not\.eql\(([\s\S]*?)\);\s*\}\s*\);?/g,
      (_, quote: string, name: string, expression: string, expected: string) =>
        `test(${quote}${name}${quote}, (${expression.trim()}) !== (${expected.trim()}));`,
    );
    translated = translated.replace(
      /pm\.test\(\s*(['"`])([^'"`]+)\1\s*,\s*function\s*\(\)\s*\{\s*pm\.expect\(([\s\S]*?)\)\.to\.eql\(([\s\S]*?)\);\s*\}\s*\);?/g,
      (_, quote: string, name: string, expression: string, expected: string) =>
        `test(${quote}${name}${quote}, (${expression.trim()}) === (${expected.trim()}));`,
    );

    translated = translated
      .split("\n")
      .map((line) => {
        const trimmed = line.trim();
        if (/^pm\.environment\.set\(/.test(trimmed)) {
          return line.replace(
            /pm\.environment\.set\(\s*(['"`][^'"`]+['"`])\s*,\s*(.+)\);?/,
            "env.set($1, String($2));",
          );
        }

        if (trimmed.includes("pm.")) {
          warnings.add(
            `Partes do script da request "${requestName}" não foram convertidas automaticamente e foram comentadas.`,
          );
          return `// [Postman nao traduzido] ${trimmed}`;
        }

        return line;
      })
      .join("\n");

    return translated.trim();
  }

  private buildExportCollectionItem(
    collections: CollectionNode[],
    requests: RequestDefinition[],
    collection: CollectionNode,
  ): Record<string, unknown> {
    const childCollections = collections.filter(
      (entry) => entry.parentCollectionId === collection.id,
    );
    const childRequests = requests.filter((request) => request.collectionId === collection.id);

    return {
      name: collection.name,
      item: [
        ...childCollections.map((entry) =>
          this.buildExportCollectionItem(collections, requests, entry),
        ),
        ...childRequests.map((request) => this.buildExportRequestItem(request)),
      ],
    };
  }

  private buildExportRequestItem(request: RequestDefinition): Record<string, unknown> {
    return {
      name: request.name,
      request: {
        method: request.method,
        header: request.headers.map((header) => ({
          key: header.key,
          value: header.value,
        })),
        url: {
          raw: this.composeExportUrl(request.url, request.queryParams),
        },
        body: this.buildExportBody(request),
      },
      event: request.postResponseScript.trim()
        ? [
            {
              listen: "test",
              script: {
                exec: request.postResponseScript.split("\n"),
              },
            },
          ]
        : [],
    };
  }

  private buildExportBody(request: RequestDefinition): Record<string, unknown> {
    if (request.bodyType === "form-data") {
      return {
        mode: "formdata",
        formdata: request.formData.map((field) => ({
          key: field.key,
          value: field.value,
          type: field.type,
          src: field.src,
        })),
      };
    }

    if (request.bodyType === "form-urlencoded") {
      return {
        mode: "urlencoded",
        urlencoded: Array.from(new URLSearchParams(request.body).entries()).map(([key, value]) => ({
          key,
          value,
        })),
      };
    }

    return {
      mode: "raw",
      raw: request.body,
      options: request.bodyType === "json" ? { raw: { language: "json" } } : undefined,
    };
  }

  private composeExportUrl(url: string, queryParams: KeyValue[]) {
    const params = queryParams.filter((entry) => entry.enabled && entry.key.trim());
    if (params.length === 0) {
      return url;
    }

    const queryString = new URLSearchParams(
      params.map((entry) => [entry.key, entry.value]),
    ).toString();
    return `${url}${url.includes("?") ? "&" : "?"}${queryString}`;
  }

  private async ensureImportCollection(projectId: string, name: string, parentCollectionId?: string) {
    const existing = await this.prisma.collection.findFirst({
      where: {
        projectId,
        name,
        parentCollectionId: parentCollectionId ?? null,
      },
    });
    if (existing) {
      return {
        collection: this.toCollection(existing),
        created: false,
        id: existing.id,
      };
    }

    const collection = await this.prisma.collection.create({
      data: {
        id: randomUUID(),
        projectId,
        name,
        parentCollectionId,
      },
    });
    return {
      collection: this.toCollection(collection),
      created: true,
      id: collection.id,
    };
  }

  private isHttpMethod(method: string): method is RequestDefinition["method"] {
    return ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"].includes(method);
  }

  private collectTemplateVariables(input: string, bucket: Set<string>) {
    for (const match of input.matchAll(/\{\{([^}]+)\}\}/g)) {
      const variableName = match[1]?.trim();
      if (variableName) {
        bucket.add(variableName);
      }
    }
  }

  private sanitizeUser(user: Pick<PrismaUser, "id" | "name" | "email" | "avatarUrl">): User {
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      avatarUrl: user.avatarUrl ?? undefined,
    };
  }

  private async findUserById(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });
    if (!user) {
      throw new NotFoundException("Usuário não encontrado.");
    }
    return user;
  }

  private async ensureProjectExists(projectId: string) {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, workspaceId: true },
    });
    if (!project) {
      throw new NotFoundException("Projeto não encontrado.");
    }
    return project;
  }

  private async getProjectWorkspace(projectId: string) {
    return this.ensureProjectExists(projectId);
  }

  private async getProjectBundleForExport(projectId: string) {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      include: {
        collections: { orderBy: { createdAt: "desc" } },
        environments: { orderBy: { createdAt: "desc" } },
        requests: { orderBy: { createdAt: "desc" } },
      },
    });
    if (!project) {
      throw new NotFoundException("Projeto não encontrado.");
    }

    return this.toProjectBundle(project);
  }

  private async requireWorkspaceRole(
    userId: string,
    workspaceId: string,
    allowedRoles: Membership["role"][],
  ) {
    const membership = await this.prisma.membership.findUnique({
      where: {
        userId_workspaceId: {
          userId,
          workspaceId,
        },
      },
    });
    if (!membership) {
      throw new UnauthorizedException("Usuário sem acesso a este workspace.");
    }
    if (!allowedRoles.includes(membership.role as Membership["role"])) {
      throw new UnauthorizedException("Você não possui permissão para esta ação.");
    }

    return membership;
  }

  private async saveEnvironmentSystem(
    projectId: string,
    payload: { id?: string; name: string; scope: "workspace" | "project"; variables: Variable[] },
  ) {
    const project = await this.ensureProjectExists(projectId);

    if (payload.id) {
      const existing = await this.prisma.environment.findUnique({
        where: { id: payload.id },
        select: { id: true, projectId: true },
      });
      if (!existing || existing.projectId !== project.id) {
        throw new NotFoundException("Ambiente não encontrado.");
      }

      const environment = await this.prisma.environment.update({
        where: { id: payload.id },
        data: {
          name: payload.name,
          scope: payload.scope,
          variables: this.variablesToJson(payload.variables),
        },
      });
      return this.toEnvironment(environment);
    }

    const environment = await this.prisma.environment.create({
      data: {
        id: randomUUID(),
        projectId,
        name: payload.name,
        scope: payload.scope,
        variables: this.variablesToJson(payload.variables),
      },
    });

    return this.toEnvironment(environment);
  }

  private async saveRequestSystem(
    projectId: string,
    payload: Omit<RequestDefinition, "projectId" | "updatedAt" | "id"> & { id?: string },
  ) {
    const project = await this.ensureProjectExists(projectId);

    if (payload.collectionId) {
      const collection = await this.prisma.collection.findUnique({
        where: { id: payload.collectionId },
        select: { id: true, projectId: true },
      });
      if (!collection || collection.projectId !== project.id) {
        throw new NotFoundException("Coleção não encontrada.");
      }
    }

    if (payload.id) {
      const existing = await this.prisma.request.findUnique({
        where: { id: payload.id },
        select: { id: true, projectId: true },
      });
      if (!existing || existing.projectId !== project.id) {
        throw new NotFoundException("Request não encontrada.");
      }

      const request = await this.prisma.request.update({
        where: { id: payload.id },
        data: {
          name: payload.name,
          collectionId: payload.collectionId,
          method: payload.method,
          url: payload.url,
          headers: this.keyValuesToJson(payload.headers),
          queryParams: this.keyValuesToJson(payload.queryParams),
          bodyType: payload.bodyType,
          body: payload.body,
          formData: this.formDataToJson(payload.formData),
          postResponseScript: payload.postResponseScript,
        },
      });

      return this.toRequest(request);
    }

    const request = await this.prisma.request.create({
      data: {
        id: randomUUID(),
        projectId,
        collectionId: payload.collectionId,
        name: payload.name,
        method: payload.method,
        url: payload.url,
        headers: this.keyValuesToJson(payload.headers),
        queryParams: this.keyValuesToJson(payload.queryParams),
        bodyType: payload.bodyType,
        body: payload.body,
        formData: this.formDataToJson(payload.formData),
        postResponseScript: payload.postResponseScript,
      },
    });

    return this.toRequest(request);
  }

  private hashToken(token: string) {
    return createHash("sha256").update(token).digest("hex");
  }

  private toWorkspace(workspace: { id: string; name: string }): Workspace {
    return {
      id: workspace.id,
      name: workspace.name,
    };
  }

  private toProject(project: { id: string; workspaceId: string; name: string; description: string }): Project {
    return {
      id: project.id,
      workspaceId: project.workspaceId,
      name: project.name,
      description: project.description,
    };
  }

  private toCollection(collection: {
    id: string;
    projectId: string;
    name: string;
    parentCollectionId: string | null;
  }): CollectionNode {
    return {
      id: collection.id,
      projectId: collection.projectId,
      name: collection.name,
      parentCollectionId: collection.parentCollectionId ?? undefined,
    };
  }

  private toEnvironment(environment: {
    id: string;
    projectId: string;
    scope: string;
    name: string;
    variables: Prisma.JsonValue;
  }): Environment {
    return {
      id: environment.id,
      projectId: environment.projectId,
      scope: environment.scope as Environment["scope"],
      name: environment.name,
      variables: this.parseVariables(environment.variables),
    };
  }

  private toRequest(request: {
    id: string;
    projectId: string;
    collectionId: string | null;
    name: string;
    method: string;
    url: string;
    headers: Prisma.JsonValue;
    queryParams: Prisma.JsonValue;
    bodyType: string;
    body: string;
    formData: Prisma.JsonValue;
    postResponseScript: string;
    updatedAt: Date;
  }): RequestDefinition {
    return {
      id: request.id,
      projectId: request.projectId,
      collectionId: request.collectionId ?? undefined,
      name: request.name,
      method: request.method as RequestDefinition["method"],
      url: request.url,
      headers: this.parseKeyValues(request.headers),
      queryParams: this.parseKeyValues(request.queryParams),
      bodyType: request.bodyType as RequestDefinition["bodyType"],
      body: request.body,
      formData: this.parseFormData(request.formData),
      postResponseScript: request.postResponseScript,
      updatedAt: request.updatedAt.toISOString(),
    };
  }

  private toProjectBundle(project: ProjectWithRelations) {
    return {
      ...this.toProject(project),
      collections: project.collections.map((collection) => this.toCollection(collection)),
      environments: project.environments.map((environment) => this.toEnvironment(environment)),
      requests: project.requests.map((request) => this.toRequest(request)),
    };
  }

  private toWorkspaceInvite(invite: InviteWithRelations): WorkspaceInvite {
    return {
      id: invite.id,
      workspaceId: invite.workspaceId,
      workspaceName: invite.workspace.name,
      email: invite.email,
      role: invite.role as WorkspaceInvite["role"],
      status: invite.status as WorkspaceInvite["status"],
      invitedBy: this.sanitizeUser(invite.invitedBy),
      createdAt: invite.createdAt.toISOString(),
      updatedAt: invite.updatedAt.toISOString(),
    };
  }

  private toNotification(notification: NotificationWithRelations): Notification {
    return {
      id: notification.id,
      type: notification.type as Notification["type"],
      title: notification.title,
      body: notification.body,
      readAt: notification.readAt?.toISOString(),
      createdAt: notification.createdAt.toISOString(),
      invite: notification.invite ? this.toWorkspaceInvite(notification.invite) : undefined,
    };
  }

  private parseVariables(value: Prisma.JsonValue): Variable[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return value.map((entry) => {
      const item = this.asRecord(entry);
      return {
        key: String(item.key ?? ""),
        value: String(item.value ?? ""),
        enabled: item.enabled !== false,
        secret: item.secret === true,
      };
    });
  }

  private parseKeyValues(value: Prisma.JsonValue): KeyValue[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return value.map((entry) => {
      const item = this.asRecord(entry);
      return {
        id: String(item.id ?? randomUUID()),
        key: String(item.key ?? ""),
        value: String(item.value ?? ""),
        enabled: item.enabled !== false,
      };
    });
  }

  private parseFormData(value: Prisma.JsonValue): FormDataField[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return value.map((entry) => {
      const item = this.asRecord(entry);
      const type = item.type === "file" ? "file" : "text";
      return {
        id: String(item.id ?? randomUUID()),
        key: String(item.key ?? ""),
        value: String(item.value ?? ""),
        enabled: item.enabled !== false,
        type,
        src: typeof item.src === "string" ? item.src : undefined,
      };
    });
  }

  private variablesToJson(variables: Variable[]): Prisma.InputJsonValue {
    return variables.map((variable) => ({
      key: variable.key,
      value: variable.value,
      enabled: variable.enabled,
      secret: variable.secret ?? false,
    }));
  }

  private keyValuesToJson(items: KeyValue[]): Prisma.InputJsonValue {
    return items.map((item) => ({
      id: item.id,
      key: item.key,
      value: item.value,
      enabled: item.enabled,
    }));
  }

  private formDataToJson(items: FormDataField[]): Prisma.InputJsonValue {
    return items.map((item) => ({
      id: item.id,
      key: item.key,
      value: item.value,
      enabled: item.enabled,
      type: item.type,
      src: item.src ?? "",
    }));
  }

  private asRecord(value: Prisma.JsonValue): Record<string, Prisma.JsonValue> {
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, Prisma.JsonValue>)
      : {};
  }

  private async createNotificationsForPendingInvites(user: PrismaUser) {
    const invites = await this.prisma.workspaceInvite.findMany({
      where: {
        email: user.email.toLowerCase(),
        status: "pending",
      },
      include: {
        workspace: true,
        invitedBy: true,
      },
    });

    for (const invite of invites) {
      await this.ensureInviteNotification(user.id, invite);
    }
  }

  private async ensureInviteNotification(userId: string, invite: InviteWithRelations) {
    const existing = await this.prisma.notification.findFirst({
      where: {
        userId,
        inviteId: invite.id,
      },
      select: { id: true },
    });
    if (existing) {
      return;
    }

    await this.prisma.notification.create({
      data: {
        id: randomUUID(),
        userId,
        inviteId: invite.id,
        type: "workspace_invite",
        title: `Convite para ${invite.workspace.name}`,
        body: `${invite.invitedBy.name} convidou você para o workspace ${invite.workspace.name}.`,
        metadata: {
          workspaceId: invite.workspaceId,
          role: invite.role,
        },
      },
    });
  }
}
