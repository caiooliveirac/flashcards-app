"use client";

import type { Editor, JSONContent } from "@tiptap/core";
import FileHandler from "@tiptap/extension-file-handler";
import { EditorContent, useEditor } from "@tiptap/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { docHasVisibleContent } from "@/features/editor/doc-utils";
import { EditorToolbar } from "@/features/editor/editor-toolbar";
import { nextGroupKeyWithHistory } from "@/features/editor/group-keys";
import {
  removeImageByAssetId,
  resolveImageSrcs,
  updateImageAttrs,
} from "@/features/editor/pm-utils";
import { TagInput } from "@/features/editor/tag-input";
import { ToastHost, useToasts } from "@/features/editor/toast";
import {
  mediaUrl,
  requestUpload,
  uploadAndProcess,
  validateImageFile,
} from "@/features/editor/upload-client";
import {
  createNoteAction,
  deleteNoteAction,
  updateNoteAction,
} from "@/features/notes/actions";
import { clozePreviewCards } from "@/lib/content/derive";
import type { BasicNoteContent } from "@/lib/content/schema";
import { collectGroupKeysFromDoc } from "@/lib/editor/cloze-node";
import { editorExtensions } from "@/lib/editor/extensions";
import type { NotePmDocs } from "@/lib/editor/parse";
import { pmDocsToNoteContent } from "@/lib/editor/serialize";
import { LiveCount } from "@/lib/motion/components";
import { emitMotion } from "@/lib/motion/events";
import { renderNoteContent } from "@/lib/render";

/**
 * Editor de criação/edição de notas (fluxos §13.1-2, aceites F2#1-F2#4).
 * 'use client' + immediatelyRender:false (App Router). Toolbar sticky bottom
 * com safe-area (mobile, pesquisa R10). Fluxo contínuo: Cmd/Ctrl+Enter salva
 * de qualquer campo → toast com Desfazer → limpa → foco de volta.
 *
 * Redesign "Editorial Cognition": layout editor 1fr + aside 340px (prévia +
 * tags), superfícies de escrita sem caixa (régua 2px no topo + kicker),
 * tabs como faixa segmentada com ativo em tinta invertida.
 */

type TabId = "basic" | "cloze" | "image";
type NoteKind = "basic" | "cloze";

interface EditNoteProps {
  noteId: string;
  noteType: NoteKind;
  initialDocs: NotePmDocs;
  initialTags: string[];
  /**
   * Keys históricas dos cards da nota (qualquer status, INCLUINDO 'removed')
   * — achado #9a: unidas às keys do doc ao gerar key nova, para nunca reciclar
   * key de card removed.
   */
  clozeGroupKeys: string[];
}

export interface NoteEditorScreenProps {
  deckId: string;
  deckName: string;
  maxBytes: number;
  tagSuggestions: string[];
  /** Presente = a tela renderiza a barra superior "← deck" + contador. */
  backHref?: string;
  /** Presente = modo edição (tabs escondidas, tipo imutável). */
  editNote?: EditNoteProps;
}

interface SelectedCloze {
  pos: number;
  groupKey: string;
  hint?: string;
}

type PreviewCard = ReturnType<typeof clozePreviewCards>[number];

const TABS: Array<{ id: TabId; label: string; shortLabel: string }> = [
  { id: "basic", label: "Pergunta e resposta", shortLabel: "P & R" },
  { id: "cloze", label: "Ocultar trecho", shortLabel: "Ocultar" },
  { id: "image", label: "A partir de um print", shortLabel: "Print" },
];

const KICKER = "text-[11px] uppercase tracking-[0.1em] font-semibold";

/**
 * Dispatcher de paste/drop por instância de editor (registrado em efeito —
 * o React Compiler proíbe refs lidos em closures criadas no render).
 */
const fileDropHandlers = new WeakMap<Editor, (files: File[], pos?: number) => void>();

