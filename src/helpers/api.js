import { showError } from './utils';
import { getRuntimeConfig } from './runtime-config';
import axios from 'axios';

export const API = axios.create({
  baseURL: getRuntimeConfig('REACT_APP_SERVER', import.meta.env.REACT_APP_SERVER || ''),
});

API.interceptors.response.use(
  (response) => response,
  (error) => {
    if (!error.config?.hideError) {
      showError(error);
    }
    return Promise.reject(error);
  }
);
