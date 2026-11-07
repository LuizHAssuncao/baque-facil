import { defineCollection, z } from "astro:content";

const rhythms = defineCollection({
  type: "content",
  schema: z.object({
    title: z.string(),
    category: z.enum(["rhythm", "sequence", "call"]).optional(),
    tempo: z.number().positive(),
    subdivision: z.union([z.literal(8), z.literal(16), z.literal(32)]),
    difficulty: z.string(),
    instruments: z.array(z.string()),
    gesture: z.object({
      src: z.string().regex(/^\/(?!\/)[^?#]+\.(?:webp|png|svg)$/i),
      description: z.object({
        "en-CA": z.string().min(1),
        "pt-BR": z.string().min(1),
      }),
    }).optional(),
  }),
});

export const collections = {
  rhythms,
};
