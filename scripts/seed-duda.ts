/**
 * Seed de produção: usuária 'duda' (senha 1234, role user) com 8 baralhos
 * clínicos populados com notas basic e cloze (conteúdo variado: listas,
 * callouts, fórmulas). Idempotente por nome de deck: baralho que já existe
 * (não deletado) é pulado inteiro.
 *
 * Uso (no servidor, dentro de /home/ubuntu/flashcards-app):
 *   pnpm exec tsx --env-file=.env scripts/seed-duda.ts
 */
import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "@/db/runtime";
import { decks, users } from "@/db/schema";
import { createDeck } from "@/features/decks/service";
import { createNote } from "@/features/notes/service";
import { bootstrapNewUser } from "@/lib/auth/bootstrap";
import { hashPassword } from "@/lib/auth/password";

// --- helpers de construção do NoteContentV1 ---

type Marks = Array<"bold" | "italic" | "highlight" | "code">;
const t = (text: string, marks?: Marks) => ({
  type: "text" as const,
  text,
  ...(marks && marks.length > 0 ? { marks } : {}),
});
const math = (latex: string) => ({ type: "math" as const, latex });
const cz = (groupKey: string, text: string, hint?: string) => ({
  type: "cloze" as const,
  groupKey,
  ...(hint ? { hint } : {}),
  content: [t(text)],
});
const p = (...content: unknown[]) => ({ type: "paragraph" as const, content });
const h = (level: 1 | 2 | 3, text: string) => ({
  type: "heading" as const,
  level,
  content: [t(text)],
});
const li = (...content: unknown[]) => ({ blocks: [p(...content)] });
const ul = (...items: unknown[]) => ({ type: "list" as const, ordered: false, items });
const ol = (...items: unknown[]) => ({ type: "list" as const, ordered: true, items });
const callout = (
  variant: "info" | "warning" | "success" | "danger",
  ...content: unknown[]
) => ({ type: "callout" as const, variant, content });
const formula = (latex: string) => ({ type: "formula" as const, latex });

interface SeedNote {
  noteType: "basic" | "cloze";
  content: unknown;
  tags: string[];
}
const basic = (front: unknown[], back: unknown[], tags: string[]): SeedNote => ({
  noteType: "basic",
  content: { schemaVersion: 1, kind: "basic", front, back },
  tags,
});
const cloze = (text: unknown[], tags: string[]): SeedNote => ({
  noteType: "cloze",
  content: { schemaVersion: 1, kind: "cloze", text },
  tags,
});

// --- helpers do "verso decisório" (padrão vinheta → conduta) ---
const resp = (...content: unknown[]) => p(t("Resposta: ", ["bold"]), ...content);
const gatilho = (...content: unknown[]) =>
  callout("info", p(t("Gatilho: ", ["bold"]), ...content));
const pegadinha = (...content: unknown[]) =>
  callout("danger", p(t("Pegadinha: ", ["bold"]), ...content));
const excecao = (...content: unknown[]) =>
  callout("warning", p(t("Exceção: ", ["bold"]), ...content));

// --- conteúdo dos 8 temas ---

