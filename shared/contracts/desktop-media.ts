import { z } from "zod";

// Temporary local generators deliberately expose their limited, procedural scope.
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const size = z.number().int().min(8).max(1024);
export const mediaSpec = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("art"), format: z.literal("png"), width: size, height: size, color, shape: z.enum(["circle", "diamond", "square"]), transparent: z.boolean() }).strict(),
  z.object({ kind: z.literal("sound"), format: z.literal("wav"), seconds: z.number().min(0.05).max(30), frequency: z.number().min(40).max(12000), sampleRate: z.enum(["22050", "44100", "48000"]), channels: z.union([z.literal(1), z.literal(2)]), waveform: z.enum(["sine", "triangle"]), fade: z.boolean() }).strict(),
  z.object({ kind: z.literal("effect"), format: z.literal("png-sheet"), width: size, height: size, color, frames: z.number().int().min(2).max(32), seconds: z.number().min(0.1).max(10) }).strict(),
]).superRefine((spec, ctx) => {
  if (spec.kind === "sound" && spec.frequency >= Number(spec.sampleRate) / 2) ctx.addIssue({ code: "custom", message: "MEDIA_FREQUENCY_UNSUPPORTED", path: ["frequency"] });
  if (spec.kind === "effect" && spec.width * spec.height * spec.frames > 16 * 1024 * 1024) ctx.addIssue({ code: "custom", message: "MEDIA_PIXEL_LIMIT", path: ["frames"] });
});
export type MediaSpec = z.infer<typeof mediaSpec>;
export const mediaBudget = Object.freeze({ perFile: 32 * 1024 * 1024, total: 128 * 1024 * 1024, files: 100, pixels: 16 * 1024 * 1024 });
export const temporaryGenerator = "orchiva-procedural-v1";
