import { redirect } from "next/navigation";
import { AuthError } from "next-auth";
import { BrandMark } from "@/components/site-header";
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
    <main className="flex min-h-dvh flex-col lg:flex-row">
      {/* Metade editorial: marca + manchete sobre memória/estudo. */}
      <section className="flex flex-col justify-center px-6 py-10 lg:w-1/2 lg:px-14 lg:py-16">
        <div className="mx-auto w-full max-w-xl">
          <BrandMark className="text-2xl!" />
          <h1 className="mt-6 max-w-xl text-[34px] leading-[1.05] font-extrabold tracking-tight text-balance sm:text-[44px] lg:mt-10 lg:text-[52px]">
            O que você estuda hoje volta na hora certa.
          </h1>
          <p className="mt-4 max-w-md text-muted-foreground">
            Revisão espaçada, sem ruído: cada cartão reaparece quando você está
            prestes a esquecer.
          </p>
        </div>
      </section>

      {/* Metade do formulário, separada por régua central (horizontal no mobile). */}
      <section className="flex flex-1 flex-col justify-center border-t-2 border-divider px-6 py-10 lg:w-1/2 lg:border-t-0 lg:border-l-2 lg:px-14 lg:py-16">
        <div className="mx-auto w-full max-w-sm">
          <p className="text-[11px] font-semibold tracking-[0.1em] uppercase text-muted-foreground">
            Acesso
          </p>

          {error ? (
            <p role="alert" className="mt-4 text-sm font-semibold text-primary-text">
              Usuário ou senha incorretos.
            </p>
          ) : null}

          <form className="mt-6 space-y-6" action={credentialsLogin}>
            <div>
              <label
                htmlFor="username"
                className="block text-[11px] font-semibold tracking-[0.1em] uppercase"
              >
                Usuário
              </label>
              <input
                id="username"
                name="username"
                required
                autoComplete="username"
                className="mt-2 block w-full border-0 border-b-2 border-divider bg-surface px-3 py-3"
              />
            </div>
            <div>
              <label
                htmlFor="password"
                className="block text-[11px] font-semibold tracking-[0.1em] uppercase"
              >
                Senha
              </label>
              <input
                id="password"
                name="password"
                type="password"
                required
                autoComplete="current-password"
                className="mt-2 block w-full border-0 border-b-2 border-divider bg-surface px-3 py-3"
              />
            </div>
            <button
              type="submit"
              className="min-h-12 w-full bg-primary px-4 font-semibold text-primary-foreground transition-colors hover:bg-primary-hover"
            >
              Entrar
            </button>
          </form>

          {isGoogleEnabled() ? (
            <form className="mt-3" action={googleLogin}>
              <button
                type="submit"
                className="min-h-12 w-full border border-divider px-4 font-semibold hover:bg-surface"
              >
                Entrar com Google
              </button>
            </form>
          ) : null}
        </div>
      </section>
    </main>
  );
}
