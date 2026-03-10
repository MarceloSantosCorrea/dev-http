import { Type } from "class-transformer";
import { IsArray, IsBoolean, IsIn, IsOptional, IsString, ValidateNested } from "class-validator";

class VariableDto {
  @IsString()
  key!: string;

  @IsString()
  value!: string;

  @IsBoolean()
  enabled!: boolean;

  @IsOptional()
  @IsBoolean()
  secret?: boolean;
}

export class SaveEnvironmentDto {
  @IsOptional()
  @IsString()
  id?: string;

  @IsString()
  name!: string;

  @IsIn(["workspace", "project"])
  scope!: "workspace" | "project";

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => VariableDto)
  variables!: VariableDto[];
}
