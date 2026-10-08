/// <reference types="jest" />
import { NotFoundException } from '@nestjs/common'
import { createDrizzleMock, withQueryResults, type DrizzleMock } from '../../__test-utils__/drizzle-mock'
import { allWheres } from '../../__test-utils__/sql'
import { CategoriesService } from './categories.service'

function make() {
  const db: DrizzleMock = createDrizzleMock()
  const service = new CategoriesService(db as never)
  return { db, service }
}

describe('CategoriesService', () => {
  it('lista categorias mapeadas para o contrato público', async () => {
    const { db, service } = make()
    withQueryResults(db, [
      { id: '1', name: 'Tecnologia', slug: 'tecnologia', createdAt: new Date(), updatedAt: new Date() },
    ])
    const result = await service.list('t-a')
    expect(result).toEqual([{ id: '1', name: 'Tecnologia', slug: 'tecnologia' }])
  })

  it('cria categoria gerando slug a partir do nome', async () => {
    const { db, service } = make()
    withQueryResults(
      db,
      [], // uniqueSlug: nenhuma colisão de slug
      undefined, // resultado do insert (ignorado pelo service)
      [{ id: 'x', name: 'Gestão & Negócios', slug: 'gestao-negocios', createdAt: new Date(), updatedAt: new Date() }] // select pós-insert
    )
    const cat = await service.create('t-a', 'Gestão & Negócios')
    expect(cat.slug).toBe('gestao-negocios')
    expect(db.insert).toHaveBeenCalled()
  })

  it('update lança 404 quando a categoria não existe', async () => {
    const { db, service } = make()
    withQueryResults(db, []) // não encontrado
    await expect(service.update('t-a', 'nope', 'Novo')).rejects.toBeInstanceOf(NotFoundException)
  })

  it('list traz só as categorias do polo', async () => {
    const { db, service } = make()
    withQueryResults(db, [])
    await service.list('t-a')
    expect(allWheres(db.where)[0]).toEqual({ sql: '`categories`.`tenant_id` = ?', params: ['t-a'] })
  })

  it('create grava o polo e procura colisão de slug só nele', async () => {
    const { db, service } = make()
    withQueryResults(db, [], undefined, [{ id: 'x', tenantId: 't-a', name: 'Gestão', slug: 'gestao' }])
    await service.create('t-a', 'Gestão')
    expect(allWheres(db.where)[0].params).toEqual(['t-a', 'gestao'])
    expect(db.values).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 't-a', slug: 'gestao' }))
  })

  it('update e remove de categoria de outro polo respondem 404', async () => {
    const { db, service } = make()
    withQueryResults(db, [], [])
    await expect(service.update('t-a', 'cat-b', 'X')).rejects.toThrow(NotFoundException)
    await expect(service.remove('t-a', 'cat-b')).rejects.toThrow(NotFoundException)
  })
})
