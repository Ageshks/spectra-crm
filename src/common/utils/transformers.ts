import { Transform } from 'class-transformer';

/**
 * Converts query/body values ('true'/'false'/'1'/'0'/booleans) into real
 * booleans so IsBoolean validation behaves correctly for query strings.
 */
export const ToBoolean = () =>
  Transform(({ value }) => {
    if (value === true || value === 'true' || value === '1') return true;
    if (value === false || value === 'false' || value === '0') return false;
    return value;
  });