function makeFileHandlerExtension() {
  return FileHandler.configure({
    onPaste: (editor, files, htmlContent) => {
      // Com HTML no clipboard o próprio PM cola o conteúdo — evita duplicar.
      if (htmlContent) return;
      fileDropHandlers.get(editor)?.(files);
    },
    onDrop: (editor, files, pos) => {
      fileDropHandlers.get(editor)?.(files, pos);
    },
  });
}

function plural(n: number, singular: string, pluralForm: string): string {
  return `${n} ${n === 1 ? singular : pluralForm}`;
}

/** Frente do card cloze com a lacuna como barra sobre --track (spec C.5). */
function GapText({ text }: { text: string }) {
  const parts = text.split("[...]");
  return (
    <>
      {parts.map((part, i) => (
        <Fragment key={i}>
          {i > 0 ? (
            <span
              role="img"
              aria-label="trecho oculto"
              className="mx-0.5 inline-block h-3 w-10 translate-y-0.5 bg-track"
            />
          ) : null}
          {part}
        </Fragment>
      ))}
    </>
  );
}

export function NoteEditorScreen({
  deckId,
  deckName,
  maxBytes,
  tagSuggestions,
  backHref,
  editNote,
}: NoteEditorScreenProps) {
  const router = useRouter();
  const isEdit = editNote !== undefined;
  const [tab, setTab] = useState<TabId>(editNote?.noteType === "cloze" ? "cloze" : "basic");
  const currentKind: NoteKind = isEdit
    ? editNote.noteType
    : tab === "cloze"
      ? "cloze"
      : "basic";

  const [tags, setTags] = useState<string[]>(editNote?.initialTags ?? []);
  const [saving, setSaving] = useState(false);
  const [sessionCards, setSessionCards] = useState(0);
  const [pendingUploads, setPendingUploads] = useState(0);
  const [lastGroupKey, setLastGroupKey] = useState<string | null>(null);
  // #9a: histórico de keys da nota (inclui cards 'removed') — imutável na
  // sessão; keys criadas aqui já aparecem no doc, então a união cobre tudo.
  const [historicalGroupKeys] = useState<readonly string[]>(
    () => editNote?.clozeGroupKeys ?? [],
  );
  const [selectedCloze, setSelectedCloze] = useState<SelectedCloze | null>(null);
  const [preview, setPreview] = useState<PreviewCard[]>([]);
  const [basicPreview, setBasicPreview] = useState<BasicNoteContent | null>(null);
  const [focusedField, setFocusedField] = useState<"front" | "back" | "text">("front");
  const { toasts, push, dismiss } = useToasts();

  // --- preview de cards cloze (debounce ~300ms) ---

  const previewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const schedulePreview = useCallback((editor: Editor) => {
    if (previewTimer.current) clearTimeout(previewTimer.current);
    previewTimer.current = setTimeout(() => {
      const content = pmDocsToNoteContent("cloze", { text: editor.getJSON() });
      setPreview(clozePreviewCards(content));
    }, 300);
  }, []);
  useEffect(() => {
    return () => {
      if (previewTimer.current) clearTimeout(previewTimer.current);
    };
  }, []);

  // --- editores (instâncias de extensão separadas por editor) ---

  const frontExtensions = useMemo(
    () => [
      ...editorExtensions({ mode: "basic", placeholder: "Frente — pergunta ou termo" }),
      makeFileHandlerExtension(),
    ],
    [],
  );
  const backExtensions = useMemo(
    () => [
      ...editorExtensions({ mode: "basic", placeholder: "Verso — resposta" }),
      makeFileHandlerExtension(),
    ],
    [],
  );
  const clozeExtensions = useMemo(
    () => [
      ...editorExtensions({
        mode: "cloze",
        placeholder: "Cole ou digite o texto; selecione um trecho e use “Ocultar trecho”",
      }),
      makeFileHandlerExtension(),
    ],
    [],
  );

  const frontEditor = useEditor({
    extensions: frontExtensions,
    immediatelyRender: false,
    content: editNote?.initialDocs.front,
    editorProps: {
      attributes: { "aria-label": "Frente do card", role: "textbox", "aria-multiline": "true" },
    },
    onCreate: ({ editor }) => resolveImageSrcs(editor),
    onFocus: () => setFocusedField("front"),
  });

  const backEditor = useEditor({
    extensions: backExtensions,
    immediatelyRender: false,
    content: editNote?.initialDocs.back,
    editorProps: {
      attributes: { "aria-label": "Verso do card", role: "textbox", "aria-multiline": "true" },
    },
    onCreate: ({ editor }) => resolveImageSrcs(editor),
    onFocus: () => setFocusedField("back"),
  });

  const clozeEditor = useEditor({
    extensions: clozeExtensions,
    immediatelyRender: false,
    content: editNote?.initialDocs.text,
    editorProps: {
      attributes: {
        "aria-label": "Texto da nota com ocultações",
        role: "textbox",
        "aria-multiline": "true",
      },
      handleClickOn: (_view, _pos, node, nodePos) => {
        if (node.type.name === "cloze") {
          const groupKey: unknown = node.attrs.groupKey;
          const hint: unknown = node.attrs.hint;
          setSelectedCloze({
            pos: nodePos,
            groupKey: typeof groupKey === "string" ? groupKey : "",
            hint: typeof hint === "string" && hint.length > 0 ? hint : undefined,
          });
        } else {
          setSelectedCloze(null);
        }
        return false;
      },
    },
    onCreate: ({ editor }) => {
      resolveImageSrcs(editor);
      schedulePreview(editor);
    },
    onUpdate: ({ editor }) => schedulePreview(editor),
    onFocus: () => setFocusedField("text"),
  });

  // --- prévia do card básico no aside (debounce ~300ms) ---

  const basicPreviewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleBasicPreview = useCallback(() => {
    if (basicPreviewTimer.current) clearTimeout(basicPreviewTimer.current);
    basicPreviewTimer.current = setTimeout(() => {
      if (!frontEditor || !backEditor) return;
      const frontJson = frontEditor.getJSON();
      const backJson = backEditor.getJSON();
      if (!docHasVisibleContent(frontJson) && !docHasVisibleContent(backJson)) {
        setBasicPreview(null);
        return;
      }
      try {
        setBasicPreview(pmDocsToNoteContent("basic", { front: frontJson, back: backJson }));
      } catch {
        setBasicPreview(null);
      }
    }, 300);
  }, [frontEditor, backEditor]);

  useEffect(() => {
    if (!frontEditor || !backEditor) return;
    const handler = () => scheduleBasicPreview();
    frontEditor.on("update", handler);
    backEditor.on("update", handler);
    // Estado inicial (modo edição já chega com conteúdo).
    scheduleBasicPreview();
    return () => {
      frontEditor.off("update", handler);
      backEditor.off("update", handler);
      if (basicPreviewTimer.current) clearTimeout(basicPreviewTimer.current);
    };
  }, [frontEditor, backEditor, scheduleBasicPreview]);

  // Foco inicial no campo principal (fluxo contínuo começa digitando).
  const didInitialFocus = useRef(false);
  useEffect(() => {
    if (didInitialFocus.current) return;
    const target = currentKind === "cloze" ? clozeEditor : frontEditor;
    if (target) {
      didInitialFocus.current = true;
      target.commands.focus("end");
    }
  }, [currentKind, clozeEditor, frontEditor]);

  function activeEditorForImages(): Editor | null {
    if (currentKind === "cloze") return clozeEditor;
    return focusedField === "back" ? backEditor : frontEditor;
  }

  async function handleFiles(editor: Editor, files: File[], pos?: number) {
    for (const file of files) {
      const validationError = validateImageFile(file, maxBytes);
      if (validationError) {
        push({ kind: "error", message: validationError });
        continue;
      }
      let assetId: string;
      let target: Awaited<ReturnType<typeof requestUpload>>["target"];
      try {
        ({ assetId, target } = await requestUpload(file));
      } catch (err) {
        push({
          kind: "error",
          message: err instanceof Error ? err.message : "falha ao iniciar o upload da imagem",
        });
        continue;
      }
      // Preview local imediato; o serializer persiste só o assetId.
      const objectUrl = URL.createObjectURL(file);
      const imageNode: JSONContent = { type: "image", attrs: { assetId, src: objectUrl } };
      if (pos !== undefined) {
        editor.chain().focus().insertContentAt(pos, imageNode).run();
      } else {
        editor.chain().focus().insertContent(imageNode).run();
      }
      setPendingUploads((n) => n + 1);
      void (async () => {
        try {
          const outcome = await uploadAndProcess(assetId, target, file);
          if (outcome === "ready") {
            updateImageAttrs(editor, assetId, { src: mediaUrl(assetId) });
            URL.revokeObjectURL(objectUrl);
          } else if (outcome === "failed") {
            removeImageByAssetId(editor, assetId);
            URL.revokeObjectURL(objectUrl);
            push({
              kind: "error",
              message: "a imagem foi rejeitada na validação — tente outro arquivo",
            });
          }
          // timeout: mantém o preview local; o asset pode ficar pronto depois.
        } catch (err) {
          removeImageByAssetId(editor, assetId);
          URL.revokeObjectURL(objectUrl);
          push({
            kind: "error",
            message: err instanceof Error ? err.message : "falha no upload da imagem",
          });
        } finally {
          setPendingUploads((n) => n - 1);
        }
      })();
    }
  }
  // Registra o dispatcher de paste/drop com a closure MAIS RECENTE de
  // handleFiles (roda após cada render; WeakMap não vaza editores destruídos).
  useEffect(() => {
    for (const ed of [frontEditor, backEditor, clozeEditor]) {
      if (ed) {
        fileDropHandlers.set(ed, (files, pos) => {
          void handleFiles(ed, files, pos);
        });
      }
    }
  });

  // --- cloze: ocultar seleção / painel da ocultação clicada ---

  function hideSelection(mode: "new" | "same") {
    const ed = clozeEditor;
    if (!ed) return;
    const keys = collectGroupKeysFromDoc(ed.getJSON());
    const key =
      mode === "same" && lastGroupKey
        ? lastGroupKey
        : nextGroupKeyWithHistory(historicalGroupKeys, keys);
    const ok = ed.chain().focus().setCloze({ groupKey: key }).run();
    if (!ok) {
      push({
        kind: "error",
        message:
          "selecione um trecho de texto (sem outra ocultação) dentro de um único bloco para ocultar",
      });
      return;
    }
    setLastGroupKey(key);
  }

  function clozeNodeAt(pos: number) {
    const ed = clozeEditor;
    if (!ed) return null;
    const node = ed.state.doc.nodeAt(pos);
    return node && node.type.name === "cloze" ? node : null;
  }

  function removeSelectedCloze() {
    if (!selectedCloze || !clozeEditor) return;
    if (clozeNodeAt(selectedCloze.pos)) {
      clozeEditor.chain().focus().setNodeSelection(selectedCloze.pos).unsetCloze().run();
    }
    setSelectedCloze(null);
  }

  function editSelectedClozeHint() {
    if (!selectedCloze || !clozeEditor) return;
    if (!clozeNodeAt(selectedCloze.pos)) {
      setSelectedCloze(null);
      return;
    }
    const next = window.prompt("Dica da ocultação (vazio remove a dica):", selectedCloze.hint ?? "");
    if (next === null) return;
    const value = next.trim();
    clozeEditor
      .chain()
      .focus()
      .setNodeSelection(selectedCloze.pos)
      .updateAttributes("cloze", { hint: value.length > 0 ? value : null })
      .run();
    setSelectedCloze({ ...selectedCloze, hint: value.length > 0 ? value : undefined });
  }

  // --- salvar (fluxo contínuo) ---

  async function undoCreate(noteId: string, cardCount: number) {
    const res = await deleteNoteAction({ noteId });
    if (res.ok) {
      setSessionCards((n) => Math.max(0, n - cardCount));
      push({ kind: "info", message: "criação desfeita" });
    } else {
      push({ kind: "error", message: res.error });
    }
  }

  /** `trailFrom`: origem do energy trail (o botão clicado), quando houver. */
  async function handleSave(trailFrom?: Element | null) {
    if (saving) return;
    // #12: salvar com upload em andamento persistiria um doc sem o assetId
    // final (ou referenciaria asset ainda 'pending') — bloqueia sem limpar nada.
    if (pendingUploads > 0) {
      push({ kind: "error", message: "aguarde o envio das imagens terminar" });
      return;
    }
    let content: unknown;
    if (currentKind === "basic") {
      if (!frontEditor || !backEditor) return;
      const frontJson = frontEditor.getJSON();
      if (!docHasVisibleContent(frontJson)) {
        push({ kind: "error", message: "escreva algo na frente do card" });
        frontEditor.commands.focus();
        return;
      }
      content = pmDocsToNoteContent("basic", {
        front: frontJson,
        back: backEditor.getJSON(),
      });
    } else {
      if (!clozeEditor) return;
      const textJson = clozeEditor.getJSON();
      if (!docHasVisibleContent(textJson)) {
        push({ kind: "error", message: "escreva o texto da nota" });
        clozeEditor.commands.focus();
        return;
      }
      if (collectGroupKeysFromDoc(textJson).length === 0) {
        push({
          kind: "error",
          message:
            "selecione um trecho e use “Ocultar trecho” para criar pelo menos uma ocultação",
        });
        clozeEditor.commands.focus();
        return;
      }
      content = pmDocsToNoteContent("cloze", { text: textJson });
    }

    setSaving(true);
    if (isEdit) {
      const res = await updateNoteAction({ noteId: editNote.noteId, content, tagNames: tags });
      if (!res.ok) {
        setSaving(false);
        push({ kind: "error", message: res.error });
        return;
      }
      const notice = `Nota atualizada — ${plural(res.cardCount, "card ativo", "cards ativos")}`;
      router.push(`/decks/${deckId}?notice=${encodeURIComponent(notice)}`);
      return;
    }

    const res = await createNoteAction({
      deckId,
      noteType: currentKind,
      content,
      tagNames: tags,
    });
    setSaving(false);
    if (!res.ok) {
      // Erro preserva o conteúdo digitado.
      push({ kind: "error", message: res.error });
      return;
    }
    const { noteId, cardCount } = res;
    // Energy trail: a nota viaja da prévia até o contador, que carimba (4g/2a).
    emitMotion("card:saved", {
      sourceEl: trailFrom ?? document.querySelector("[data-ms-trail-source]"),
      deckEl: document.querySelector("[data-ms-trail-target]"),
    });
    setSessionCards((n) => n + cardCount);
    push({
      kind: "success",
      message:
        currentKind === "basic" ? "Card criado" : `Nota criada — ${plural(cardCount, "card", "cards")}`,
      action: { label: "Desfazer", onClick: () => void undoCreate(noteId, cardCount) },
    });
    if (currentKind === "basic") {
      frontEditor?.commands.clearContent(true);
      backEditor?.commands.clearContent(true);
      frontEditor?.commands.focus();
      setFocusedField("front");
    } else {
      clozeEditor?.commands.clearContent(true);
      setPreview([]);
      setLastGroupKey(null);
      setSelectedCloze(null);
      clozeEditor?.commands.focus();
    }
  }

  // --- teclado global do formulário ---

  function switchTab(next: TabId) {
    if (isEdit) return;
    setTab(next);
    setSelectedCloze(null);
    // Foca o editor do painel recém-ativo após o paint.
    requestAnimationFrame(() => {
      if (next === "cloze") clozeEditor?.commands.focus();
      else frontEditor?.commands.focus();
    });
  }

  function onKeyDownCapture(e: React.KeyboardEvent<HTMLDivElement>) {
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key === "Enter") {
      e.preventDefault();
      void handleSave();
      return;
    }
    if (!isEdit && mod && !e.shiftKey && !e.altKey) {
      if (e.key === "1" || e.key === "2" || e.key === "3") {
        e.preventDefault();
        switchTab(e.key === "1" ? "basic" : e.key === "2" ? "cloze" : "image");
        return;
      }
    }
    if (mod && e.shiftKey && e.code === "KeyC" && currentKind === "cloze") {
      e.preventDefault();
      hideSelection("new");
    }
  }

  // --- tabs (a11y: role=tablist + setas) ---

  const tabRefs = useRef<Partial<Record<TabId, HTMLButtonElement | null>>>({});

  function onTabListKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const index = TABS.findIndex((t) => t.id === tab);
    const delta = e.key === "ArrowRight" ? 1 : -1;
    const next = TABS[(index + delta + TABS.length) % TABS.length];
    if (next) {
      setTab(next.id);
      tabRefs.current[next.id]?.focus();
    }
  }

  const showBasicPanel = currentKind === "basic";

  const renderOpts = { mediaUrl };

  const asidePreview =
    currentKind === "basic" ? (
      <section aria-label="Prévia do card">
        <h2 className={KICKER}>Prévia</h2>
        <div
          data-ms-tilt="5"
          data-ms-trail-source
          className="ms-matter ms-specular mt-2 border border-border bg-surface p-3 text-sm"
        >
          {basicPreview ? (
            renderNoteContent(basicPreview, renderOpts)
          ) : (
            <p className="text-muted-foreground">
              Escreva na frente para ver aqui a prévia do card.
            </p>
          )}
        </div>
      </section>
    ) : (
      <section aria-label="Prévia dos cards que serão criados">
        <h2 className={KICKER}>Prévia</h2>
        <div
          data-ms-tilt="5"
          data-ms-trail-source
          className="ms-matter ms-specular mt-2 border border-border bg-surface p-3 text-sm"
        >
          Este texto criará{" "}
          <span className="font-extrabold">{preview.length}</span>{" "}
          {preview.length === 1 ? "card" : "cards"}
        </div>
        {preview.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">
            Oculte um trecho para ver aqui os cards que serão criados.
          </p>
        ) : (
          <ol className="mt-2 space-y-2">
            {preview.map((card) => (
              <li key={card.groupKey} className="border border-border bg-surface p-3 text-sm">
                <p>
                  <GapText text={card.frontText} />
                </p>
                <p className="mt-1 text-muted-foreground">
                  Resposta:{" "}
                  <span className="font-semibold text-foreground">{card.answerText}</span>
                  {card.hint ? ` · Dica: ${card.hint}` : ""}
                </p>
              </li>
            ))}
          </ol>
        )}
      </section>
    );

  return (
    <div onKeyDownCapture={onKeyDownCapture} className="pb-4">
      {backHref ? (
        <div className="mb-5 flex items-baseline justify-between gap-3">
          <Link
            href={backHref}
            className="truncate text-sm font-semibold text-primary-text underline-offset-4 hover:underline"
          >
            ← {deckName}
          </Link>
          {!isEdit ? (
            <span className="shrink-0 text-sm text-muted-foreground">
              {plural(sessionCards, "card criado", "cards criados")}
            </span>
          ) : null}
        </div>
      ) : null}

      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_340px] lg:gap-8">
        <div className="min-w-0">
          {!isEdit ? (
            <div
              role="tablist"
              aria-label="Modo de criação"
              onKeyDown={onTabListKeyDown}
              className="flex border border-border"
            >
              {TABS.map((t) => (
                <button
                  key={t.id}
                  ref={(el) => {
                    tabRefs.current[t.id] = el;
                  }}
                  type="button"
                  role="tab"
                  id={`tab-${t.id}`}
                  aria-selected={tab === t.id}
                  aria-controls={t.id === "cloze" ? "panel-cloze" : "panel-basic"}
                  tabIndex={tab === t.id ? 0 : -1}
                  onClick={() => switchTab(t.id)}
                  className={`min-h-11 flex-1 border-l border-border px-2 first:border-l-0 ${KICKER} transition-colors duration-150 ease-out ${
                    tab === t.id
                      ? "bg-foreground text-background"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <span className="sm:hidden">{t.shortLabel}</span>
                  <span className="hidden sm:inline">{t.label}</span>
                </button>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Tipo da nota:{" "}
              <span className="font-semibold text-foreground">
                {currentKind === "basic" ? "Pergunta e resposta" : "Ocultar trecho (cloze)"}
              </span>{" "}
              — o tipo não muda na edição.
            </p>
          )}

          {showBasicPanel ? (
            <div
              role={isEdit ? undefined : "tabpanel"}
              id="panel-basic"
              aria-labelledby={isEdit ? undefined : `tab-${tab}`}
              className="mt-6 space-y-6"
            >
              {tab === "image" && !isEdit ? (
                <div
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    const files = Array.from(e.dataTransfer.files);
                    if (files.length > 0) {
                      const ed = activeEditorForImages();
                      if (ed) void handleFiles(ed, files);
                    }
                  }}
                  className="border-2 border-divider p-4 text-sm"
                >
                  {pendingUploads > 0 ? (
                    <p role="status" className="font-semibold">
                      Enviando e validando {plural(pendingUploads, "imagem", "imagens")}…
                    </p>
                  ) : (
                    <>
                      <p className="font-semibold">
                        Cole um print (Cmd/Ctrl+V) na frente ou no verso
                      </p>
                      <p className="mt-1 text-muted-foreground">
                        … ou arraste o arquivo até aqui, ou{" "}
                        <label className="cursor-pointer font-semibold text-primary-text underline underline-offset-4">
                          escolha um arquivo
                          <input
                            type="file"
                            accept="image/*"
                            className="sr-only"
                            onChange={(e) => {
                              const files = Array.from(e.target.files ?? []);
                              e.target.value = "";
                              if (files.length > 0) {
                                const ed = activeEditorForImages();
                                if (ed) void handleFiles(ed, files);
                              }
                            }}
                          />
                        </label>
                        .
                      </p>
                    </>
                  )}
                </div>
              ) : null}
              <div className="border-t-2 border-divider pt-2">
                <span className={`block ${KICKER}`} id="label-front">
                  Frente
                </span>
                <div
                  onKeyDownCapture={(e) => {
                    // Tab avança Frente → Verso (aceite F2#1); Shift+Tab segue o fluxo nativo.
                    if (e.key === "Tab" && !e.shiftKey) {
                      e.preventDefault();
                      backEditor?.commands.focus();
                    }
                  }}
                >
                  <EditorContent editor={frontEditor} aria-labelledby="label-front" />
                </div>
              </div>
              <div className="border-t-2 border-divider pt-2">
                <span className={`block ${KICKER}`} id="label-back">
                  Verso
                </span>
                <div
                  onKeyDownCapture={(e) => {
                    if (e.key === "Tab" && e.shiftKey) {
                      e.preventDefault();
                      frontEditor?.commands.focus();
                    }
                  }}
                >
                  <EditorContent editor={backEditor} aria-labelledby="label-back" />
                </div>
              </div>
            </div>
          ) : (
            <div
              role={isEdit ? undefined : "tabpanel"}
              id="panel-cloze"
              aria-labelledby={isEdit ? undefined : "tab-cloze"}
              className="mt-6 space-y-6"
            >
              <div className="border-t-2 border-divider pt-2">
                <span className={`block ${KICKER}`} id="label-cloze">
                  Selecione o que quer lembrar
                </span>
                <p className="mt-1 text-sm text-muted-foreground">
                  Cole ou escreva o texto — depois selecione o que quer lembrar.
                </p>
                <EditorContent editor={clozeEditor} aria-labelledby="label-cloze" />
              </div>

              {selectedCloze ? (
                <div
                  role="group"
                  aria-label={`Ocultação ${selectedCloze.groupKey} selecionada`}
                  className="flex flex-wrap items-center gap-2 border border-border bg-surface px-3 py-2 text-sm"
                >
                  <span>
                    Ocultação <span className="font-mono">{selectedCloze.groupKey}</span>
                    {selectedCloze.hint ? ` — dica: ${selectedCloze.hint}` : ""}
                  </span>
                  <button
                    type="button"
                    onClick={removeSelectedCloze}
                    data-ms-ripple="danger"
                    className="min-h-11 border border-border bg-background px-3 transition-colors duration-150 ease-out hover:bg-surface"
                  >
                    Remover ocultação
                  </button>
                  <button
                    type="button"
                    onClick={editSelectedClozeHint}
                    data-ms-ripple="ink"
                    className="min-h-11 border border-border bg-background px-3 transition-colors duration-150 ease-out hover:bg-surface"
                  >
                    {selectedCloze.hint ? "Trocar dica" : "Adicionar dica"}
                  </button>
                  <button
                    type="button"
                    aria-label="Fechar painel da ocultação"
                    onClick={() => setSelectedCloze(null)}
                    data-ms-ripple="ink"
                    className="ml-auto min-h-11 min-w-11 text-muted-foreground transition-colors duration-150 ease-out hover:text-foreground"
                  >
                    ×
                  </button>
                </div>
              ) : null}
            </div>
          )}
        </div>

        {/* Aside: prévia + tags (desktop 340px com régua à esquerda; mobile abaixo). */}
        <aside className="mt-10 lg:mt-0 lg:border-l lg:border-border lg:pl-8">
          {asidePreview}

          <div className="mt-8">
            <TagInput tags={tags} onChange={setTags} suggestions={tagSuggestions} />
          </div>

          <a
            href="/assistente"
            className="mt-8 block text-sm text-muted-foreground underline-offset-4 hover:text-primary-text hover:underline"
            title="Assistente de criação de cards com IA"
          >
            ✳ Deixe o assistente sugerir cards a partir do seu texto.
          </a>
        </aside>
      </div>

      {/* Toolbar + salvar: sticky bottom (teclado virtual mobile, R10/#6571). */}
      <div
        className="sticky bottom-0 z-40 mt-8 -mx-5 border-t-2 border-divider bg-background px-5 pt-3"
        style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
      >
        <EditorToolbar
          editor={currentKind === "cloze" ? clozeEditor : focusedField === "back" ? backEditor : frontEditor}
          cloze={
            currentKind === "cloze"
              ? {
                  onHideNew: () => hideSelection("new"),
                  onHideSame: () => hideSelection("same"),
                  sameEnabled: lastGroupKey !== null,
                }
              : undefined
          }
          onFiles={(files) => {
            const ed = activeEditorForImages();
            if (ed) void handleFiles(ed, files);
          }}
        />
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={(e) => void handleSave(e.currentTarget)}
            disabled={saving}
            data-ms-magnetic
            data-ms-ripple="create"
            className={`min-h-12 w-full px-6 text-sm font-semibold transition-colors duration-150 ease-out disabled:opacity-60 sm:w-auto ${
              isEdit
                ? "bg-primary text-primary-foreground hover:bg-primary-hover"
                : "border border-border bg-background hover:bg-surface"
            }`}
          >
            {saving ? "Salvando…" : isEdit ? "Salvar alterações" : "Salvar e continuar"}
          </button>
          <kbd className="hidden text-xs text-muted-foreground sm:inline">Cmd/Ctrl+Enter</kbd>
          <span className="ml-auto flex items-center gap-3 text-sm text-muted-foreground">
            {pendingUploads > 0 ? (
              <span role="status">enviando {plural(pendingUploads, "imagem", "imagens")}…</span>
            ) : null}
            {!isEdit ? (
              <span aria-live="polite">
                {sessionCards > 0 ? (
                  <span data-ms-trail-target>
                    <LiveCount value={sessionCards} variant="stamp" />{" "}
                    {sessionCards === 1 ? "card criado" : "cards criados"} em {deckName}
                  </span>
                ) : (
                  `criando em ${deckName}`
                )}
              </span>
            ) : null}
          </span>
        </div>
      </div>

      <ToastHost toasts={toasts} dismiss={dismiss} />
    </div>
  );
}
