import { buildCollectionHomeKey } from "../../data/local/collectionsStore.js";
import { buildCatalogOrderKey } from "../addons/homeCatalogs.js";

export const HIDE_UNRELEASED_CONTENT_KEY = "hide_unreleased_content";

export function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function normalizeString(value) {
  return String(value ?? "").trim();
}

export function syncItemKey(item = {}) {
  if (item.is_collection || item.isCollection) {
    return buildCollectionHomeKey({
      id: item.collection_id ?? item.collectionId
    });
  }
  return buildCatalogOrderKey(
    item.addon_id ?? item.addonId,
    item.type,
    item.catalog_id ?? item.catalogId
  );
}

export function normalizeSyncItem(item = {}, fallbackOrder = 0) {
  const isCollection = Boolean(item.is_collection ?? item.isCollection);
  const order = Number(item.order);
  return {
    addon_id: normalizeString(item.addon_id ?? item.addonId),
    type: normalizeString(item.type).toLowerCase(),
    catalog_id: normalizeString(item.catalog_id ?? item.catalogId),
    enabled: item.enabled !== false,
    order: Number.isFinite(order) ? Math.trunc(order) : fallbackOrder,
    custom_title: normalizeString(item.custom_title ?? item.customTitle),
    is_collection: isCollection,
    collection_id: normalizeString(item.collection_id ?? item.collectionId)
  };
}

export function itemHasIdentity(item = {}) {
  if (item.is_collection) {
    return Boolean(item.collection_id);
  }
  return Boolean(item.addon_id && item.type && item.catalog_id);
}

export function payloadSignature(payload = {}) {
  return stableStringify({
    hide_unreleased_content: Boolean(payload.hide_unreleased_content),
    items: (payload.items || []).map((item) => ({
      key: syncItemKey(item),
      enabled: item.enabled !== false,
      order: Number(item.order || 0),
      custom_title: normalizeString(item.custom_title ?? item.customTitle)
    }))
  });
}

// The payload this device describes for its installed catalogs and
// collections: saved order first, then entries the saved order does not list.
export function composeLocalPayload({
  catalogEntries = [],
  collectionEntries = [],
  prefs = {},
  hideUnreleasedContent = false
} = {}) {
  const customTitles = prefs.customTitles || {};
  const entryByKey = new Map([
    ...catalogEntries.map((entry) => [entry.key, { ...entry, isCollection: false }]),
    ...collectionEntries.map((entry) => [entry.key, { ...entry, isCollection: true }])
  ]);
  const allKeys = [
    ...catalogEntries.map((entry) => entry.key),
    ...collectionEntries.map((entry) => entry.key)
  ];
  const savedValid = (prefs.order || []).filter(
    (key, index, array) => array.indexOf(key) === index && entryByKey.has(key)
  );
  const savedSet = new Set(savedValid);
  const mergedOrder = [...savedValid, ...allKeys.filter((key) => !savedSet.has(key))];
  const disabledSet = new Set(prefs.disabled || []);

  const items = mergedOrder
    .map((key, index) => {
      const entry = entryByKey.get(key);
      if (!entry) {
        return null;
      }
      if (entry.isCollection) {
        return {
          addon_id: "",
          type: "",
          catalog_id: "",
          enabled: !disabledSet.has(entry.key),
          order: index,
          custom_title: normalizeString(customTitles[entry.key]),
          is_collection: true,
          collection_id: entry.collectionId
        };
      }
      return {
        addon_id: entry.addonId,
        type: entry.type,
        catalog_id: entry.catalogId,
        enabled: !disabledSet.has(entry.disableKey) && !disabledSet.has(entry.key),
        order: index,
        custom_title: normalizeString(customTitles[entry.key]),
        is_collection: false,
        collection_id: ""
      };
    })
    .filter(Boolean);

  return {
    hide_unreleased_content: Boolean(hideUnreleasedContent),
    items
  };
}

// The Home catalog preferences a remote payload stores on this device. Entries
// the remote does not list follow in their local order; Home would otherwise
// append them in row-arrival order, which differs between launches.
export function homeCatalogPrefsFromPayload(payload = {}, localPayload = null) {
  const sortedItems = (payload.items || [])
    .map((item, index) => normalizeSyncItem(item, index))
    .filter(itemHasIdentity)
    .sort((left, right) => left.order - right.order);
  const remoteOrder = sortedItems.map((item) => syncItemKey(item)).filter(Boolean);
  const remoteKeys = new Set(remoteOrder);
  const localOnlyOrder = (localPayload?.items || [])
    .map((item) => syncItemKey(item))
    .filter((key) => key && !remoteKeys.has(key));
  const order = [...remoteOrder, ...localOnlyOrder];
  const disabled = sortedItems
    .filter((item) => item.enabled === false)
    .map((item) => syncItemKey(item))
    .filter(Boolean);
  const customTitles = sortedItems.reduce((accumulator, item) => {
    const key = syncItemKey(item);
    const title = normalizeString(item.custom_title ?? item.customTitle);
    if (key && title) {
      accumulator[key] = title;
    }
    return accumulator;
  }, {});
  return { order, disabled, customTitles };
}

// A remote list can omit catalogs installed here after it was saved, so it
// never equals the local payload. Compare with the payload this device would
// describe after applying the remote, so only a change Home shows counts.
export function remotePayloadChangesHome({
  remotePayload = {},
  localPayload = {},
  catalogEntries = [],
  collectionEntries = []
} = {}) {
  const hideUnreleasedContent = Object.prototype.hasOwnProperty.call(
    remotePayload,
    HIDE_UNRELEASED_CONTENT_KEY
  )
    ? Boolean(remotePayload.hide_unreleased_content)
    : Boolean(localPayload.hide_unreleased_content);
  const appliedPayload = composeLocalPayload({
    catalogEntries,
    collectionEntries,
    prefs: homeCatalogPrefsFromPayload(remotePayload, localPayload),
    hideUnreleasedContent
  });
  return payloadSignature(appliedPayload) !== payloadSignature(localPayload);
}
