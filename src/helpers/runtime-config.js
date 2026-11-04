const runtimeConfig = window.RUNTIME_CONFIG || {};

export const getRuntimeConfig = (key, fallback = '') => {
  const value = runtimeConfig[key];
  if (value !== undefined && value !== null && value !== '') {
    return value;
  }
  return fallback;
};

export const getRuntimeConfigBool = (key, fallback = false) => {
  return getRuntimeConfig(key, fallback ? 'true' : 'false') === 'true';
};

export const getRuntimeBaseUrls = () => {
  const value = getRuntimeConfig('REACT_APP_BASE_URL', import.meta.env.REACT_APP_BASE_URL || '{}');
  try {
    return JSON.parse(value);
  } catch (e) {
    return {};
  }
};
