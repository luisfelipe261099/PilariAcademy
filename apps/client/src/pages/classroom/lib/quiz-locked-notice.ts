/**
 * Aviso de tentativas esgotadas na prova do módulo. Quem libera novas tentativas é o professor do curso ou o admin do
 * polo. Na matriz, a equipe do Studio Pilari atende o aluno; nos polos ela não atende, então o aviso manda falar com o
 * professor ou com o polo. É o mesmo critério e as mesmas palavras do servidor (QuizService.submit). A mensagem do
 * servidor só chegaria numa tentativa de envio, e a tela já trava o envio quando `locked`: o aluno lê este texto.
 */
export function quizLockedNotice(isMatriz: boolean): string {
  return isMatriz
    ? 'Tentativas esgotadas — fale com o Studio Pilari para liberar novas tentativas.'
    : 'Tentativas esgotadas — fale com o professor do curso ou com o seu polo para liberar novas tentativas.'
}
