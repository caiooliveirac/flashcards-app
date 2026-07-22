"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Tipografia cinética (handoff §3 · 4e, §7).
 *
 * As letras (ou palavras) assentam em cascata. O texto real fica num
 * `aria-label` e os pedaços vão `aria-hidden`, então leitor de tela e busca da
 * página continuam vendo uma string só — a animação não fragmenta o conteúdo.
 */
export function KineticText({
  text,
  by = "letter",
  as: Tag = "span",
  className = "",
  delayStart = 0,
}: {
  text: string;
  by?: "letter" | "word";
  as?: "span" | "h1" | "h2" | "h3" | "p";
  className?: string;
  /** Índice inicial da cascata, para encadear com um bloco anterior. */
  delayStart?: number;
}) {
  const pieces = by === "letter" ? [...text] : text.split(/(\s+)/);
  return (
    <Tag
      aria-label={text}
      className={`ms-kinetic ${by === "word" ? "ms-kinetic-words" : ""} ${className}`}
    >
      {pieces.map((piece, i) => (
        <span
          key={`${i}-${piece}`}
          aria-hidden="true"
          style={{ "--ms-i": i + delayStart } as React.CSSProperties}
        >
          {piece}
        </span>
      ))}
    </Tag>
  );
}

/**
 * Contagem viva (handoff §7 · 2a) — números NUNCA trocam secos.
 *
 * Cada mudança de valor remonta o dígito com `ms-flip`. O `key` é o próprio
 * valor: é o React que reinicia a animação, sem timer nem classe manual.
 */
export function LiveCount({
  value,
  className = "",
  variant = "flip",
}: {
  value: number;
  className?: string;
  variant?: "flip" | "stamp";
}) {
  const first = useRef(true);
  const [animate, setAnimate] = useState(false);

  useEffect(() => {
    // O primeiro render é o estado inicial da página, não uma mudança.
    if (first.current) {
      first.current = false;
      return;
    }
    setAnimate(true);
  }, [value]);

  return (
    <span className={`inline-block tabular-nums ${className}`}>
      <span
        key={value}
        className={animate ? (variant === "stamp" ? "ms-stamp" : "ms-flip") : undefined}
        style={{ display: "inline-block" }}
      >
        {value}
      </span>
    </span>
  );
}
