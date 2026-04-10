import { z } from "zod";

// ─── Auth ──────────────────────────────────────────────────

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
});

// ─── Tenants ───────────────────────────────────────────────

export const createTenantSchema = z.object({
  name: z.string().min(1).max(255),
  slug: z
    .string()
    .min(1)
    .max(100)
    .regex(
      /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
      "Slug must be lowercase alphanumeric with hyphens"
    ),
});

// ─── Integrations ──────────────────────────────────────────

export const createIntegrationSchema = z.object({
  appName: z.string().min(1).max(100),
  apiKey: z.string().min(1),
  baseUrl: z.string().url().optional(),
  syncFrequency: z.enum(["daily", "weekly", "monthly"]).default("monthly"),
  extraConfig: z.record(z.unknown()).optional(),
});

export const updateIntegrationSchema = z.object({
  apiKey: z.string().min(1).optional(),
  baseUrl: z.string().url().optional(),
  syncFrequency: z.enum(["daily", "weekly", "monthly"]).optional(),
  status: z.enum(["active", "inactive"]).optional(),
  extraConfig: z.record(z.unknown()).optional(),
});

// ─── User query filters ────────────────────────────────────

export const usersQuerySchema = z.object({
  integrationId: z.string().uuid().optional(),
  licenseType: z.string().optional(),
  isActive: z
    .enum(["true", "false"])
    .transform((v) => v === "true")
    .optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(10000).default(50),
});
