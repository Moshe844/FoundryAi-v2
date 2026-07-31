const INTERNAL_TERMS = Object.freeze([
  "persistence",
  "authentication",
  "delegated",
  "application-owned",
  "session",
  "runtime",
  "topology",
  "provider strategy",
  "schema",
  "ORM",
  "framework",
  "middleware",
  "stateless",
] as const);

export function internalLanguageTerm(value: string): string | null {
  const normalized = value.toLocaleLowerCase();
  return (
    INTERNAL_TERMS.find((term) =>
      normalized.includes(term.toLocaleLowerCase()),
    ) ?? null
  );
}
