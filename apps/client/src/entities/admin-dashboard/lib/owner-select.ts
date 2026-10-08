export const OWNER_PLACEHOLDER = '— escolher parceiro —'

/**
 * O select do dono do curso: o valor selecionado e o texto da opção vazia. Dono que está nas opções aparece como a opção
 * dele, e a vazia só convida a escolher (com o nome também na vazia, o mesmo nome aparecia duas vezes na lista). Dono que
 * não está nas opções (perdeu o papel de parceiro, ou a lista ainda carrega) não tem opção própria: a vazia leva o nome atual.
 */
export function ownerSelect(
  course: { instructorId: string | null; instructorName: string | null },
  ownerUids: readonly string[]
): { value: string; emptyLabel: string } {
  const dono = course.instructorId
  if (dono !== null && ownerUids.includes(dono)) return { value: dono, emptyLabel: OWNER_PLACEHOLDER }
  return { value: '', emptyLabel: course.instructorName ?? OWNER_PLACEHOLDER }
}
