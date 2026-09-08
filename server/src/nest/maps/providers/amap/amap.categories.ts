/**
 * Pill category → AMap POI type codes.
 *
 * The keys are the client contract (POI_CATEGORIES in the client's
 * poiCategories.ts + CATEGORY_OSM_FILTERS here server-side) and must not
 * change — only the values are AMap-specific. AMap does not do OSM tags; it
 * filters by its own numeric POI type-code tree, so this table is an
 * approximation by design:
 *
 *   - 大类 codes (`050000`, three significant digits + zeros) select a whole
 *     branch and match the broad OSM selector lists;
 *   - 中类 codes select a narrower branch where the OSM list is narrow.
 *
 * Result density and coverage WILL differ from the Overpass path — that
 * difference is documented in docs/amap/poi-category-comparison.md, and the
 * final granularity is a product call, not an engineering one
 * (docs/amap/03-server-provider.md).
 */

/** AMap POI type-code selector: `|`-joined codes, as the `types` param takes them. */
export type AmapTypes = string;

export const CATEGORY_AMAP_TYPES: Record<string, AmapTypes> = {
  // 050000 餐饮服务 (the whole dining branch — restaurant + fast_food + more)
  restaurant: '050000',
  // 050500 咖啡厅 | 050600 茶艺馆
  cafe: '050500|050600',
  // 050700 酒吧 | 050800 康乐餐饮
  bar: '050700',
  // 100000 住宿服务 (hotel/hostel/guest-house/apartment/motel all collapse here)
  hotel: '100000',
  // 110000 风景名胜 (attraction/viewpoint/monument/castle/memorial/ruins)
  sights: '110000',
  // 140100 博物馆 | 140104 美术馆 | 140105 展览馆 (theatre is a different tree)
  museum: '140100|140104|140105',
  // 110100 公园 | 110200 街头公园 | 110300 城市广场 (parks/gardens; beaches/peaks
  // have no AMap equivalent and fall away — see the comparison report)
  nature: '110100|110200|110300',
  // 080000 体育休闲服务 (theme park/zoo/aquarium/water park)
  activity: '080000',
  // 060000 购物服务 (mall/department store/marketplace)
  shopping: '060000',
  // 060101 超市 | 060102 便利店
  supermarket: '060101|060102',
};

/** The type codes for a pill category, or null when the category is unknown. */
export function amapTypesForCategory(category: string): AmapTypes | null {
  return CATEGORY_AMAP_TYPES[category] ?? null;
}
