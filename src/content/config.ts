import { defineCollection, z } from "astro:content";

const rhythms = defineCollection({
  type: "content",
  schema: z.object({
    title: z.string(),
    tempo: z.number().positive(),
    subdivision: z.literal(16),
    difficulty: z.string(),
    instruments: z.array(z.string()),
  }),
});

export const collections = {
  rhythms,
};
