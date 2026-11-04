import { dateBounds, daySegments, filterLogs, normalizeLog, normalizeToken } from './usage-data.js';

export class UsageQueryError extends Error {}

function checkCancelled(signal) {
    if (signal?.aborted) {
        const error = new Error('已取消查询');
        error.name = 'AbortError';
        throw error;
    }
}

export function isCancelled(error) {
    return error?.name === 'AbortError' || error?.code === 'ERR_CANCELED';
}

export function queryErrorMessage(error) {
    if (isCancelled(error)) return '查询已取消，未展示本次未完成的数据';
    return error instanceof UsageQueryError ? error.message : '查询失败，请检查网络、凭证及站点权限；未展示未完成的数据';
}

async function request(get, path, config, label) {
    checkCancelled(config.signal);
    try {
        const response = await get(path, config);
        checkCancelled(config.signal);
        return response.data;
    } catch (error) {
        if (isCancelled(error) || config.signal?.aborted) {
            checkCancelled(config.signal);
            throw error;
        }
        const status = error?.response?.status;
        throw new UsageQueryError(`${label}失败${status ? `（HTTP ${status}）` : ''}，请检查网络、凭证及权限${status === 429 ? '，请求过于频繁，请稍后重试' : ''}`);
    }
}

export async function fetchPages({ get, path, config, params = {}, label, mapItem, onProgress = () => {} }) {
    const rows = [];
    const ids = new Set();
    const signatures = new Set();
    let pageSize = 100;
    let expectedTotal;
    for (let page = 1; page <= 10000; page += 1) {
        onProgress(`${label}：第 ${page} 页，已获取 ${rows.length}${expectedTotal == null ? '' : ` / ${expectedTotal}`} 条`);
        const body = await request(get, path, { ...config, params: { ...params, p: page, page_size: pageSize } }, label);
        if (body?.success !== true) throw new UsageQueryError(`${label}失败，后端未确认成功，请检查权限`);
        if (Array.isArray(body.data)) throw new UsageQueryError(`${label}返回旧版数组结构，无法确认分页完整性；此模式要求 items / total / page_size 分页接口`);
        const data = body?.data;
        const total = Number(data?.total);
        const actualSize = Number(data?.page_size);
        if (!Array.isArray(data?.items) || data.total == null || data.page_size == null ||
            !Number.isSafeInteger(total) || total < 0 || !Number.isSafeInteger(actualSize) || actualSize <= 0 || data.items.length > actualSize) {
            throw new UsageQueryError(`${label}分页结构无效，已停止查询，不能视为完整结果`);
        }
        if (page > 1 && (total !== expectedTotal || actualSize !== pageSize)) {
            throw new UsageQueryError(`${label}分页总数或页大小发生变化，请在数据稳定后重试`);
        }
        expectedTotal = total;
        pageSize = actualSize;
        let mapped;
        try {
            mapped = data.items.map((item, index) => mapItem(item, rows.length + index));
        } catch {
            throw new UsageQueryError(`${label}包含无效条目或额度，不能计算完整结果`);
        }
        if (mapped.length) {
            const signature = JSON.stringify(mapped.map(({ rowKey, ...row }) => row));
            if (signatures.has(signature)) throw new UsageQueryError(`${label}出现重复分页，已停止查询`);
            signatures.add(signature);
            for (const row of mapped) {
                if (row.id !== '') {
                    if (ids.has(row.id)) throw new UsageQueryError(`${label}出现重复记录，分页可能发生偏移，请重试`);
                    ids.add(row.id);
                }
            }
        }
        rows.push(...mapped);
        if (rows.length > total) throw new UsageQueryError(`${label}返回条数超过分页总数，已停止查询`);
        if (rows.length === total) return rows;
        if (mapped.length < actualSize) throw new UsageQueryError(`${label}提前结束但未达到分页总数，不能视为完整结果`);
    }
    throw new UsageQueryError(`${label}超过 10000 页安全限制，未展示截断结果，请缩小日期范围`);
}

