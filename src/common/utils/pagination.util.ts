import {
  PAGINATION_DEFAULT_LIMIT,
  PAGINATION_DEFAULT_PAGE,
  PAGINATION_MAX_LIMIT,
} from '../constants';

export type SortOrder = 'asc' | 'desc';

export interface PaginationQuery {
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: SortOrder;
  search?: string;
}

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface PaginatedResult<T> {
  data: T[];
  meta: PaginationMeta;
}

export const normalizePagination = (
  query: PaginationQuery,
  defaultSortBy = 'createdAt',
): Required<Pick<PaginationQuery, 'page' | 'limit' | 'sortBy' | 'sortOrder'>> & {
  skip: number;
  take: number;
  search?: string;
} => {
  const page = Math.max(1, Math.floor(Number(query.page) || PAGINATION_DEFAULT_PAGE));
  const limit = Math.min(
    PAGINATION_MAX_LIMIT,
    Math.max(1, Math.floor(Number(query.limit) || PAGINATION_DEFAULT_LIMIT)),
  );
  const sortBy = query.sortBy || defaultSortBy;
  const sortOrder: SortOrder = query.sortOrder === 'asc' ? 'asc' : 'desc';
  return {
    page,
    limit,
    sortBy,
    sortOrder,
    skip: (page - 1) * limit,
    take: limit,
    search: query.search?.trim() || undefined,
  };
};

export const buildMeta = (page: number, limit: number, total: number): PaginationMeta => ({
  page,
  limit,
  total,
  totalPages: Math.max(1, Math.ceil(total / limit)),
});

export const paginated = <T>(data: T[], page: number, limit: number, total: number): PaginatedResult<T> => ({
  data,
  meta: buildMeta(page, limit, total),
});

/** Escapes Prisma `contains` special characters for mode: 'insensitive'. */
export const escapeSearch = (value: string): string =>
  value.replace(/[\\%_]/g, (match) => `\\${match}`);

/**
 * Builds a Prisma orderBy object from user-supplied sort fields, falling back
 * to the default column when the requested field is not whitelisted.
 */
export const safeOrderBy = (
  sortBy: string | undefined,
  sortOrder: SortOrder,
  allowed: readonly string[],
  fallback = 'createdAt',
): Record<string, SortOrder> => {
  const column = sortBy && allowed.includes(sortBy) ? sortBy : fallback;
  return { [column]: sortOrder };
};
