/**
 * Carga horária que o certificado imprime: a definida no curso vence a soma da duração das aulas.
 *
 * É a fonte ÚNICA da regra. A emissão do certificado usa esta função para imprimir, e a primeira
 * aprovação do curso a usa para gravar o resultado em `courses.workload_hours`: assim a carga
 * calculada passa a ser um dado do curso, sob a trava dos dados do certificado, e mexer nas aulas
 * depois da aprovação deixa de mudar o número impresso.
 *
 * O fallback existe porque a soma é como sempre funcionou, e continua valendo para curso que ninguém
 * configurou. `Math.max(1, ...)` porque certificado com "0 horas" é pior que um arredondado para cima.
 *
 * @param declared horas definidas no curso (`workload_hours`). null, undefined, 0 ou negativo contam como "não definida".
 * @param lessonsDurationSec soma da duração das aulas do curso (`lessons.duration_sec`), em segundos.
 */
export function certificateWorkloadHours(declared: number | null | undefined, lessonsDurationSec: number): number {
  if (declared != null && declared > 0) return declared
  return Math.max(1, Math.round(lessonsDurationSec / 3600))
}
