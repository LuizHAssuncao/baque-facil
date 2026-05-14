export function extractRhythmBlock(markdown: string): string | null {
  const match = markdown.match(/```rhythm[^\n]*\n([\s\S]*?)```/i);
  return match?.[1]?.trim() ?? null;
}
