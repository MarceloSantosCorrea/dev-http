import { IsOptional, IsString, MaxLength, MinLength } from "class-validator";

export class UpdateCollectionDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name?: string;
}
