import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Button, Input, Typography, Table, Tag, Card, Collapse, Toast, Space, Tabs, Select, Tooltip, Modal, DatePicker } from '@douyinfe/semi-ui';
import { IconSearch, IconCopy, IconDownload } from '@douyinfe/semi-icons';
import { API, getRuntimeBaseUrls, getRuntimeConfigBool, timestamp2string } from '../helpers';
import { stringToColor, renderModelPrice } from '../helpers/render';
import { ITEMS_PER_PAGE } from '../constants';
import { dailySummary, dateBounds, datePreset, dollars, filterLogs, localDate } from '../helpers/usage-data';
import { queryUsage, queryErrorMessage } from '../helpers/usage-query';
import Papa from 'papaparse';

const { Text, Paragraph } = Typography;
const { Panel } = Collapse;
const QUERY_COOLDOWN = 3000;
const PRESETS = [['today', '今天'], ['yesterday', '昨天'], ['week', '本周'], ['lastWeek', '上周'], ['month', '本月'], ['lastMonth', '上月'], ['default', '过去7天至今日']];
const fieldStyle = { display: 'flex', flexDirection: 'column', gap: 6, minWidth: 180, flex: '1 1 220px' };
const dateValue = value => new Date(`${value}T00:00:00`);

function renderTimestamp(value) {
    return Number.isFinite(Number(value)) && Number.isFinite(new Date(Number(value) * 1000).getTime()) ? timestamp2string(Number(value)) : '未知';
}

function expiry(token) {
    return token.never_expires ? '永不过期' : token.expires_at == null ? '未知' : renderTimestamp(token.expires_at);
}

function money(value) {
    return value == null ? '未知' : `$${dollars(value)}`;
}

function detailContent(record) {
    let other;
    try { other = JSON.parse(record.other); } catch { /* 旧版日志可能没有计价参数。 */ }
    let tooltip = '以后端记录的额度为准；该日志没有完整的计价参数';
    if (other && typeof other === 'object') {
        const isNumber = (value) => typeof value === 'number' && Number.isFinite(value);
        if (isNumber(other.group_ratio) && ((isNumber(other.model_price) && other.model_price !== -1) ||
            (isNumber(other.model_ratio) && isNumber(other.completion_ratio)))) {
            tooltip = <>{renderModelPrice(record.prompt_tokens, record.completion_tokens, other.model_ratio, other.model_price,
                other.completion_ratio, other.group_ratio)}<div>计价参数仅供参考；实际花费以日志额度为准。</div></>;
        }
    }
    return <Tooltip content={tooltip}><Paragraph ellipsis={{ rows: 2 }}>{record.content || '—'}</Paragraph></Tooltip>;
}

