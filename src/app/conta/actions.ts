"use server";

import { auth } from "@/lib/auth";
import {
  changeOwnPassword,
  type ChangePasswordError,
} from "@/features/account/service";
import { MIN_PASSWORD_LENGTH } from "@/features/account/constants";

export interface ChangePasswordState {
  status: "idle" | "success" | "error";
  message?: string;
}

const ERROR_MESSAGES: Record<ChangePasswordError, string> = {
  wrong_current: "A senha atual não confere. Tente de novo.",
  too_short: `A nova senha precisa ter pelo menos ${MIN_PASSWORD_LENGTH} caracteres.`,
  same_as_current: "A nova senha precisa ser diferente da atual.",
  no_password: "Esta conta não usa senha. Fale com o administrador.",
};

export async function changePasswordAction(
  _prev: ChangePasswordState,
  formData: FormData,
): Promise<ChangePasswordState> {
  const session = await auth();
  if (!session?.user?.id) {
    return { status: "error", message: "Sessão expirada. Entre de novo." };
  }

  const currentPassword = String(formData.get("currentPassword") ?? "");
  const newPassword = String(formData.get("newPassword") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");

  if (!currentPassword || !newPassword) {
    return { status: "error", message: "Preencha todos os campos." };
  }
  if (newPassword !== confirmPassword) {
    return { status: "error", message: "A confirmação não bate com a nova senha." };
  }

  const result = await changeOwnPassword(session.user.id, currentPassword, newPassword);
  if (!result.ok) {
    return { status: "error", message: ERROR_MESSAGES[result.error] };
  }
  return { status: "success", message: "Senha alterada. Ela já vale no próximo acesso." };
}
