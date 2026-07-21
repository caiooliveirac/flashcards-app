import { afterEach, describe, expect, it, vi } from "vitest";
import {
  formatBytes,
  mediaUrl,
  uploadToTarget,
  validateImageFile,
  waitForProcessing,
} from "@/features/editor/upload-client";

const MAX = 10 * 1024 * 1024;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("validateImageFile", () => {
  it("aceita mimes de imagem suportados dentro do limite", () => {
    for (const type of ["image/jpeg", "image/png", "image/webp", "image/gif"]) {
      expect(validateImageFile({ type, size: 1000 }, MAX)).toBeNull();
    }
  });

  it("rejeita tipo não-imagem com mensagem clara ANTES de subir", () => {
    const error = validateImageFile({ type: "application/pdf", size: 1000 }, MAX);
    expect(error).toMatch(/não é uma imagem/);
  });

  it("rejeita svg (fora da allowlist de magic bytes do worker)", () => {
    expect(validateImageFile({ type: "image/svg+xml", size: 1000 }, MAX)).not.toBeNull();
  });

  it("rejeita arquivo acima do limite com o limite na mensagem", () => {
    const error = validateImageFile({ type: "image/png", size: MAX + 1 }, MAX);
    expect(error).toMatch(/grande demais/);
    expect(error).toMatch(/10 MB/);
  });

  it("rejeita arquivo vazio", () => {
    expect(validateImageFile({ type: "image/png", size: 0 }, MAX)).toMatch(/vazio/);
  });
});

describe("formatBytes", () => {
  it("formata MB, KB e bytes", () => {
    expect(formatBytes(10 * 1024 * 1024)).toBe("10 MB");
    expect(formatBytes(512 * 1024)).toBe("512 KB");
    expect(formatBytes(100)).toBe("100 bytes");
  });
});

describe("mediaUrl", () => {
  it("monta a rota autenticada (com e sem thumb)", () => {
    expect(mediaUrl("abc")).toBe("/api/media/abc");
    expect(mediaUrl("abc", true)).toBe("/api/media/abc?thumb=1");
  });
});

describe("uploadToTarget", () => {
  it("PUT direto na rota local; 413 vira mensagem de tamanho", async () => {
    const calls: Array<{ url: string; method?: string }> = [];
    vi.stubGlobal("fetch", (url: string | URL, init?: RequestInit) => {
      calls.push({ url: String(url), method: init?.method });
      return Promise.resolve(new Response(null, { status: 413 }));
    });
    const file = new File([new Uint8Array(10)], "a.png", { type: "image/png" });
    await expect(uploadToTarget("asset-1", { mode: "direct" }, file)).rejects.toThrow(
      /grande demais/,
    );
    expect(calls[0]).toEqual({ url: "/api/media/upload/asset-1", method: "PUT" });
  });

  it("presigned-put reenvia os headers assinados", async () => {
    let seen: { url: string; headers?: unknown } | null = null;
    vi.stubGlobal("fetch", (url: string | URL, init?: RequestInit) => {
      seen = { url: String(url), headers: init?.headers };
      return Promise.resolve(new Response(null, { status: 200 }));
    });
    const file = new File([new Uint8Array(10)], "a.png", { type: "image/png" });
    await uploadToTarget(
      "asset-2",
      {
        mode: "presigned-put",
        url: "https://bucket.example/staging/asset-2?sig=x",
        headers: { "Content-Type": "image/png" },
        expiresAt: new Date().toISOString(),
      },
      file,
    );
    expect(seen).toEqual({
      url: "https://bucket.example/staging/asset-2?sig=x",
      headers: { "Content-Type": "image/png" },
    });
  });
});

describe("waitForProcessing", () => {
  function stubStatusSequence(statuses: string[]) {
    let i = 0;
    vi.stubGlobal("fetch", () => {
      const status = statuses[Math.min(i, statuses.length - 1)];
      i += 1;
      return Promise.resolve(
        new Response(JSON.stringify({ status }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    });
  }

  it("resolve 'ready' quando o worker termina", async () => {
    stubStatusSequence(["pending", "validating", "ready"]);
    await expect(
      waitForProcessing("a", { intervalMs: 1, maxAttempts: 10 }),
    ).resolves.toBe("ready");
  });

  it("resolve 'failed' quando a validação rejeita", async () => {
    stubStatusSequence(["validating", "failed"]);
    await expect(
      waitForProcessing("a", { intervalMs: 1, maxAttempts: 10 }),
    ).resolves.toBe("failed");
  });

  it("resolve 'timeout' após maxAttempts sem desfecho", async () => {
    stubStatusSequence(["validating"]);
    await expect(
      waitForProcessing("a", { intervalMs: 1, maxAttempts: 3 }),
    ).resolves.toBe("timeout");
  });

  it("tolera falha transitória de rede e continua o poll", async () => {
    let i = 0;
    vi.stubGlobal("fetch", () => {
      i += 1;
      if (i === 1) return Promise.reject(new Error("rede caiu"));
      return Promise.resolve(
        new Response(JSON.stringify({ status: "ready" }), { status: 200 }),
      );
    });
    await expect(
      waitForProcessing("a", { intervalMs: 1, maxAttempts: 5 }),
    ).resolves.toBe("ready");
  });
});
