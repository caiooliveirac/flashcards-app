# Checklist manual — mobile real (aceite F2#4)

Executar em **iOS Safari** e **Android Chrome** reais (não emulador) após cada
mudança relevante no editor. Marcar data/dispositivo/resultado.

Pré-requisito: usuário de teste logado em `https://flashcards.mnrs.com.br`.

## Upload de imagem

1. [ ] Galeria: em "Adicionar cards", tocar no botão de imagem da toolbar →
   input de arquivo → escolher foto da galeria → imagem aparece no editor e
   fica nítida (`ready`) em poucos segundos.
2. [ ] Print do clipboard (Android): tirar print → copiar → colar no editor
   (menu de contexto Colar) → imagem inserida.
3. [ ] Print do clipboard (iOS): tirar print → copiar na miniatura → tocar e
   segurar no editor → Colar → imagem inserida.
4. [ ] Arquivo acima de 10 MB é rejeitado com mensagem clara ANTES de subir.

## Editor com teclado virtual (R10 / issue Tiptap #6571)

5. [ ] Toolbar permanece visível e utilizável com o teclado aberto (sticky
   bottom, sem flutuar no meio da tela).
6. [ ] Tocar em botão da toolbar NÃO fecha o teclado nem perde a seleção
   (iOS Safari: bold/highlight aplicam na seleção feita por toque).
7. [ ] Modo "Ocultar trecho": selecionar palavra por toque → botão de ocultar
   da toolbar cria a ocultação; preview de N cards atualiza.
8. [ ] Sem double-scroll: a página não "pula" ao focar o editor.

## Fluxo geral

9. [ ] Criar card básico completo só no touch (frente, verso, salvar) e ver
   o card na lista do deck.
10. [ ] Busca no detalhe do deck funciona e o resultado é tocável.

| Data | Dispositivo/OS/Browser | Itens falhos | Notas |
|---|---|---|---|
|  |  |  |  |