const DECKS: Array<{ name: string; description: string; notes: SeedNote[] }> = [
  {
    name: "Sepse e Choque",
    description: "Reconhecimento de hipoperfusão, ressuscitação guiada, vasopressores e diferencial de choque.",
    notes: [
      basic(
        [p(t("Defina "), t("sepse", ["bold"]), t(" e "), t("choque séptico", ["bold"]), t(" (Sepsis-3) — e o que os separa."))],
        [
          resp(t("Sepse = disfunção orgânica (↑ SOFA ≥ 2) por resposta desregulada à infecção. Choque séptico = sepse + vasopressor para PAM ≥ 65 E lactato > 2 mmol/L apesar de volume adequado.")),
          gatilho(t("O divisor é a "), t("vaso-dependência + lactato elevado", ["bold"]), t(" após ressuscitação — mortalidade ~40%.")),
        ],
        ["sepse", "definição"],
      ),
      basic(
        [p(t("Idoso com pneumonia, "), t("PA 118 × 70", ["bold"]), t(", mas confuso, oligúrico, extremidades frias e lactato 4,5. A PA “normal” afasta choque?"))],
        [
          resp(t("Não. Há "), t("hipoperfusão tecidual", ["bold"]), t(" — conduzir como choque séptico incipiente: ressuscitação, ATB precoce e reavaliação da perfusão.")),
          gatilho(t("Lactato alto, oligúria, enchimento capilar lento e confusão marcam hipoperfusão "), t("antes", ["bold"]), t(" da hipotensão franca.")),
          pegadinha(t("PA “normal” em hipertenso crônico pode ser hipotensão relativa — não espere a PAS despencar para agir.")),
        ],
        ["sepse", "choque", "reconhecimento"],
      ),
      basic(
        [p(t("À beira-leito, quando o "), t("qSOFA", ["bold"]), t(" sinaliza risco — e por que não serve como rastreio isolado?"))],
        [
          resp(t("≥ 2 dos 3 (FR ≥ 22, PAS ≤ 100, alteração do sensório) → maior mortalidade; aprofundar investigação (lactato, SOFA).")),
          pegadinha(t("Baixa sensibilidade: qSOFA "), t("negativo NÃO exclui sepse", ["bold"]), t(" — não usar isoladamente para rastrear (SSC 2021).")),
        ],
        ["sepse", "qSOFA"],
      ),
      cloze(
        [
          h(3, "Pacote da 1ª hora (Surviving Sepsis)"),
          ol(
            li(t("Dosar "), cz("g1", "lactato")),
            li(t("Coletar "), cz("g2", "hemoculturas antes do antibiótico")),
            li(t("Iniciar "), cz("g3", "antibiótico de amplo espectro")),
            li(t("Cristaloide "), cz("g4", "30 mL/kg"), t(" se hipotensão ou lactato ≥ 4 (depois, guiar por medidas dinâmicas)")),
            li(t("Vasopressor se PAM < 65 no/após o volume: "), cz("g5", "noradrenalina")),
          ),
        ],
        ["sepse", "bundle"],
      ),
      basic(
        [p(t("Choque séptico com foco indefinido. A equipe quer aguardar a TC para só então iniciar o antibiótico. Conduta?"))],
        [
          resp(t("Antibiótico de amplo espectro "), t("imediato", ["bold"]), t(" (idealmente na 1ª hora do choque), logo após as hemoculturas — sem esperar a imagem.")),
          gatilho(t("Cada hora de atraso do ATB no choque séptico aumenta a mortalidade.")),
          excecao(t("Sepse SEM choque e diagnóstico incerto: aceita-se investigação rápida e início em até 3 h.")),
        ],
        ["sepse", "antibiótico", "tempo"],
      ),
      basic(
        [p(t("Após os "), t("30 mL/kg", ["bold"]), t(" iniciais de cristaloide, como decidir se administro MAIS volume?"))],
        [
          resp(t("Guiar por "), t("responsividade a fluidos", ["bold"]), t(": só expandir se houver resposta em medida dinâmica; caso contrário, iniciar/otimizar vasopressor.")),
          gatilho(t("Elevação passiva das pernas, variação de pressão de pulso/volume sistólico, colapsabilidade da VCI — "), t("dinâmicas", ["bold"]), t(", não PVC estática.")),
          pegadinha(t("Repetir bolus fixos “porque a PA está baixa” gera congestão e piora o desfecho.")),
        ],
        ["sepse", "fluido", "responsividade"],
      ),
      basic(
        [p(t("Séptico já com 30 mL/kg, agora com estertores, turgência jugular e hipoxemia, mas ainda hipotenso. Mais volume?"))],
        [
          resp(t("Não — "), t("parar a expansão", ["bold"]), t(" e escalar vasopressor (± inotrópico se disfunção de VE).")),
          gatilho(t("Congestão + ausência de resposta dinâmica = "), t("teto de fluido atingido", ["bold"]), t("; não há mais reserva de pré-carga.")),
        ],
        ["sepse", "fluido", "congestão"],
      ),
      basic(
        [p(t("Pneumonia, extremidades frias, confusão e "), t("PA 72 × 40", ["bold"]), t(". Após expansão inicial segue muito hipotenso; a equipe quer completar todo o volume previsto antes do vasopressor. Próxima medida?"))],
        [
          resp(t("Iniciar "), t("noradrenalina já", ["bold"]), t(" (pode ser em acesso periférico calibroso) para PAM ≥ 65, junto com a reposição — não adiar o vasopressor.")),
          gatilho(t("Hipotensão profunda com hipoperfusão não tolera esperar “terminar o volume”: vasopressor precoce encurta o tempo de hipoperfusão.")),
          pegadinha(t("“Só posso iniciar vasopressor após todo o cristaloide” é falso — o atraso perpetua o choque.")),
        ],
        ["sepse", "vasopressor", "noradrenalina"],
      ),
      basic(
        [p(t("Choque séptico com noradrenalina crescente ("), t("~0,3–0,5 µg/kg/min", ["bold"]), t(") sem atingir PAM 65. Próximo passo farmacológico?"))],
        [
          resp(t("Associar "), t("vasopressina 0,03 U/min", ["bold"]), t(" — em vez de escalar a noradrenalina indefinidamente.")),
          gatilho(t("SSC: adicionar vasopressina quando a NA chega a "), t("0,25–0,5 µg/kg/min", ["bold"]), t("; poupa catecolamina.")),
          excecao(t("Ainda refratário: acrescentar adrenalina e reavaliar corticoide e controle de foco.")),
        ],
        ["sepse", "vasopressor", "vasopressina"],
      ),
      basic(
        [p(t("PAM 70 em vasopressor e volemia adequada, mas mantém lactato alto, oligúria e "), t("disfunção de VE ao eco", ["bold"]), t(". Conduta?"))],
        [
          resp(t("Adicionar "), t("inotrópico (dobutamina)", ["bold"]), t(" — cardiomiopatia séptica com baixo débito apesar de PAM adequada.")),
          gatilho(t("PAM recuperada + hipoperfusão persistente + disfunção contrátil = problema de "), t("débito", ["bold"]), t(", não de tônus vascular.")),
        ],
        ["sepse", "inotrópico", "cardiomiopatia"],
      ),
      basic(
        [p(t("Quando associar "), t("hidrocortisona", ["bold"]), t(" no choque séptico?"))],
        [
          resp(t("Choque com "), t("necessidade persistente de vasopressor", ["bold"]), t(": hidrocortisona 200 mg/dia IV (50 mg 6/6 h ou infusão).")),
          gatilho(t("Gatilho = vaso-dependência mantida apesar de volume e vasopressor; não é rotina em todo séptico.")),
          excecao(t("Desmamar ao retirar o vasopressor.")),
        ],
        ["sepse", "corticoide"],
      ),
      basic(
        [p(t("Séptico com lactato 5. A alternativa propõe expandir volume repetidamente até o lactato cair. Está correta?"))],
        [
          resp(t("Não automaticamente. O lactato alto reflete hipoperfusão E outros fatores (clearance hepático, β-agonista) — corrigir a perfusão, não “encher” o paciente.")),
          pegadinha(t("Tratar lactato elevado como sinônimo de déficit volêmico leva à sobrecarga hídrica.")),
          gatilho(t("Reavaliar perfusão (enchimento capilar, diurese), não só o número isolado.")),
        ],
        ["sepse", "lactato", "perfusão"],
      ),
      basic(
        [p(t("Qual cristaloide preferir na ressuscitação da sepse — e por quê?"))],
        [
          resp(t("Cristaloide "), t("balanceado", ["bold"]), t(" (Ringer lactato/Plasma-Lyte), evitando grandes volumes de SF 0,9%.")),
          gatilho(t("Excesso de salina → "), t("acidose metabólica hiperclorêmica", ["bold"]), t(" e possível piora renal.")),
        ],
        ["sepse", "fluido", "cristaloide"],
      ),
      basic(
        [p(t("Perfil hemodinâmico dos 4 tipos de choque (DC, RVS, POAP)?"))],
        [
          ol(
            li(t("Hipovolêmico: ", ["bold"]), t("DC ↓, RVS ↑, POAP ↓")),
            li(t("Cardiogênico: ", ["bold"]), t("DC ↓, RVS ↑, POAP ↑")),
            li(t("Distributivo (séptico): ", ["bold"]), t("DC ↑/normal, RVS ↓, POAP ↓/normal")),
            li(t("Obstrutivo: ", ["bold"]), t("DC ↓, RVS ↑, enchimento variável conforme a causa")),
          ),
          gatilho(t("POAP separa cardiogênico (↑) de hipovolêmico/distributivo (↓); RVS separa distributivo (↓) dos demais.")),
        ],
        ["choque", "hemodinâmica"],
      ),
      basic(
        [p(t("Séptico intubado fica subitamente com "), t("PA 60 × 30", ["bold"]), t(". Antes de assumir “piora da sepse”, o que descartar?"))],
        [
          resp(t("Causas mecânicas/obstrutivas: "), t("auto-PEEP (hiperinsuflação), pneumotórax hipertensivo e efeito da sedação/VPP", ["bold"]), t(" — desconectar do ventilador e examinar o tórax.")),
          gatilho(t("Hipotensão logo após intubação/VPP raramente é só sepse: a pressão intratorácica reduz a pré-carga.")),
          pegadinha(t("Atribuir toda hipotensão à sepse faz perder TEP, tamponamento, pneumotórax e hemorragia.")),
        ],
        ["sepse", "choque", "diferencial"],
      ),
      basic(
        [p(t("Choque séptico por "), t("colangite, abscesso ou cateter infectado", ["bold"]), t(". Além de ATB e ressuscitação, o que não pode faltar?"))],
        [
          resp(t("Controle do foco", ["bold"]), t(": drenagem do abscesso/via biliar, retirada do cateter — o mais precoce possível.")),
          gatilho(t("Antibiótico não resolve foco não drenado; a fonte controlável deve ser abordada nas primeiras horas.")),
        ],
        ["sepse", "controle-foco"],
      ),
      basic(
        [p(t("Qual o alvo de "), t("PAM", ["bold"]), t(" na ressuscitação do choque séptico — e quando individualizar para cima?"))],
        [
          resp(t("PAM ≥ 65 mmHg", ["bold"]), t(" para a maioria.")),
          excecao(t("HAS crônica: alvo mais alto (80–85) pode reduzir diálise, mas custa mais arritmia — individualizar, não é rotina.")),
          pegadinha(t("Perseguir PAM alta em todos aumenta a dose de vasopressor sem ganho de sobrevida.")),
        ],
        ["sepse", "PAM"],
      ),
      basic(
        [p(t("Choque séptico precisa de noradrenalina, mas ainda não há acesso central. Espero o cateter?"))],
        [
          resp(t("Não. Iniciar em "), t("veia periférica calibrosa", ["bold"]), t(" (proximal, por tempo limitado) enquanto se obtém o acesso central.")),
          pegadinha(t("Adiar o vasopressor “até passar o cateter central” prolonga a hipoperfusão.")),
        ],
        ["sepse", "vasopressor", "acesso"],
      ),
      basic(
        [p(t("Além do lactato, que parâmetro simples à beira-leito pode guiar a ressuscitação do choque séptico?"))],
        [
          resp(t("Tempo de enchimento capilar", ["bold"]), t(" (normal ≤ 3 s) — guiar por ele é ao menos tão bom quanto pelo lactato (ANDROMEDA-SHOCK).")),
          gatilho(t("Perfusão periférica normalizando = ressuscitação no rumo certo, mesmo com lactato ainda em queda lenta.")),
        ],
        ["sepse", "perfusão"],
      ),
      basic(
        [p(t("Hipotenso com extremidades frias, turgência jugular, B3 e estertores. Parece choque séptico — devo expandir volume?"))],
        [
          resp(t("Não — o quadro sugere "), t("choque cardiogênico", ["bold"]), t(" (congestão + baixo débito): inotrópico/vasopressor, não expansão.")),
          gatilho(t("Séptico costuma ter extremidades quentes e jugular plana (vasodilatado); frio + congesto = cardiogênico.")),
          pegadinha(t("Turgência jugular e B3 apontam bomba, não hipovolemia — volume aqui piora o edema.")),
        ],
        ["sepse", "choque", "diferencial"],
      ),
      basic(
        [p(t("Choque séptico: a punção para hemoculturas está difícil e demorada. Conduta?"))],
        [
          resp(t("Não atrasar o antibiótico", ["bold"]), t(" — coletar hemoculturas idealmente antes, mas a dificuldade de coleta não adia a 1ª dose no choque.")),
          gatilho(t("O tempo até o ATB pesa mais no desfecho do que a coleta perfeita da cultura.")),
        ],
        ["sepse", "antibiótico", "hemocultura"],
      ),
    ],
  },
  {
    name: "Diabetes",
    description: "CAD/EHH orientadas por decisão, potássio, resolução, hipoglicemia e farmacologia.",
    notes: [
      basic(
        [p(t("Critérios diagnósticos de "), t("diabetes mellitus", ["bold"]), t("?"))],
        [
          ul(
            li(t("Glicemia de jejum ≥ "), t("126 mg/dL", ["bold"])),
            li(t("TOTG 75 g (2 h) ≥ "), t("200 mg/dL", ["bold"])),
            li(t("HbA1c ≥ "), t("6,5%", ["bold"])),
            li(t("Glicemia casual ≥ "), t("200 mg/dL", ["bold"]), t(" + sintomas clássicos")),
          ),
          excecao(t("Assintomático: confirmar com dois testes alterados (o mesmo repetido ou dois diferentes).")),
        ],
        ["diabetes", "diagnóstico"],
      ),
      basic(
        [p(t("Como se firma o diagnóstico de "), t("cetoacidose diabética", ["bold"]), t(" (consenso 2024)?"))],
        [
          resp(t("Glicemia ≥ 200 (ou DM conhecido) + cetose (β-hidroxibutirato ≥ 3 mmol/L) + acidose (pH < 7,3 ou HCO₃⁻ < 18)", ["bold"]), t(".")),
          gatilho(t("O "), t("β-hidroxibutirato", ["bold"]), t(" é o marcador central de diagnóstico e resolução; o consenso 2024 retirou o ânion gap dos critérios.")),
          pegadinha(t("A cetonúria (fita) mede acetoacetato e pode subestimar a cetose — prefira o β-OHB sérico.")),
        ],
        ["diabetes", "CAD", "diagnóstico"],
      ),
      basic(
        [p(t("Usuário de "), t("iSGLT2", ["bold"]), t(" com náusea, Kussmaul e acidose, mas glicemia "), t("180 mg/dL", ["bold"]), t(". Pode ser CAD?"))],
        [
          resp(t("Sim — "), t("cetoacidose euglicêmica", ["bold"]), t(". Tratar como CAD: insulina + glicose simultâneas, volume e potássio.")),
          gatilho(t("O que define CAD é "), t("acidose + cetose", ["bold"]), t(", não a glicemia; iSGLT2, gestação e jejum cursam com glicemia normal.")),
          pegadinha(t("Excluir CAD “porque a glicemia não está alta” é erro clássico — e perigoso no usuário de iSGLT2.")),
        ],
        ["diabetes", "CAD", "euglicêmica"],
      ),
      basic(
        [p(t("O que diferencia "), t("EHH", ["bold"]), t(" de "), t("CAD", ["bold"]), t(" — e por que muda o manejo?"))],
        [
          ul(
            li(t("EHH: ", ["bold"]), t("glicemia > 600, osmolaridade efetiva > 320, pH > 7,3, sem cetose importante; idoso, desidratação extrema, rebaixamento")),
            li(t("CAD: ", ["bold"]), t("acidose + cetose; glicemia costuma ser menor")),
          ),
          gatilho(t("EHH tem "), t("maior déficit de água livre", ["bold"]), t(" e osmolaridade — correção mais lenta, foco em volume.")),
        ],
        ["diabetes", "CAD", "EHH"],
      ),
      basic(
        [p(t("CAD recém-admitida: volume, potássio e insulina. Qual a "), t("ordem", ["bold"]), t(" e o cuidado inicial?"))],
        [
          resp(t("1) "), t("Volume", ["bold"]), t(" (SF 15–20 mL/kg na 1ª h); 2) checar "), t("potássio", ["bold"]), t(" antes da insulina; 3) "), t("insulina", ["bold"]), t(" 0,1 U/kg/h.")),
          gatilho(t("A insulina desloca K⁺ para dentro da célula — dosar o K antes de iniciá-la.")),
        ],
        ["diabetes", "CAD", "prioridade"],
      ),
      basic(
        [p(t("CAD com "), t("K⁺ 3,0 mEq/L", ["bold"]), t(". A prescrição inclui insulina imediata. Qual o erro e a conduta?"))],
        [
          resp(t("Adiar a insulina", ["bold"]), t(" e repor potássio primeiro; só iniciar insulina com K⁺ > 3,3.")),
          gatilho(t("Insulina + correção da acidose baixam ainda mais o K⁺ → "), t("arritmia/parada", ["bold"]), t(".")),
          pegadinha(t("K⁺ sérico “normal” na CAD já indica "), t("depleção corporal grave", ["bold"]), t(" — repor se < 5,2; segurar insulina se < 3,3.")),
        ],
        ["diabetes", "CAD", "potássio"],
      ),
      basic(
        [p(t("Na CAD, a glicemia caiu para "), t("200 mg/dL", ["bold"]), t(" mas persiste cetose/acidose. Suspendo a insulina?"))],
        [
          resp(t("Não. Adicionar "), t("soro glicosado", ["bold"]), t(" e "), t("manter a insulina", ["bold"]), t(" até resolver a cetoacidose.")),
          pegadinha(t("Suspender insulina só porque a glicemia normalizou "), t("mantém a cetogênese", ["bold"]), t(" e perpetua a acidose.")),
          gatilho(t("A insulina trata a cetose, não só a glicemia — a glicose no soro permite mantê-la sem hipoglicemia.")),
        ],
        ["diabetes", "CAD", "insulina"],
      ),
      basic(
        [p(t("Quando considerar a "), t("CAD resolvida", ["bold"]), t(" (consenso 2024)?"))],
        [
          resp(t("β-hidroxibutirato < 0,6 mmol/L", ["bold"]), t(" (ou normalizado) com pH ≥ 7,3 e HCO₃⁻ ≥ 15–18; então transição para insulina SC.")),
          gatilho(t("Resolução é "), t("bioquímica (cetose/acidose)", ["bold"]), t(", não “glicemia normal”.")),
          excecao(t("Sobrepor a 1ª insulina SC 1–2 h antes de desligar a bomba, evitando recidiva.")),
        ],
        ["diabetes", "CAD", "resolução"],
      ),
      basic(
        [p(t("CAD com pH 7,05. A equipe quer repor bicarbonato. Está indicado?"))],
        [
          resp(t("Não. Bicarbonato "), t("só se pH < 6,9", ["bold"]), t("; a acidose corrige com volume + insulina.")),
          pegadinha(t("Bicarbonato precoce → "), t("hipocalemia e acidose liquórica paradoxal", ["bold"]), t(", atrasando a resolução.")),
        ],
        ["diabetes", "CAD", "bicarbonato"],
      ),
      basic(
        [p(t("EHH com "), t("Na⁺ corrigido alto", ["bold"]), t(" e osmolaridade muito elevada. Qual o cuidado na correção?"))],
        [
          resp(t("Corrigir "), t("lentamente", ["bold"]), t(": repor volume e reduzir glicemia/osmolaridade de forma gradual.")),
          gatilho(t("Na corrigido = Na medido + 1,6 × (glicemia − 100)/100 — guia o déficit de água livre.")),
          pegadinha(t("Queda osmótica rápida → "), t("edema cerebral", ["bold"]), t(" (sobretudo em jovens).")),
        ],
        ["diabetes", "EHH", "osmolaridade"],
      ),
      basic(
        [p(t("Idoso em "), t("glibenclamida", ["bold"]), t(" com hipoglicemia que recorre após cada bolus de glicose. Conduta?"))],
        [
          resp(t("Internar", ["bold"]), t(", glicose IV contínua e considerar "), t("octreotide", ["bold"]), t(" na hipoglicemia recorrente por sulfonilureia.")),
          gatilho(t("Sulfonilureia tem meia-vida longa → hipoglicemia "), t("prolongada e recidivante", ["bold"]), t("; o octreotide inibe a secreção de insulina.")),
          pegadinha(t("Dar glicose e liberar → recidiva horas depois.")),
        ],
        ["diabetes", "hipoglicemia", "sulfonilureia"],
      ),
      basic(
        [p(t("Diabético inconsciente por hipoglicemia, "), t("sem acesso venoso", ["bold"]), t(". Conduta imediata?"))],
        [
          resp(t("Glucagon IM/SC 1 mg", ["bold"]), t(" (ou nasal), enquanto se obtém acesso para glicose IV.")),
          excecao(t("Glucagon é menos eficaz em "), t("desnutrido, alcoolista, hepatopata ou hipoglicemia por sulfonilureia", ["bold"]), t(" (glicogênio baixo) — priorizar glicose IV.")),
        ],
        ["diabetes", "hipoglicemia"],
      ),
      basic(
        [p(t("Regra "), t("15-15", ["bold"]), t(" na hipoglicemia leve-moderada do paciente consciente?"))],
        [
          resp(t("15 g de carboidrato rápido (4 comp. de glicose, 150 mL de suco) → aguardar 15 min → rechecar; repetir se ainda < 70 mg/dL.")),
          gatilho(t("Consciente e deglutindo = via oral; inconsciente = glucagon ou glicose IV.")),
        ],
        ["diabetes", "hipoglicemia"],
      ),
      basic(
        [p(t("Internado hiperglicêmico prescrito só com "), t("escala móvel (“sliding scale”)", ["bold"]), t(". Qual o problema?"))],
        [
          resp(t("Escala móvel isolada é reativa e insuficiente — usar esquema "), t("basal-bolus", ["bold"]), t(" (basal + prandial + correção).")),
          pegadinha(t("Só corrigir depois da hiperglicemia gera oscilação; a insulina basal previne.")),
        ],
        ["diabetes", "internado", "insulina"],
      ),
      basic(
        [p(t("Toda CAD/EHH exige uma pergunta obrigatória além do tratamento. Qual?"))],
        [
          resp(t("Qual o "), t("fator precipitante", ["bold"]), t("? Buscar ativamente.")),
          gatilho(t("Mais comuns: "), t("infecção (nº 1), omissão de insulina, IAM/AVC e drogas (corticoide, iSGLT2)", ["bold"]), t(".")),
        ],
        ["diabetes", "CAD", "precipitante"],
      ),
      basic(
        [p(t("Metformina e função renal: limite de "), t("contraindicação", ["bold"]), t(" e quando "), t("suspender temporariamente", ["bold"]), t("?"))],
        [
          ul(
            li(t("Contraindicada se TFG < "), t("30 mL/min/1,73 m²", ["bold"]), t(" (risco de acidose láctica)")),
            li(t("Reavaliar/reduzir dose com TFG 30–45")),
          ),
          excecao(t("Suspender antes de "), t("contraste iodado", ["bold"]), t(" e em doença aguda com risco de IRA, sepse ou jejum/cirurgia.")),
        ],
        ["diabetes", "farmacologia"],
      ),
      basic(
        [p(t("Insulinas: diferença "), t("prática", ["bold"]), t(" entre ultrarrápida, regular, NPH e análogo basal?"))],
        [
          ul(
            li(t("Ultrarrápida (lispro/asparte): ", ["bold"]), t("aplicar no momento da refeição; menos hipoglicemia que a regular")),
            li(t("Regular: ", ["bold"]), t("aplicar 30 min antes da refeição")),
            li(t("NPH: ", ["bold"]), t("TEM pico (4–10 h) → principal causa de hipoglicemia noturna/interprandial")),
            li(t("Glargina/degludeca: ", ["bold"]), t("SEM pico, ~24 h → basal com menor risco de hipoglicemia")),
          ),
        ],
        ["diabetes", "farmacologia", "insulina"],
      ),
      basic(
        [p(t("Meta geral de HbA1c no DM2 e a exceção no idoso frágil?"))],
        [
          resp(t("Geral < 7%", ["bold"]), t("; idoso frágil/expectativa limitada: individualizar, aceitando < 8% para evitar hipoglicemia.")),
          gatilho(t("Afrouxar a meta quando o risco de hipoglicemia supera o ganho — priorizar segurança.")),
        ],
        ["diabetes", "metas"],
      ),
      basic(
        [p(t("DM1 com virose e inapetência decide "), t("suspender a insulina basal", ["bold"]), t(" porque “não está comendo”. Por que é perigoso?"))],
        [
          resp(t("NUNCA suspender a basal", ["bold"]), t(" na doença aguda — o estresse eleva a glicemia e a falta de insulina precipita CAD.")),
          gatilho(t("“Sick day rules”: manter (às vezes aumentar) a basal, monitorar glicemia e cetona, hidratar.")),
        ],
        ["diabetes", "sick-day"],
      ),
      basic(
        [p(t("DM2 com "), t("doença cardiovascular, IC ou DRC", ["bold"]), t(" estabelecida. Como escolher o 2º hipoglicemiante além da metformina?"))],
        [
          resp(t("Priorizar "), t("iSGLT2 ou GLP-1", ["bold"]), t(" com benefício comprovado (iSGLT2 em IC/DRC; GLP-1 em DCV aterosclerótica) — independentemente da HbA1c.")),
          pegadinha(t("Escolher o 2º agente só pela glicemia perde a proteção cardiorrenal que muda desfecho.")),
        ],
        ["diabetes", "farmacologia", "cardiorrenal"],
      ),
      basic(
        [p(t("Ao diagnosticar "), t("DM2", ["bold"]), t(", qual rastreio de complicações já se inicia — e por que difere do DM1?"))],
        [
          resp(t("No DM2: "), t("retinopatia, albuminúria e pé/neuropatia JÁ no diagnóstico", ["bold"]), t(".")),
          gatilho(t("O DM2 evolui anos assintomático → complicações podem existir ao diagnóstico; no DM1, rastrear retino/nefro após 5 anos.")),
        ],
        ["diabetes", "rastreio"],
      ),
      basic(
        [p(t("Paciente acorda com hiperglicemia. Como diferenciar "), t("fenômeno do alvorecer", ["bold"]), t(" de "), t("rebote (Somogyi)", ["bold"]), t("?"))],
        [
          resp(t("Medir a glicemia às "), t("~3 h da manhã", ["bold"]), t(": baixa = Somogyi (rebote pós-hipoglicemia); normal/alta = alvorecer.")),
          gatilho(t("Somogyi → reduzir/ajustar a NPH noturna; alvorecer → ajustar basal/horário. Condutas opostas!")),
        ],
        ["diabetes", "hiperglicemia-matinal"],
      ),
      basic(
        [p(t("Preciso repor "), t("fosfato de rotina", ["bold"]), t(" na cetoacidose diabética?"))],
        [
          resp(t("Não. Só se "), t("hipofosfatemia grave/sintomática", ["bold"]), t(" (fraqueza muscular/respiratória, arritmia).")),
          pegadinha(t("Reposição rotineira de fosfato não melhora desfecho e pode causar hipocalcemia.")),
        ],
        ["diabetes", "CAD", "fosfato"],
      ),
    ],
  },
  {
    name: "IRA e Ácido-Base",
    description: "IRA orientada por decisão (obstrução, índices, diálise) e leitura do distúrbio ácido-base.",
    notes: [
      basic(
        [p(t("Critérios diagnósticos de IRA ("), t("KDIGO", ["bold"]), t(")?"))],
        [
          ul(
            li(t("↑ creatinina ≥ "), t("0,3 mg/dL", ["bold"]), t(" em 48 h; ou")),
            li(t("↑ creatinina ≥ "), t("1,5× o basal", ["bold"]), t(" em 7 dias; ou")),
            li(t("Diurese < "), t("0,5 mL/kg/h por 6 h", ["bold"])),
          ),
          gatilho(t("Basta UM critério; o débito urinário detecta IRA mesmo com creatinina ainda “normal”.")),
        ],
        ["IRA", "KDIGO"],
      ),
      basic(
        [p(t("IRA com creatinina subindo rápido (1,0 → 3,0 em 24 h). Posso usar a "), t("eGFR (CKD-EPI)", ["bold"]), t(" para ajustar medicamentos?"))],
        [
          resp(t("Não. A eGFR só vale em função "), t("estável", ["bold"]), t("; na fase aguda ela superestima a função real.")),
          pegadinha(t("Confiar na eGFR durante a lesão aguda leva a "), t("superdosar", ["bold"]), t(" drogas de eliminação renal.")),
        ],
        ["IRA", "eGFR", "farmacologia"],
      ),
      basic(
        [p(t("Diante de uma IRA, qual a primeira “bifurcação” que muda a conduta?"))],
        [
          resp(t("Classificar em "), t("pré-renal, renal (intrínseca) ou pós-renal", ["bold"]), t("; obstrução e hipoperfusão são rapidamente reversíveis.")),
          gatilho(t("Sempre "), t("excluir obstrução (US) e hipovolemia", ["bold"]), t(" antes de rotular como NTA.")),
        ],
        ["IRA", "classificação"],
      ),
      basic(
        [p(t("Idoso oligúrico, creatinina 5,0, "), t("bexiga palpável", ["bold"]), t(" e hidronefrose bilateral na US. Próxima medida?"))],
        [
          resp(t("Descomprimir já", ["bold"]), t(": sondagem vesical (ou nefrostomia se obstrução alta) — antes de investigação laboratorial extensa.")),
          gatilho(t("IRA pós-renal reverte com a "), t("desobstrução", ["bold"]), t("; adiar para “investigar” custa função renal.")),
          excecao(t("Vigiar "), t("poliúria pós-desobstrutiva", ["bold"]), t(" (repor volume e eletrólitos).")),
        ],
        ["IRA", "pós-renal", "obstrução"],
      ),
      basic(
        [p(t("Como o "), t("sedimento urinário", ["bold"]), t(" localiza a causa da IRA intrínseca?"))],
        [
          ul(
            li(t("Cilindros granulosos pigmentados (“muddy brown”): ", ["bold"]), t("necrose tubular aguda")),
            li(t("Cilindros hemáticos / hemácias dismórficas: ", ["bold"]), t("glomerulonefrite")),
            li(t("Leucócitos/cilindros leucocitários (± eosinofilúria): ", ["bold"]), t("nefrite intersticial aguda")),
            li(t("Sedimento limpo: ", ["bold"]), t("pré-renal ou pós-renal")),
          ),
        ],
        ["IRA", "sedimento"],
      ),
      basic(
        [p(t("Como diferenciar IRA "), t("pré-renal", ["bold"]), t(" de "), t("NTA", ["bold"]), t(" pelos índices urinários?"))],
        [
          ul(
            li(t("FENa: ", ["bold"]), t("< 1% (pré-renal) vs > 2% (NTA)")),
            li(t("Na urinário: ", ["bold"]), t("< 20 vs > 40 mEq/L")),
            li(t("Osmolaridade urinária: ", ["bold"]), t("alta/concentrada vs isostenúria")),
          ),
          pegadinha(t("Diurético recente "), t("invalida a FENa", ["bold"]), t(" → usar FEUreia (< 35% = pré-renal). FENa também é < 1% em GN, contraste e sepse precoce.")),
        ],
        ["IRA", "FENa"],
      ),
      basic(
        [p(t("IRA pré-renal respondeu a volume, mas agora há "), t("estertores e turgência jugular", ["bold"]), t(" e persiste a oligúria. Mais volume?"))],
        [
          resp(t("Não — "), t("suspender a expansão", ["bold"]), t("; a oligúria agora é da NTA instalada, não de hipovolemia.")),
          pegadinha(t("Insistir em volume no paciente já congesto causa "), t("edema pulmonar", ["bold"]), t(" sem melhorar a diurese.")),
          gatilho(t("O alvo é euvolemia, não “forçar diurese”.")),
        ],
        ["IRA", "volume"],
      ),
      basic(
        [p(t("Suspeita de "), t("dissecção de aorta/TEP", ["bold"]), t(" com creatinina 1,8. Adiar a angio-TC por medo de nefropatia do contraste?"))],
        [
          resp(t("Não — o risco da doença supera o do contraste: "), t("fazer a angio-TC", ["bold"]), t(" e hidratar.")),
          pegadinha(t("O risco de nefropatia por contraste foi "), t("superestimado", ["bold"]), t("; negar exame vital por Cr levemente alta é erro.")),
          excecao(t("Em exame eletivo, otimizar volemia e rever a real necessidade.")),
        ],
        ["IRA", "contraste"],
      ),
      basic(
        [p(t("Indicações de diálise "), t("de urgência", ["bold"]), t(" na IRA (AEIOU)?"))],
        [
          ul(
            li(t("A", ["bold"]), t("cidose metabólica refratária")),
            li(t("E", ["bold"]), t("letrólitos: hipercalemia refratária/com ECG")),
            li(t("I", ["bold"]), t("ntoxicações dialisáveis (metanol, etilenoglicol, lítio, salicilato)")),
            li(t("O", ["bold"]), t("verload: hipervolemia refratária a diurético")),
            li(t("U", ["bold"]), t("remia: encefalopatia, pericardite, sangramento urêmico")),
          ),
          gatilho(t("A indicação é "), t("clínica (refratariedade/sintoma)", ["bold"]), t(", não um número isolado.")),
        ],
        ["IRA", "diálise"],
      ),
      basic(
        [p(t("IRA com ureia 200 mg/dL, assintomático, sem acidose/hipercalemia/hipervolemia. Indico diálise pelo número?"))],
        [
          resp(t("Não. "), t("Sem indicação clínica (AEIOU)", ["bold"]), t(", não se dialisa por valor isolado de ureia/creatinina.")),
          pegadinha(t("“Ureia alta = diálise” é armadilha — o gatilho é sintoma/refratariedade.")),
        ],
        ["IRA", "diálise"],
      ),
      basic(
        [p(t("Fórmula do "), t("ânion gap", ["bold"]), t(", valor normal e por que corrigir pela albumina?"))],
        [
          formula("AG = Na^{+} - (Cl^{-} + HCO_3^{-})"),
          p(t("Normal: "), t("8–12 mEq/L", ["bold"]), t(". Correção: somar "), math("2{,}5 \\times (4 - albumina)"), t(" ao AG.")),
          pegadinha(t("Hipoalbuminemia "), t("mascara", ["bold"]), t(" o AG alto — sem corrigir, perde-se uma acidose de AG aumentado.")),
        ],
        ["ácido-base", "ânion-gap"],
      ),
      basic(
        [p(t("Acidose metabólica com HCO₃⁻ 12. A compensação respiratória está adequada ("), t("Winter", ["bold"]), t(")?"))],
        [
          formula("pCO_2\\ esperada = 1{,}5 \\times HCO_3^{-} + 8 \\pm 2"),
          gatilho(t("pCO₂ "), t("acima", ["bold"]), t(" do esperado = acidose respiratória associada; "), t("abaixo", ["bold"]), t(" = alcalose respiratória associada.")),
        ],
        ["ácido-base", "compensação"],
      ),
      basic(
        [p(t("Acidose de ânion gap alto: por que calcular o "), t("delta-delta", ["bold"]), t(" (Δ AG / Δ HCO₃⁻)?"))],
        [
          resp(t("Revela um "), t("distúrbio metabólico associado", ["bold"]), t(": ~1 = AG puro; > 2 = alcalose metabólica concomitante; < 1 = acidose de AG normal associada.")),
          gatilho(t("Evita perder um 2º distúrbio “escondido” pela acidose de AG alto.")),
        ],
        ["ácido-base", "delta-delta"],
      ),
      cloze(
        [
          p(
            t("Acidose metabólica de ânion gap AUMENTADO: "),
            cz("g1", "cetoacidose (diabética, alcoólica, jejum)"),
            t(", "),
            cz("g2", "acidose láctica"),
            t(", "),
            cz("g3", "uremia"),
            t(" e "),
            cz("g4", "intoxicações (metanol, etilenoglicol, salicilatos)"),
            t("."),
          ),
        ],
        ["ácido-base", "ânion-gap"],
      ),
      basic(
        [p(t("Após grande volume de "), t("SF 0,9%", ["bold"]), t(", surge acidose metabólica de "), t("ânion gap normal", ["bold"]), t(". Causa e conduta?"))],
        [
          resp(t("Acidose "), t("hiperclorêmica dilucional", ["bold"]), t(" pela sobrecarga de cloro — trocar para cristaloide balanceado.")),
          gatilho(t("AG normal + hipercloremia + histórico de SF = acidose iatrogênica, não nova sepse/isquemia.")),
          pegadinha(t("Ler essa acidose como “piora clínica” gera condutas desnecessárias.")),
        ],
        ["ácido-base", "hiperclorêmica"],
      ),
      basic(
        [p(t("Alcalose metabólica: como o "), t("cloro urinário", ["bold"]), t(" separa as causas e orienta o tratamento?"))],
        [
          ul(
            li(t("Cl urinário < 20 (salino-responsiva): ", ["bold"]), t("vômito, diurético, aspiração gástrica → repor volume/SF")),
            li(t("Cl urinário > 20 (salino-resistente): ", ["bold"]), t("hiperaldosteronismo, Cushing → tratar a causa (SF não resolve)")),
          ),
        ],
        ["ácido-base", "alcalose"],
      ),
      basic(
        [p(t("Como diferenciar acidose respiratória "), t("aguda", ["bold"]), t(" de "), t("crônica", ["bold"]), t(" pela gasometria?"))],
        [
          resp(t("Pela compensação renal: para cada ↑ 10 de pCO₂, o HCO₃⁻ sobe ~1 (aguda) ou ~3,5 (crônica).")),
          gatilho(t("HCO₃⁻ muito elevado com hipercapnia = retenção "), t("crônica compensada", ["bold"]), t("; pouco elevado = "), t("descompensação aguda", ["bold"]), t(".")),
        ],
        ["ácido-base", "respiratória"],
      ),
      basic(
        [p(t("Ordem para interpretar uma gasometria — e quando a "), t("venosa", ["bold"]), t(" basta?"))],
        [
          ol(
            li(t("pH: acidose ou alcalose?")),
            li(t("Distúrbio primário (pCO₂ vs HCO₃⁻)")),
            li(t("Compensação esperada (Winter etc.)")),
            li(t("Ânion gap e delta-delta")),
          ),
          gatilho(t("Venosa", ["bold"]), t(" triagem de pH/HCO₃⁻/pCO₂; "), t("arterial", ["bold"]), t(" quando a oxigenação/pO₂ importa (insuficiência respiratória).")),
        ],
        ["ácido-base", "interpretação"],
      ),
      basic(
        [p(t("IRA após imobilização prolongada; CK 30.000 e dipstick “sangue +++”, mas SEM hemácias na microscopia. Diagnóstico e conduta?"))],
        [
          resp(t("Rabdomiólise", ["bold"]), t(" (mioglobinúria): "), t("hidratação vigorosa", ["bold"]), t(" para proteger o túbulo; corrigir hipercalemia.")),
          gatilho(t("Dipstick “sangue” positivo SEM hemácias = mioglobina/hemoglobina, não hematúria.")),
        ],
        ["IRA", "rabdomiólise"],
      ),
      basic(
        [p(t("IRA com eosinofilia, rash e piúria estéril dias após iniciar "), t("AINE, IBP ou antibiótico", ["bold"]), t(". Diagnóstico e conduta?"))],
        [
          resp(t("Nefrite intersticial aguda", ["bold"]), t(" (alérgica): "), t("suspender a droga causal", ["bold"]), t("; corticoide se não melhorar.")),
          gatilho(t("A tríade (febre, rash, eosinofilia) costuma ser incompleta — pensar em NIA quando surge IRA após droga nova.")),
        ],
        ["IRA", "NIA"],
      ),
      basic(
        [p(t("Intoxicação por "), t("salicilato (AAS)", ["bold"]), t(": qual o distúrbio ácido-base clássico?"))],
        [
          resp(t("MISTO: "), t("alcalose respiratória + acidose metabólica de ânion gap alto", ["bold"]), t(".")),
          gatilho(t("pH quase normal com AG alto e pCO₂ baixa → suspeitar de salicilato.")),
        ],
        ["ácido-base", "salicilato"],
      ),
      basic(
        [p(t("IRA (creatinina subindo) com "), t("IC descompensada e congestão", ["bold"]), t(". A conduta é expandir volume para “melhorar a perfusão renal”?"))],
        [
          resp(t("Não. Na síndrome cardiorrenal congestiva o rim sofre por "), t("congestão venosa", ["bold"]), t(" — o tratamento é "), t("descongestionar (diurético)", ["bold"]), t(".")),
          pegadinha(t("Dar volume no congesto piora tudo; a creatinina pode até subir durante a diurese e ainda assim ser o caminho certo.")),
        ],
        ["IRA", "cardiorrenal"],
      ),
      basic(
        [p(t("Acidose de "), t("ânion gap normal (hiperclorêmica)", ["bold"]), t(": como o ânion gap URINÁRIO separa diarreia de acidose tubular renal?"))],
        [
          resp(t("AG urinário "), t("negativo = perda GI (diarreia)", ["bold"]), t("; "), t("positivo = ATR", ["bold"]), t(" (rim não excreta NH₄⁺).")),
          gatilho(t("O AG urinário estima a amônia urinária: negativo = resposta renal apropriada (causa extra-renal); positivo = defeito renal.")),
        ],
        ["ácido-base", "AG-urinário"],
      ),
    ],
  },
  {
    name: "HAS",
    description: "Diagnóstico, emergências por cenário, exceções de meta e pegadinhas de conduta.",
    notes: [
      basic(
        [p(t("Como se confirma o diagnóstico de "), t("HAS", ["bold"]), t("?"))],
        [
          ul(
            li(t("Consultório: ≥ "), t("140 × 90 mmHg", ["bold"]), t(" em ≥ 2 ocasiões")),
            li(t("MAPA 24 h: média ≥ "), t("130 × 80", ["bold"]), t(" (vigília ≥ 135 × 85)")),
            li(t("MRPA: média ≥ "), t("130 × 80", ["bold"])),
          ),
          gatilho(t("PA ≥ 180 × 110 ou lesão de órgão-alvo já presente = diagnóstico em consulta única.")),
        ],
        ["HAS", "diagnóstico"],
      ),
      cloze(
        [
          p(
            t("Fármacos de 1ª linha na HAS: "),
            cz("g1", "diuréticos tiazídicos"),
            t(", "),
            cz("g2", "IECA ou BRA"),
            t(" e "),
            cz("g3", "bloqueadores de canais de cálcio di-hidropiridínicos"),
            t(". Nunca combinar "),
            cz("g4", "IECA com BRA"),
            t("."),
          ),
        ],
        ["HAS", "farmacologia"],
      ),
      basic(
        [p(t("O que transforma uma PA muito elevada em "), t("emergência hipertensiva", ["bold"]), t(" — e como isso muda a conduta?"))],
        [
          resp(t("A "), t("lesão aguda de órgão-alvo", ["bold"]), t(" (SNC, coração, aorta, rim, retina, eclâmpsia): droga IV titulável, em geral reduzir PAM ≤ 25% na 1ª hora.")),
          gatilho(t("Sem LOA aguda = HAS grave assintomática → tratamento oral e gradual, não IV.")),
          excecao(t("Dissecção, AVC e eclâmpsia têm alvos próprios (cards específicos).")),
        ],
        ["HAS", "emergência"],
      ),
      basic(
        [p(t("PA "), t("220 × 120", ["bold"]), t(", assintomático, neuro normal, sem lesão aguda de órgão-alvo. A alternativa propõe normalizar já com anti-hipertensivo IV. Correto?"))],
        [
          resp(t("Não. "), t("Não baixar rápido com IV", ["bold"]), t("; reajustar anti-hipertensivo oral e reduzir em 24–48 h com seguimento.")),
          pegadinha(t("Queda abrupta sem LOA → "), t("isquemia cerebral, coronariana e renal", ["bold"]), t(" (perda da autorregulação). É a “letra D”.")),
          gatilho(t("Sem sintoma/lesão aguda, o número alto isolado NÃO é emergência.")),
        ],
        ["HAS", "urgência", "assintomática"],
      ),
      basic(
        [p(t("Na maioria das emergências hipertensivas, qual a "), t("velocidade/meta", ["bold"]), t(" de redução — e as 3 exceções clássicas?"))],
        [
          resp(t("Reduzir a PAM "), t("≤ 25% na 1ª hora", ["bold"]), t(", depois de forma gradual.")),
          excecao(t("Dissecção de aorta", ["bold"]), t(" (PAS 100–120 rápido), "), t("AVC isquêmico", ["bold"]), t(" (permissiva) e "), t("hemorragia intracraniana", ["bold"]), t(" (PAS < 140).")),
          pegadinha(t("Normalizar a PA rapidamente na maioria das emergências piora a isquemia.")),
        ],
        ["HAS", "emergência", "metas"],
      ),
      basic(
        [p(t("Dissecção aguda de aorta, PA "), t("200 × 110", ["bold"]), t(" e FC 110. Qual a sequência correta de drogas?"))],
        [
          resp(t("Betabloqueador IV primeiro", ["bold"]), t(" (esmolol/labetalol) para FC < 60 e PAS 100–120; "), t("só então", ["bold"]), t(" vasodilatador (nitroprussiato) se preciso.")),
          gatilho(t("Reduzir a "), t("força de ejeção (dP/dt) e a FC", ["bold"]), t(" diminui o cisalhamento na parede aórtica.")),
          pegadinha(t("Vasodilatador isolado → "), t("taquicardia reflexa", ["bold"]), t(" e mais cisalhamento — pode propagar a dissecção.")),
        ],
        ["HAS", "emergência", "dissecção"],
      ),
      basic(
        [p(t("AVC isquêmico agudo, PA "), t("200 × 110", ["bold"]), t(", sem indicação de trombólise. Baixar a pressão?"))],
        [
          resp(t("Hipertensão permissiva", ["bold"]), t(": só tratar se > 220 × 120 (ou lesão aguda de outro órgão), reduzindo ~15%.")),
          excecao(t("Se for "), t("trombolisar", ["bold"]), t(": < 185 × 110 antes e < 180 × 105 nas 24 h.")),
          pegadinha(t("Baixar agressivamente reduz a perfusão da penumbra e piora o déficit.")),
        ],
        ["HAS", "emergência", "AVC"],
      ),
      basic(
        [p(t("Hemorragia intracerebral espontânea, PAS "), t("190", ["bold"]), t(". Alvo pressórico?"))],
        [
          resp(t("Reduzir a PAS para "), t("< 140 mmHg", ["bold"]), t(" (faixa ~130–140), de forma controlada.")),
          pegadinha(t("Diferente do AVC isquêmico: aqui a PA alta favorece "), t("expansão do hematoma", ["bold"]), t(" — mas evitar quedas < 130.")),
        ],
        ["HAS", "emergência", "hemorragia"],
      ),
      basic(
        [p(t("Edema agudo de pulmão hipertensivo (SCAPE): PA "), t("210 × 120", ["bold"]), t(", dispneia intensa, hipoxemia. O que mais alivia?"))],
        [
          resp(t("Nitroglicerina IV em dose alta + VNI", ["bold"]), t(" (± furosemida): vasodilatação reduz pré e pós-carga.")),
          gatilho(t("O problema é "), t("pós-carga elevada com redistribuição de volume", ["bold"]), t(", não sobrecarga hídrica maciça — o vasodilatador é o carro-chefe.")),
          pegadinha(t("Focar só em “diurético em bolus” subtrata; VNI + nitrato revertem mais rápido.")),
        ],
        ["HAS", "emergência", "EAP"],
      ),
      basic(
        [p(t("Jovem com dor torácica, PA "), t("210 × 120", ["bold"]), t(" e FC 130 após "), t("cocaína", ["bold"]), t(". Qual droga usar — e qual EVITAR?"))],
        [
          resp(t("Benzodiazepínico", ["bold"]), t(" primeiro (reduz PA e FC); se necessário, nitrato ou fentolamina.")),
          pegadinha(t("EVITAR "), t("betabloqueador isolado", ["bold"]), t(": bloqueio β com α livre → “estimulação α sem oposição”, vasoconstrição e piora da isquemia.")),
        ],
        ["HAS", "emergência", "simpatomimético"],
      ),
      basic(
        [p(t("Gestante com pré-eclâmpsia evolui com "), t("convulsão", ["bold"]), t(". Qual a droga central — e por quê?"))],
        [
          resp(t("Sulfato de magnésio", ["bold"]), t(" IV: controla e previne novas convulsões (não é benzodiazepínico nem o anti-hipertensivo).")),
          gatilho(t("MgSO₄ (convulsão) e anti-hipertensivo (hidralazina/labetalol/nifedipino) têm papéis "), t("distintos", ["bold"]), t("; o definitivo é o parto.")),
          excecao(t("Intoxicação por Mg (arreflexia, depressão respiratória) → gluconato de cálcio.")),
        ],
        ["HAS", "gestação", "eclâmpsia"],
      ),
      basic(
        [p(t("Gestante > 20 semanas com PA ≥ 140 × 90. O que define "), t("pré-eclâmpsia", ["bold"]), t(" e os sinais de "), t("gravidade", ["bold"]), t("?"))],
        [
          resp(t("HTA após a 20ª semana + "), t("proteinúria (≥ 300 mg/24 h) OU lesão de órgão-alvo", ["bold"]), t(".")),
          ul(
            li(t("Gravidade: ", ["bold"]), t("PA ≥ 160 × 110, plaquetopenia, ↑ transaminases, creatinina elevada, edema pulmonar")),
            li(t("Premonitórios: ", ["bold"]), t("cefaleia, escotomas, dor epigástrica/HD (HELLP)")),
          ),
        ],
        ["HAS", "gestação", "pré-eclâmpsia"],
      ),
      basic(
        [p(t("Contraindicações e efeito adverso clássico dos "), t("IECA", ["bold"]), t("?"))],
        [
          ul(
            li(t("Gestação", ["bold"]), t(" (teratogênico — usar metildopa/nifedipino)")),
            li(t("Estenose bilateral de artéria renal; hipercalemia; angioedema prévio")),
          ),
          gatilho(t("Tosse seca (bradicinina) → trocar por BRA. Alta de creatinina > 30% após o início sugere estenose de artéria renal.")),
        ],
        ["HAS", "farmacologia", "IECA"],
      ),
      cloze(
        [
          p(
            t("HAS resistente: PA não controlada com "),
            cz("g1", "3 fármacos otimizados, incluindo um diurético"),
            t(". A 4ª droga de escolha é a "),
            cz("g2", "espironolactona"),
            t("."),
          ),
          excecao(t("Antes de rotular: excluir má adesão, efeito do jaleco branco e causas secundárias.")),
        ],
        ["HAS", "resistente"],
      ),
      basic(
        [p(t("Emergência hipertensiva: "), t("droga IV", ["bold"]), t(" de escolha por cenário?"))],
        [
          ul(
            li(t("Dissecção de aorta: ", ["bold"]), t("esmolol/labetalol (+ nitroprussiato depois)")),
            li(t("EAP hipertensivo: ", ["bold"]), t("nitroglicerina + VNI (± furosemida)")),
            li(t("Encefalopatia/AVC: ", ["bold"]), t("nicardipina ou labetalol")),
            li(t("Eclâmpsia: ", ["bold"]), t("hidralazina ou labetalol + MgSO₄")),
          ),
          pegadinha(t("Não há droga universal — a escolha segue o órgão. Nitroprussiato: cautela no SNC e toxicidade por tiocianato em infusões longas.")),
        ],
        ["HAS", "emergência", "farmacologia"],
      ),
      basic(
        [p(t("Metas pressóricas no tratamento "), t("crônico", ["bold"]), t(" da HAS?"))],
        [
          resp(t("Geral < 140 × 90", ["bold"]), t("; alto risco CV (DAC, DM, DRC, pós-AVC) < 130 × 80 se tolerado.")),
          gatilho(t("Diretrizes recentes (ESC 2024) puxam o alvo para 120–129 de sistólica quando bem tolerado.")),
        ],
        ["HAS", "metas"],
      ),
      basic(
        [p(t("Quando "), t("investigar HAS secundária", ["bold"]), t(" em vez de só tratar?"))],
        [
          resp(t("Pistas: "), t("início < 30 ou > 55 anos, HAS resistente, hipocalemia espontânea, sopro abdominal, crises adrenérgicas, piora abrupta", ["bold"]), t(".")),
          gatilho(t("HAS “fora do padrão” (jovem, resistente, com achado específico) → procurar causa tratável.")),
        ],
        ["HAS", "secundária"],
      ),
      basic(
        [p(t("Hipertenso com "), t("hipocalemia espontânea", ["bold"]), t(" (sem diurético) e alcalose metabólica. Suspeita e exame?"))],
        [
          resp(t("Hiperaldosteronismo primário", ["bold"]), t(": rastrear pela "), t("relação aldosterona/renina", ["bold"]), t(".")),
          gatilho(t("HAS + hipocalemia não provocada = hiperaldo até prova em contrário (secundária mais comum e tratável).")),
        ],
        ["HAS", "hiperaldosteronismo"],
      ),
      basic(
        [p(t("Crises de HAS paroxística com cefaleia, sudorese e palpitações; suspeita de "), t("feocromocitoma", ["bold"]), t(". Regra ao iniciar o bloqueio?"))],
        [
          resp(t("Bloqueio "), t("α ANTES do β", ["bold"]), t(" (fenoxibenzamina/doxazosina antes do betabloqueador).")),
          pegadinha(t("Betabloquear primeiro → "), t("α sem oposição", ["bold"]), t(" → crise hipertensiva grave.")),
        ],
        ["HAS", "feocromocitoma"],
      ),
      basic(
        [p(t("Jovem hipertenso com "), t("pulsos femorais fracos/atrasados", ["bold"]), t(" e PA menor nos MMII. Diagnóstico?"))],
        [
          resp(t("Coarctação da aorta", ["bold"]), t(": gradiente de PA entre membros superiores e inferiores.")),
          gatilho(t("HAS no jovem + diferença de PA/pulso MMSS-MMII = coarctação (procurar erosões costais no Rx).")),
        ],
        ["HAS", "coarctação"],
      ),
      basic(
        [p(t("Como a "), t("comorbidade", ["bold"]), t(" direciona a escolha do anti-hipertensivo?"))],
        [
          ul(
            li(t("DM/DRC com albuminúria: ", ["bold"]), t("IECA ou BRA")),
            li(t("Pós-IAM/ICFER: ", ["bold"]), t("betabloqueador + IECA/BRA")),
            li(t("Idoso/negro sem DRC: ", ["bold"]), t("tiazídico ou BCC respondem melhor")),
          ),
          gatilho(t("A “melhor” 1ª droga depende do perfil — a comorbidade escolhe por você.")),
        ],
        ["HAS", "escolha"],
      ),
    ],
  },
  {
    name: "Arritmias",
    description: "Estabilidade, escolha da terapia por ritmo/QRS, FA e pegadinhas do nó AV.",
    notes: [
      basic(
        [p(t("Taquicardia a 180, PA 78 × 40 e dor torácica. O que indica cardioversão — e o detalhe que precisa ser verdadeiro?"))],
        [
          resp(t("Instabilidade (hipotensão, dor isquêmica, IC aguda ou rebaixamento) atribuível à taquiarritmia → "), t("cardioversão elétrica sincronizada", ["bold"]), t(".")),
          gatilho(t("A instabilidade tem de ser "), t("causada pela arritmia", ["bold"]), t(" — em geral FC > 150; se a FC é baixa, procure outra causa do choque.")),
        ],
        ["arritmias", "instabilidade", "cardioversão"],
      ),
      basic(
        [p(t("Quando usar cardioversão "), t("sincronizada", ["bold"]), t(" e quando "), t("desfibrilação", ["bold"]), t(" (não sincronizada)?"))],
        [
          ul(
            li(t("Sincronizada: ", ["bold"]), t("ritmos ORGANIZADOS com pulso instáveis — TSV, FA/flutter, TV monomórfica com pulso")),
            li(t("Desfibrilação: ", ["bold"]), t("FV, TV sem pulso e TV polimórfica instável (torsades)")),
          ),
          pegadinha(t("Sincronizar na FV/TV sem pulso "), t("atrasa o choque", ["bold"]), t(" (o aparelho não “acha” o R) — nesses casos, desfibrilar.")),
        ],
        ["arritmias", "cardioversão", "desfibrilação"],
      ),
      basic(
        [p(t("Séptico/desidratado com taquicardia "), t("sinusal", ["bold"]), t(" a 130. A alternativa sugere cardioverter ou dar betabloqueador. Correto?"))],
        [
          resp(t("Não. A taquicardia sinusal é "), t("resposta compensatória", ["bold"]), t(" — tratar a causa (volume, dor, febre, hipóxia, anemia).")),
          pegadinha(t("Frear uma sinusal compensatória (cardioversão/betabloqueio) pode "), t("precipitar colapso", ["bold"]), t(".")),
        ],
        ["arritmias", "taquicardia-sinusal"],
      ),
      cloze(
        [
          p(
            t("TSV regular estável de QRS estreito: manobra vagal → "),
            cz("g1", "adenosina 6 mg IV em bolus rápido"),
            t(" → se falhar, "),
            cz("g2", "12 mg"),
            t(" (veia calibrosa + flush de SF)."),
          ),
        ],
        ["arritmias", "TSV"],
      ),
      basic(
        [p(t("Cuidados e limitações da "), t("adenosina", ["bold"]), t(" na TSV?"))],
        [
          ul(
            li(t("Meia-vida ultracurta → "), t("assistolia transitória", ["bold"]), t(" e mal-estar breve; avisar o paciente")),
            li(t("Cautela/evitar em "), t("asma/broncoespasmo", ["bold"])),
            li(t("Não converte FA/flutter (só desmascara o ritmo); ineficaz em TV")),
          ),
          excecao(t("Também é diagnóstica: na taqui regular de QRS estreito, pode revelar flutter ao lentificar o nó AV.")),
        ],
        ["arritmias", "adenosina"],
      ),
      basic(
        [p(t("Taquicardia "), t("irregular, de QRS largo", ["bold"]), t(", muito rápida, em paciente com WPW conhecido. Qual conduta EVITAR?"))],
        [
          resp(t("FA pré-excitada", ["bold"]), t(": evitar TODOS os bloqueadores do nó AV; usar "), t("procainamida", ["bold"]), t(" ou "), t("cardioversão elétrica", ["bold"]), t(" (se instável).")),
          pegadinha(t("Adenosina, diltiazem, verapamil, digoxina e betabloqueador "), t("aceleram a via acessória", ["bold"]), t(" → podem degenerar em FV.")),
          gatilho(t("Irregular + QRS largo + muito rápida = pense em pré-excitação, não em “FA comum”.")),
        ],
        ["arritmias", "WPW", "pré-excitação"],
      ),
      basic(
        [p(t("Taquicardia "), t("regular de QRS largo", ["bold"]), t(", monomórfica, paciente estável. Conduta — e a regra de ouro?"))],
        [
          resp(t("Tratar como "), t("TV", ["bold"]), t(": antiarrítmico (procainamida ou amiodarona); se instável, cardioversão sincronizada.")),
          pegadinha(t("Toda taqui de QRS largo de origem incerta = TV até prova em contrário; "), t("não dar bloqueador do nó AV", ["bold"]), t(".")),
        ],
        ["arritmias", "TV"],
      ),
      basic(
        [p(t("Torsades de pointes", ["bold"]), t(" (TV polimórfica com QT longo). Conduta?"))],
        [
          resp(t("Sulfato de magnésio 1–2 g IV", ["bold"]), t(" (mesmo com Mg normal); corrigir K⁺/Mg²⁺ e suspender drogas que prolongam o QT.")),
          excecao(t("Bradicardia-dependente: "), t("marca-passo ou isoproterenol", ["bold"]), t(" para acelerar a FC; instável → desfibrilar.")),
        ],
        ["arritmias", "torsades"],
      ),
      basic(
        [p(t("FA de alta resposta (150 bpm) surgida durante "), t("sepse/hipertireoidismo", ["bold"]), t(". O foco é a arritmia?"))],
        [
          resp(t("Não isoladamente — "), t("tratar a causa de base", ["bold"]), t(" (infecção, tireotoxicose, hipovolemia); o controle de FC é adjuvante.")),
          pegadinha(t("Só “controlar a FA” sem tratar o gatilho leva a recidiva e resposta pobre aos antiarrítmicos.")),
        ],
        ["arritmias", "FA", "secundária"],
      ),
      basic(
        [p(t("FA: como decidir entre controle de "), t("frequência", ["bold"]), t(" e de "), t("ritmo", ["bold"]), t("?"))],
        [
          ul(
            li(t("Instável → ", ["bold"]), t("cardioversão (controle de ritmo urgente)")),
            li(t("Estável, sintomático/1º episódio/jovem → ", ["bold"]), t("considerar controle de ritmo")),
            li(t("Idoso, assintomático, persistente → ", ["bold"]), t("controle de frequência costuma bastar")),
          ),
          gatilho(t("A anticoagulação segue o CHA₂DS₂-VASc INDEPENDENTE da estratégia escolhida.")),
        ],
        ["arritmias", "FA", "estratégia"],
      ),
      basic(
        [p(t("FA de alta resposta em "), t("IC de fração reduzida descompensada", ["bold"]), t(". Qual droga de controle de FC EVITAR?"))],
        [
          resp(t("Evitar "), t("diltiazem/verapamil", ["bold"]), t(" (inotrópicos negativos) — preferir "), t("amiodarona ou digoxina", ["bold"]), t("; betabloqueador só com cautela após compensar.")),
          pegadinha(t("Bloqueador de canal de cálcio não di-hidropiridínico na ICFER descompensada pode "), t("precipitar choque cardiogênico", ["bold"]), t(".")),
        ],
        ["arritmias", "FA", "ICFER"],
      ),
      basic(
        [p(t("FA com > 48 h (ou duração incerta), estável: o que fazer antes da cardioversão eletiva?"))],
        [
          resp(t("Anticoagular por "), t("3 semanas antes (e 4 após)", ["bold"]), t(", OU excluir trombo em AE por "), t("eco transesofágico", ["bold"]), t(".")),
          pegadinha(t("Cardioverter sem esse cuidado pode "), t("embolizar", ["bold"]), t(" um trombo atrial (AVC).")),
        ],
        ["arritmias", "FA", "anticoagulação"],
      ),
      basic(
        [p(t("Componentes do "), t("CHA₂DS₂-VASc", ["bold"]), t(" e o limiar para anticoagular na FA não valvar?"))],
        [
          ul(
            li(t("C", ["bold"]), t(" IC (1) · "), t("H", ["bold"]), t(" HAS (1) · "), t("A₂", ["bold"]), t(" ≥ 75 anos (2)")),
            li(t("D", ["bold"]), t(" diabetes (1) · "), t("S₂", ["bold"]), t(" AVC/AIT prévio (2)")),
            li(t("V", ["bold"]), t(" doença vascular (1) · "), t("A", ["bold"]), t(" 65–74 (1) · "), t("Sc", ["bold"]), t(" sexo feminino (1)")),
          ),
          resp(t("Anticoagular (DOAC): ≥ 2 (homens) ou ≥ 3 (mulheres).")),
        ],
        ["arritmias", "FA", "anticoagulação"],
      ),
      basic(
        [p(t("Bradicardia sintomática", ["bold"]), t(" (hipotensão, síncope, isquemia). Sequência de tratamento?"))],
        [
          ol(
            li(t("Atropina 1 mg IV", ["bold"]), t(" a cada 3–5 min (máx. 3 mg)")),
            li(t("Sem resposta: "), t("marca-passo transcutâneo", ["bold"]), t(" OU dopamina OU adrenalina em infusão")),
          ),
          gatilho(t("Corrigir causas reversíveis: hipóxia, hipercalemia, drogas (betabloqueador/digital), isquemia.")),
        ],
        ["arritmias", "bradicardia"],
      ),
      basic(
        [p(t("Bradicardia por "), t("Mobitz II ou BAVT com escape de QRS largo", ["bold"]), t(". Por que a atropina pode falhar — e o que fazer?"))],
        [
          resp(t("Bloqueio "), t("infra-nodal (His-Purkinje)", ["bold"]), t(": a atropina age no nó AV e não melhora — partir para "), t("marca-passo (transcutâneo → transvenoso)", ["bold"]), t(".")),
          pegadinha(t("Insistir em atropina no Mobitz II/BAVT atrasa o marca-passo e pode piorar (acelera o átrio sem conduzir).")),
        ],
        ["arritmias", "bradicardia", "BAV"],
      ),
      basic(
        [p(t("PCR em "), t("FV/TV sem pulso", ["bold"]), t(". Conduta?"))],
        [
          ol(
            li(t("RCP de alta qualidade + "), t("desfibrilação precoce", ["bold"])),
            li(t("Adrenalina 1 mg a cada 3–5 min", ["bold"]), t(" (após o 2º choque)")),
            li(t("Amiodarona 300 mg IV", ["bold"]), t(" após o 3º choque; repetir 150 mg")),
          ),
          gatilho(t("Nos ritmos chocáveis, a "), t("desfibrilação precoce", ["bold"]), t(" é o que mais muda o prognóstico.")),
        ],
        ["arritmias", "ACLS", "PCR"],
      ),
      basic(
        [p(t("ACLS em "), t("AESP e assistolia", ["bold"]), t(" (não chocáveis)?"))],
        [
          ol(
            li(t("RCP de alta qualidade — "), t("sem desfibrilação", ["bold"])),
            li(t("Adrenalina 1 mg IV a cada 3–5 min", ["bold"]), t(" desde já")),
            li(t("Tratar as causas reversíveis (5H e 5T)")),
          ),
          callout("warning", p(t("5H: Hipóxia, Hipovolemia, H⁺ (acidose), Hipo/hipercalemia, Hipotermia."))),
          callout("warning", p(t("5T: pneumotórax hiperTensivo, Tamponamento, Tóxicos, TEP, Trombose coronária."))),
        ],
        ["arritmias", "ACLS", "PCR"],
      ),
      basic(
        [p(t("Taquicardia regular de QRS estreito a "), t("~150 bpm", ["bold"]), t(" que “não varia”. A manobra vagal desacelera e aparecem ondas em serrote. Diagnóstico?"))],
        [
          resp(t("Flutter atrial", ["bold"]), t(" com condução 2:1 (átrio ~300 → ventrículo ~150).")),
          gatilho(t("FC fixa em ~150 → sempre pensar em flutter 2:1; vagal/adenosina desmascaram as ondas F. Curativo: ablação do istmo.")),
        ],
        ["arritmias", "flutter"],
      ),
      basic(
        [p(t("Paciente em digoxina com náusea, visão amarelada, "), t("taquicardia atrial com bloqueio", ["bold"]), t(" e hipercalemia. Conduta?"))],
        [
          resp(t("Intoxicação digitálica", ["bold"]), t(": "), t("anticorpo antidigoxina (Fab)", ["bold"]), t(" nos casos graves; corrigir eletrólitos.")),
          pegadinha(t("Evitar cálcio IV para a hipercalemia na intoxicação digitálica (risco de “coração de pedra”).")),
        ],
        ["arritmias", "digital"],
      ),
      basic(
        [p(t("ECG de rotina com "), t("PR curto e onda delta", ["bold"]), t(" (WPW) em ritmo sinusal. Qual droga evitar a longo prazo — e o tratamento curativo?"))],
        [
          resp(t("Evitar "), t("digoxina e verapamil", ["bold"]), t(" (encurtam o refratário da via acessória). Curativo: "), t("ablação por cateter", ["bold"]), t(".")),
          gatilho(t("O risco é FA conduzida pela via acessória → FV; por isso nada de bloqueador nodal crônico que favoreça a via.")),
        ],
        ["arritmias", "WPW"],
      ),
      basic(
        [p(t("Jovem com "), t("síncope ao esforço/emoção", ["bold"]), t(" e história familiar de morte súbita precoce. O que rastrear no ECG?"))],
        [
          resp(t("QT longo congênito", ["bold"]), t(" (e canalopatias como Brugada); evitar drogas que prolongam o QT, avaliar CDI.")),
          gatilho(t("Síncope de esforço + morte súbita familiar = canalopatia/cardiomiopatia, não “desmaio vasovagal”.")),
        ],
        ["arritmias", "QT-longo"],
      ),
      basic(
        [p(t("Quais bradiarritmias têm indicação de "), t("marca-passo definitivo", ["bold"]), t("?"))],
        [
          ul(
            li(t("BAV total ou Mobitz II", ["bold"]), t(" (mesmo assintomático, se persistente)")),
            li(t("Disfunção do nó sinusal SINTOMÁTICA")),
            li(t("BAV sintomático de qualquer grau")),
          ),
          pegadinha(t("BAV de 1º grau e Mobitz I assintomáticos NÃO indicam marca-passo.")),
        ],
        ["arritmias", "marca-passo"],
      ),
    ],
  },
  {
    name: "Asma e DPOC",
    description: "Crise asmática, insuficiência respiratória, oxigênio no DPOC, VNI e mimetizadores.",
    notes: [
      basic(
        [p(t("Quais sinais marcam crise asmática "), t("grave/muito grave", ["bold"]), t("?"))],
        [
          ul(
            li(t("Fala entrecortada, agitação, musculatura acessória")),
            li(t("SpO₂ < 90%, PFE ≤ 50% do previsto")),
            li(t("Sonolência, confusão, "), t("tórax silencioso", ["bold"]), t(" = iminência de parada")),
          ),
          gatilho(t("Tórax silencioso NÃO é melhora — é broncoespasmo tão intenso que não gera fluxo/sibilo.")),
        ],
        ["asma", "gravidade"],
      ),
      cloze(
        [
          h(3, "Manejo da crise asmática"),
          ul(
            li(cz("g1", "SABA (salbutamol)", "broncodilatador"), t(" em doses repetidas na 1ª hora")),
            li(t("Crise grave: associar "), cz("g2", "brometo de ipratrópio")),
            li(cz("g3", "Corticoide sistêmico", "VO = IV"), t(" precoce, na 1ª hora")),
            li(t("O₂ titulado para SpO₂ "), cz("g4", "93–95%")),
          ),
        ],
        ["asma", "emergência"],
      ),
      basic(
        [p(t("Por que o GINA não recomenda mais "), t("SABA isolado", ["bold"]), t(" como resgate?"))],
        [
          resp(t("Não trata a inflamação e associa-se a mais exacerbações e morte. Resgate preferencial: "), t("CI + formoterol", ["bold"]), t(" (anti-inflamatório de resgate/MART).")),
          gatilho(t("Todo asmático precisa de "), t("corticoide inalatório", ["bold"]), t("; “só bombinha de alívio” é conduta ultrapassada e perigosa.")),
        ],
        ["asma", "GINA"],
      ),
      basic(
        [p(t("Crise asmática grave: paciente sonolento e a pCO₂ (antes baixa) agora está "), t("“normalizando” (40 mmHg)", ["bold"]), t(". O que isso indica?"))],
        [
          resp(t("Fadiga respiratória iminente", ["bold"]), t(" — preparar via aérea/intubação, não relaxar.")),
          pegadinha(t("Na crise, o esperado é "), t("hipocapnia", ["bold"]), t(" (hiperventilação); pCO₂ “normal/subindo” em quem piora = exaustão.")),
          gatilho(t("Com tórax silencioso, rebaixamento e bradicardia = indicação de intubação.")),
        ],
        ["asma", "insuficiência-respiratória"],
      ),
      basic(
        [p(t("Crise asmática grave sem resposta às primeiras doses de SABA + ipratrópio + corticoide. Que adjuvante considerar?"))],
        [
          resp(t("Sulfato de magnésio IV", ["bold"]), t(" (2 g) — broncodilatador adjuvante na crise grave/refratária.")),
          gatilho(t("Não substitui SABA/corticoide; entra quando a resposta inicial é insuficiente.")),
        ],
        ["asma", "magnésio"],
      ),
      basic(
        [p(t("Crise asmática sem febre nem consolidação. A conduta inclui antibiótico de rotina?"))],
        [
          resp(t("Não. Antibiótico "), t("não é rotina", ["bold"]), t(" na exacerbação de asma — a maioria dos gatilhos é viral/alérgica.")),
          excecao(t("Só com evidência de infecção bacteriana (pneumonia, sinusite bacteriana).")),
        ],
        ["asma", "antibiótico"],
      ),
      basic(
        [p(t("Asmático grave é intubado e logo depois fica com "), t("PA 60 × 30", ["bold"]), t(". Causa mais provável e conduta imediata?"))],
        [
          resp(t("Hiperinsuflação dinâmica (auto-PEEP)", ["bold"]), t(": "), t("desconectar do ventilador", ["bold"]), t(" e comprimir o tórax para expirar; reduzir FR/volume-minuto e permitir hipercapnia.")),
          pegadinha(t("O aprisionamento aéreo reduz o retorno venoso → hipotensão; sempre descartar também pneumotórax hipertensivo.")),
        ],
        ["asma", "ventilação", "auto-PEEP"],
      ),
      basic(
        [p(t("Exacerbação de DPOC com SpO₂ 84%. Colocam O₂ alto fluxo, a SpO₂ vai a 99% e o paciente fica sonolento. O que houve?"))],
        [
          resp(t("A hiperóxia precipitou "), t("retenção de CO₂", ["bold"]), t(" — titular O₂ para alvo "), t("88–92%", ["bold"]), t(".")),
          gatilho(t("Excesso de O₂ piora a relação V/Q e reduz o drive — não é “quanto mais O₂, melhor”.")),
          pegadinha(t("Sonolência após oxigenar demais o DPOC = narcose por CO₂, não “melhora”.")),
        ],
        ["DPOC", "oxigênio"],
      ),
      basic(
        [p(t("Exacerbação de DPOC com "), t("pH 7,28 e pCO₂ 68", ["bold"]), t(", dispneia intensa, consciente. Qual o suporte indicado?"))],
        [
          resp(t("Ventilação não invasiva (VNI)", ["bold"]), t(" — reduz trabalho respiratório, PCO₂ e necessidade de intubação/mortalidade.")),
          gatilho(t("Gatilho de VNI: "), t("acidose respiratória (pH < 7,35 com pCO₂ elevado)", ["bold"]), t(".")),
          excecao(t("Contraindicação/falha (rebaixamento, instabilidade, secreção incontrolável) → intubar.")),
        ],
        ["DPOC", "VNI"],
      ),
      basic(
        [p(t("Quando prescrever antibiótico na "), t("exacerbação de DPOC", ["bold"]), t("?"))],
        [
          resp(t("Anthonisen: "), t("2 de 3 cardinais desde que um seja a purulência", ["bold"]), t("; ou os 3 cardinais; ou necessidade de ventilação.")),
          gatilho(t("A "), t("purulência do escarro", ["bold"]), t(" é o melhor preditor de benefício. Duração usual 5–7 dias.")),
        ],
        ["DPOC", "antibiótico"],
      ),
      basic(
        [p(t("Duração do corticoide sistêmico na exacerbação de DPOC?"))],
        [
          resp(t("Curso curto ~5 dias", ["bold"]), t(" (ex.: prednisona 40 mg/dia), VO na maioria.")),
          pegadinha(t("Cursos prolongados não trazem benefício adicional e aumentam efeitos adversos.")),
        ],
        ["DPOC", "corticoide"],
      ),
      basic(
        [p(t("DPOC com pCO₂ 60 e "), t("pH 7,38", ["bold"]), t(" (bicarbonato alto). Isso é insuficiência respiratória aguda?"))],
        [
          resp(t("Não — é "), t("hipercapnia crônica compensada", ["bold"]), t(" (pH quase normal). Tratar só se houver descompensação.")),
          pegadinha(t("Ventilar agressivamente um retentor crônico compensado causa alcalose e arritmias — olhar o pH, não só a pCO₂.")),
        ],
        ["DPOC", "hipercapnia"],
      ),
      basic(
        [p(t("DPOC “exacerbando” sem escarro purulento, com dor torácica e hipoxemia desproporcional. O que investigar?"))],
        [
          resp(t("Descartar mimetizadores: "), t("TEP, pneumotórax, pneumonia, insuficiência cardíaca e SCA", ["bold"]), t(".")),
          pegadinha(t("Rotular tudo como “exacerbação” e só broncodilatar faz perder TEP e pneumotórax — causas comuns de piora no DPOC.")),
        ],
        ["DPOC", "diferencial"],
      ),
      basic(
        [p(t("Na manutenção, por que o "), t("corticoide inalatório (CI)", ["bold"]), t(" tem papéis diferentes em asma e DPOC?"))],
        [
          ul(
            li(t("Asma: ", ["bold"]), t("CI é a base (doença inflamatória eosinofílica)")),
            li(t("DPOC: ", ["bold"]), t("broncodilatador de longa (LABA/LAMA) é a base; CI é adjuvante seletivo")),
          ),
          gatilho(t("No DPOC, adicionar CI sobretudo com "), t("eosinófilos ≥ 300 (ou ≥ 100 com exacerbações)", ["bold"]), t("; evitar se < 100 ou pneumonias de repetição.")),
        ],
        ["DPOC", "asma", "corticoide-inalatório"],
      ),
      basic(
        [p(t("Diagnóstico espirométrico de DPOC e gravidade "), t("GOLD", ["bold"]), t("?"))],
        [
          resp(t("Obstrução fixa: "), t("VEF₁/CVF < 0,70 pós-broncodilatador", ["bold"]), t(".")),
          ol(
            li(t("GOLD 1: VEF₁ ≥ 80% · GOLD 2: 50–79%")),
            li(t("GOLD 3: 30–49% · GOLD 4: < 30%")),
          ),
          gatilho(t("A gravidade espirométrica guia prognóstico; o tratamento segue sintomas + exacerbações (grupos A-B-E).")),
        ],
        ["DPOC", "GOLD"],
      ),
      basic(
        [p(t("DPOC estável: qual intervenção com "), t("oxigênio", ["bold"]), t(" muda a mortalidade — e qual a indicação?"))],
        [
          resp(t("Oxigenoterapia domiciliar prolongada (≥ 15 h/dia)", ["bold"]), t(" se "), t("PaO₂ ≤ 55 (ou SatO₂ ≤ 88%)", ["bold"]), t(", ou ≤ 59 com cor pulmonale/policitemia.")),
          pegadinha(t("O₂ domiciliar reduz mortalidade só nos hipoxêmicos crônicos — não é para dispneia com saturação normal.")),
        ],
        ["DPOC", "oxigenoterapia"],
      ),
      basic(
        [p(t("Qual a ÚNICA medida que altera a "), t("história natural (declínio do VEF₁ e mortalidade)", ["bold"]), t(" da DPOC?"))],
        [
          resp(t("Cessação do tabagismo", ["bold"]), t(" (+ vacinação e, quando indicado, O₂ domiciliar).")),
          pegadinha(t("Broncodilatadores aliviam sintomas/exacerbações, mas não mudam o declínio funcional como parar de fumar.")),
        ],
        ["DPOC", "tabagismo"],
      ),
      basic(
        [p(t("Como avaliar o "), t("controle da asma", ["bold"]), t(" para decidir step-up/step-down (GINA)?"))],
        [
          resp(t("Nas últimas 4 semanas: sintomas diurnos > 2×/sem? Despertar noturno? Resgate > 2×/sem? Limitação de atividade?")),
          gatilho(t("0 = controlada · 1–2 = parcial · 3–4 = não controlada → subir etapa. Antes do step-up: checar adesão, técnica e gatilhos.")),
        ],
        ["asma", "controle"],
      ),
      basic(
        [p(t("Que fatores identificam o asmático de risco para "), t("crise quase-fatal", ["bold"]), t("?"))],
        [
          resp(t("Intubação/UTI prévia por asma", ["bold"]), t(", internação/emergência no último ano, uso excessivo de SABA, má adesão ao CI.")),
          gatilho(t("História de intubação por asma é o marcador mais forte — baixar o limiar para tratar e internar.")),
        ],
        ["asma", "quase-fatal"],
      ),
      basic(
        [p(t("Adulto com asma que "), t("piora nos dias de trabalho e melhora nas férias", ["bold"]), t(". Suspeita e conduta?"))],
        [
          resp(t("Asma ocupacional", ["bold"]), t(": relacionar sintomas/PFE ao ambiente; afastar do agente é decisivo.")),
          gatilho(t("Padrão temporal (piora no trabalho, melhora fora) é a pista — o afastamento precoce muda o prognóstico.")),
        ],
        ["asma", "ocupacional"],
      ),
    ],
  },
  {
    name: "Pneumonias",
    description: "Disposição, gravidade, antibiótico por risco e pegadinhas (HCAP, procalcitonina, aspiração).",
    notes: [
      basic(
        [p(t("Componentes do "), t("CURB-65", ["bold"]), t(" e conduta por pontuação?"))],
        [
          ul(
            li(t("C", ["bold"]), t("onfusão · "), t("U", ["bold"]), t("reia > 50 (BUN > 19) · "), t("R", ["bold"]), t(" FR ≥ 30")),
            li(t("B", ["bold"]), t(" PAS < 90 ou PAD ≤ 60 · "), t("65", ["bold"]), t(": idade ≥ 65")),
          ),
          resp(t("0–1: ambulatório · 2: considerar internação · ≥ 3: internar (UTI se 4–5).")),
        ],
        ["pneumonia", "PAC", "CURB-65"],
      ),
      basic(
        [p(t("Jovem hígido com PAC, CURB-65 = 0, mas "), t("SpO₂ 86% em ar ambiente", ["bold"]), t(". Posso dar alta pelo escore?"))],
        [
          resp(t("Não. A "), t("hipoxemia", ["bold"]), t(" indica internação, mesmo com escore baixo.")),
          pegadinha(t("O CURB-65 orienta local de tratamento, mas "), t("não substitui", ["bold"]), t(" saturação, comorbidade e julgamento clínico.")),
        ],
        ["pneumonia", "PAC", "disposição"],
      ),
      basic(
        [p(t("Quais critérios definem "), t("PAC grave", ["bold"]), t(" (ATS/IDSA) e indicam UTI?"))],
        [
          resp(t("1 critério MAIOR", ["bold"]), t(" (choque séptico com vasopressor OU ventilação mecânica) "), t("OU ≥ 3 menores", ["bold"]), t(".")),
          gatilho(t("Menores: FR ≥ 30, PaO₂/FiO₂ ≤ 250, infiltrado multilobar, confusão, ureia alta, leucopenia, plaquetopenia, hipotermia, hipotensão que exige volume agressivo.")),
        ],
        ["pneumonia", "PAC", "grave"],
      ),
      cloze(
        [
          p(
            t("PAC ambulatorial em hígido sem comorbidades: "),
            cz("g1", "amoxicilina"),
            t(" (alternativa: macrolídeo). Com comorbidades: "),
            cz("g2", "beta-lactâmico + macrolídeo"),
            t(" OU "),
            cz("g3", "quinolona respiratória isolada"),
            t("."),
          ),
        ],
        ["pneumonia", "PAC", "antibiótico"],
      ),
      basic(
        [p(t("Esquema empírico para PAC internada em "), t("enfermaria", ["bold"]), t("?"))],
        [
          resp(t("Beta-lactâmico (ceftriaxona ou ampicilina-sulbactam) + macrolídeo", ["bold"]), t("; alternativa: quinolona respiratória em monoterapia.")),
          gatilho(t("A cobertura de atípicos (macrolídeo/quinolona) é padrão na PAC internada.")),
        ],
        ["pneumonia", "PAC", "antibiótico"],
      ),
      basic(
        [p(t("PAC grave em UTI: qual o esquema — e quando ampliar para "), t("MRSA/Pseudomonas", ["bold"]), t("?"))],
        [
          resp(t("Beta-lactâmico + macrolídeo", ["bold"]), t(" (ou beta-lactâmico + quinolona respiratória).")),
          gatilho(t("Ampliar SÓ com fator de risco: isolamento prévio de MRSA/Pseudomonas, hospitalização + ATB IV recentes, ou (Pseudomonas) doença estrutural do pulmão.")),
          pegadinha(t("Cobrir MRSA/Pseudomonas de rotina, sem fator de risco, é excesso.")),
        ],
        ["pneumonia", "PAC", "grave"],
      ),
      basic(
        [p(t("Paciente de casa de repouso, hemodiálise recente. Uso o antigo esquema de “"), t("pneumonia associada aos cuidados de saúde (HCAP)", ["bold"]), t("” com cobertura ampla?"))],
        [
          resp(t("Não — o conceito de HCAP foi "), t("abandonado", ["bold"]), t(" (ATS/IDSA 2019). Tratar como PAC e ampliar só por "), t("fatores de risco individuais", ["bold"]), t(".")),
          pegadinha(t("“Contato com serviço de saúde” não justifica, por si só, cobrir MRSA/Pseudomonas.")),
        ],
        ["pneumonia", "PAC", "HCAP"],
      ),
      basic(
        [p(t("PAC clínico-radiológica típica, mas "), t("procalcitonina baixa", ["bold"]), t(". Posso adiar o antibiótico?"))],
        [
          resp(t("Não. Iniciar o antibiótico "), t("não deve depender da procalcitonina", ["bold"]), t(" quando o diagnóstico é clínico-radiológico.")),
          pegadinha(t("Procalcitonina baixa não exclui PAC bacteriana — usá-la para negar/atrasar o ATB inicial é erro.")),
        ],
        ["pneumonia", "PAC", "procalcitonina"],
      ),
      basic(
        [p(t("PAC "), t("grave em UTI (choque/hipoxemia importante)", ["bold"]), t(". Há papel para corticoide?"))],
        [
          resp(t("Sim — "), t("hidrocortisona", ["bold"]), t(" na PAC grave (reduz mortalidade em estudos recentes, p. ex. CAPE COD).")),
          excecao(t("Evitar corticoide se a etiologia for "), t("influenza", ["bold"]), t(" (pior desfecho).")),
        ],
        ["pneumonia", "PAC", "corticoide"],
      ),
      basic(
        [p(t("Pneumonia por "), t("influenza", ["bold"]), t(" em paciente hospitalizado/grave. Conduta antiviral?"))],
        [
          resp(t("Oseltamivir", ["bold"]), t(" o quanto antes — há benefício mesmo iniciando após 48 h nos casos graves/internados.")),
          gatilho(t("Piora após influenza → considerar coinfecção bacteriana (S. aureus, pneumococo).")),
        ],
        ["pneumonia", "influenza"],
      ),
      basic(
        [p(t("Pneumonia "), t("aspirativa", ["bold"]), t(" sem abscesso nem empiema. Preciso cobrir anaeróbios de rotina?"))],
        [
          resp(t("Não. A cobertura anaeróbia "), t("de rotina não é recomendada", ["bold"]), t(" — tratar como PAC (ex.: amoxicilina-clavulanato).")),
          excecao(t("Reservar anaeróbios para "), t("abscesso pulmonar ou empiema", ["bold"]), t(".")),
        ],
        ["pneumonia", "aspiração"],
      ),
      basic(
        [p(t("Agentes "), t("atípicos", ["bold"]), t(" da PAC e as pistas da Legionella?"))],
        [
          resp(t("Mycoplasma, Chlamydophila e Legionella — não respondem a beta-lactâmicos (precisam de macrolídeo/quinolona).")),
          gatilho(t("Legionella: "), t("hiponatremia", ["bold"]), t(", diarreia, ↑ transaminases, exposição a água/ar-condicionado → antígeno urinário.")),
        ],
        ["pneumonia", "atípicos"],
      ),
      cloze(
        [
          h(3, "Critérios de Light (exsudato se ≥ 1)"),
          ul(
            li(t("Proteína pleural/sérica > "), cz("g1", "0,5")),
            li(t("DHL pleural/sérica > "), cz("g2", "0,6")),
            li(t("DHL pleural > "), cz("g3", "2/3 do limite superior do DHL sérico")),
          ),
        ],
        ["derrame pleural", "Light"],
      ),
      basic(
        [p(t("PAC com derrame: quando o líquido pleural exige "), t("drenagem", ["bold"]), t(" (não só antibiótico)?"))],
        [
          resp(t("Drenar se: "), t("pus/empiema, pH < 7,2, glicose baixa, Gram/cultura positivos ou loculação", ["bold"]), t(".")),
          pegadinha(t("Derrame parapneumônico complicado/empiema NÃO resolve só com ATB — precisa de dreno.")),
        ],
        ["derrame pleural", "pneumonia"],
      ),
      basic(
        [p(t("PAC tratada há 72 h sem melhora (mantém febre e hipoxemia). O que considerar antes de só “trocar o antibiótico”?"))],
        [
          resp(t("Reavaliar: "), t("complicação (empiema/abscesso), germe resistente/não coberto (atípico, MRSA, TB, fungo) e diagnóstico alternativo", ["bold"]), t(" (TEP, IC, neoplasia).")),
          gatilho(t("Repetir imagem e coletar culturas orientam melhor que a troca empírica cega.")),
        ],
        ["pneumonia", "falha"],
      ),
      basic(
        [p(t("PAC internada, 3º dia: afebril há 24 h, hemodinâmica/oxigenação estáveis, tolerando via oral. Conduta?"))],
        [
          resp(t("Transição IV → VO", ["bold"]), t(" e programar alta — atingiu estabilidade clínica.")),
          gatilho(t("Estabilidade (afebril, sinais vitais e saturação estáveis, tolerando VO, consciente) libera o switch e a alta.")),
        ],
        ["pneumonia", "switch"],
      ),
      basic(
        [p(t("HIV com CD4 baixo, dispneia progressiva, "), t("hipoxemia desproporcional ao Rx", ["bold"]), t(" e LDH alta. Diagnóstico e tratamento?"))],
        [
          resp(t("Pneumocystis (PCP)", ["bold"]), t(": "), t("sulfametoxazol-trimetoprima", ["bold"]), t("; adicionar "), t("corticoide se PaO₂ < 70", ["bold"]), t(".")),
          gatilho(t("Hipoxemia desproporcional + infiltrado intersticial + imunossupressão = PCP, não PAC bacteriana comum.")),
        ],
        ["pneumonia", "PCP", "imunossuprimido"],
      ),
      basic(
        [p(t("“Pneumonia” arrastada com "), t("tosse > 2–3 semanas, sudorese noturna, emagrecimento e cavitação apical", ["bold"]), t(". Conduta imediata?"))],
        [
          resp(t("Suspeitar de tuberculose", ["bold"]), t(": "), t("isolamento respiratório (aerossóis)", ["bold"]), t(" + baciloscopia/TRM-TB do escarro.")),
          pegadinha(t("Tratar como PAC comum e não isolar expõe a enfermaria — o padrão sub-agudo com cavitação apical é a pista.")),
        ],
        ["pneumonia", "tuberculose"],
      ),
      basic(
        [p(t("PAC tratada com boa evolução clínica. Preciso de "), t("radiografia de controle", ["bold"]), t("?"))],
        [
          resp(t("Não de rotina", ["bold"]), t(". Considerar em 6–8 semanas em "), t("idoso/tabagista", ["bold"]), t(" para excluir neoplasia subjacente.")),
          pegadinha(t("A resolução radiológica é mais lenta que a clínica — Rx de controle precoce só gera confusão.")),
        ],
        ["pneumonia", "controle"],
      ),
      basic(
        [p(t("Quadro arrastado com febre, escarro pútrido e "), t("cavidade com nível hidroaéreo", ["bold"]), t(" (dentes ruins/aspiração). Diagnóstico e tratamento?"))],
        [
          resp(t("Abscesso pulmonar", ["bold"]), t(": antibiótico prolongado com cobertura anaeróbia (amoxicilina-clavulanato ou clindamicina); drenagem se falha.")),
          gatilho(t("Aqui a cobertura anaeróbia É indicada — ao contrário da aspiração sem abscesso.")),
        ],
        ["pneumonia", "abscesso"],
      ),
    ],
  },
  {
    name: "HDA e HDB",
    description: "Ressuscitação, transfusão, momento da endoscopia, varizes/TIPS e HDB por gravidade.",
    notes: [
      basic(
        [p(t("Diferencie "), t("HDA", ["bold"]), t(" de "), t("HDB", ["bold"]), t(" (referência anatômica e apresentação)."))],
        [
          resp(t("Referência: "), t("ângulo de Treitz", ["bold"]), t(" — proximal = HDA (hematêmese, melena); distal = HDB (hematoquezia/enterorragia).")),
          pegadinha(t("Melena pode ocorrer em HDB de trânsito lento e hematoquezia em HDA maciça — a apresentação não localiza 100%.")),
        ],
        ["HDA", "HDB"],
      ),
      basic(
        [p(t("HDA com "), t("PA 88 × 50, FC 120", ["bold"]), t(" e hematêmese ativa. A equipe quer levar direto à endoscopia. Prioridade?"))],
        [
          resp(t("Estabilizar primeiro", ["bold"]), t(": 2 acessos calibrosos, cristaloide, tipagem/transfusão; EDA "), t("após", ["bold"]), t(" a ressuscitação.")),
          gatilho(t("Endoscopia no instável, sem reanimação, aumenta a mortalidade — ABC antes do endoscópio.")),
        ],
        ["HDA", "ressuscitação"],
      ),
      basic(
        [p(t("Qual o "), t("limiar transfusional", ["bold"]), t(" na HDA — e quando ele muda?"))],
        [
          resp(t("Estratégia restritiva: transfundir "), t("Hb < 7 g/dL", ["bold"]), t(" (alvo 7–9).")),
          excecao(t("< 8", ["bold"]), t(" em cardiopata/SCA; na hemorragia maciça instável, transfundir pela clínica (a Hb ainda não caiu).")),
          pegadinha(t("Transfundir liberalmente na HDA "), t("piora o ressangramento", ["bold"]), t(" e a mortalidade.")),
        ],
        ["HDA", "transfusão"],
      ),
      basic(
        [p(t("Qual ferramenta identifica HDA de "), t("muito baixo risco", ["bold"]), t(" (alta com EDA eletiva)?"))],
        [
          resp(t("Glasgow-Blatchford ≤ 1", ["bold"]), t(" → muito baixo risco de intervenção/ressangramento/óbito → ambulatorial.")),
          gatilho(t("Usa só dados "), t("pré-endoscopia", ["bold"]), t(" (ureia, Hb, PAS, FC, melena/síncope).")),
        ],
        ["HDA", "escores"],
      ),
      basic(
        [p(t("Paciente com "), t("hematoquezia volumosa e choque", ["bold"]), t(". Por que pensar em fonte ALTA antes de assumir HDB?"))],
        [
          resp(t("HDA maciça", ["bold"]), t(" transita rápido e sai como hematoquezia — na instabilidade, "), t("fazer EDA", ["bold"]), t(" antes de investigar o cólon.")),
          pegadinha(t("Assumir HDB pela hematoquezia e ir direto à colonoscopia pode perder uma HDA grave.")),
        ],
        ["HDA", "HDB", "hematoquezia"],
      ),
      basic(
        [p(t("HDA já estabilizada. Em quanto tempo fazer a "), t("endoscopia", ["bold"]), t(" — e o erro a evitar?"))],
        [
          resp(t("EDA em "), t("até 24 h", ["bold"]), t(" após a estabilização (mais precoce se varicosa/instável).")),
          pegadinha(t("Adiar a EDA “esperando o paciente 100%” ou “completar o tratamento clínico” retarda a hemostasia; muito precoce (< 12 h) também não melhora.")),
        ],
        ["HDA", "endoscopia", "tempo"],
      ),
      basic(
        [p(t("Antes da endoscopia na HDA não varicosa, quais duas medidas farmacológicas ajudam?"))],
        [
          ul(
            li(t("IBP IV", ["bold"]), t(" (bolus ± infusão) — reduz estigmas de alto risco; mantido após a EDA se lesão de alto risco")),
            li(t("Eritromicina IV", ["bold"]), t(" 30–120 min antes (procinético) — esvazia o estômago e melhora a visualização")),
          ),
          pegadinha(t("O IBP pré-EDA NÃO substitui a endoscopia — é adjuvante, não tratamento definitivo.")),
        ],
        ["HDA", "IBP"],
      ),
      basic(
        [p(t("Classificação de "), t("Forrest", ["bold"]), t(" e quem precisa de terapia endoscópica?"))],
        [
          ol(
            li(t("Ia jato · Ib babação · IIa vaso visível", ["bold"]), t(" → tratar (alto risco)")),
            li(t("IIb coágulo aderido: ", ["bold"]), t("considerar")),
            li(t("IIc hematina · III base limpa: ", ["bold"]), t("só IBP (baixo risco)")),
          ),
          gatilho(t("Estigmas de alto risco (Ia–IIa) exigem hemostasia endoscópica + IBP em dose alta.")),
        ],
        ["HDA", "Forrest"],
      ),
      basic(
        [p(t("Úlcera tratada por via endoscópica volta a sangrar 24 h depois. Próximo passo?"))],
        [
          resp(t("Nova endoscopia", ["bold"]), t(" (2ª tentativa de hemostasia); se falhar, "), t("embolização arterial ou cirurgia", ["bold"]), t(".")),
          gatilho(t("Ressangramento após a 1ª terapia → repetir a EDA é o padrão antes de escalar para radiologia/cirurgia.")),
        ],
        ["HDA", "ressangramento"],
      ),
      cloze(
        [
          h(3, "HDA varicosa — manejo"),
          ul(
            li(t("Droga vasoativa: "), cz("g1", "terlipressina (ou octreotide/somatostatina)")),
            li(t("Antibiótico profilático: "), cz("g2", "ceftriaxona")),
            li(t("EDA em até "), cz("g3", "12 horas")),
            li(t("Terapia endoscópica de escolha: "), cz("g4", "ligadura elástica")),
          ),
        ],
        ["HDA", "varizes"],
      ),
      basic(
        [p(t("HDA varicosa de "), t("alto risco (Child C ou B com sangramento ativo)", ["bold"]), t(" já controlada na EDA. O que considerar precocemente?"))],
        [
          resp(t("TIPS precoce", ["bold"]), t(" (48–72 h) reduz ressangramento e mortalidade nos pacientes de alto risco.")),
          excecao(t("Ressangramento não controlado por EDA: "), t("balão de Sengstaken ou stent esofágico como ponte", ["bold"]), t(" até o TIPS.")),
        ],
        ["HDA", "varizes", "TIPS"],
      ),
      basic(
        [p(t("HDA em paciente anticoagulado; outro em uso de "), t("AAS para prevenção secundária", ["bold"]), t(". Como manejar as drogas?"))],
        [
          ul(
            li(t("Anticoagulante: ", ["bold"]), t("suspender e reverter conforme a droga/gravidade (vit. K/CCP p/ varfarina; agentes específicos p/ DOAC)")),
            li(t("AAS de prevenção 2ária: ", ["bold"]), t("retomar precocemente após a hemostasia")),
          ),
          pegadinha(t("Suspender o AAS de prevenção secundária “para sempre” troca o risco de sangrar pelo de infartar.")),
        ],
        ["HDA", "anticoagulação"],
      ),
      basic(
        [p(t("Hematoquezia volumosa com "), t("hipotensão e sangramento ativo", ["bold"]), t(". A alternativa propõe colonoscopia de urgência. Melhor conduta?"))],
        [
          resp(t("Estabilizar", ["bold"]), t(" e, no sangramento ativo importante, "), t("angio-TC", ["bold"]), t(" para localizar → embolização; a colonoscopia entra após preparo, na maioria.")),
          pegadinha(t("Colonoscopia de urgência sem preparo, no instável, tem baixo rendimento e risco — não é a 1ª escolha na HDB maciça.")),
        ],
        ["HDB", "angio-TC"],
      ),
      basic(
        [p(t("HDB "), t("hemodinamicamente estável", ["bold"]), t(". Exame de escolha e momento?"))],
        [
          resp(t("Colonoscopia após preparo", ["bold"]), t(" (idealmente nas primeiras 24 h nos internados) — diagnóstica e terapêutica.")),
          gatilho(t("Estável = tempo para preparar o cólon (melhora rendimento/segurança); instável = imagem/angiografia.")),
        ],
        ["HDB", "colonoscopia"],
      ),
      basic(
        [p(t("Principais causas de "), t("HDB", ["bold"]), t(" no adulto?"))],
        [
          ul(
            li(t("Doença diverticular", ["bold"]), t(" (mais comum; arterial, indolor)")),
            li(t("Angiodisplasia", ["bold"]), t(" (idoso, sangramento recorrente)")),
            li(t("Colite isquêmica, doença anorretal, pós-polipectomia, neoplasia")),
          ),
        ],
        ["HDB", "causas"],
      ),
      basic(
        [p(t("Idoso com dor abdominal em cólica seguida de "), t("hematoquezia", ["bold"]), t(", após episódio de hipoperfusão (hipotensão/pós-operatório). Diagnóstico provável?"))],
        [
          resp(t("Colite isquêmica", ["bold"]), t(" — mais comum no cólon esquerdo/flexura esplênica; suporte, hidratação e vigilância (a maioria melhora clinicamente).")),
          gatilho(t("Dor desproporcional + sangramento após baixo fluxo distingue da diverticular (indolor).")),
        ],
        ["HDB", "colite-isquêmica"],
      ),
      basic(
        [p(t("Após "), t("vômitos repetidos", ["bold"]), t(" (álcool), surge hematêmese. Lesão provável e evolução?"))],
        [
          resp(t("Laceração de Mallory-Weiss", ["bold"]), t(" (junção esôfago-gástrica): a maioria "), t("cessa espontaneamente", ["bold"]), t("; terapia endoscópica se sangramento ativo.")),
          gatilho(t("Sequência “vômito primeiro, sangue depois” aponta Mallory-Weiss.")),
        ],
        ["HDA", "Mallory-Weiss"],
      ),
      basic(
        [p(t("Sangramento digestivo recorrente com "), t("EDA e colonoscopia normais", ["bold"]), t(". Próximo exame?"))],
        [
          resp(t("Cápsula endoscópica", ["bold"]), t(" para investigar o intestino delgado (sangramento de origem obscura).")),
          gatilho(t("Fonte no delgado escapa da EDA e da colono — a cápsula é o passo seguinte no paciente estável.")),
        ],
        ["HDB", "obscuro"],
      ),
      basic(
        [p(t("Cirrótico com "), t("varizes de médio/grosso calibre", ["bold"]), t(" que NUNCA sangraram. Como prevenir o 1º sangramento?"))],
        [
          resp(t("Betabloqueador não seletivo (propranolol/carvedilol)", ["bold"]), t(" OU "), t("ligadura elástica profilática", ["bold"]), t(".")),
          pegadinha(t("Profilaxia PRIMÁRIA não usa vasoativo/antibiótico (isso é do sangramento agudo) — é BB ou ligadura.")),
        ],
        ["HDA", "varizes", "profilaxia"],
      ),
      basic(
        [p(t("Hematêmese volumosa e recorrente, com EDA inicial “sem lesão evidente”. Que causa considerar?"))],
        [
          resp(t("Lesão de Dieulafoy", ["bold"]), t(": arteríola submucosa aberrante, sangramento arterial intermitente e de difícil localização (repetir EDA no momento do sangramento).")),
          gatilho(t("Sangramento arterial vultoso com endoscopia “normal” → suspeitar de Dieulafoy.")),
        ],
        ["HDA", "Dieulafoy"],
      ),
      basic(
        [p(t("Idoso com "), t("estenose aórtica", ["bold"]), t(" e sangramento recorrente por "), t("angiodisplasia", ["bold"]), t(". Que associação é essa?"))],
        [
          resp(t("Síndrome de Heyde", ["bold"]), t(" (estenose aórtica + angiodisplasia + deficiência adquirida de von Willebrand); a troca valvar pode resolver o sangramento.")),
          gatilho(t("Angiodisplasia sangrante + sopro de estenose aórtica → pensar em Heyde.")),
        ],
        ["HDB", "Heyde"],
      ),
    ],
  },
  {
    name: "SCA e ICC",
    description: "Síndrome coronariana aguda (IAM), insuficiência cardíaca e suas emergências.",
    notes: [
      basic(
        [p(t("Critérios diagnósticos do "), t("IAMCSST", ["bold"]), t("?"))],
        [
          ul(
            li(
              t("Dor torácica isquêmica + ECG: "),
              t("supra de ST ≥ 1 mm em ≥ 2 derivações contíguas", ["bold"]),
              t(" (ou BCRE presumivelmente novo)"),
            ),
            li(t("V1–V4: supra ≥ "), t("2 mm", ["bold"]), t(" em homens / ≥ 1,5 mm em mulheres")),
          ),
          callout(
            "info",
            p(t("Troponina confirma necrose mas "), t("não aguardar resultado", ["bold"]), t(" para reperfundir.")),
          ),
        ],
        ["SCA", "IAM", "ECG"],
      ),
      cloze(
        [
          h(3, "Reperfusão no IAMCSST"),
          ul(
            li(t("ICP primária preferida se tempo porta-balão ≤ "), cz("g1", "90 min")),
            li(
              t("Se ICP indisponível em ≤ "),
              cz("g2", "120 min"),
              t(": administrar fibrinolítico"),
            ),
            li(t("Após fibrinólise eficaz: ICP de rotina em "), cz("g3", "3–24 h")),
          ),
        ],
        ["SCA", "IAM", "reperfusão"],
      ),
      basic(
        [p(t("Quais as drogas "), t("universais no SCA", ["bold"]), t(" (com e sem supra)?"))],
        [
          ul(
            li(t("AAS ", ["bold"]), t("300 mg de ataque → manutenção")),
            li(t("P2Y12: ", ["bold"]), t("ticagrelor 180 mg (preferencial) ou clopidogrel 300–600 mg")),
            li(t("Anticoagulante: ", ["bold"]), t("HNF ou enoxaparina")),
            li(t("Estatina de alta intensidade: ", ["bold"]), t("atorvastatina 40–80 mg ou rosuvastatina 20–40 mg")),
          ),
          callout(
            "warning",
            p(t("Nitrato: cuidado em IAM de VD (precipita hipotensão). BB: só se sem IC aguda, BAV ou broncoespasmo.")),
          ),
        ],
        ["SCA", "farmacologia"],
      ),
      basic(
        [p(t("Homem 62a, dor precordial há 1 h; ECG com supra em D2, D3 e aVF e PA 80 × 50. Qual conduta medicamentosa "), t("evitar", ["bold"]), t(" — e por quê?"))],
        [
          p(
            t("IAM inferior com hipotensão sugere "),
            t("acometimento do ventrículo direito", ["bold"]),
            t(" (confirmar com V3R–V4R). O VD é pré-carga-dependente."),
          ),
          callout(
            "danger",
            p(t("Evitar "), t("nitrato, morfina e diuréticos", ["bold"]), t(" (reduzem a pré-carga → colapso). Conduta: "), t("volume (SF)", ["bold"]), t(" + reperfusão urgente.")),
          ),
        ],
        ["SCA", "IAM", "emergência"],
      ),
      cloze(
        [
          p(
            t("IAMSST vs Angina instável: ambos SEM supra de ST e podem ter infra ou alteração de onda T. O que os diferencia é a "),
            cz("g1", "troponina", "marcador de necrose"),
            t(" — positiva no IAMSST, negativa na AI."),
          ),
        ],
        ["SCA", "diagnóstico"],
      ),
      basic(
        [p(t("Classificação de "), t("Killip-Kimball", ["bold"]), t(" no IAM?"))],
        [
          ol(
            li(t("I: sem sinais de IC")),
            li(t("II: B3, crepitações basais ou turgência jugular")),
            li(t("III: edema agudo de pulmão")),
            li(t("IV: choque cardiogênico")),
          ),
          p(t("Mortalidade: I ~6% → IV ~60%.", ["italic"])),
        ],
        ["SCA", "ICC", "escores"],
      ),
      basic(
        [p(t("Pilares do tratamento da "), t("ICFER", ["bold"]), t(" (FE < 40%) com redução de mortalidade?"))],
        [
          ul(
            li(t("ARNI: ", ["bold"]), t("sacubitril/valsartana — substitui IECA/BRA se tolerado")),
            li(t("Betabloqueador: ", ["bold"]), t("carvedilol, bisoprolol ou metoprolol succinato")),
            li(t("Antagonista de aldosterona: ", ["bold"]), t("espironolactona ou eplerenona")),
            li(t("SGLT2i: ", ["bold"]), t("dapagliflozina ou empagliflozina — reduz mortalidade independente de DM")),
          ),
          callout(
            "info",
            p(t("Diurético de alça (furosemida) para controle de congestão — sintomático, sem impacto em mortalidade.")),
          ),
        ],
        ["ICC", "farmacologia"],
      ),
      basic(
        [p(t("Manejo do "), t("edema agudo de pulmão", ["bold"]), t(" cardiogênico?"))],
        [
          ul(
            li(t("Posição sentada + O₂ (SpO₂ > 95%) — VNI se hipoxemia persistente")),
            li(t("Furosemida "), t("40–80 mg IV", ["bold"])),
            li(t("Nitrato IV ou SL ", ["bold"]), t("(vasodilatador venoso e arterial)")),
            li(t("Se choque: dobutamina ± vasopressor; "), t("evitar betabloqueador", ["bold"])),
          ),
          callout(
            "danger",
            p(t("Morfina rotineira: em desuso — associada a piores desfechos em estudos observacionais.")),
          ),
        ],
        ["ICC", "emergência", "EAP"],
      ),
      basic(
        [p(t("SCA "), t("sem supra (NSTEMI/angina instável)", ["bold"]), t(": o que define o momento da estratégia invasiva (cateterismo)?"))],
        [
          resp(t("Estratificar por risco: "), t("muito alto → invasiva imediata (< 2 h)", ["bold"]), t("; "), t("alto → precoce (< 24 h)", ["bold"]), t("; baixo → avaliação isquêmica antes.")),
          gatilho(t("Muito alto risco = instabilidade hemodinâmica/elétrica, dor refratária, complicação mecânica ou IC aguda — não esperar.")),
        ],
        ["SCA", "NSTEMI", "estratégia"],
      ),
      basic(
        [p(t("3–5 dias após IAM, surge "), t("sopro novo + choque/edema agudo", ["bold"]), t(". O que suspeitar?"))],
        [
          resp(t("Complicação mecânica", ["bold"]), t(": CIV, insuficiência mitral aguda (ruptura de músculo papilar) ou ruptura de parede livre — eco urgente e cirurgia.")),
          gatilho(t("Sopro novo + deterioração hemodinâmica no pós-IAM = complicação mecânica, não “só” reinfarto.")),
        ],
        ["SCA", "IAM", "complicação"],
      ),
      basic(
        [p(t("IAM evoluindo com "), t("choque cardiogênico", ["bold"]), t(". Qual intervenção mais muda o prognóstico?"))],
        [
          resp(t("Revascularização imediata", ["bold"]), t(" da artéria culpada (ICP) + suporte (inotrópico/vasopressor, considerar dispositivo).")),
          pegadinha(t("No choque com multiarterial, tratar "), t("só a lesão culpada", ["bold"]), t(" no 1º tempo (CULPRIT-SHOCK) — revascularização completa imediata piorou o desfecho.")),
        ],
        ["SCA", "choque-cardiogênico"],
      ),
      basic(
        [p(t("Dispneia e congestão com "), t("FE preservada (ICFEP)", ["bold"]), t(". O tratamento é igual ao da ICFER?"))],
        [
          resp(t("Não idêntico. Base da ICFEP: "), t("iSGLT2", ["bold"]), t(" + controle de congestão (diurético) e das comorbidades (HAS, FA, obesidade).")),
          gatilho(t("O “quarteto” (ARNI/BB/antialdosterona) é da ICFER; na ICFEP o iSGLT2 tem o benefício mais claro.")),
        ],
        ["ICC", "ICFEP"],
      ),
      basic(
        [p(t("IAM com supra em "), t("D2, D3 e aVF", ["bold"]), t(". Artéria provável e qual derivação extra pedir?"))],
        [
          resp(t("Parede inferior → "), t("coronária direita", ["bold"]), t(". Pedir "), t("V3R–V4R", ["bold"]), t(" (VD) e V7–V9 (dorsal).")),
          gatilho(t("Anterior = DA (V1–V4); lateral = circunflexa (D1, aVL, V5–V6); inferior = CD/Cx.")),
        ],
        ["SCA", "IAM", "ECG"],
      ),
      basic(
        [p(t("IAM com "), t("congestão pulmonar (Killip II)", ["bold"]), t(". Iniciar betabloqueador nas primeiras horas?"))],
        [
          resp(t("Não agora", ["bold"]), t(". Adiar o betabloqueador enquanto houver IC aguda/instabilidade — iniciar após compensar.")),
          pegadinha(t("Betabloqueador IV/precoce no IAM com IC aguda "), t("aumenta o risco de choque cardiogênico", ["bold"]), t(".")),
        ],
        ["SCA", "IAM", "betabloqueador"],
      ),
      basic(
        [p(t("Duração padrão da "), t("dupla antiagregação (DAPT)", ["bold"]), t(" após SCA — e o que a encurta ou prolonga?"))],
        [
          resp(t("~12 meses", ["bold"]), t(" (AAS + inibidor de P2Y12) na maioria.")),
          gatilho(t("Alto risco de sangramento → encurtar; alto risco isquêmico com baixo risco hemorrágico → considerar prolongar.")),
        ],
        ["SCA", "DAPT"],
      ),
    ],
  },
  {
    name: "Neurologia de Urgência",
    description: "AVC isquêmico e hemorrágico, meningite bacteriana, status epiléptico.",
    notes: [
      basic(
        [p(t("Janela e critérios para "), t("tPA no AVC isquêmico", ["bold"]), t("?"))],
        [
          ul(
            li(t("Janela: "), t("até 4,5 h", ["bold"]), t(" do início dos sintomas (acordou com déficit = contar da hora em que dormiu)")),
            li(t("TC sem hemorragia; NIHSS habitual ≥ 4; PA < 185 × 110 mmHg antes de iniciar")),
            li(t("Dose: 0,9 mg/kg IV (máx 90 mg) — 10% em bolus, 90% em 60 min")),
          ),
          callout(
            "info",
            p(
              t("Trombectomia mecânica: oclusão de grande vaso até "),
              t("6 h", ["bold"]),
              t(" (ou até 24 h com penumbra em imagem avançada)."),
            ),
          ),
        ],
        ["AVC", "neurologia", "tPA"],
      ),
      basic(
        [p(t("Antes de liberar o "), t("tPA", ["bold"]), t(" no AVC isquêmico, quais contraindicações você precisa excluir?"))],
        [
          ul(
            li(t("Sangramento: ", ["bold"]), t("hemorragia intracraniana na TC, sangramento ativo, coagulopatia (plaquetas < 100.000, INR > 1,7, DOAC/heparina plena)")),
            li(t("Lesão do SNC recente: ", ["bold"]), t("AVC isquêmico ou TCE < 3 meses, neurocirurgia recente")),
            li(t("Cirurgia de grande porte: ", ["bold"]), t("< 14 dias")),
            li(t("PA > 185 × 110 mmHg", ["bold"]), t(" refratária ao tratamento")),
          ),
          callout(
            "info",
            p(t("O fio condutor é o "), t("risco de sangramento", ["bold"]), t(". Glicemia < 50 mg/dL: corrigir e reavaliar antes de excluir.")),
          ),
        ],
        ["AVC", "tPA", "contraindicações"],
      ),
      basic(
        [p(t("AVC isquêmico: qual o alvo de "), t("pressão arterial", ["bold"]), t(" se o paciente VAI trombolisar vs se NÃO vai?"))],
        [
          ul(
            li(t("Vai trombolisar: ", ["bold"]), t("baixar para < 185 × 110 antes e manter < 180 × 105 nas primeiras 24 h")),
            li(t("Não vai trombolisar: ", ["bold"]), t("hipertensão permissiva — só tratar se > 220 × 120 ou lesão aguda de órgão-alvo")),
          ),
          callout("warning", p(t("Baixar a PA agressivamente sem indicação reduz a perfusão da penumbra e piora o déficit."))),
        ],
        ["AVC", "neurologia", "tPA"],
      ),
      basic(
        [p(t("Manejo inicial da "), t("hemorragia intracerebral espontânea", ["bold"]), t("?"))],
        [
          ul(
            li(t("PA: PAS 150–220 mmHg → alvo "), t("< 140 mmHg", ["bold"]), t(" na 1ª hora")),
            li(
              t("Reverter anticoagulação: "),
              t("vitamina K + CCP", ["bold"]),
              t(" (warfarina); andexanet alfa / idarucizumab (DOACs)"),
            ),
            li(t("Controle de PIC: cabeceira 30°, manitol, hiperventilação transitória se herniação")),
            li(t("Evitar hiperglicemia (> 180 mg/dL) e febre")),
          ),
          callout(
            "warning",
            p(t("Cirurgia: hemorragia cerebelar > 3 cm OU hidrocefalia/deterioração neurológica progressiva.")),
          ),
        ],
        ["AVC", "hemorragia", "neurologia"],
      ),
      basic(
        [p(t("Tratamento empírico da "), t("meningite bacteriana", ["bold"]), t(" no adulto?"))],
        [
          ol(
            li(
              t("Dexametasona "),
              t("0,15 mg/kg 6/6h × 4 dias", ["bold"]),
              t(" — iniciar ANTES ou junto com ATB"),
            ),
            li(t("Ceftriaxona "), t("2 g 12/12h", ["bold"])),
            li(
              t("Acrescentar "),
              t("ampicilina 2 g 4/4h", ["bold"]),
              t(" se > 50 anos, imunodeprimido ou alcoolista (Listeria)"),
            ),
          ),
          callout(
            "warning",
            p(t("Não retardar ATB para aguardar TC; PL antes só se TC normal e sem sinais de hipertensão intracraniana.")),
          ),
        ],
        ["meningite", "neurologia", "antibiótico"],
      ),
      cloze(
        [
          h(3, "Status epiléptico — escalonamento terapêutico"),
          ol(
            li(
              t("1ª linha: "),
              cz("g1", "benzodiazepínico IV (diazepam 10 mg ou lorazepam 4 mg)"),
              t(" — até 2 doses"),
            ),
            li(
              t("2ª linha: "),
              cz("g2", "fenitoína 20 mg/kg IV"),
              t(" (ou ácido valpróico / levetiracetam)"),
            ),
            li(
              t("3ª linha (refratário > 30–60 min): "),
              cz("g3", "anestesia geral (propofol, midazolam ou tiopental)"),
            ),
          ),
        ],
        ["epilepsia", "status epiléptico", "neurologia"],
      ),
      basic(
        [p(t("AVC isquêmico incapacitante, mas "), t("fora das 4,5 h", ["bold"]), t(" (ou “wake-up”). Ainda há reperfusão possível?"))],
        [
          resp(t("Sim — "), t("trombectomia mecânica até 24 h", ["bold"]), t(" na oclusão de grande vaso com tecido salvável (mismatch em perfusão — DAWN/DEFUSE-3).")),
          gatilho(t("“Passou a janela do tPA” não encerra o caso: imagem avançada + grande vaso podem indicar trombectomia.")),
        ],
        ["AVC", "trombectomia"],
      ),
      basic(
        [p(t("Déficit focal que "), t("resolveu completamente em 1 h", ["bold"]), t(" (AIT). Conduta?"))],
        [
          resp(t("Investigação urgente", ["bold"]), t(" (carótidas, ECG/FA, imagem) + "), t("dupla antiagregação por ~21 dias", ["bold"]), t(" no AIT de alto risco (CHANCE/POINT).")),
          pegadinha(t("Mandar para casa “porque melhorou” perde a janela de prevenir o AVC que costuma vir nos primeiros dias.")),
        ],
        ["AVC", "AIT"],
      ),
      basic(
        [p(t("Cefaleia "), t("súbita e explosiva (“pior da vida”)", ["bold"]), t(", máxima em segundos. TC de crânio normal. Posso descartar hemorragia?"))],
        [
          resp(t("Não. TC normal não exclui "), t("hemorragia subaracnóidea", ["bold"]), t(" — fazer "), t("punção lombar (xantocromia)", ["bold"]), t(" ou angio-TC.")),
          gatilho(t("Thunderclap = HSA até prova em contrário; após o diagnóstico, nimodipino previne vasoespasmo.")),
        ],
        ["neurologia", "HSA"],
      ),
      basic(
        [p(t("Suspeita de meningite: quando fazer "), t("TC antes da punção lombar", ["bold"]), t("?"))],
        [
          resp(t("TC antes se: "), t("rebaixamento, déficit focal, papiledema, convulsão recente ou imunossupressão", ["bold"]), t(".")),
          pegadinha(t("Na dúvida, "), t("não atrasar o antibiótico", ["bold"]), t(": hemocultura → ATB + dexametasona → TC → PL.")),
        ],
        ["neurologia", "meningite"],
      ),
      basic(
        [p(t("Febre + "), t("alteração de comportamento/convulsão com foco temporal", ["bold"]), t(". Qual tratamento não pode esperar exames?"))],
        [
          resp(t("Aciclovir empírico já", ["bold"]), t(" — suspeita de encefalite herpética (HSV).")),
          pegadinha(t("Aguardar PCR/RM para iniciar o aciclovir aumenta sequela e mortalidade — trate na suspeita.")),
        ],
        ["neurologia", "encefalite"],
      ),
      basic(
        [p(t("“AVC” com hemiparesia súbita. Qual exame à beira-leito é "), t("obrigatório", ["bold"]), t(" antes de assumir isquemia?"))],
        [
          resp(t("Glicemia capilar", ["bold"]), t(" — a hipoglicemia é o grande mimetizador do AVC (e reversível).")),
          gatilho(t("Outros mimics: paralisia de Todd (pós-ictal), enxaqueca com aura, encefalopatia.")),
        ],
        ["neurologia", "AVC", "mimic"],
      ),
      basic(
        [p(t("Dor lombar com "), t("retenção urinária, anestesia em sela e déficit de MMII", ["bold"]), t(". Urgência?"))],
        [
          resp(t("Síndrome da cauda equina", ["bold"]), t(" — urgência: "), t("RM imediata + descompressão cirúrgica", ["bold"]), t(" (corticoide se causa tumoral).")),
          pegadinha(t("Adiar a RM/cirurgia → déficit e incontinência permanentes.")),
        ],
        ["neurologia", "cauda-equina"],
      ),
    ],
  },
  {
    name: "Distúrbios do Potássio e Sódio",
    description: "Hiper/hipocalemia (ECG e conduta), hiponatremia e SIADH.",
    notes: [
      basic(
        [p(t("Renal crônico, K⁺ 7,2 mEq/L, ECG com onda T apiculada e QRS alargando. Qual a "), t("primeira", ["bold"]), t(" medida — e por quê?"))],
        [
          p(
            t("Gluconato de cálcio IV", ["bold"]),
            t(": estabiliza a membrana do miócito e protege o coração. Age em minutos, mas "),
            t("não reduz o K⁺", ["bold"]),
            t(" — ganha tempo para as medidas que baixam o potássio."),
          ),
          callout("danger", p(t("Erro clássico: achar que o cálcio “baixa” o potássio. Ele só protege a membrana."))),
        ],
        ["eletrólitos", "hipercalemia", "emergência"],
      ),
      basic(
        [p(t("Hipercalemia grave: quais medidas "), t("deslocam", ["bold"]), t(" o K⁺ para dentro da célula e quais realmente o "), t("removem", ["bold"]), t(" do corpo?"))],
        [
          ul(
            li(t("Desloca ", ["bold"]), t("(rápido, transitório): insulina + glicose, β₂-agonista (salbutamol), bicarbonato se acidose")),
            li(t("Remove ", ["bold"]), t("(definitivo): diálise, diurético de alça, resina de troca (poliestirenossulfonato)")),
          ),
          callout("info", p(t("Sequência prática: cálcio (protege) → insulina+glicose (desloca) → remoção. Reavaliar ECG e K⁺."))),
        ],
        ["eletrólitos", "hipercalemia"],
      ),
      cloze(
        [
          h(3, "Progressão do ECG na hipercalemia"),
          p(
            t("Ordem: "),
            cz("g1", "onda T apiculada"),
            t(" → achatamento da onda P e PR longo → "),
            cz("g2", "alargamento do QRS"),
            t(" → "),
            cz("g3", "onda sinusoidal"),
            t(" → FV/assistolia."),
          ),
        ],
        ["eletrólitos", "hipercalemia", "ECG"],
      ),
      basic(
        [p(t("Hipocalemia: achados no ECG e por que ela é perigosa em quem usa "), t("digoxina", ["bold"]), t("?"))],
        [
          p(t("ECG: "), t("onda U", ["bold"]), t(", achatamento/inversão de T, infra de ST, extrassístoles.")),
          callout(
            "warning",
            p(t("Potencializa a "), t("toxicidade digitálica", ["bold"]), t(" → arritmias. Repor K⁺ e corrigir o "), t("magnésio", ["bold"]), t(" junto (hipomagnesemia perpetua a hipocalemia).")),
          ),
        ],
        ["eletrólitos", "hipocalemia", "ECG"],
      ),
      basic(
        [p(t("Hiponatremia confirmada (Na⁺ baixo, osmolaridade baixa): qual o "), t("eixo", ["bold"]), t(" que organiza a busca da causa?"))],
        [
          p(t("A "), t("volemia", ["bold"]), t(":")),
          ul(
            li(t("Hipovolêmica: ", ["bold"]), t("perdas (diurético, TGI, 3º espaço)")),
            li(t("Euvolêmica: ", ["bold"]), t("SIADH, hipotireoidismo, insuficiência adrenal")),
            li(t("Hipervolêmica: ", ["bold"]), t("IC, cirrose, síndrome nefrótica, DRC")),
          ),
          callout("info", p(t("Antes: excluir pseudo-hiponatremia e hiponatremia hipertônica (hiperglicemia)."))),
        ],
        ["eletrólitos", "hiponatremia"],
      ),
      basic(
        [p(t("Na⁺ 112 mEq/L com convulsão. Qual a conduta — e o principal "), t("erro", ["bold"]), t(" a evitar?"))],
        [
          p(
            t("Hiponatremia aguda "),
            t("sintomática", ["bold"]),
            t(" → "),
            t("salina hipertônica 3%", ["bold"]),
            t(" em bolus, elevando o Na⁺ apenas 4–6 mEq/L para cessar os sintomas."),
          ),
          callout(
            "danger",
            p(t("Corrigir rápido demais → "), t("mielinólise pontina", ["bold"]), t(" (desmielinização osmótica). Limite: "), t("≤ 8–10 mEq/L em 24 h", ["bold"]), t(".")),
          ),
        ],
        ["eletrólitos", "hiponatremia", "emergência"],
      ),
      basic(
        [p(t("O que sustenta o diagnóstico de "), t("SIADH", ["bold"]), t(" numa hiponatremia — e o tratamento?"))],
        [
          ul(
            li(t("Euvolemia clínica")),
            li(t("Osmolaridade sérica baixa com "), t("osmolaridade urinária inapropriadamente alta", ["bold"]), t(" (> 100)")),
            li(t("Na⁺ urinário > 30 mEq/L; função tireoidiana e adrenal normais")),
          ),
          p(t("Tratamento: "), t("restrição hídrica", ["bold"]), t(" (± sal/ureia; tratar a causa).")),
        ],
        ["eletrólitos", "hiponatremia", "SIADH"],
      ),
      basic(
        [p(t("K⁺ 6,5 no laudo, mas paciente assintomático, ECG normal e a coleta foi difícil. Conduta antes de tratar agressivamente?"))],
        [
          resp(t("Repetir a dosagem", ["bold"]), t(" (amostra sem hemólise/garrote) — suspeitar de "), t("pseudo-hipercalemia", ["bold"]), t(".")),
          gatilho(t("Hemólise, garrote prolongado e trombocitose/leucocitose extremas elevam o K falsamente; ECG normal reforça a dúvida.")),
        ],
        ["eletrólitos", "pseudo-hipercalemia"],
      ),
      basic(
        [p(t("Hipocalemia que "), t("não corrige", ["bold"]), t(" apesar da reposição de potássio. O que checar?"))],
        [
          resp(t("O magnésio", ["bold"]), t(": a hipomagnesemia perpetua a perda renal de K⁺ — repor Mg é indispensável.")),
          pegadinha(t("Insistir só em KCl sem corrigir o Mg mantém a hipocalemia (e a hipocalcemia) refratárias.")),
        ],
        ["eletrólitos", "hipomagnesemia"],
      ),
      basic(
        [p(t("Idoso desidratado com "), t("Na⁺ 168", ["bold"]), t(". Qual o cuidado na velocidade de correção?"))],
        [
          resp(t("Corrigir "), t("lentamente", ["bold"]), t(" (repor água livre; queda ≤ 10–12 mEq/L/24 h).")),
          pegadinha(t("Baixar o sódio rápido demais na hipernatremia → "), t("edema cerebral e convulsão", ["bold"]), t(".")),
        ],
        ["eletrólitos", "hipernatremia"],
      ),
      basic(
        [p(t("Hiponatremia "), t("hipovolêmica", ["bold"]), t(" (perdas, mucosas secas). O tratamento é restrição hídrica como no SIADH?"))],
        [
          resp(t("Não — "), t("é o oposto", ["bold"]), t(": repor volume com "), t("soro fisiológico", ["bold"]), t("; corrigida a volemia, o ADH cai e o Na sobe.")),
          pegadinha(t("Restringir água no hipovolêmico piora a perfusão; a restrição é do SIADH (euvolêmico).")),
        ],
        ["eletrólitos", "hiponatremia"],
      ),
      basic(
        [p(t("Corrigindo uma hiponatremia crônica, o Na⁺ subiu "), t("rápido demais (> 10 em 24 h)", ["bold"]), t(". Conduta?"))],
        [
          resp(t("Re-baixar o sódio", ["bold"]), t(": água livre (SG 5%) ± "), t("desmopressina (DDAVP)", ["bold"]), t(" para frear a correção e prevenir mielinólise.")),
          gatilho(t("A supercorreção é tão perigosa quanto a hiponatremia — reconhecer e reverter ativamente.")),
        ],
        ["eletrólitos", "hiponatremia", "supercorreção"],
      ),
      basic(
        [p(t("Hipocalemia grave (K⁺ 2,2) sintomática. Como repor com segurança?"))],
        [
          resp(t("KCl IV", ["bold"]), t(" (concentração alta → veia central e bomba de infusão), com "), t("monitorização de ECG", ["bold"]), t("; corrigir o Mg junto.")),
          pegadinha(t("Reposição IV rápida/concentrada em veia periférica → flebite e risco de arritmia; nunca em bolus.")),
        ],
        ["eletrólitos", "hipocalemia", "reposição"],
      ),
    ],
  },
  {
    name: "TEP e TVP",
    description: "Wells, D-dímero, quando trombolisar, TVP e profilaxia de TEV.",
    notes: [
      basic(
        [p(t("Mulher 55a, dispneia súbita e dor pleurítica 10 dias após artroplastia de quadril. Como o "), t("escore de Wells", ["bold"]), t(" direciona a investigação?"))],
        [
          ul(
            li(t("Wells baixo/intermediário: ", ["bold"]), t("dosar D-dímero — se normal, exclui TEP")),
            li(t("Wells alto: ", ["bold"]), t("angio-TC de tórax direto (não pedir D-dímero)")),
          ),
          callout("info", p(t("Pós-operatório recente + imobilização puxam o Wells para cima — alta suspeita clínica."))),
        ],
        ["TEP", "escores", "diagnóstico"],
      ),
      basic(
        [p(t("Qual o valor do "), t("D-dímero", ["bold"]), t(" na suspeita de TEP — e quando NÃO pedir?"))],
        [
          p(
            t("Alto valor preditivo "),
            t("negativo", ["bold"]),
            t(": normal + probabilidade baixa → afasta TEP e evita imagem."),
          ),
          callout(
            "warning",
            p(t("Não pedir se probabilidade "), t("alta", ["bold"]), t(" (vá direto à angio-TC) — um D-dímero negativo não afasta e só atrasa. É inespecífico (sobe em sepse, câncer, gestação, pós-op).")),
          ),
        ],
        ["TEP", "diagnóstico"],
      ),
      basic(
        [p(t("TEP confirmado com "), t("hipotensão sustentada", ["bold"]), t(" (PAS < 90). O que muda em relação ao TEP estável?"))],
        [
          p(
            t("TEP "),
            t("maciço (instável)", ["bold"]),
            t(" → "),
            t("trombólise sistêmica", ["bold"]),
            t(" (alteplase), se sem contraindicação; alternativa: embolectomia/cateter."),
          ),
          callout("danger", p(t("No TEP maciço, anticoagular apenas NÃO basta — a trombólise é o que reverte a obstrução."))),
        ],
        ["TEP", "trombólise", "emergência"],
      ),
      basic(
        [p(t("Que achados classificam um TEP "), t("normotenso", ["bold"]), t(" como de risco intermediário (submaciço)?"))],
        [
          ul(
            li(t("Disfunção de VD", ["bold"]), t(" (eco ou relação VD/VE aumentada na angio-TC)")),
            li(t("Biomarcadores elevados: "), t("troponina, BNP", ["bold"])),
          ),
          p(t("Justifica monitorização em UTI e trombólise de resgate se deteriorar.", ["italic"])),
        ],
        ["TEP", "prognóstico"],
      ),
      basic(
        [p(t("Suspeita de "), t("TVP", ["bold"]), t(" de membro inferior: como confirmar e tratar?"))],
        [
          ul(
            li(t("Confirmação: "), t("US doppler com compressão", ["bold"]), t(" (Wells-TVP + D-dímero afastam nos casos de baixa probabilidade)")),
            li(t("Tratamento: anticoagulação — "), t("DOAC", ["bold"]), t(" (rivaroxabana/apixabana) de preferência; HBPM em gestante e câncer")),
          ),
        ],
        ["TVP", "diagnóstico", "anticoagulação"],
      ),
      basic(
        [p(t("Paciente internado clínico: como decidir a "), t("profilaxia de TEV", ["bold"]), t("?"))],
        [
          ul(
            li(t("Estratificar risco (Padua/Caprini)")),
            li(t("Risco alto sem sangramento: "), t("profilaxia farmacológica", ["bold"]), t(" (HBPM/HNF)")),
            li(t("Contraindicação a anticoagulante: "), t("profilaxia mecânica", ["bold"]), t(" (compressão pneumática)")),
          ),
          callout("info", p(t("Subprofilaxia é causa evitável de TEP intra-hospitalar — decisão ativa em toda internação."))),
        ],
        ["TEP", "profilaxia"],
      ),
      basic(
        [p(t("Gestante com dispneia súbita e suspeita de "), t("TEP", ["bold"]), t(". Por que o algoritmo muda?"))],
        [
          resp(t("D-dímero menos útil (sobe na gestação); iniciar pela "), t("US doppler de MMII", ["bold"]), t("; se negativo, imagem torácica (cintilografia V/Q ou angio-TC).")),
          gatilho(t("Usar algoritmo adaptado à gestação; a radiação é aceitável frente ao risco do TEP não tratado.")),
        ],
        ["TEP", "gestação"],
      ),
      basic(
        [p(t("Por quanto tempo anticoagular após um TEP — e o que define estender?"))],
        [
          resp(t("Provocado por fator transitório: "), t("~3 meses", ["bold"]), t(". Não provocado, recorrente ou câncer ativo: "), t("anticoagulação estendida", ["bold"]), t(".")),
          gatilho(t("A decisão pesa recorrência × sangramento; fator reversível = curso curto.")),
        ],
        ["TEP", "duração"],
      ),
      basic(
        [p(t("TEP em paciente com "), t("câncer ativo", ["bold"]), t(". Qual anticoagulante escolher?"))],
        [
          resp(t("DOAC (rivaroxabana/apixabana/edoxabana)", ["bold"]), t(" ou HBPM.")),
          excecao(t("Tumor "), t("gastrointestinal/urotelial", ["bold"]), t(" (mais sangramento com DOAC) → preferir HBPM ou apixabana.")),
        ],
        ["TEP", "câncer"],
      ),
      basic(
        [p(t("Quando indicar "), t("filtro de veia cava", ["bold"]), t(" no TEV?"))],
        [
          resp(t("Contraindicação absoluta à anticoagulação", ["bold"]), t(" (ex.: sangramento ativo) OU TEP recorrente apesar de anticoagulação adequada.")),
          pegadinha(t("Filtro NÃO substitui a anticoagulação — retomá-la assim que possível e remover o filtro.")),
        ],
        ["TEP", "filtro-VCI"],
      ),
      basic(
        [p(t("Quais achados de ECG e gasometria "), t("sugerem", ["bold"]), t(" TEP (e qual o mais comum)?"))],
        [
          resp(t("Mais comum: "), t("taquicardia sinusal", ["bold"]), t(". Sugestivos: S1Q3T3, strain de VD, BRD novo; gaso com "), t("hipoxemia + hipocapnia", ["bold"]), t(".")),
          pegadinha(t("ECG e gaso normais NÃO excluem TEP — servem para levantar suspeita, não para afastar.")),
        ],
        ["TEP", "ECG"],
      ),
      basic(
        [p(t("TVP com "), t("membro muito edemaciado, cianótico e doloroso", ["bold"]), t(" (flegmasia). O que muda?"))],
        [
          resp(t("Flegmasia cerulea dolens", ["bold"]), t(" (TVP iliofemoral maciça com isquemia) → considerar "), t("trombólise dirigida/trombectomia", ["bold"]), t(", não só anticoagular.")),
          gatilho(t("Ameaça de perda do membro eleva a TVP a emergência vascular.")),
        ],
        ["TVP", "flegmasia"],
      ),
    ],
  },
  {
    name: "Anafilaxia",
    description: "Reconhecimento, adrenalina IM precoce e manejo da refratária.",
    notes: [
      basic(
        [p(t("Quais critérios firmam "), t("anafilaxia", ["bold"]), t(" à beira-leito?"))],
        [
          p(t("Início agudo (minutos a horas) com qualquer um:")),
          ol(
            li(t("Pele/mucosa + comprometimento "), t("respiratório OU hipotensão", ["bold"])),
            li(t("≥ 2 sistemas", ["bold"]), t(" após alérgeno provável (pele, respiratório, TGI, cardiovascular)")),
            li(t("Hipotensão", ["bold"]), t(" após exposição a alérgeno conhecido")),
          ),
          callout("warning", p(t("Pode NÃO ter urticária — colapso isolado após alérgeno já conta como anafilaxia."))),
        ],
        ["anafilaxia", "diagnóstico", "emergência"],
      ),
      basic(
        [p(t("Anafilaxia confirmada. Qual a 1ª droga, dose e via — e o "), t("erro clássico", ["bold"]), t(" de prova?"))],
        [
          p(
            t("Adrenalina 0,3–0,5 mg IM (1:1000)", ["bold"]),
            t(" no vasto lateral da coxa, repetível a cada 5–15 min."),
          ),
          callout(
            "danger",
            p(t("Erro clássico: usar "), t("anti-histamínico ou corticoide como 1ª linha", ["bold"]), t(" — não revertem obstrução de via aérea nem choque. Não há contraindicação absoluta à adrenalina na anafilaxia.")),
          ),
        ],
        ["anafilaxia", "farmacologia", "emergência"],
      ),
      basic(
        [p(t("Além da adrenalina, quais as medidas de suporte na anafilaxia?"))],
        [
          ul(
            li(t("O₂ e via aérea; "), t("decúbito com MMII elevados", ["bold"]), t(" (não sentar/levantar — risco de colapso)")),
            li(t("Volume: cristaloide em bolus")),
            li(t("2ª linha: anti-H1 e "), t("corticoide", ["bold"]), t(" (ajuda a prevenir reação bifásica)")),
            li(t("Broncoespasmo: β₂-agonista inalatório")),
          ),
        ],
        ["anafilaxia", "emergência"],
      ),
      basic(
        [p(t("Anafilaxia que "), t("não responde", ["bold"]), t(" à adrenalina IM repetida — o que considerar?"))],
        [
          ul(
            li(t("Adrenalina IV em infusão", ["bold"]), t(" (monitorizado) + volume agressivo")),
            li(t("Em uso de "), t("betabloqueador", ["bold"]), t(" (resposta reduzida à adrenalina): "), t("glucagon IV", ["bold"])),
            li(t("Observar 4–6 h (ou mais) pelo risco de "), t("reação bifásica", ["bold"])),
          ),
        ],
        ["anafilaxia", "refratária"],
      ),
      basic(
        [p(t("Anafilaxia tratada e estável. O que não pode faltar na "), t("alta", ["bold"]), t("?"))],
        [
          resp(t("Observação prolongada", ["bold"]), t(" (risco de reação bifásica), prescrição de "), t("autoinjetor de adrenalina", ["bold"]), t(" + educação e encaminhamento ao alergista.")),
          pegadinha(t("Alta precoce sem autoinjetor deixa o paciente desprotegido para uma recidiva bifásica.")),
        ],
        ["anafilaxia", "alta"],
      ),
      basic(
        [p(t("Paciente em "), t("IECA", ["bold"]), t(" com angioedema de língua/lábios SEM urticária nem broncoespasmo. Responde igual à anafilaxia?"))],
        [
          resp(t("Não. Angioedema por IECA é "), t("mediado por bradicinina", ["bold"]), t(" (não histamínico): suspender o IECA e "), t("proteger a via aérea", ["bold"]), t("; adrenalina/anti-H1/corticoide têm resposta limitada.")),
          gatilho(t("Sem urticária/prurido + uso de IECA → pensar em bradicinina (icatibanto em casos graves).")),
        ],
        ["anafilaxia", "angioedema", "IECA"],
      ),
      basic(
        [p(t("Reação grave com hipotensão logo após "), t("contraste iodado", ["bold"]), t(" (sem IgE prévia). O manejo muda?"))],
        [
          resp(t("Não. Reação "), t("anafilactoide", ["bold"]), t(" (não-IgE) tem manejo "), t("igual ao da anafilaxia: adrenalina IM", ["bold"]), t(", volume, O₂.")),
          gatilho(t("Mecanismo diferente, conduta idêntica — não hesitar na adrenalina por “não ser alergia verdadeira”.")),
        ],
        ["anafilaxia", "anafilactoide"],
      ),
      basic(
        [p(t("Quando usar adrenalina "), t("IV", ["bold"]), t(" em vez de IM na anafilaxia?"))],
        [
          resp(t("IM é a 1ª linha", ["bold"]), t("; reservar a "), t("IV (infusão titulada, monitorizada)", ["bold"]), t(" para choque refratário à IM ou parada iminente.")),
          pegadinha(t("Adrenalina IV em bolus na anafilaxia sem monitorização → arritmia/isquemia.")),
        ],
        ["anafilaxia", "adrenalina"],
      ),
      basic(
        [p(t("Anafilaxia recorrente sem gatilho claro. Que exame ajuda a confirmar/investigar?"))],
        [
          resp(t("Triptase sérica", ["bold"]), t(" (na crise) confirma a ativação mastocitária; elevação persistente sugere "), t("mastocitose", ["bold"]), t(".")),
          gatilho(t("Triptase basal alta ou episódios repetidos sem alérgeno → investigar mastocitose.")),
        ],
        ["anafilaxia", "triptase"],
      ),
    ],
  },
  {
    name: "Intoxicações e Antídotos",
    description: "Paracetamol, antídotos, síndrome colinérgica, tricíclicos e opioides.",
    notes: [
      basic(
        [p(t("Ingestão de "), t("paracetamol", ["bold"]), t(" em dose tóxica há 6 h, paciente assintomático. Conduta e antídoto?"))],
        [
          p(
            t("Dosar nível e aplicar o "),
            t("nomograma de Rumack-Matthew", ["bold"]),
            t(" (a partir de 4 h) → "),
            t("N-acetilcisteína", ["bold"]),
            t(" se acima da linha de tratamento."),
          ),
          callout(
            "warning",
            p(t("Iniciar NAC empiricamente se apresentação tardia (> 8 h) ou dose muito alta. Assintomático "), t("não exclui", ["bold"]), t(" hepatotoxicidade (surge em 24–72 h).")),
          ),
        ],
        ["intoxicação", "paracetamol", "antídoto"],
      ),
      basic(
        [p(t("Relacione as principais intoxicações aos seus "), t("antídotos", ["bold"]), t("."))],
        [
          ul(
            li(t("Opioide → "), t("naloxona", ["bold"])),
            li(t("Benzodiazepínico → "), t("flumazenil", ["bold"]), t(" (cautela)")),
            li(t("Paracetamol → "), t("N-acetilcisteína", ["bold"])),
            li(t("Metanol/etilenoglicol → "), t("fomepizol", ["bold"]), t(" (ou etanol)")),
            li(t("Organofosforado → "), t("atropina + pralidoxima", ["bold"])),
            li(t("Digoxina → "), t("anticorpo antidigoxina (Fab)", ["bold"])),
            li(t("Betabloqueador/BCC → "), t("glucagon / cálcio", ["bold"])),
          ),
        ],
        ["intoxicação", "antídoto"],
      ),
      basic(
        [p(t("Agricultor com miose, sialorreia, broncorreia, bradicardia e fasciculações. Síndrome e tratamento?"))],
        [
          p(
            t("Intoxicação por "),
            t("organofosforado", ["bold"]),
            t(" (síndrome colinérgica: muscarínica SLUDGE + nicotínica). Tratamento: "),
            t("atropina", ["bold"]),
            t(" (titular até secar secreções) + "),
            t("pralidoxima", ["bold"]),
            t(" (reativa a acetilcolinesterase)."),
          ),
          callout("danger", p(t("A broncorreia mata — atropinizar em doses altas, guiado pelas secreções."))),
        ],
        ["intoxicação", "organofosforado"],
      ),
      basic(
        [p(t("Intoxicação por "), t("antidepressivo tricíclico", ["bold"]), t(" com QRS alargado e hipotensão. Qual droga muda o prognóstico?"))],
        [
          p(
            t("Bicarbonato de sódio IV", ["bold"]),
            t(": alcaliniza e oferta Na⁺ → reverte o bloqueio dos canais de sódio, estreita o QRS e trata a hipotensão."),
          ),
          callout("info", p(t("Convulsão: benzodiazepínico. Evitar antiarrítmicos da classe Ia/Ic (pioram o bloqueio)."))),
        ],
        ["intoxicação", "tricíclico", "ECG"],
      ),
      basic(
        [p(t("Por que o "), t("flumazenil", ["bold"]), t(" deve ser usado com cautela na intoxicação por benzodiazepínico?"))],
        [
          p(
            t("Pode precipitar "),
            t("convulsões", ["bold"]),
            t(" (em dependentes) e arritmias se houver co-ingestão de tricíclico. Reservado a casos selecionados; o suporte ventilatório costuma bastar."),
          ),
        ],
        ["intoxicação", "benzodiazepínico", "antídoto"],
      ),
      basic(
        [p(t("Paciente torporoso, FR 6 irpm, "), t("miose puntiforme", ["bold"]), t(". Conduta imediata?"))],
        [
          p(
            t("Tríade opioide (rebaixamento + depressão respiratória + miose) → "),
            t("naloxona", ["bold"]),
            t(", titulada pela ventilação (não pela consciência)."),
          ),
          callout("warning", p(t("Meia-vida curta da naloxona → vigiar re-sedação; pode exigir repique ou infusão contínua."))),
        ],
        ["intoxicação", "opioide", "antídoto"],
      ),
      basic(
        [p(t("Quando o "), t("carvão ativado", ["bold"]), t(" ajuda numa intoxicação — e quando é inútil/perigoso?"))],
        [
          resp(t("Útil na "), t("1ª hora", ["bold"]), t(" pós-ingestão, com via aérea protegida.")),
          pegadinha(t("Não adsorve "), t("álcoois, lítio, ferro, metais e cáusticos", ["bold"]), t("; contraindicado com rebaixamento sem via aérea, íleo ou risco de aspiração.")),
        ],
        ["intoxicação", "carvão-ativado"],
      ),
      basic(
        [p(t("Acidose de ânion gap alto + "), t("gap osmolar elevado", ["bold"]), t(" + rebaixamento. Que intoxicação e antídoto?"))],
        [
          resp(t("Metanol ou etilenoglicol", ["bold"]), t(": "), t("fomepizol (ou etanol) + hemodiálise", ["bold"]), t(".")),
          gatilho(t("Metanol → cegueira (nervo óptico); etilenoglicol → cristais de oxalato + IRA. O gap osmolar aponta o álcool antes do metabólito.")),
        ],
        ["intoxicação", "metanol", "etilenoglicol"],
      ),
      basic(
        [p(t("Vítima de incêndio/aquecedor com cefaleia, rebaixamento e "), t("SpO₂ do oxímetro normal", ["bold"]), t(". Diagnóstico e conduta?"))],
        [
          resp(t("Intoxicação por monóxido de carbono", ["bold"]), t(": "), t("O₂ a 100%", ["bold"]), t(" (máscara não reinalante; hiperbárica em casos graves/gestante).")),
          pegadinha(t("O oxímetro NÃO distingue carboxi-hemoglobina — SpO₂ “normal” engana; dosar carboxiHb. Em incêndio, pensar em cianeto (hidroxocobalamina).")),
        ],
        ["intoxicação", "monóxido-carbono"],
      ),
      basic(
        [p(t("Paciente “"), t("quente, seco, vermelho, cego, louco", ["bold"]), t("”, com midríase, taquicardia e retenção urinária. Que toxíndrome?"))],
        [
          resp(t("Síndrome anticolinérgica", ["bold"]), t(" (anti-histamínico, atropina, tricíclico): suporte + benzodiazepínico; fisostigmina em casos selecionados.")),
          gatilho(t("Oposto da colinérgica (SLUDGE, miose, úmido) — pele/pupila diferenciam: anticolinérgico = seco e midriático.")),
        ],
        ["intoxicação", "anticolinérgico"],
      ),
      basic(
        [p(t("Uso crônico de "), t("lítio", ["bold"]), t(" com tremor grosseiro, ataxia e confusão. Conduta na intoxicação grave?"))],
        [
          resp(t("Hidratação com SF e "), t("hemodiálise", ["bold"]), t(" nos casos graves (nível alto, neurotoxicidade, IRA).")),
          pegadinha(t("Evitar "), t("tiazídicos e desidratação (AINE, IECA)", ["bold"]), t(" — reduzem o clearance e precipitam a intoxicação.")),
        ],
        ["intoxicação", "lítio"],
      ),
      basic(
        [p(t("Criança com dor abdominal, vômitos e "), t("comprimidos radiopacos no Rx de abdome", ["bold"]), t(". Intoxicação e antídoto?"))],
        [
          resp(t("Intoxicação por ferro", ["bold"]), t(": "), t("desferroxamina", ["bold"]), t(" nos casos graves; suporte.")),
          gatilho(t("O ferro é radiopaco (visível no Rx) e o carvão ativado NÃO o adsorve.")),
        ],
        ["intoxicação", "ferro"],
      ),
    ],
  },
];

