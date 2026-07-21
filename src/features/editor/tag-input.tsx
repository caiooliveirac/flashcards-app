"use client";

import { useId, useState } from "react";

/**
 * Input de tags com chips: Enter adiciona, Backspace (input vazio) remove a
 * última, sugestões via datalist (funciona no mobile). Normalização espelha
 * o serviço de tags: trim + colapsa espaços, caixa preservada.
 */

function normalize(name: string): string {
  return name.replace(/\s+/g, " ").trim();
}

export interface TagInputProps {
  tags: string[];
  onChange: (tags: string[]) => void;
  suggestions: string[];
}

export function TagInput({ tags, onChange, suggestions }: TagInputProps) {
  const [draft, setDraft] = useState("");
  const listId = useId();
  const inputId = useId();

  function addDraft() {
    const name = normalize(draft);
    if (name.length === 0) return;
    if (!tags.includes(name)) onChange([...tags, name]);
    setDraft("");
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      addDraft();
      return;
    }
    if (e.key === "Backspace" && draft.length === 0 && tags.length > 0) {
      e.preventDefault();
      onChange(tags.slice(0, -1));
    }
  }

  return (
    <div>
      <label htmlFor={inputId} className="mb-1 block text-sm font-medium">
        Tags <span className="font-normal text-muted-foreground">(Enter adiciona)</span>
      </label>
      <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-border bg-background px-2 py-1.5 focus-within:outline-2 focus-within:outline-ring">
        {tags.map((tag) => (
          <span
            key={tag}
            className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-sm"
          >
            {tag}
            <button
              type="button"
              aria-label={`Remover tag ${tag}`}
              onClick={() => onChange(tags.filter((t) => t !== tag))}
              className="text-muted-foreground outline-offset-2 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
            >
              ×
            </button>
          </span>
        ))}
        <input
          id={inputId}
          list={listId}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          onBlur={addDraft}
          maxLength={120}
          autoComplete="off"
          placeholder={tags.length === 0 ? "ex.: anatomia" : ""}
          className="min-w-24 flex-1 bg-transparent py-0.5 text-sm outline-none"
        />
        <datalist id={listId}>
          {suggestions
            .filter((s) => !tags.includes(s))
            .map((s) => (
              <option key={s} value={s} />
            ))}
        </datalist>
      </div>
    </div>
  );
}
