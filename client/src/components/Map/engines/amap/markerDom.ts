/**
 * DOM builders for the AMap engine's markers — ports of the Leaflet/GL marker
 * visuals (photo circle + category-coloured ring + day-order badge), mounted
 * through Marker.setContent instead of a map library's own element API.
 *
 * Built with createElement/textContent, never HTML strings: cluster re-renders
 * swap these elements constantly, and no user-derived value may travel through
 * markup (docs/amap/00-constraints.md, 渲染安全). The one innerHTML below
 * carries the category icon, which is TREK's own generated SVG — never user
 * content. Colors stay literal like the sibling renderers: these elements live
 * inside injected map HTML where CSS variables cannot reach.
 */
import { createElement } from 'react'
import { renderIconMarkup } from '../../../../utils/iconMarkup'
import { CATEGORY_ICON_MAP } from '../../../shared/categoryIcons'
import { safeHexColor } from '../../../../utils/safeColor'
import type { Place } from '../../../../types'

function categoryIconSvg(iconName: string | null | undefined, size: number): string {
  const IconComponent = (iconName && CATEGORY_ICON_MAP[iconName]) || CATEGORY_ICON_MAP['MapPin']
  try {
    return renderIconMarkup(createElement(IconComponent, { size, color: 'white', strokeWidth: 2.5 }))
  } catch {
    return ''
  }
}

/** Same allow-list as the Leaflet/GL builders: only these origins render as a photo. */
function isRenderablePhoto(photoUrl: string | null): photoUrl is string {
  return (
    !!photoUrl
    && (photoUrl.startsWith('data:') || photoUrl.startsWith('/api/maps/place-photo/') || photoUrl.startsWith('/uploads/'))
  )
}

export function buildPlaceMarkerElement(
  place: Place & { category_color?: string; category_icon?: string },
  photoUrl: string | null,
  orderNumbers: number[] | null,
  selected: boolean,
): HTMLDivElement {
  const size = selected ? 44 : 36
  const borderColor = selected ? '#111827' : safeHexColor(place.category_color, 'white')
  const borderWidth = selected ? 3 : 2.5
  const shadow = selected
    ? '0 0 0 3px rgba(17,24,39,0.25), 0 4px 14px rgba(0,0,0,0.3)'
    : '0 2px 8px rgba(0,0,0,0.22)'
  const bgColor = safeHexColor(place.category_color, '#6b7280')
  // The visual circle is size + 2*border per side (see MapViewGL): the wrapper
  // has to be the full outer size or the border bleeds outside the anchor.
  const outer = size + borderWidth * 2

  const wrap = document.createElement('div')
  wrap.className = 'trek-amap-marker'
  wrap.style.cssText = `width:${outer}px;height:${outer}px;cursor:pointer;position:relative;`

  const circle = document.createElement('div')
  circle.style.cssText = [
    'position:absolute;left:50%;top:50%;transform:translate(-50%,-50%)',
    `width:${size}px;height:${size}px;border-radius:50%`,
    `border:${borderWidth}px solid ${borderColor}`,
    `box-shadow:${shadow}`,
    `background:${bgColor}`,
    isRenderablePhoto(photoUrl) ? 'overflow:hidden' : 'display:flex;align-items:center;justify-content:center',
    'box-sizing:content-box',
  ].join(';')
  if (isRenderablePhoto(photoUrl)) {
    const img = document.createElement('img')
    img.src = photoUrl
    img.width = size
    img.height = size
    img.alt = ''
    img.style.cssText = 'display:block;border-radius:50%;object-fit:cover;'
    circle.appendChild(img)
  } else {
    const icon = document.createElement('span')
    icon.innerHTML = categoryIconSvg(place.category_icon, selected ? 18 : 15)
    circle.appendChild(icon)
  }
  wrap.appendChild(circle)

  if (orderNumbers && orderNumbers.length > 0) {
    const badge = document.createElement('span')
    badge.textContent = orderNumbers.join(' · ')
    badge.style.cssText = [
      'position:absolute;bottom:-2px;right:-2px',
      `min-width:18px;height:${orderNumbers.length > 1 ? 16 : 18}px`,
      `border-radius:${orderNumbers.length > 1 ? 8 : 9}px`,
      `padding:0 ${orderNumbers.length > 1 ? 4 : 3}px`,
      'background:rgba(255,255,255,0.94)',
      'border:1.5px solid rgba(0,0,0,0.15)',
      'box-shadow:0 1px 4px rgba(0,0,0,0.18)',
      'display:flex;align-items:center;justify-content:center',
      `font-size:${orderNumbers.length > 1 ? 7.5 : 9}px;font-weight:800;color:#111827`,
      'font-family:var(--font-system);line-height:1',
      'box-sizing:border-box;white-space:nowrap',
    ].join(';')
    wrap.appendChild(badge)
  }

  return wrap
}

/** GL-styled cluster bubble: dark disc, white ring, white count. */
export function buildClusterBubbleElement(count: number): HTMLDivElement {
  const size = count < 10 ? 36 : count < 50 ? 42 : 48
  const el = document.createElement('div')
  el.className = 'trek-amap-cluster'
  el.style.cssText = [
    `width:${size}px;height:${size}px;border-radius:50%`,
    'background:rgba(17,24,39,0.97)',
    'border:2.5px solid rgba(255,255,255,0.9)',
    'box-shadow:0 2px 8px rgba(0,0,0,0.3)',
    'display:flex;align-items:center;justify-content:center',
    'color:#ffffff;font-weight:800;font-size:12px;font-family:var(--font-system)',
    'box-sizing:border-box',
  ].join(';')
  el.textContent = String(count)
  return el
}
