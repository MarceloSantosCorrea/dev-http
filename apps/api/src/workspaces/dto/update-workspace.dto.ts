import { IsOptional, IsString, MaxLength, MinLength } from "class-validator";

export class UpdateWorkspaceDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(400)
  description?: string;
}
