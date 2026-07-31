// Intake intentionally contains no project-category examples, keyword routing,
// workflow templates, or fixed recommendations. Project-specific choices come
// from validated live project understanding after the short request is sent.
export function effectiveMissionQuery(query: string): string {
  const trimmed = query.trim();
  return trimmed.length >= 2 ? trimmed : "";
}
