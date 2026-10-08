/// <reference types="jest" />
import { NotFoundException } from '@nestjs/common'
import type { TenantBranding } from '@pilari/types'
import { EMPTY_BRANDING } from '../tenancy/branding'
import type { TenantContext } from '../tenancy/tenant-context'
import { createCanvas } from '@napi-rs/canvas'
import { AppIconService } from './app-icon.service'
import { TenantPublicController } from './tenant-public.controller'

const polo = (branding: Partial<TenantBranding> = {}): TenantContext => ({
  id: 't-a', slug: 'polo-a', name: 'Polo A', isMatriz: false, status: 'active',
  branding: { ...EMPTY_BRANDING, ...branding }, updatedAt: new Date('2026-10-01T12:00:00Z'),
})

type FakeRes = { set: jest.Mock; send: jest.Mock; redirect: jest.Mock }

function makeRes() {
  const headers: Record<string, string> = {}
  const res: FakeRes = {
    set: jest.fn((k: string, v: string) => {
      headers[k] = v
      return res
    }),
    send: jest.fn(() => res),
    redirect: jest.fn(() => res),
  }
  return { res, headers }
}

function make(objeto: { buffer: Buffer; contentType: string } | null = null) {
  const readObject = jest.fn(async () => objeto)
  const gcs = { readObject } as never
  return { controller: new TenantPublicController(gcs, new AppIconService(gcs)), readObject }
}

const PNG = { buffer: Buffer.from('\x89PNG'), contentType: 'image/png' }
/** O `?v=` que a URL pública leva: a versão do polo (updatedAt em ms). */
const VERSAO = String(polo().updatedAt.getTime())

describe('TenantPublicController.asset', () => {
  it('objeto do bucket em PNG sai inline, com cache longo para a versão atual, e lê exatamente o caminho do polo', async () => {
    const { controller, readObject } = make(PNG)
    const { res, headers } = makeRes()
    await controller.asset(polo({ logoUrl: 'polos/t-a/marca/logo-1-a.png' }), 'logo', VERSAO, res as never)
    expect(readObject).toHaveBeenCalledWith('polos/t-a/marca/logo-1-a.png', { maxBytes: 5 * 1024 * 1024 })
    expect(headers['Content-Type']).toBe('image/png')
    expect(headers['Content-Disposition']).toBeUndefined()
    expect(headers['Cache-Control']).toBe('public, max-age=604800')
    expect(res.send).toHaveBeenCalledWith(PNG.buffer)
  })

  describe('cache da imagem do bucket', () => {
    const servida = async (versao: unknown) => {
      const { controller } = make(PNG)
      const { res, headers } = makeRes()
      await controller.asset(polo({ logoUrl: 'polos/t-a/marca/logo-1-a.png' }), 'logo', versao as string | undefined, res as never)
      expect(res.send).toHaveBeenCalledWith(PNG.buffer)
      expect(headers['Content-Type']).toBe('image/png')
      return headers['Cache-Control']
    }

    it('só a URL com a versão atual do polo (?v=<updatedAt em ms>) ganha o cache de uma semana', async () => {
      expect(await servida(VERSAO)).toBe('public, max-age=604800')
    })

    it.each([
      ['sem ?v', undefined],
      ['?v vazio', ''],
      ['versão de antes da troca da marca', String(polo().updatedAt.getTime() - 1)],
      ['versão de depois', String(polo().updatedAt.getTime() + 1)],
      ['lixo', 'abc'],
      ['?v repetido (vira lista)', [VERSAO, VERSAO]],
    ])('%s: a imagem sai, mas o cache é de um minuto', async (_caso, versao) => {
      expect(await servida(versao)).toBe('public, max-age=60')
    })

    it('a versão é a do polo que pediu: a de outro polo não vale', async () => {
      const outro = { ...polo({ logoUrl: 'polos/t-a/marca/logo-1-a.png' }), updatedAt: new Date('2026-10-02T08:00:00Z') }
      const { controller } = make(PNG)
      const { res, headers } = makeRes()
      await controller.asset(outro, 'logo', VERSAO, res as never)
      expect(headers['Cache-Control']).toBe('public, max-age=60')
    })
  })

  it.each(['image/svg+xml', 'text/html', 'application/octet-stream'])('%s no bucket vira download (anti-XSS na origem do app)', async (tipo) => {
    const { controller } = make({ buffer: Buffer.from('<svg onload=alert(1)>'), contentType: tipo })
    const { res, headers } = makeRes()
    await controller.asset(polo({ logoUrl: 'polos/t-a/marca/logo-1-a.svg' }), 'logo', VERSAO, res as never)
    expect(headers['Content-Type']).toBe('application/octet-stream')
    expect(headers['Content-Disposition']).toBe('attachment')
  })

  it('cada tipo lê o próprio campo da marca', async () => {
    const marca = {
      logoUrl: 'polos/t-a/marca/logo-1-a.png',
      logoLightUrl: 'polos/t-a/marca/logo-light-2-b.png',
      faviconUrl: 'polos/t-a/marca/favicon-3-c.png',
    }
    for (const [kind, caminho] of [['logo', marca.logoUrl], ['logo-light', marca.logoLightUrl], ['favicon', marca.faviconUrl]] as const) {
      const { controller, readObject } = make(PNG)
      await controller.asset(polo(marca), kind, VERSAO, makeRes().res as never)
      expect(readObject).toHaveBeenCalledWith(caminho, { maxBytes: 5 * 1024 * 1024 })
    }
  })

  it('URL externa redireciona, sem ler o bucket', async () => {
    const { controller, readObject } = make(PNG)
    const { res, headers } = makeRes()
    await controller.asset(polo({ faviconUrl: 'https://cdn.exemplo.com/f.png' }), 'favicon', VERSAO, res as never)
    expect(res.redirect).toHaveBeenCalledWith(302, 'https://cdn.exemplo.com/f.png')
    expect(headers['Cache-Control']).toBe('public, max-age=3600')
    expect(readObject).not.toHaveBeenCalled()
    expect(res.send).not.toHaveBeenCalled()
  })

  it('tipo desconhecido e campo vazio respondem 404 sem tocar no bucket', async () => {
    const { controller, readObject } = make(PNG)
    const { res } = makeRes()
    await expect(controller.asset(polo({ logoUrl: 'polos/t-a/marca/a.png' }), 'qualquer', VERSAO, res as never)).rejects.toThrow(NotFoundException)
    await expect(controller.asset(polo({ logoUrl: 'polos/t-a/marca/a.png' }), 'logo-light', VERSAO, res as never)).rejects.toThrow(NotFoundException)
    await expect(controller.asset(polo(), 'logo', VERSAO, res as never)).rejects.toThrow(NotFoundException)
    expect(readObject).not.toHaveBeenCalled()
  })

  it('objeto ausente no bucket responde 404', async () => {
    const { controller } = make(null)
    await expect(controller.asset(polo({ logoUrl: 'polos/t-a/marca/sumiu.png' }), 'logo', VERSAO, makeRes().res as never)).rejects.toThrow(NotFoundException)
  })

  it.each([
    'polos/t-b/marca/logo-1-a.png',
    'polos/t-a/marca/../../t-b/marca/logo-1-a.png',
    'polos/t-a/outra-pasta/logo.png',
    'cursos/c1/video/aula.mp4',
    '/etc/passwd',
  ])('caminho fora da pasta da marca do polo (%s) responde 404 sem ler o bucket', async (caminho) => {
    const { controller, readObject } = make(PNG)
    await expect(controller.asset(polo({ logoUrl: caminho }), 'logo', VERSAO, makeRes().res as never)).rejects.toThrow(NotFoundException)
    expect(readObject).not.toHaveBeenCalled()
  })
})

