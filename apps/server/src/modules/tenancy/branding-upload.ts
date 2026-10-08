import { randomUUID } from 'node:crypto'
import { NotFoundException } from '@nestjs/common'
import type { BrandingAssetKind, UploadTicket } from '@pilari/types'
import type { GcsService } from '../classroom/gcs.service'

/** Só imagens inertes: SVG e HTML ficam de fora porque o proxy da marca é público e na mesma origem. */
export const BRANDING_UPLOAD_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const

export function brandingObjectPath(tenantId: string, kind: BrandingAssetKind, fileName: string, id: string = randomUUID()): string {
  const seguro = fileName.replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/\.{2,}/g, '.').slice(-80) || 'imagem'
  return `polos/${tenantId}/marca/${kind}-${id}-${seguro}`
}

export async function brandingUploadTicket(
  gcs: Pick<GcsService, 'signedUploadUrl'>,
  tenantId: string,
  input: { kind: BrandingAssetKind; fileName: string; contentType: string }
): Promise<UploadTicket> {
  const objectPath = brandingObjectPath(tenantId, input.kind, input.fileName)
  const uploadUrl = await gcs.signedUploadUrl(objectPath, input.contentType)
  if (!uploadUrl) throw new NotFoundException('Upload indisponível (GCS não configurado).')
  return { uploadUrl, objectPath }
}
