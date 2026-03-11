import { Inject, Injectable } from "@nestjs/common";

import { StoreService } from "../store/store.service";
import { CreateCollectionDto } from "./dto/create-collection.dto";
import { CreateProjectDto } from "./dto/create-project.dto";
import { ReorderDto } from "./dto/reorder.dto";
import { SaveEnvironmentDto } from "./dto/save-environment.dto";
import { SaveRequestDto } from "./dto/save-request.dto";
import { UpdateCollectionDto } from "./dto/update-collection.dto";
import { UpdateProjectDto } from "./dto/update-project.dto";
import { UpdateRequestDto } from "./dto/update-request.dto";

type PostmanImportPayload = {
  collection?: Record<string, unknown>;
  environment?: Record<string, unknown>;
};

@Injectable()
export class ProjectsService {
  constructor(@Inject(StoreService) private readonly store: StoreService) {}

  async listProjects(userId: string, workspaceId: string) {
    return this.store.listProjects(userId, workspaceId);
  }

  async getProject(userId: string, projectId: string) {
    return this.store.getProject(userId, projectId);
  }

  async createProject(userId: string, workspaceId: string, dto: CreateProjectDto) {
    return this.store.createProject(userId, workspaceId, {
      name: dto.name,
      description: dto.description ?? "",
    });
  }

  async updateProject(userId: string, projectId: string, dto: UpdateProjectDto) {
    return this.store.updateProject(userId, projectId, {
      name: dto.name,
      description: dto.description,
    });
  }

  async createCollection(userId: string, projectId: string, dto: CreateCollectionDto) {
    return this.store.createCollection(userId, projectId, {
      name: dto.name,
      parentCollectionId: dto.parentCollectionId,
    });
  }

  async updateCollection(
    userId: string,
    projectId: string,
    collectionId: string,
    dto: UpdateCollectionDto,
  ) {
    return this.store.updateCollection(userId, projectId, collectionId, {
      name: dto.name,
    });
  }

  async removeProject(userId: string, projectId: string) {
    return this.store.removeProject(userId, projectId);
  }

  async saveEnvironment(userId: string, projectId: string, dto: SaveEnvironmentDto) {
    return this.store.saveEnvironment(userId, projectId, dto);
  }

  async saveRequest(userId: string, projectId: string, dto: SaveRequestDto) {
    return this.store.saveRequest(userId, projectId, {
      id: dto.id,
      name: dto.name,
      collectionId: dto.collectionId,
      method: dto.method,
      url: dto.url,
      headers: dto.headers.map((header) => ({
        id: header.id ?? crypto.randomUUID(),
        key: header.key,
        value: header.value,
        enabled: header.enabled,
      })),
      queryParams: dto.queryParams.map((param) => ({
        id: param.id ?? crypto.randomUUID(),
        key: param.key,
        value: param.value,
        enabled: param.enabled,
      })),
      bodyType: dto.bodyType,
      body: dto.body,
      formData: (dto.formData ?? []).map((field) => ({
        id: field.id ?? crypto.randomUUID(),
        key: field.key,
        value: field.value,
        enabled: field.enabled,
        type: field.type,
        src: field.src,
      })),
      postResponseScript: dto.postResponseScript,
    });
  }

  async updateRequest(
    userId: string,
    projectId: string,
    requestId: string,
    dto: UpdateRequestDto,
  ) {
    return this.store.updateRequest(userId, projectId, requestId, {
      name: dto.name,
    });
  }

  async reorderCollections(userId: string, projectId: string, dto: ReorderDto) {
    return this.store.reorderCollections(userId, projectId, dto.ids);
  }

  async reorderRequests(userId: string, projectId: string, dto: ReorderDto) {
    return this.store.reorderRequests(userId, projectId, dto.ids);
  }

  async reorderEnvironments(userId: string, projectId: string, dto: ReorderDto) {
    return this.store.reorderEnvironments(userId, projectId, dto.ids);
  }

  async importPostman(userId: string, projectId: string, payload: PostmanImportPayload) {
    return this.store.importPostman(userId, projectId, payload);
  }

  async exportProject(userId: string, projectId: string) {
    await this.store.getProject(userId, projectId);
    return this.store.exportProject(projectId);
  }
}
