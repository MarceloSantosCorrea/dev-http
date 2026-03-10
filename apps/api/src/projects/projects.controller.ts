import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Post,
  Req,
} from "@nestjs/common";

import { AuthService } from "../auth/auth.service";
import type { RequestLike } from "../auth/auth-http";
import { CreateCollectionDto } from "./dto/create-collection.dto";
import { CreateProjectDto } from "./dto/create-project.dto";
import { SaveEnvironmentDto } from "./dto/save-environment.dto";
import { SaveRequestDto } from "./dto/save-request.dto";
import { ProjectsService } from "./projects.service";

type PostmanImportPayload = {
  collection?: Record<string, unknown>;
  environment?: Record<string, unknown>;
};

@Controller()
export class ProjectsController {
  constructor(
    @Inject(AuthService)
    private readonly authService: AuthService,
    @Inject(ProjectsService)
    private readonly projectsService: ProjectsService,
  ) {}

  @Get("projects/:projectId")
  async getProject(
    @Param("projectId") projectId: string,
    @Req() request: RequestLike,
  ) {
    await this.authService.requireUserFromRequest(request);
    return this.projectsService.getProject(projectId);
  }

  @Post("workspaces/:workspaceId/projects")
  async createProject(
    @Param("workspaceId") workspaceId: string,
    @Body() body: CreateProjectDto,
    @Req() request: RequestLike,
  ) {
    this.authService.requireCsrf(request);
    await this.authService.requireUserFromRequest(request);
    return this.projectsService.createProject(workspaceId, body);
  }

  @Post("projects/:projectId/environments")
  async saveEnvironment(
    @Param("projectId") projectId: string,
    @Body() body: SaveEnvironmentDto,
    @Req() request: RequestLike,
  ) {
    this.authService.requireCsrf(request);
    await this.authService.requireUserFromRequest(request);
    return this.projectsService.saveEnvironment(projectId, body);
  }

  @Post("projects/:projectId/collections")
  async createCollection(
    @Param("projectId") projectId: string,
    @Body() body: CreateCollectionDto,
    @Req() request: RequestLike,
  ) {
    this.authService.requireCsrf(request);
    await this.authService.requireUserFromRequest(request);
    return this.projectsService.createCollection(projectId, body);
  }

  @Delete("projects/:projectId")
  async removeProject(
    @Param("projectId") projectId: string,
    @Req() request: RequestLike,
  ) {
    this.authService.requireCsrf(request);
    await this.authService.requireUserFromRequest(request);
    return this.projectsService.removeProject(projectId);
  }

  @Post("projects/:projectId/requests")
  async saveRequest(
    @Param("projectId") projectId: string,
    @Body() body: SaveRequestDto,
    @Req() request: RequestLike,
  ) {
    this.authService.requireCsrf(request);
    await this.authService.requireUserFromRequest(request);
    return this.projectsService.saveRequest(projectId, body);
  }

  @Post("projects/:projectId/import/postman")
  async importPostman(
    @Param("projectId") projectId: string,
    @Body() body: PostmanImportPayload,
    @Req() request: RequestLike,
  ) {
    this.authService.requireCsrf(request);
    await this.authService.requireUserFromRequest(request);
    return this.projectsService.importPostman(projectId, body);
  }

  @Get("projects/:projectId/export/postman")
  async exportPostman(
    @Param("projectId") projectId: string,
    @Req() request: RequestLike,
  ) {
    await this.authService.requireUserFromRequest(request);
    return this.projectsService.exportProject(projectId);
  }
}
