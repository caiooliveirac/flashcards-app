import type { JSONContent } from "@tiptap/core";

/**
 * Helpers PUROS sobre o JSON do ProseMirror (sem instância de editor) —
 * validação client-side barata antes de chamar as actions.
 */

/** true se o doc tem algum conteúdo visível: texto não-branco ou imagem com assetId. */
export function docHasVisibleContent(doc: JSONContent): boolean {
  let found = false;
  const walk = (node: JSONContent): void => {
    if (found) return;
    if (node.type === "text" && typeof node.text === "string" && node.text.trim().length > 0) {
      found = true;
      return;
    }
    if (node.type === "image") {
      const assetId: unknown = node.attrs?.assetId;
      if (typeof assetId === "string" && assetId.length > 0) {
        found = true;
        return;
      }
    }
    for (const child of node.content ?? []) walk(child);
  };
  walk(doc);
  return found;
}

/** assetIds de imagens presentes no doc PM (únicos, ordem de aparição). */
export function collectAssetIdsFromDoc(doc: JSONContent): string[] {
  const ids: string[] = [];
  const walk = (node: JSONContent): void => {
    if (node.type === "image") {
      const assetId: unknown = node.attrs?.assetId;
      if (typeof assetId === "string" && assetId.length > 0 && !ids.includes(assetId)) {
        ids.push(assetId);
      }
    }
    for (const child of node.content ?? []) walk(child);
  };
  walk(doc);
  return ids;
}
