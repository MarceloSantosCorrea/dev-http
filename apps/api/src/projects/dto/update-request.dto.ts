import { IsOptional, IsString } from "class-validator";

export class UpdateRequestDto {
  @IsOptional()
  @IsString()
  name?: string;
}
