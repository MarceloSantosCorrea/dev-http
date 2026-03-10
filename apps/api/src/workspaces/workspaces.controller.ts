import { Body, Controller, Delete, Get, Inject, Param, Patch, Post, Req } from "@nestjs/common";

import { AuthService } from "../auth/auth.service";
import type { RequestLike } from "../auth/auth-http";
import { StoreService } from "../store/store.service";
import { CreateWorkspaceDto } from "./dto/create-workspace.dto";
import { CreateWorkspaceInviteDto } from "./dto/create-workspace-invite.dto";
import { UpdateWorkspaceMemberRoleDto } from "./dto/update-workspace-member-role.dto";
import { UpdateWorkspaceDto } from "./dto/update-workspace.dto";

@Controller("workspaces")
export class WorkspacesController {
  constructor(
    @Inject(AuthService)
    private readonly authService: AuthService,
    @Inject(StoreService)
    private readonly store: StoreService,
  ) {}

  @Post()
  async createWorkspace(@Body() body: CreateWorkspaceDto, @Req() request: RequestLike) {
    this.authService.requireCsrf(request);
    const user = await this.authService.requireUserFromRequest(request);
    return this.store.createWorkspace(user.id, body);
  }

  @Get(":workspaceId/bootstrap")
  async bootstrap(
    @Param("workspaceId") workspaceId: string,
    @Req() request: RequestLike,
  ) {
    const user = await this.authService.requireUserFromRequest(request);
    return this.store.getBootstrap(user.id, workspaceId);
  }

  @Patch(":workspaceId")
  async updateWorkspace(
    @Param("workspaceId") workspaceId: string,
    @Body() body: UpdateWorkspaceDto,
    @Req() request: RequestLike,
  ) {
    this.authService.requireCsrf(request);
    const user = await this.authService.requireUserFromRequest(request);
    return this.store.updateWorkspace(user.id, workspaceId, {
      name: body.name,
    });
  }

  @Get(":workspaceId/members")
  async listMembers(
    @Param("workspaceId") workspaceId: string,
    @Req() request: RequestLike,
  ) {
    const user = await this.authService.requireUserFromRequest(request);
    return this.store.listWorkspaceMembers(user.id, workspaceId);
  }

  @Get(":workspaceId/invites")
  async listInvites(
    @Param("workspaceId") workspaceId: string,
    @Req() request: RequestLike,
  ) {
    const user = await this.authService.requireUserFromRequest(request);
    return this.store.listWorkspaceInvites(user.id, workspaceId);
  }

  @Post(":workspaceId/invites")
  async createInvite(
    @Param("workspaceId") workspaceId: string,
    @Body() body: CreateWorkspaceInviteDto,
    @Req() request: RequestLike,
  ) {
    this.authService.requireCsrf(request);
    const user = await this.authService.requireUserFromRequest(request);
    return this.store.createWorkspaceInvite(user.id, workspaceId, body);
  }

  @Patch(":workspaceId/members/:memberUserId")
  async updateMemberRole(
    @Param("workspaceId") workspaceId: string,
    @Param("memberUserId") memberUserId: string,
    @Body() body: UpdateWorkspaceMemberRoleDto,
    @Req() request: RequestLike,
  ) {
    this.authService.requireCsrf(request);
    const user = await this.authService.requireUserFromRequest(request);
    return this.store.updateWorkspaceMemberRole(user.id, workspaceId, memberUserId, body.role);
  }

  @Delete(":workspaceId/members/:memberUserId")
  async removeMember(
    @Param("workspaceId") workspaceId: string,
    @Param("memberUserId") memberUserId: string,
    @Req() request: RequestLike,
  ) {
    this.authService.requireCsrf(request);
    const user = await this.authService.requireUserFromRequest(request);
    return this.store.removeWorkspaceMember(user.id, workspaceId, memberUserId);
  }

  @Delete(":workspaceId/invites/:inviteId")
  async revokeInvite(
    @Param("workspaceId") workspaceId: string,
    @Param("inviteId") inviteId: string,
    @Req() request: RequestLike,
  ) {
    this.authService.requireCsrf(request);
    const user = await this.authService.requireUserFromRequest(request);
    return this.store.revokeWorkspaceInvite(user.id, workspaceId, inviteId);
  }

  @Post("invites/:inviteId/accept")
  async acceptInvite(
    @Param("inviteId") inviteId: string,
    @Req() request: RequestLike,
  ) {
    this.authService.requireCsrf(request);
    const user = await this.authService.requireUserFromRequest(request);
    return this.store.acceptWorkspaceInvite(user.id, inviteId);
  }

  @Post("invites/:inviteId/decline")
  async declineInvite(
    @Param("inviteId") inviteId: string,
    @Req() request: RequestLike,
  ) {
    this.authService.requireCsrf(request);
    const user = await this.authService.requireUserFromRequest(request);
    return this.store.declineWorkspaceInvite(user.id, inviteId);
  }
}
