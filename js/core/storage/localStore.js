export const LocalStore = {
  get(key, defaultValue = null) {
    try {
      const value = localStorage.getItem(key);
      return value !== null ? JSON.parse(value) : defaultValue;
    } catch (e) {
      console.error("LocalStore get error:", e);
      return defaultValue;
    }
  },

  /** The stored JSON text, unparsed; lets callers detect changes cheaply. */
  getRaw(key) {
    try {
      return localStorage.getItem(key);
    } catch (e) {
      console.error("LocalStore get error:", e);
      return null;
    }
  },

  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      console.error("LocalStore set error:", e);
    }
  },

  remove(key) {
    localStorage.removeItem(key);
  },

  clear() {
    localStorage.clear();
  }
};
