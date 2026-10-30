import { z } from "zod";
import { EXPIRIES, MAX_TEXT_BYTES } from "./shared";

const base64url = /^[A-Za-z0-9_-]+$/;
export const idSchema = z.string().regex(/^[a-f0-9]{32}$/);
export const tokenSchema = z.string().length(43).regex(base64url);
export const envelopeSchema = z.strictObject({
  v: z.literal(1),
  iv: z.string().length(16).regex(base64url),
  ciphertext: z.string().min(22).max(Math.ceil((MAX_TEXT_BYTES + 16) * 4 / 3)).regex(base64url),
}).superRefine((data, ctx) => {
  const bytes = Buffer.from(data.ciphertext, "base64url");
  if (bytes.length < 16 || bytes.length > MAX_TEXT_BYTES + 16 || bytes.toString("base64url") !== data.ciphertext) {
    ctx.addIssue({ code: "custom", message: "Invalid ciphertext." });
  }
});
export const createSchema = z.strictObject({
  accessTokenHash: z.string().regex(/^[a-f0-9]{64}$/),
  expiresIn: z.number().refine((n) => EXPIRIES.some((entry) => entry.seconds === n)),
});
export const snippetSchema = z.strictObject({ id: idSchema, envelope: envelopeSchema });
export const padSchema = z.strictObject({ expectedRevision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER - 1), envelope: envelopeSchema });
