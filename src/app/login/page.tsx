import { redirect } from "next/navigation";
import { AuthError } from "next-auth";
import { auth, isGoogleEnabled, signIn } from "@/lib/auth";

async function credentialsLogin(formData: FormData): Promise<void> {
  "use server";
  try {
    await signIn("credentials", {
      username: formData.get("username"),
      password: formData.get("password"),
      redirectTo: "/",
    });
  } catch (err) {
    if (err instanceof AuthError) {
      redirect("/login?error=1");
    }
    throw err; // NEXT_REDIRECT do sucesso passa por aqui
  }
}

async function googleLogin(): Promise<void> {
  "use server";
  await signIn("google", { redirectTo: "/" });
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await auth();
  if (session?.user) {
    redirect("/");
  }
  const { error } = await searchParams;

  return (
    <main className="flex min-h-dvh items-center justify-center p-6">
      <div className="w-full max-w-sm rounded-xl border border-border bg-card p-8 text-card-foreground shadow-sm">
        <h1 className="text-2xl font-semibold">Flashcards</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Estude com revisão espaçada. Entre para começar.
        </p>

        {error ? (
          <p
            role="alert"
            className="mt-4 rounded-md border border-destructive px-3 py-2 text-sm text-destructive"
          >
            Usuário ou senha incorretos.
          </p>
        ) : null}

        <form className="mt-6 space-y-3" action={credentialsLogin}>
          <div>
            <label htmlFor="username" className="mb-1 block text-sm font-medium">
              Usuário
            </label>
            <input
              id="username"
              name="username"
              required
              autoComplete="username"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 outline-offset-2 focus-visible:outline-2 focus-visible:outline-ring"
            />
          </div>
          <div>
            <label htmlFor="password" className="mb-1 block text-sm font-medium">
              Senha
            </label>
            <input
              id="password"
              name="password"
              type="password"
              required
              autoComplete="current-password"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 outline-offset-2 focus-visible:outline-2 focus-visible:outline-ring"
            />
          </div>
          <button
            type="submit"
            className="w-full rounded-lg bg-primary px-4 py-2.5 font-medium text-primary-foreground outline-offset-2 transition-colors hover:opacity-90 focus-visible:outline-2 focus-visible:outline-ring"
          >
            Entrar
          </button>
        </form>

        {isGoogleEnabled() ? (
          <form className="mt-3" action={googleLogin}>
            <button
              type="submit"
              className="w-full rounded-lg border border-border px-4 py-2.5 font-medium outline-offset-2 hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
            >
              Entrar com Google
            </button>
          </form>
        ) : null}
      </div>
    </main>
  );
}
