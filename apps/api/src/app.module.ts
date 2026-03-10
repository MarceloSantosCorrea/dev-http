import { Module } from "@nestjs/common";

import { AuthController } from "./auth/auth.controller";
import { AuthService } from "./auth/auth.service";
import { ExecutionController } from "./execution/execution.controller";
import { ExecutionService } from "./execution/execution.service";
import { HealthController } from "./health.controller";
import { PreferencesController } from "./preferences/preferences.controller";
import { PrismaService } from "./prisma/prisma.service";
import { ProjectsController } from "./projects/projects.controller";
import { ProjectsService } from "./projects/projects.service";
import { StoreService } from "./store/store.service";
import { UsersController } from "./users/users.controller";
import { WorkspacesController } from "./workspaces/workspaces.controller";

@Module({
  controllers: [
    HealthController,
    AuthController,
    WorkspacesController,
    ProjectsController,
    ExecutionController,
    PreferencesController,
    UsersController,
  ],
  providers: [PrismaService, StoreService, AuthService, ProjectsService, ExecutionService],
})
export class AppModule {}
