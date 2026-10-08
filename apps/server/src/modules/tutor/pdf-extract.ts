import { PDFParse } from 'pdf-parse'

/** Texto cru de um PDF (sem OCR: PDF escaneado sai vazio). Isolado aqui para os testes não carregarem o pdfjs. */
export async function extrairTextoPdf(pdf: Buffer): Promise<string> {
  const parser = new PDFParse({ data: new Uint8Array(pdf) })
  try {
    return (await parser.getText()).text
  } finally {
    await parser.destroy()
  }
}
