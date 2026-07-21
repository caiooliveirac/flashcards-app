import type { Editor } from "@tiptap/core";
import { mediaUrl } from "@/features/editor/upload-client";

/**
 * Utilitários sobre a instância do editor para o ciclo de vida das imagens:
 * preview local (objectURL) enquanto o asset processa, troca para a rota de
 * mídia quando 'ready', remoção quando 'failed'. O src NUNCA persiste no
 * NoteContent (o serializer ignora) — é só exibição.
 */

function findImagePos(editor: Editor, assetId: string): { pos: number; size: number } | null {
  let found: { pos: number; size: number } | null = null;
  editor.state.doc.descendants((node, pos) => {
    if (found) return false;
    if (node.type.name === "image" && node.attrs.assetId === assetId) {
      found = { pos, size: node.nodeSize };
      return false;
    }
    return true;
  });
  return found;
}

/** Atualiza attrs da imagem (por assetId) sem entrar no histórico de undo. */
export function updateImageAttrs(
  editor: Editor,
  assetId: string,
  attrs: Record<string, unknown>,
): boolean {
  const hit = findImagePos(editor, assetId);
  if (!hit) return false;
  const node = editor.state.doc.nodeAt(hit.pos);
  if (!node) return false;
  const tr = editor.state.tr
    .setNodeMarkup(hit.pos, undefined, { ...node.attrs, ...attrs })
    .setMeta("addToHistory", false);
  editor.view.dispatch(tr);
  return true;
}

/** Remove a imagem (por assetId) — usado quando a validação do worker falha. */
export function removeImageByAssetId(editor: Editor, assetId: string): boolean {
  const hit = findImagePos(editor, assetId);
  if (!hit) return false;
  const tr = editor.state.tr.delete(hit.pos, hit.pos + hit.size);
  editor.view.dispatch(tr);
  return true;
}

/**
 * Ao abrir uma nota existente, o JSON persistido só tem assetId — resolve o
 * src para a rota autenticada de mídia (sem entrar no histórico de undo).
 */
export function resolveImageSrcs(editor: Editor): void {
  const targets: Array<{ pos: number; attrs: Record<string, unknown> }> = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === "image") {
      const assetId: unknown = node.attrs.assetId;
      const src: unknown = node.attrs.src;
      if (typeof assetId === "string" && assetId.length > 0 && (typeof src !== "string" || src.length === 0)) {
        targets.push({ pos, attrs: { ...node.attrs, src: mediaUrl(assetId) } });
      }
    }
    return true;
  });
  if (targets.length === 0) return;
  let tr = editor.state.tr;
  for (const t of targets) {
    tr = tr.setNodeMarkup(t.pos, undefined, t.attrs);
  }
  editor.view.dispatch(tr.setMeta("addToHistory", false));
}
