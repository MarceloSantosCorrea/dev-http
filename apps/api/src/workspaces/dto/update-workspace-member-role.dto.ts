import { IsIn } from "class-validator";

export class UpdateWorkspaceMemberRoleDto {
  @IsIn(["owner", "admin", "editor", "viewer"])
  role!: "owner" | "admin" | "editor" | "viewer";
}
