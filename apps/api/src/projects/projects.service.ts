import { Inject, Injectable } from "@nestjs/common";

import { StoreService } from "../store/store.service";
import { CreateCollectionDto } from "./dto/create-collection.dto";
import { CreateProjectDto } from "./dto/create-project.dto";
import { SaveEnvironmentDto } from "./dto/save-environment.dto";
import { SaveRequestDto } from "./dto/save-request.dto";

type PostmanImportPayload = {
  collection?: Record<string, unknown>;
  environment?: Record<string, unknown>;
};

@Injectable()
export class ProjectsService {
  constructor(@Inject(StoreService) private readonly store: StoreService) {}

  async listProjects(workspaceId: string) {
    return this.store.listProjects(workspaceId);
  }

  async getProject(projectId: string) {
    return this.store.getProject(projectId);
  }

  async createProject(workspaceId: string, dto: CreateProjectDto) {
    return this.store.createProject(workspaceId, {
      name: dto.name,
      description: dto.description ?? "",
    });
  }

  async createCollection(projectId: string, dto: CreateCollectionDto) {
    return this.store.createCollection(projectId, {
      name: dto.name,
      parentCollectionId: dto.parentCollectionId,
    });
  }

  async removeProject(projectId: string) {
    return this.store.removeProject(projectId);
  }

  async saveEnvironment(projectId: string, dto: SaveEnvironmentDto) {
    return this.store.saveEnvironment(projectId, dto);
  }

  async saveRequest(projectId: string, dto: SaveRequestDto) {
    return this.store.saveRequest(projectId, {
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

  async importPostman(projectId: string, payload: PostmanImportPayload) {
    return this.store.importPostman(projectId, payload);
  }

  async exportProject(projectId: string) {
    return this.store.exportProject(projectId);
  }
}
