import { IsOptional, IsString } from "class-validator";

export class ExecuteSavedRequestDto {
  @IsOptional()
  @IsString()
  environmentId?: string;
}