const LogsTable = () => {
    const baseUrls = useMemo(() => getRuntimeBaseUrls(), []);
    const sites = Object.keys(baseUrls || {});
    const [activeSite, setActiveSite] = useState(() => sites[0] || '');
    const [mode, setMode] = useState('access');
    const [accessToken, setAccessToken] = useState('');
    const [userId, setUserId] = useState('');
    const [adminUserId, setAdminUserId] = useState('');
    const [targetUserId, setTargetUserId] = useState('');
    const [keyDraft, setKeyDraft] = useState('');
    const [keys, setKeys] = useState([]);
    const [range, setRange] = useState(() => datePreset('default'));
    const [model, setModel] = useState('');
    const [view, setView] = useState('day');
    const [result, setResult] = useState(null);
    const [loading, setLoading] = useState(false);
    const [progress, setProgress] = useState('');
    const [error, setError] = useState('');
    const [activePanels, setActivePanels] = useState(['tokens', 'logs']);
    const [pageSize, setPageSize] = useState(ITEMS_PER_PAGE);
    const [page, setPage] = useState(1);
    const [coolingDown, setCoolingDown] = useState(false);
    const requestRef = useRef(null);
    const lastSubmitRef = useRef(0);
    const cooldownRef = useRef(null);
    const showBalance = getRuntimeConfigBool('REACT_APP_SHOW_BALANCE', true);
    const showDetail = getRuntimeConfigBool('REACT_APP_SHOW_DETAIL', true);
    // 管理员模式不展示令牌信息面板，仅查询用量明细与日汇总。
    const effectiveShowBalance = mode === 'admin' ? false : showBalance;

    useEffect(() => () => {
        requestRef.current?.abort();
        clearTimeout(cooldownRef.current);
    }, []);

    const clearData = () => {
        requestRef.current?.abort();
        requestRef.current = null;
        setLoading(false);
        setResult(null);
        setError('');
        setProgress('');
        setModel('');
        setPage(1);
    };

    const changeIdentity = (setter, value) => {
        clearData();
        setter(value);
    };

    const resetCredentials = () => {
        clearData();
        setAccessToken('');
        setUserId('');
        setAdminUserId('');
        setTargetUserId('');
        setKeyDraft('');
        setKeys([]);
    };

    const changeRange = (next) => {
        let inFetchedRange = false;
        try {
            dateBounds(next);
            inFetchedRange = result && next.start >= result.range.start && next.end <= result.range.end;
        } catch { /* 编辑中的日期不参与统计。 */ }
        if (!inFetchedRange || loading) clearData();
        setRange(next);
        setPage(1);
    };

    const resetFilters = () => {
        changeRange(datePreset('default'));
        setModel('');
        setView('day');
        setPage(1);
    };

    const addKey = () => {
        const value = keyDraft.trim();
        if (!/^sk-[a-zA-Z0-9]+$/.test(value)) return Toast.warning('请输入有效的 sk- 开头令牌，不要包含空格');
        if (keys.includes(value)) return Toast.warning('该令牌已添加');
        clearData();
        setKeys(previous => [...previous, value]);
        setKeyDraft('');
    };

    const fetchData = async () => {
        if (requestRef.current || Date.now() - lastSubmitRef.current < QUERY_COOLDOWN) return;
        const baseUrl = baseUrls?.[activeSite];
        if (typeof baseUrl !== 'string') return Toast.warning('尚未配置有效站点');
        if (!effectiveShowBalance && !showDetail) return Toast.warning('当前站点已关闭余额和明细查询');
        try { dateBounds(range); } catch (e) { return Toast.warning(e.message); }
        if (mode === 'access' && (!accessToken.trim() || /\s/.test(accessToken.trim()) || !/^[1-9]\d*$/.test(userId.trim()))) {
            return Toast.warning('请输入 Access Token 和正整数用户 ID');
        }
        if (mode === 'admin' && (!accessToken.trim() || /\s/.test(accessToken.trim()) || !/^[1-9]\d*$/.test(adminUserId.trim()) || !/^[1-9]\d*$/.test(targetUserId.trim()))) {
            return Toast.warning('请输入管理员 Access Token、管理员用户 ID 与目标用户 ID（均为正整数）');
        }
        if (mode === 'key' && (keys.length === 0 || keyDraft.trim())) return Toast.warning('请先添加要查询的 sk key，再点击查询');
        clearData();
        const controller = new AbortController();
        requestRef.current = controller;
        lastSubmitRef.current = Date.now();
        setCoolingDown(true);
        clearTimeout(cooldownRef.current);
        cooldownRef.current = setTimeout(() => setCoolingDown(false), QUERY_COOLDOWN);
        setLoading(true);
        setProgress('准备查询');
        try {
            const data = await queryUsage({
                get: (path, config) => API.get(path, config), baseUrl, mode,
                accessToken: accessToken.trim(), userId: userId.trim(),
                adminUserId: adminUserId.trim(), targetUserId: targetUserId.trim(),
                keys: [...keys], range: { ...range },
                showBalance: effectiveShowBalance, showDetail, signal: controller.signal,
                onProgress: (value) => { if (requestRef.current === controller) setProgress(value); },
            });
            if (requestRef.current === controller) {
                setResult(data);
                setActivePanels(['tokens', 'logs']);
                setProgress('查询完成');
            }
        } catch (e) {
            if (requestRef.current === controller) {
                setError(queryErrorMessage(e));
                setProgress('');
            }
        } finally {
            if (requestRef.current === controller) {
                requestRef.current = null;
                setLoading(false);
            }
        }
    };

    const copyText = async (text) => {
        try {
            if (navigator.clipboard && window.isSecureContext) {
                await navigator.clipboard.writeText(text);
            } else {
                const element = document.createElement('textarea');
                element.value = text;
                element.style.position = 'fixed';
                element.style.left = '-9999px';
                document.body.appendChild(element);
                try {
                    element.select();
                    if (!document.execCommand('copy')) throw new Error('copy');
                } finally { element.remove(); }
            }
            Toast.success('已复制');
        } catch {
            Modal.error({ title: '无法复制到剪贴板，请手动复制', content: text });
        }
    };

    const exportCSV = (rows, filename) => {
        if (!rows.length || loading) return;
        try {
            const csv = '\ufeff' + Papa.unparse(rows, { escapeFormulae: true });
            const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
            const link = document.createElement('a');
            link.href = url;
            link.download = filename;
            document.body.appendChild(link);
            link.click();
            link.remove();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
        } catch { Toast.error('导出失败，请稍后重试'); }
    };

    const dateError = useMemo(() => {
        try { dateBounds(range); return ''; } catch (e) { return e.message; }
    }, [range]);
    const filtered = useMemo(() => result && !dateError ? filterLogs(result.logs, range, model) : [], [result, range, model, dateError]);
    const daily = useMemo(() => dailySummary(filtered), [filtered]);
    const modelOptions = useMemo(() => [...new Set((result?.logs || []).map(log => log.model_name).filter(Boolean))].sort().map(value => ({ value, label: value })), [result]);
    const totalQuota = useMemo(() => filtered.reduce((total, log) => total + log.quota, 0), [filtered]);
    const tokens = result?.tokens || [];
    const rows = view === 'day' ? daily : filtered;
    const partialLabel = result?.incomplete ? '不完整：仅已获取部分' : mode === 'key' ? '仅接口返回的最近记录' : mode === 'admin' ? '目标用户后端保存期内的记录' : '后端保存期及权限内的记录';
    const tokenExport = tokens.map(token => ({
        '来源': token.source, '令牌ID': token.id, '令牌名称': token.name, '状态': token.status,
        '无限额度': token.unlimited_quota ? '是' : '否',
        '总额度(quota)': token.total_quota ?? '未知', '总额(USD)': token.total_quota == null ? '未知' : dollars(token.total_quota),
        '剩余额度(quota)': token.remain_quota ?? '未知', '剩余金额(USD)': token.remain_quota == null ? '未知' : dollars(token.remain_quota),
        '已用额度(quota)': token.used_quota ?? '未知', '已用金额(USD)': token.used_quota == null ? '未知' : dollars(token.used_quota),
        '有效期至': expiry(token),
    }));
    const logExport = () => view === 'detail'
        ? rows.map(log => ({
            request_id: log.request_id,
            stat_date: log.date,
            request_time: renderTimestamp(log.created_at),
            model_name: log.model_name,
            input_tokens: log.prompt_tokens,
            output_tokens: log.completion_tokens,
            cache_tokens: log.cache_tokens,
            cache_creation_tokens: log.cache_creation_tokens,
            cache_creation_tokens_5m: log.cache_creation_tokens_5m,
            cache_creation_tokens_60m: log.cache_creation_tokens_60m,
            quota: log.quota,
            'metadata.user_id': log.user_id,
        }))
        : rows.map(log => ({
            '日期': log.date, '调用数量': log.count,
            '来源': log.source, '令牌ID': log.token_id, '令牌名称': log.token_name, '模型': log.model_name,
            '提示tokens': log.prompt_tokens, '补全tokens': log.completion_tokens,
            '花费(USD)': dollars(log.quota), '消费额度(quota)': log.quota,
            '结果范围': partialLabel,
        }));

    const commonColumns = [
        { title: '来源', dataIndex: 'source', width: 100 },
        { title: '令牌 ID', dataIndex: 'token_id', width: 100, render: value => value || '—' },
        { title: '令牌名称', dataIndex: 'token_name', width: 160, render: value => <Tag color="grey" onClick={() => copyText(value)}>{value || '未命名'}</Tag>, sorter: (a, b) => a.token_name.localeCompare(b.token_name) },
        { title: '模型', dataIndex: 'model_name', width: 180, render: value => <Tag color={stringToColor(value)} onClick={() => copyText(value)}>{value || '未知'}</Tag>, sorter: (a, b) => a.model_name.localeCompare(b.model_name) },
    ];
    const amountColumns = [
        { title: '提示 tokens', dataIndex: 'prompt_tokens', width: 130, sorter: (a, b) => a.prompt_tokens - b.prompt_tokens },
        { title: '补全 tokens', dataIndex: 'completion_tokens', width: 130, sorter: (a, b) => a.completion_tokens - b.completion_tokens },
        { title: '花费 (USD)', dataIndex: 'quota', width: 140, render: money, sorter: (a, b) => a.quota - b.quota },
    ];
    const detailColumns = [
        { title: '时间', dataIndex: 'created_at', width: 190, render: renderTimestamp, sorter: (a, b) => a.created_at - b.created_at },
        ...commonColumns,
        { title: '用时', dataIndex: 'use_time', width: 170, render: (value, record) => record.model_name.startsWith('mj_') ? '—' : <Space><Tag color={value < 101 ? 'green' : value < 300 ? 'orange' : 'red'}>{value} 秒</Tag><Tag color={record.is_stream ? 'blue' : 'purple'}>{record.is_stream ? '流' : '非流'}</Tag></Space>, sorter: (a, b) => a.use_time - b.use_time },
        ...amountColumns,
        { title: '详情', dataIndex: 'content', width: 240, render: (_, record) => detailContent(record) },
    ];
    const dayColumns = [
        { title: '日期（本地）', dataIndex: 'date', width: 140, sorter: (a, b) => a.date.localeCompare(b.date) },
        ...commonColumns,
        { title: '调用数量', dataIndex: 'count', width: 120, sorter: (a, b) => a.count - b.count },
        ...amountColumns,
    ];
    const tokenColumns = [
        { title: '来源', dataIndex: 'source', width: 100 },
        { title: '令牌 ID', dataIndex: 'id', width: 100, render: value => value || '—' },
        { title: '令牌名称', dataIndex: 'name', width: 180, render: value => <Tag onClick={() => copyText(value)}>{value || '未命名'}</Tag> },
        { title: '状态', dataIndex: 'status', width: 100 },
        { title: '额度模式', dataIndex: 'unlimited_quota', width: 100, render: value => value ? '无限额度' : '有限额度' },
        { title: '总额 (USD)', dataIndex: 'total_quota', width: 150, render: (value, token) => token.unlimited_quota ? '无限额度' : money(value) },
        { title: '剩余 (USD)', dataIndex: 'remain_quota', width: 150, render: (value, token) => token.unlimited_quota ? '无限额度' : money(value) },
        { title: '已用 (USD)', dataIndex: 'used_quota', width: 150, render: money },
        { title: '有效期至', width: 200, render: (_, token) => expiry(token) },
    ];

    return <>
        {sites.length > 1 && <Tabs activeKey={activeSite} onChange={value => { resetCredentials(); setActiveSite(value); }}>
            {sites.map(site => <Tabs.TabPane tab={site} itemKey={site} key={site} />)}
        </Tabs>}
        <Card style={{ marginTop: 24 }}>
            <Paragraph strong>查询方式：</Paragraph>
            <Space wrap>
                <Button theme={mode === 'access' ? 'solid' : 'light'} onClick={() => { if (mode !== 'access') { resetCredentials(); setMode('access'); } }}>访问令牌（可查时间范围内全量）</Button>
                <Button theme={mode === 'key' ? 'solid' : 'light'} onClick={() => { if (mode !== 'key') { resetCredentials(); setMode('key'); } }}>令牌 Key（仅最近 1000 条）</Button>
                <Button theme={mode === 'admin' ? 'solid' : 'light'} onClick={() => { if (mode !== 'admin') { resetCredentials(); setMode('admin'); } }}>管理员（按用户 ID 查全量）</Button>
            </Space>
            <Paragraph type="secondary" style={{ marginTop: 12 }}>
                凭证仅保存在当前页面内存，不写入本地存储或网址；切换站点、模式或修改凭证会清除旧结果。仅请求已配置站点。
            </Paragraph>
            {mode === 'access' ? <>
                <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 16 }}>
                    <label style={fieldStyle}><Text>访问令牌 Access Token</Text><Input mode="password" autoComplete="off" value={accessToken} onChange={value => changeIdentity(setAccessToken, value)} placeholder="访问令牌 Access Token（NewAPI 个人设置中生成）" aria-label="Access Token" /></label>
                    <label style={fieldStyle}><Text>用户 ID</Text><Input value={userId} autoComplete="off" inputMode="numeric" onChange={value => changeIdentity(setUserId, value)} placeholder="输入用户 ID" aria-label="用户 ID" /></label>
                </div>
                <Paragraph type="secondary" style={{ marginTop: 12 }}>Access 模式按本地日期逐日顺序抓取全部分页；可查询范围受后端日志保存期与账户权限限制，并非无限历史。令牌信息是当前快照，不随日期或模型筛选变化。</Paragraph>
            </> : mode === 'admin' ? <>
                <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 16 }}>
                    <label style={fieldStyle}><Text>管理员 Access Token</Text><Input mode="password" autoComplete="off" value={accessToken} onChange={value => changeIdentity(setAccessToken, value)} placeholder="管理员 Access Token（需管理员及以上权限）" aria-label="管理员 Access Token" /></label>
                    <label style={fieldStyle}><Text>管理员用户 ID</Text><Input value={adminUserId} autoComplete="off" inputMode="numeric" onChange={value => changeIdentity(setAdminUserId, value)} placeholder="输入管理员自己的用户 ID" aria-label="管理员用户 ID" /></label>
                    <label style={fieldStyle}><Text>目标用户 ID</Text><Input value={targetUserId} autoComplete="off" inputMode="numeric" onChange={value => changeIdentity(setTargetUserId, value)} placeholder="输入要查询的目标用户 ID" aria-label="目标用户 ID" /></label>
                </div>
                <Paragraph type="secondary" style={{ marginTop: 12 }}>管理员模式用管理员令牌按目标用户的用户名逐日抓取全部消费日志（/api/log/）；管理员令牌需具备访问日志与用户信息的权限。可查询范围受后端日志保存期限制。此模式只展示用量明细与日汇总，不展示令牌信息面板。</Paragraph>
            </> : <>
                <div style={{ display: 'flex', gap: 12, marginTop: 16 }}>
                    <Input mode="password" autoComplete="off" value={keyDraft} onChange={value => changeIdentity(setKeyDraft, value)} placeholder="输入 sk- 开头的令牌后添加" aria-label="SK Key" onKeyDown={event => { if (event.key === 'Enter') addKey(); }} />
                    <Button onClick={addKey} disabled={!keyDraft.trim()}>添加</Button>
                </div>
                <Space wrap style={{ marginTop: 12 }}>{keys.map((_, index) => <Tag key={index} closable onClose={() => { clearData(); setKeys(previous => previous.filter((__, i) => i !== index)); }} size="large">Key {index + 1} · 已隐藏</Tag>)}</Space>
                <Paragraph type="secondary" style={{ marginTop: 12 }}>每个 key 顺序查询，接口只返回最多最近 1000 条日志，不支持历史分页；日期筛选不能补齐更早记录。任一 key 查询失败时整批结果不展示。同名令牌按 Key 序号区分，不显示或导出密钥。</Paragraph>
            </>}
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 16 }}>
                <div style={{ ...fieldStyle, flex: '2 1 360px' }}>
                    <Text>开始日期 — 结束日期（本地，含尾日）</Text>
                    <DatePicker type="dateRange" aria-label="查询日期范围" format="yyyy-MM-dd" style={{ width: '100%' }}
                        value={[dateValue(range.start), dateValue(range.end)]} onChangeWithDateFirst
                        presets={PRESETS.map(([preset, text]) => { const dates = datePreset(preset); return { text, start: dateValue(dates.start), end: dateValue(dates.end) }; })}
                        onChange={dates => { if (Array.isArray(dates) && dates.length === 2 && dates.every(date => date instanceof Date && Number.isFinite(date.getTime()))) changeRange({ start: localDate(dates[0]), end: localDate(dates[1]) }); }} />
                </div>
                <label style={fieldStyle}><Text>查询模式</Text><Select aria-label="查询模式" value={view} optionList={[{ value: 'day', label: '按日查询' }, { value: 'detail', label: '按条查询' }]} onChange={value => { setView(value); setPage(1); }} /></label>
            </div>
            <Space wrap style={{ marginTop: 12 }}>{PRESETS.map(([preset, label]) => <Button key={preset} size="small" onClick={() => changeRange(datePreset(preset))}>{label}</Button>)}</Space>
            <Paragraph type="secondary" style={{ marginTop: 12 }}>默认从 7 天前至今天（含尾日）。已获取范围内的日期和模型筛选在内存中进行；超出范围会清空结果，需要重新查询。更改日期也会取消正在进行的查询。</Paragraph>
            {dateError && <div role="alert"><Text type="danger">{dateError}</Text></div>}
            {!sites.length && <div role="alert"><Text type="danger">未配置查询站点，请检查运行时站点配置。</Text></div>}
            <Space wrap style={{ marginTop: 12 }}>
                <Button icon={<IconSearch />} theme="solid" onClick={fetchData} loading={loading} disabled={loading || coolingDown || !!dateError || !sites.length || (!effectiveShowBalance && !showDetail)}>{coolingDown && !loading ? '请稍候（3秒间隔）' : '查询'}</Button>
                {loading && <Button type="danger" onClick={() => { clearData(); setError('查询已取消，未展示本次未完成的数据'); }}>取消查询</Button>}
                <Button onClick={resetFilters}>重置筛选</Button>
                <Button onClick={resetCredentials}>清空凭证与结果</Button>
                <span role="status" aria-live="polite"><Text type="secondary">{progress}</Text></span>
            </Space>
            {loading && <Paragraph type="secondary" style={{ marginTop: 12 }}>正在获取数据，全部完成后才展示结果；请勿将进行中的查询视为完整账单。</Paragraph>}
            {error && <div role="alert" style={{ marginTop: 12 }}><Text type="danger">{error}</Text></div>}
            {result?.warnings.map((warning, index) => <div role="alert" key={index} style={{ marginTop: 12 }}><Text type={result.incomplete ? 'danger' : 'warning'} strong>{warning}</Text></div>)}
        </Card>
        <Card style={{ marginTop: 24 }}>
            <Collapse activeKey={activePanels} onChange={setActivePanels}>
                {effectiveShowBalance && <Panel header="令牌信息（当前快照）" itemKey="tokens">
                    <Space wrap style={{ marginBottom: 16 }}>
                        <Button icon={<IconCopy />} disabled={!tokens.length} onClick={() => copyText(tokenExport.map(token => Object.entries(token).map(([key, value]) => `${key}: ${value}`).join('\n')).join('\n\n'))}>复制令牌信息</Button>
                        <Button icon={<IconDownload />} disabled={!tokens.length} onClick={() => exportCSV(tokenExport, '令牌信息.csv')}>导出令牌信息 CSV</Button>
                        <Text type="secondary">$1 = 500000 quota（额度单位，非输入/输出 tokens）。无限额度令牌仍保留后端已用额度。</Text>
                    </Space>
                    <Table rowKey="rowKey" columns={tokenColumns} dataSource={tokens} scroll={{ x: 1330 }} pagination={{ pageSize: 10, hideOnSinglePage: true }} empty="暂无令牌信息" />
                </Panel>}
                {showDetail && <Panel header="用量明细与日汇总" itemKey="logs">
                    <Space wrap style={{ marginBottom: 16 }}>
                        <Button theme={view === 'day' ? 'solid' : 'light'} onClick={() => { setView('day'); setPage(1); }}>按日</Button>
                        <Button theme={view === 'detail' ? 'solid' : 'light'} onClick={() => { setView('detail'); setPage(1); }}>按条</Button>
                        <Select aria-label="模型筛选" placeholder="全部模型" value={model || undefined} showClear filter optionList={modelOptions} style={{ width: 240 }} onChange={value => { setModel(value || ''); setPage(1); }} />
                        <Button onClick={resetFilters}>重置筛选</Button>
                        <Button icon={<IconDownload />} disabled={!rows.length || loading} onClick={() => exportCSV(logExport(), `${view === 'day' ? '日汇总' : '用量明细'}${result?.incomplete ? '-不完整' : ''}.csv`)}>导出{view === 'day' ? '日汇总' : '明细'} CSV</Button>
                    </Space>
                    <Paragraph>
                        <Text strong>{result?.incomplete ? '已获取部分花费（非完整总额）' : '当前筛选花费总额'}：{result ? money(totalQuota) : '—'}</Text>
                        {'　'}<Text strong>调用数量：{result ? filtered.length : '—'}</Text>
                    </Paragraph>
                    {result && <Paragraph type={result.incomplete ? 'danger' : 'secondary'}>{partialLabel}；已获取日期：{result.range.start} 至 {result.range.end}；当前显示：{range.start} 至 {range.end}。金额以日志 quota / 500000 美元计算，不重算费率。</Paragraph>}
                    <Table key={view} rowKey="rowKey" columns={view === 'day' ? dayColumns : detailColumns} dataSource={rows} scroll={{ x: view === 'day' ? 1200 : 1640 }} empty={result ? '当前筛选下无调用记录' : '请查询后查看数据'} pagination={{
                        currentPage: page, pageSize, hideOnSinglePage: true, showSizeChanger: true, pageSizeOpts: [10, 20, 50, 100],
                        onPageChange: setPage, onPageSizeChange: value => { setPageSize(value); setPage(1); },
                        showTotal: total => `共 ${total} ${view === 'day' ? '组' : '条'}`, showQuickJumper: true, total: rows.length,
                    }} />
                </Panel>}
            </Collapse>
        </Card>
    </>;
};

export default LogsTable;
