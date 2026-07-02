import { Vector3 } from 'three'
import type { SelectionBounds } from '../hooks/useRectangleSelection'

export const WGS84_RADIUS = 6378137

export interface EnuAxes {
  east: Vector3
  north: Vector3
  up: Vector3
}

export function latLonToEcef(latDeg: number, lonDeg: number, height = 0): Vector3 {
  const lat = (latDeg * Math.PI) / 180
  const lon = (lonDeg * Math.PI) / 180
  const r = WGS84_RADIUS + height
  return new Vector3(
    r * Math.cos(lat) * Math.cos(lon),
    r * Math.cos(lat) * Math.sin(lon),
    r * Math.sin(lat),
  )
}

export function ecefToEnuAxes(latDeg: number, lonDeg: number): EnuAxes {
  const lat = (latDeg * Math.PI) / 180
  const lon = (lonDeg * Math.PI) / 180
  const up = new Vector3(Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat))
  const east = new Vector3(-Math.sin(lon), Math.cos(lon), 0)
  const north = new Vector3().crossVectors(up, east).normalize()
  return { east, north, up }
}

export function ecefToEnuPoint(ecef: Vector3, centerEcef: Vector3, axes: EnuAxes): Vector3 {
  const d = ecef.clone().sub(centerEcef)
  // Return ENU aligned with Three.js Y-up: x=east, y=up, z=-north
  // (Three.js forward is -Z, so north maps to -Z to keep right-handed)
  return new Vector3(
    d.dot(axes.east),
    d.dot(axes.up),
    -d.dot(axes.north),
  )
}

export function getSelectionCenter(bounds: SelectionBounds): { lon: number; lat: number } {
  return {
    lon: (bounds.west + bounds.east) / 2,
    lat: (bounds.south + bounds.north) / 2,
  }
}

export function getSelectionSizeMeters(bounds: SelectionBounds): { width: number; height: number } {
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const width = toRad(bounds.east - bounds.west) * 6371000
  const height = toRad(bounds.north - bounds.south) * 6371000
  return { width, height }
}
