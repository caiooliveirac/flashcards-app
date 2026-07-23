/**
 * Constantes da conta compartilhadas entre client e server. SEM imports de
 * servidor (db/pg) aqui — este módulo entra no bundle do browser via o
 * formulário de troca de senha.
 */

/** Piso de senha para a troca self-service (admin ainda aceita 4, provisório). */
export const MIN_PASSWORD_LENGTH = 6;
