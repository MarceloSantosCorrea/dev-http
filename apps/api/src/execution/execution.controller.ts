import { Body, Controller, Inject, Post, Req } from "@nestjs/common";

import { AuthService } from "../auth/auth.service";
import type { RequestLike } from "../auth/auth-http";
import { ExecuteRequestDto } from "./dto/execute-request.dto";
import { ExecutionService } from "./execution.service";

@Controller("requests")
export class ExecutionController {
  constructor(
    @Inject(AuthService)
    private readonly authService: AuthService,
    @Inject(ExecutionService)
    private readonly executionService: ExecutionService,
  ) {}

  @Post("execute")
  async execute(
    @Body() body: ExecuteRequestDto,
    @Req() request: RequestLike,
  ) {
    this.authService.requireCsrf(request);
    await this.authService.requireUserFromRequest(request);
    return this.executionService.execute(body);
  }
}
