import { describe, expect, it } from 'vitest'
import { nearestPlace, placeLabel, placesInBox } from '@core/geo/places'

describe('offline place names', () => {
  it('finds the nearest town, villages included', () => {
    expect(placeLabel(38.7223, -9.1393)).toBe('Lisbon, Portugal')
    expect(nearestPlace(0, -30)).toBeNull() // mid-Atlantic
    // Trip names skip villages: the nearest town of at least 5,000 people.
    expect(nearestPlace(45.4793, 10.9091)?.city).toBe('Settimo') // a village of 1,600 near Verona
    const town = nearestPlace(45.4793, 10.9091, 30, 5000)
    expect(town?.city).toBeTruthy()
    expect(town?.city).not.toBe('Settimo')
  })

  it('lists the biggest towns in a map view for labels', () => {
    const europe = placesInBox(35, -10, 60, 30, 3e6, 50).map((p) => p.name)
    expect(europe).toEqual(expect.arrayContaining(['London', 'Madrid', 'Berlin']))
    expect(europe).not.toContain('Lisbon') // under 3 million
    // Across the antimeridian (west > east).
    expect(placesInBox(-50, 160, -30, -170, 1e5, 20).map((p) => p.name)).toContain('Auckland')
  })
})