/** Largura e altura gravadas no cabeçalho IHDR de um PNG. */
const ladoDoPng = (b: Buffer) => [b.readUInt32BE(16), b.readUInt32BE(20)]

describe('TenantPublicController: app (PWA)', () => {
  it('manifesto do polo: JSON de manifesto, sem cache longo, com nome, cor e ícones versionados do polo', () => {
    const { controller } = make()
    const { res, headers } = makeRes()
    controller.manifesto(polo({ primaryColor: '#123456' }), res as never)
    expect(headers['Content-Type']).toBe('application/manifest+json; charset=utf-8')
    expect(headers['Cache-Control']).toBe('no-cache')
    const m = JSON.parse(res.send.mock.calls[0][0] as string)
    expect(m).toMatchObject({ name: 'Polo A', short_name: 'Polo A', theme_color: '#123456', display: 'standalone', start_url: '/dashboard' })
    expect(m.icons.map((i: { src: string }) => i.src)).toEqual([
      `/api/tenant/app-icon/any-192?v=${VERSAO}`,
      `/api/tenant/app-icon/any-512?v=${VERSAO}`,
      `/api/tenant/app-icon/maskable-512?v=${VERSAO}`,
    ])
  })

  it('ícone da matriz: redireciona para o PNG fixo do "F"', async () => {
    const { controller, readObject } = make()
    const { res } = makeRes()
    await controller.iconeDoApp({ ...polo(), isMatriz: true }, 'apple-180', undefined, res as never)
    expect(res.redirect).toHaveBeenCalledWith(302, '/icons/pilari-apple-180.png')
    expect(readObject).not.toHaveBeenCalled()
  })

  it('ícone do polo com favicon no bucket: PNG no tamanho pedido, desenhado a partir da marca do polo', async () => {
    const quadrado = createCanvas(64, 64)
    quadrado.getContext('2d').fillRect(0, 0, 64, 64)
    const { controller, readObject } = make({ buffer: await quadrado.encode('png'), contentType: 'image/png' })
    const { res, headers } = makeRes()
    await controller.iconeDoApp(polo({ faviconUrl: 'polos/t-a/marca/favicon-1.png' }), 'maskable-512', VERSAO, res as never)
    expect(readObject).toHaveBeenCalledWith('polos/t-a/marca/favicon-1.png', { maxBytes: 5 * 1024 * 1024 })
    expect(headers['Content-Type']).toBe('image/png')
    expect(headers['Cache-Control']).toBe('public, max-age=604800')
    expect(ladoDoPng(res.send.mock.calls[0][0] as Buffer)).toEqual([512, 512])
  })

  it('favicon externo (https) não é buscado pelo servidor: o ícone sai com a inicial do polo', async () => {
    const { controller, readObject } = make()
    const { res } = makeRes()
    await controller.iconeDoApp(polo({ faviconUrl: 'https://exemplo.com/f.png' }), 'any-192', undefined, res as never)
    expect(readObject).not.toHaveBeenCalled()
    expect(ladoDoPng(res.send.mock.calls[0][0] as Buffer)).toEqual([192, 192])
  })

  it('variante desconhecida → 404', async () => {
    const { controller } = make()
    const { res } = makeRes()
    await expect(controller.iconeDoApp(polo(), '1024', undefined, res as never)).rejects.toBeInstanceOf(NotFoundException)
  })
})

