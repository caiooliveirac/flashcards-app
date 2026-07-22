import { auth } from "@/lib/auth";
import { isAiEnabled } from "@/lib/ai/config";
import { AssistantPanel } from "./assistant-panel";

/**
 * Ponto de montagem do assistente no layout raiz. Só renderiza para usuário
 * autenticado e quando há chave (isAiEnabled) — assim some da /login e não
 * quebra nada quando a IA está desligada (recurso facultativo, §9).
 */
export async function AssistantMount() {
  if (!isAiEnabled()) return null;
  const session = await auth();
  if (!session?.user?.id) return null;
  return <AssistantPanel />;
}
