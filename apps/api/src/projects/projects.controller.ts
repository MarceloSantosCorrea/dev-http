import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Req,
} from "@nestjs/common";

import { AuthService } from "../auth/auth.service";
import type { RequestLike } from "../auth/auth-http";
import { CreateCollectionDto } from "./dto/create-collection.dto";
import { CreateProjectDto } from "./dto/create-project.dto";
import { SaveEnvironmentDto } from "./dto/save-environment.dto";
import { SaveRequestDto } from "./dto/save-request.dto";
import { UpdateCollectionDto } from "./dto/update-collection.dto";
import { UpdateProjectDto } from "./dto/update-project.dto";
import { UpdateRequestDto } from "./dto/update-request.dto";
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
    const user = await this.authService.requireUserFromRequest(request);
    return this.projectsService.getProject(user.id, projectId);
  }

  @Post("workspaces/:workspaceId/projects")
  async createProject(
    @Param("workspaceId") workspaceId: string,
    @Body() body: CreateProjectDto,
    @Req() request: RequestLike,
  ) {
    this.authService.requireCsrf(request);
    const user = await this.authService.requireUserFromRequest(request);
    return this.projectsService.createProject(user.id, workspaceId, body);
  }

  @Patch("projects/:projectId")
  async updateProject(
    @Param("projectId") projectId: string,
    @Body() body: UpdateProjectDto,
    @Req() request: RequestLike,
  ) {
    this.authService.requireCsrf(request);
    const user = await this.authService.requireUserFromRequest(request);
    return this.projectsService.updateProject(user.id, projectId, body);
  }

  @Post("projects/:projectId/environments")
  async saveEnvironment(
    @Param("projectId") projectId: string,
    @Body() body: SaveEnvironmentDto,
    @Req() request: RequestLike,
  ) {
    this.authService.requireCsrf(request);
    const user = await this.authService.requireUserFromRequest(request);
    return this.projectsService.saveEnvironment(user.id, projectId, body);
  }

  @Post("projects/:projectId/collections")
  async createCollection(
    @Param("projectId") projectId: string,
    @Body() body: CreateCollectionDto,
    @Req() request: RequestLike,
  ) {
    this.authService.requireCsrf(request);
    const user = await this.authService.requireUserFromRequest(request);
    return this.projectsService.createCollection(user.id, projectId, body);
  }

  @Patch("projects/:projectId/collections/:collectionId")
  async updateCollection(
    @Param("projectId") projectId: string,
    @Param("collectionId") collectionId: string,
    @Body() body: UpdateCollectionDto,
    @Req() request: RequestLike,
  ) {
    this.authService.requireCsrf(request);
    const user = await this.authService.requireUserFromRequest(request);
    return this.projectsService.updateCollection(user.id, projectId, collectionId, body);
  }

  @Delete("projects/:projectId")
  async removeProject(
    @Param("projectId") projectId: string,
    @Req() request: RequestLike,
  ) {
    this.authService.requireCsrf(request);
    const user = await this.authService.requireUserFromRequest(request);
    return this.projectsService.removeProject(user.id, projectId);
  }

  @Post("projects/:projectId/requests")
  async saveRequest(
    @Param("projectId") projectId: string,
    @Body() body: SaveRequestDto,
    @Req() request: RequestLike,
  ) {
    this.authService.requireCsrf(request);
    const user = await this.authService.requireUserFromRequest(request);
    return this.projectsService.saveRequest(user.id, projectId, body);
  }

  @Patch("projects/:projectId/requests/:requestId")
  async updateRequest(
    @Param("projectId") projectId: string,
    @Param("requestId") requestId: string,
    @Body() body: UpdateRequestDto,
    @Req() request: RequestLike,
  ) {
    this.authService.requireCsrf(request);
    const user = await this.authService.requireUserFromRequest(request);
    return this.projectsService.updateRequest(user.id, projectId, requestId, body);
  }

  @Post("projects/:projectId/import/postman")
  async importPostman(
    @Param("projectId") projectId: string,
    @Body() body: PostmanImportPayload,
    @Req() request: RequestLike,
  ) {
    this.authService.requireCsrf(request);
    const user = await this.authService.requireUserFromRequest(request);
    return this.projectsService.importPostman(user.id, projectId, body);
  }

  @Get("projects/:projectId/export/postman")
  async exportPostman(
    @Param("projectId") projectId: string,
    @Req() request: RequestLike,
  ) {
    const user = await this.authService.requireUserFromRequest(request);
    return this.projectsService.exportProject(user.id, projectId);
  }
}