// --- execução ---

const db = getDb();

const passwordHash = await hashPassword("1234");
const userId = await db.withServiceTransaction(async (tx) => {
  const [existing] = await tx
    .select({ id: users.id })
    .from(users)
    .where(eq(users.username, "duda"))
    .limit(1);
  if (existing) {
    await tx.update(users).set({ passwordHash }).where(eq(users.id, existing.id));
    return existing.id;
  }
  const [created] = await tx
    .insert(users)
    .values({ username: "duda", passwordHash, role: "user", name: "Duda", email: null })
    .returning({ id: users.id });
  if (!created) throw new Error("insert de 'duda' falhou");
  return created.id;
});
await bootstrapNewUser(userId, db.withServiceTransaction);
console.log(`usuária 'duda' pronta (id ${userId})`);

let totalNotes = 0;
let totalCards = 0;
for (const deck of DECKS) {
  const [existingDeck] = await db.withServiceTransaction(async (tx) =>
    tx
      .select({ id: decks.id })
      .from(decks)
      .where(and(eq(decks.ownerUserId, userId), eq(decks.name, deck.name), isNull(decks.deletedAt)))
      .limit(1),
  );
  if (existingDeck) {
    console.log(`- deck "${deck.name}" já existe (${existingDeck.id}) — pulado`);
    continue;
  }
  const { deckId } = await createDeck(userId, {
    name: deck.name,
    description: deck.description,
  });
  let deckCards = 0;
  for (const note of deck.notes) {
    const result = await createNote(userId, {
      deckId,
      noteType: note.noteType,
      content: note.content,
      tagNames: note.tags,
    });
    deckCards += result.cardCount;
    totalNotes += 1;
  }
  totalCards += deckCards;
  console.log(`- deck "${deck.name}": ${deck.notes.length} notas, ${deckCards} cards`);
}

console.log(`seed concluído: ${totalNotes} notas novas, ${totalCards} cards novos`);
await db.end();
