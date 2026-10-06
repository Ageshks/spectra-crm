import { AsyncLocalStorage } from 'async_hooks';
import { RequestContextInfo } from '../types/auth.types';

const storage = new AsyncLocalStorage<RequestContextInfo>();

export const RequestContext = {
  run<T>(info: RequestContextInfo, callback: () => T): T {
    return storage.run(info, callback);
  },
  get(): RequestContextInfo {
    return storage.getStore() ?? {};
  },
};
