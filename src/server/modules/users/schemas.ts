import { z } from "zod";
import { emailSchema, newPasswordSchema } from "../auth/schemas";

const roleSchema = z.enum(["ADMIN", "EXAMINER", "CANDIDATE"]);
const nameSchema = z.string().trim().min(1, "Enter a name.").max(120);

export const createUserSchema = z.strictObject({
  email: emailSchema,
  name: nameSchema,
  role: roleSchema,
  password: newPasswordSchema,
});

export const updateUserSchema = z
  .strictObject({
    name: nameSchema.optional(),
    role: roleSchema.optional(),
    isActive: z.boolean().optional(),
    password: newPasswordSchema.optional(),
  })
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: "Provide at least one field to change.",
  });

// Query string values arrive as text, so numbers and booleans are coerced.
export const listUsersSchema = z.object({
  role: roleSchema.optional(),
  isActive: z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .optional(),
  q: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
export type ListUsersInput = z.infer<typeof listUsersSchema>;
