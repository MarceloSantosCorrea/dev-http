import { Type } from "class-transformer";
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  ValidateNested,
} from "class-validator";

class KeyValueDto {
  @IsOptional()
  @IsString()
  id?: string;

  @IsString()
  key!: string;

  @IsString()
  value!: string;

  @IsBoolean()
  enabled!: boolean;
}

class FormDataFieldDto {
  @IsOptional()
  @IsString()
  id?: string;

  @IsString()
  key!: string;

  @IsString()
  value!: string;

  @IsBoolean()
  enabled!: boolean;

  @IsIn(["text", "file"])
  type!: "text" | "file";

  @IsOptional()
  @IsString()
  src?: string;
}

export class UpdateRequestDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsIn(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"])
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS";

  @IsOptional()
  @IsString()
  url?: string;

  @IsOptional()
  @IsString()
  environmentId?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => KeyValueDto)
  headers?: KeyValueDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => KeyValueDto)
  queryParams?: KeyValueDto[];

  @IsOptional()
  @IsIn(["json", "text", "form-urlencoded", "form-data"])
  bodyType?: "json" | "text" | "form-urlencoded" | "form-data";

  @IsOptional()
  @IsString()
  body?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FormDataFieldDto)
  formData?: FormDataFieldDto[];

  @IsOptional()
  @IsString()
  postResponseScript?: string;
}
