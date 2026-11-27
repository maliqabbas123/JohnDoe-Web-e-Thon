import { z } from "zod";

// Emails are compared case-insensitively, so they are stored lower-case.
export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .pipe(z.email("Enter a valid email address."));

// Length is the requirement; composition rules are deliberately absent, in
// line with NIST SP 800-63B.
export const newPasswordSchema = z
  .string()
  .min(8, "Use at least 8 characters.")
  .max(128, "Use at most 128 characters.");

export const loginSchema = z.strictObject({
  email: emailSchema,
  password: z.string().min(1, "Enter your password.").max(128),
});

export const changePasswordSchema = z
  .strictObject({
    currentPassword: z.string().min(1, "Enter your current password.").max(128),
    newPassword: newPasswordSchema,
  })
  .refine((value) => value.currentPassword !== value.newPassword, {
    path: ["newPassword"],
    message: "Choose a password different from the current one.",
  });

export type LoginInput = z.infer<typeof loginSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
