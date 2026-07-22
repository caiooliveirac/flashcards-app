"use client";

import { useEffect } from "react";
import { startMotionSystem } from "./behaviors";

/**
 * Liga o Motion System uma única vez por documento (montado no root layout).
 *
 * Não renderiza nada: os comportamentos são descobertos por `data-ms-*` via
 * MutationObserver, então qualquer árvore — Server Component, portal ou
 * conteúdo carregado depois — participa sem precisar de provider.
 */
export function MotionRoot() {
  useEffect(() => startMotionSystem(), []);
  return null;
}
