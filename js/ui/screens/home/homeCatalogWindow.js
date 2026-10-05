// Catalog descriptors in Home display order, without catalogs hidden on Home.
export function orderHomeCatalogDescriptors(
  descriptors = [],
  { orderedKeys = [], disabledKeys = [] } = {}
) {
  const disabled = new Set(disabledKeys);
  const positionByKey = new Map(orderedKeys.map((key, index) => [key, index]));
  const positionOf = (descriptor) =>
    positionByKey.has(descriptor.homeCatalogKey)
      ? positionByKey.get(descriptor.homeCatalogKey)
      : orderedKeys.length;
  return descriptors
    .filter(
      (descriptor) =>
        !disabled.has(descriptor.homeCatalogKey) && !disabled.has(descriptor.homeCatalogDisableKey)
    )
    .map((descriptor, index) => ({ descriptor, index }))
    .sort(
      (left, right) =>
        positionOf(left.descriptor) - positionOf(right.descriptor) || left.index - right.index
    )
    .map(({ descriptor }) => descriptor);
}

// The first rows Home requests, plus the catalogs the hero draws from.
export function initialHomeCatalogDescriptors(
  ordered = [],
  { count = 0, heroCatalogKeys = [] } = {}
) {
  const heroKeys = new Set(heroCatalogKeys);
  return ordered.filter(
    (descriptor, index) => index < count || heroKeys.has(descriptor.homeCatalogKey)
  );
}

// How many display-ordered catalogs Home needs: every catalog row through the
// focused one, and the rows the user can reach next.
export function homeCatalogWindowTarget(rows = [], focusedRowKey = "", preloadRows = 0) {
  const focusedIndex = rows.findIndex((row) => row?.homeCatalogKey === focusedRowKey);
  const catalogsThroughFocus =
    focusedIndex >= 0
      ? rows.slice(0, focusedIndex + 1).filter((row) => row?.rowKind !== "collection").length
      : 0;
  return catalogsThroughFocus + preloadRows;
}
