import { describe, expect, it } from "vitest";
import {
  nextStudyDayStart,
  studyDayKey,
  studyDayStart,
  type StudyDayConfig,
} from "@/lib/study-day";

// America/Sao_Paulo é UTC-3 o ano todo desde 2019 (sem DST) — bom para asserts
// determinísticos. Casos de DST usam America/New_York.
const SP: StudyDayConfig = { timezone: "America/Sao_Paulo", dayStartHour: 4 };

describe("study-day (§7.4)", () => {
  it("instante depois do corte pertence ao dia civil local", () => {
    // 2026-03-10T12:00-03:00 = 15:00Z
    expect(studyDayKey(new Date("2026-03-10T15:00:00Z"), SP)).toBe("2026-03-10");
  });

  it("instante ANTES do corte de 4h pertence ao dia local anterior", () => {
    // 2026-03-10T02:30-03:00 = 05:30Z → ainda é o dia de estudo 2026-03-09
    expect(studyDayKey(new Date("2026-03-10T05:30:00Z"), SP)).toBe("2026-03-09");
  });

  it("exatamente no corte (04:00 local) já é o novo dia", () => {
    // 2026-03-10T04:00-03:00 = 07:00Z
    expect(studyDayKey(new Date("2026-03-10T07:00:00Z"), SP)).toBe("2026-03-10");
    // 03:59:59 local ainda é o dia anterior
    expect(studyDayKey(new Date("2026-03-10T06:59:59Z"), SP)).toBe("2026-03-09");
  });

  it("cruzar a meia-noite NÃO troca o dia de estudo (só o corte troca)", () => {
    // 23:00 e 01:00 locais da mesma noite → mesmo dia de estudo
    const antes = studyDayKey(new Date("2026-03-11T02:00:00Z"), SP); // 23:00-03 do dia 10
    const depois = studyDayKey(new Date("2026-03-11T04:00:00Z"), SP); // 01:00-03 do dia 11
    expect(antes).toBe("2026-03-10");
    expect(depois).toBe("2026-03-10");
    expect(antes).toBe(depois);
  });

  it("studyDayStart é o corte das 4h do dia local corrente (UTC-3)", () => {
    const start = studyDayStart(new Date("2026-03-10T15:00:00Z"), SP);
    // 04:00-03:00 = 07:00Z
    expect(start.toISOString()).toBe("2026-03-10T07:00:00.000Z");
  });

  it("antes do corte, studyDayStart aponta o corte do dia anterior", () => {
    const start = studyDayStart(new Date("2026-03-10T05:30:00Z"), SP); // 02:30-03
    expect(start.toISOString()).toBe("2026-03-09T07:00:00.000Z");
  });

  it("nextStudyDayStart = corte do dia local seguinte", () => {
    const next = nextStudyDayStart(new Date("2026-03-10T15:00:00Z"), SP);
    expect(next.toISOString()).toBe("2026-03-11T07:00:00.000Z");
  });

  it("nextStudyDayStart antes do corte aponta o corte de HOJE", () => {
    // 02:30-03 do dia 10 → dia de estudo é 09 → próximo começo é o corte do dia 10
    const next = nextStudyDayStart(new Date("2026-03-10T05:30:00Z"), SP);
    expect(next.toISOString()).toBe("2026-03-10T07:00:00.000Z");
  });

  it("atravessa fim de mês corretamente", () => {
    const next = nextStudyDayStart(new Date("2026-01-31T15:00:00Z"), SP);
    expect(next.toISOString()).toBe("2026-02-01T07:00:00.000Z");
  });

  it("dayStartHour=0 usa a meia-noite local como corte", () => {
    const cfg: StudyDayConfig = { timezone: "America/Sao_Paulo", dayStartHour: 0 };
    // 00:30-03 = 03:30Z do dia 10 → dia de estudo 10
    expect(studyDayKey(new Date("2026-03-10T03:30:00Z"), cfg)).toBe("2026-03-10");
    expect(studyDayStart(new Date("2026-03-10T03:30:00Z"), cfg).toISOString()).toBe(
      "2026-03-10T03:00:00.000Z",
    );
  });

  it("respeita DST: America/New_York muda de offset na primavera", () => {
    const ny: StudyDayConfig = { timezone: "America/New_York", dayStartHour: 4 };
    // Antes do DST 2026 (começa 2026-03-08): offset -05:00 → corte 04:00 = 09:00Z
    expect(studyDayStart(new Date("2026-03-01T15:00:00Z"), ny).toISOString()).toBe(
      "2026-03-01T09:00:00.000Z",
    );
    // Depois do DST: offset -04:00 → corte 04:00 = 08:00Z
    expect(studyDayStart(new Date("2026-03-20T15:00:00Z"), ny).toISOString()).toBe(
      "2026-03-20T08:00:00.000Z",
    );
  });
});
