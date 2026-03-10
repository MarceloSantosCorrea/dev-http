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

export class SaveRequestDto {
  @IsOptional()
  @IsString()
  id?: string;

  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsIn(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"])
  method!: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS";

  @IsString()
  url!: string;

  @IsOptional()
  @IsString()
  environmentId?: string;

  @IsOptional()
  @IsString()
  collectionId?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => KeyValueDto)
  headers!: KeyValueDto[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => KeyValueDto)
  queryParams!: KeyValueDto[];

  @IsIn(["json", "text", "form-urlencoded", "form-data"])
  bodyType!: "json" | "text" | "form-urlencoded" | "form-data";

  @IsString()
  body!: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FormDataFieldDto)
  formData?: FormDataFieldDto[];

  @IsString()
  postResponseScript!: string;
}
