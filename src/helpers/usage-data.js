export const QUOTA_PER_USD = 500000;

export const numberOrZero = (value) => {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
};

export const textOrEmpty = (value) => typeof value === 'string' ? value : '';
export const dollars = (quota) => (numberOrZero(quota) / QUOTA_PER_USD).toFixed(6);

export function localDate(date = new Date()) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function parseDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('请选择有效的开始与结束日期');
    const [year, month, day] = value.split('-').map(Number);
    const date = new Date(year, month - 1, day);
    if (localDate(date) !== value) throw new Error('日期无效');
    return date;
}

export function dateBounds(range) {
    const start = parseDate(range.start);
    const end = parseDate(range.end);
    if (start > end) throw new Error('开始日期不能晚于结束日期');
    end.setDate(end.getDate() + 1);
    return { start: Math.floor(start.getTime() / 1000), end: Math.floor(end.getTime() / 1000) - 1 };
}

export function datePreset(preset, now = new Date()) {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const end = new Date(start);
    switch (preset) {
        case 'today': break;
        case 'yesterday': start.setDate(start.getDate() - 1); end.setDate(end.getDate() - 1); break;
        case 'week': start.setDate(start.getDate() - (start.getDay() + 6) % 7); break;
        case 'lastWeek':
            start.setDate(start.getDate() - (start.getDay() + 6) % 7 - 7);
            end.setTime(start.getTime()); end.setDate(end.getDate() + 6); break;
        case 'month': start.setDate(1); break;
        case 'lastMonth': start.setDate(1); start.setMonth(start.getMonth() - 1); end.setDate(0); break;
        default: start.setDate(start.getDate() - 7);
    }
    return { start: localDate(start), end: localDate(end) };
}

export function* daySegments(range) {
    dateBounds(range);
    const cursor = parseDate(range.start);
    const last = parseDate(range.end);
    while (cursor <= last) {
        const start = Math.floor(cursor.getTime() / 1000);
        const date = localDate(cursor);
        cursor.setDate(cursor.getDate() + 1);
        yield { date, start, end: Math.floor(cursor.getTime() / 1000) - 1 };
    }
}

function parseJsonObject(value) {
    if (value && typeof value === 'object' && !Array.isArray(value)) return value;
    if (typeof value !== 'string' || !value) return {};
    try {
        const parsed = JSON.parse(value);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch { return {}; }
}

export function normalizeLog(raw, source, index) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('日志条目格式无效');
    const createdAt = Number(raw.created_at);
    const quota = Number(raw.quota);
    if (raw.created_at == null || !Number.isFinite(createdAt) || !Number.isFinite(new Date(createdAt * 1000).getTime()) ||
        raw.quota == null || !Number.isFinite(quota)) throw new Error('日志缺少有效时间或额度，不能计算完整金额');
    const other = parseJsonObject(raw.other);
    const metadata = parseJsonObject(raw.metadata ?? other.metadata);
    const cacheField = (name) => numberOrZero(raw[name] ?? other[name]);
    const userId = raw.user_id ?? metadata.user_id;
    return {
        rowKey: `${source}-${index}`, source,
        id: raw.id == null ? '' : String(raw.id),
        request_id: raw.request_id == null ? '' : String(raw.request_id),
        token_id: raw.token_id == null ? '' : String(raw.token_id),
        token_name: textOrEmpty(raw.token_name), model_name: textOrEmpty(raw.model_name),
        created_at: createdAt, date: localDate(new Date(createdAt * 1000)),
        type: raw.type == null ? 2 : numberOrZero(raw.type),
        prompt_tokens: numberOrZero(raw.prompt_tokens), completion_tokens: numberOrZero(raw.completion_tokens),
        cache_tokens: cacheField('cache_tokens'),
        cache_creation_tokens: cacheField('cache_creation_tokens'),
        cache_creation_tokens_5m: cacheField('cache_creation_tokens_5m'),
        cache_creation_tokens_60m: cacheField('cache_creation_tokens_60m'),
        user_id: userId == null ? '' : String(userId),
        quota, use_time: numberOrZero(raw.use_time), is_stream: raw.is_stream === true || raw.is_stream === 1,
        content: textOrEmpty(raw.content), other: textOrEmpty(raw.other),
    };
}

export function normalizeToken(raw, source, mode, index) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('令牌信息格式无效');
    const access = mode === 'access';
    const remain = raw[access ? 'remain_quota' : 'total_available'];
    const used = raw[access ? 'used_quota' : 'total_used'];
    const total = access ? numberOrZero(remain) + numberOrZero(used) : raw.total_granted;
    const amount = (value) => value == null || !Number.isFinite(Number(value)) ? null : Number(value);
    const expires = raw[access ? 'expired_time' : 'expires_at'];
    return {
        rowKey: `${source}-token-${index}`, source,
        id: access && raw.id != null ? String(raw.id) : '', name: textOrEmpty(raw.name),
        status: access ? (Number(raw.status) === 1 ? '有效' : '无效') : '未提供',
        remain_quota: amount(remain), used_quota: amount(used),
        total_quota: access && (amount(remain) == null || amount(used) == null) ? null : amount(total),
        unlimited_quota: raw.unlimited_quota === true || raw.unlimited_quota === 1,
        expires_at: expires == null || !Number.isFinite(Number(expires)) ? null : Number(expires),
        never_expires: access ? Number(expires) === -1 : expires != null && Number(expires) === 0,
    };
}

export function filterLogs(logs, range, model = '') {
    const bounds = dateBounds(range);
    return logs.filter(log => log.created_at >= bounds.start && log.created_at <= bounds.end && (!model || log.model_name === model));
}

export function dailySummary(logs) {
    const groups = new Map();
    for (const log of logs) {
        const key = JSON.stringify([log.date, log.source, log.token_id, log.token_name, log.model_name]);
        if (!groups.has(key)) groups.set(key, {
            rowKey: key, date: log.date, source: log.source, token_id: log.token_id,
            token_name: log.token_name, model_name: log.model_name,
            count: 0, prompt_tokens: 0, completion_tokens: 0, quota: 0,
        });
        const group = groups.get(key);
        group.count += 1;
        group.prompt_tokens += log.prompt_tokens;
        group.completion_tokens += log.completion_tokens;
        group.quota += log.quota;
    }
    return [...groups.values()].sort((a, b) => b.date.localeCompare(a.date));
}
