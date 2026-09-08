/** Notion の language 表示名を、属性値として安定した CSS class にする。 */
export function codeLanguageClass(language: string | null): string | undefined {
  if (!language?.trim()) return undefined;
  const normalized = language.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
  return normalized ? `language-${normalized}` : undefined;
}
