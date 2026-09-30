import { getCollection } from "astro:content";
import type { APIRoute } from "astro";
import { buildQuizRhythms } from "../../lib/rhythmQuiz";
import { sampleMap } from "../../lib/sampleMap";

export const GET: APIRoute = async () => {
  const entries = await getCollection("rhythms");
  return new Response(JSON.stringify({ rhythms: buildQuizRhythms(entries), samples: sampleMap }), {
    headers: { "Content-Type": "application/json" },
  });
};
