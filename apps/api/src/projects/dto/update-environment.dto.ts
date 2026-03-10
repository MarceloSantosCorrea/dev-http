import { Type } from "class-transformer";
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  ValidateNested,
} from "class-validator";

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

export class UpdateEnvironmentDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsIn(["workspace", "project"])
  scope?: "workspace" | "project";

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => VariableDto)
  variables?: VariableDto[];
}
