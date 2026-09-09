import { describe, it, expect } from 'vitest'
import { categoryLabel } from './categoryNames'

const t = (key: string) => `T:${key}`

describe('categoryLabel', () => {
  it('translates the seeded built-in category names', () => {
    expect(categoryLabel('Hotel', t)).toBe('T:categories.builtin.hotel')
    expect(categoryLabel('Restaurant', t)).toBe('T:categories.builtin.restaurant')
    expect(categoryLabel('Bar/Cafe', t)).toBe('T:categories.builtin.barcafe')
    expect(categoryLabel('Other', t)).toBe('T:categories.builtin.other')
  })

  it('passes through user-created and renamed categories', () => {
    expect(categoryLabel('My Secret Spots', t)).toBe('My Secret Spots')
    // A renamed built-in is indistinguishable from a custom one — shown as-is.
    expect(categoryLabel('Hotel (fav)', t)).toBe('Hotel (fav)')
  })

  it('renders empty for a missing name', () => {
    expect(categoryLabel(null, t)).toBe('')
    expect(categoryLabel(undefined, t)).toBe('')
    expect(categoryLabel('', t)).toBe('')
  })
})
