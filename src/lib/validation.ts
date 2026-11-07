import { z } from 'zod';

// Request body schemas. Every schema is .strict(): any key not listed here
// (company_id, companyId, owner_user_id, role on a document, etc.) causes a
// 400. Fields like company_id and owner_user_id have NO schema anywhere; they
// are only ever set from the authenticated session on the server.

const title = z.string().trim().min(1, 'Title is required').max(200);
const docBody = z.string().max(20_000);
const projectName = z.string().trim().min(1, 'Name is required').max(100);

export const loginSchema = z
  .object({
    email: z.string().trim().max(254),
    password: z.string().min(1).max(200),
  })
  .strict();

export const createDocumentSchema = z.object({ title, body: docBody }).strict();

export const updateDocumentSchema = z
  .object({ title: title.optional(), body: docBody.optional() })
  .strict()
  .refine((v) => v.title !== undefined || v.body !== undefined, {
    message: 'Provide at least one of title or body',
  });

export const projectSchema = z.object({ name: projectName }).strict();

// Admin-created users always start as 'member'. Promotion is a separate,
// explicit admin-only action (changeRoleSchema), never part of user creation.
export const createUserSchema = z
  .object({
    email: z.email().max(254),
    password: z.string().min(12, 'Password must be at least 12 characters').max(200),
  })
  .strict();

export const changeRoleSchema = z.object({ role: z.enum(['admin', 'member']) }).strict();

export const setActiveSchema = z.object({ isActive: z.boolean() }).strict();