export async function queryUsage({ get, baseUrl, mode, accessToken, userId, adminUserId, targetUserId, keys, range, showBalance, showDetail, signal, onProgress = () => {} }) {
    dateBounds(range);
    const root = baseUrl.replace(/\/+$/, '');
    const configFor = (token, headerUserId) => ({
        baseURL: '', hideError: true, signal, timeout: 60000,
        headers: {
            Authorization: `Bearer ${token}`,
            ...(headerUserId ? { 'New-Api-User': headerUserId } : {}),
            'Cache-Control': 'no-cache', Pragma: 'no-cache',
        },
    });
    const result = { logs: [], tokens: [], warnings: [], incomplete: false, range: { ...range } };
    if (mode === 'admin') {
        const config = configFor(accessToken, adminUserId);
        onProgress(`查询用户 ${targetUserId} 信息`);
        const userBody = await request(get, `${root}/api/user/${encodeURIComponent(targetUserId)}`, config, '目标用户信息');
        if (userBody?.success !== true || !userBody.data || typeof userBody.data !== 'object') {
            throw new UsageQueryError('目标用户信息查询失败，请检查用户 ID 以及管理员令牌权限');
        }
        const username = userBody.data.username;
        if (typeof username !== 'string' || !username) {
            throw new UsageQueryError('目标用户缺少用户名，无法按用户名检索日志');
        }
        if (showBalance) {
            const amount = (value) => value == null || !Number.isFinite(Number(value)) ? null : Number(value);
            const quota = amount(userBody.data.quota);
            const usedQuota = amount(userBody.data.used_quota);
            result.tokens = [{
                rowKey: `admin-user-${targetUserId}`, source: `用户 ${targetUserId}`,
                id: String(targetUserId), name: username, status: '账户快照',
                remain_quota: quota, used_quota: usedQuota,
                total_quota: quota == null || usedQuota == null ? null : quota + usedQuota,
                unlimited_quota: false, expires_at: null, never_expires: false,
            }];
        }
        if (showDetail) {
            for (const segment of daySegments(range)) {
                const rows = await fetchPages({
                    get, path: `${root}/api/log/`, config, label: `${segment.date} 日志`, onProgress,
                    params: { type: 2, username, start_timestamp: segment.start, end_timestamp: segment.end },
                    mapItem: (row, index) => normalizeLog(row, `用户 ${targetUserId}`, index),
                });
                if (rows.some(row => row.created_at < segment.start || row.created_at > segment.end || row.type !== 2)) {
                    throw new UsageQueryError(`${segment.date} 返回超出日期范围或非消费日志，后端可能不支持筛选，已停止查询`);
                }
                result.logs.push(...rows.map(row => ({ ...row, rowKey: `${segment.date}-${row.rowKey}` })));
            }
        }
    } else if (mode === 'access') {
        const config = configFor(accessToken, userId);
        if (showBalance) {
            try {
                result.tokens = await fetchPages({
                    get, path: `${root}/api/token/`, config, label: '令牌信息', onProgress,
                    mapItem: (row, index) => normalizeToken(row, '账户', 'access', index),
                });
            } catch (error) {
                if (isCancelled(error) || signal?.aborted) throw error;
                result.warnings.push(`令牌信息不可用：${queryErrorMessage(error)}。日志查询将独立进行。`);
            }
        }
        if (showDetail) {
            for (const segment of daySegments(range)) {
                const rows = await fetchPages({
                    get, path: `${root}/api/log/self`, config, label: `${segment.date} 日志`, onProgress,
                    params: { type: 2, start_timestamp: segment.start, end_timestamp: segment.end },
                    mapItem: (row, index) => normalizeLog(row, '账户', index),
                });
                if (rows.some(row => row.created_at < segment.start || row.created_at > segment.end || row.type !== 2)) {
                    throw new UsageQueryError(`${segment.date} 返回超出日期范围或非消费日志，后端可能不支持筛选，已停止查询`);
                }
                result.logs.push(...rows.map(row => ({ ...row, rowKey: `${segment.date}-${row.rowKey}` })));
            }
        }
    } else {
        for (let index = 0; index < keys.length; index += 1) {
            const source = `Key ${index + 1}`;
            const config = configFor(keys[index]);
            onProgress(`${source} / ${keys.length}：正在查询`);
            if (showBalance) {
                const body = await request(get, `${root}/api/usage/token/`, config, `${source} 令牌信息`);
                if (body?.code !== true) throw new UsageQueryError(`${source} 令牌信息查询失败，整批结果未展示，请检查令牌权限`);
                try {
                    result.tokens.push(normalizeToken(body.data, source, 'key', index));
                } catch {
                    throw new UsageQueryError(`${source} 令牌信息格式无效，整批结果未展示`);
                }
            }
            if (showDetail) {
                const body = await request(get, `${root}/api/log/token`, config, `${source} 日志`);
                if (body?.success !== true || !Array.isArray(body.data)) throw new UsageQueryError(`${source} 日志查询失败，整批结果未展示，请检查令牌权限`);
                if (body.data.length >= 1000) {
                    result.incomplete = true;
                    result.warnings.push(`${source} 返回 ${body.data.length} 条日志，已达到最近 1000 条上限：所选日期可能缺失记录，金额和调用数仅为已获取部分，不能视为完整账单。`);
                }
                let rows;
                try {
                    rows = body.data.map((row, rowIndex) => normalizeLog(row, source, rowIndex));
                } catch {
                    throw new UsageQueryError(`${source} 日志包含无效时间或额度，整批结果未展示`);
                }
                result.logs.push(...filterLogs(rows.filter(row => row.type === 0 || row.type === 2), range));
            }
        }
    }
    checkCancelled(signal);
    result.logs.sort((a, b) => b.created_at - a.created_at);
    return result;
}
