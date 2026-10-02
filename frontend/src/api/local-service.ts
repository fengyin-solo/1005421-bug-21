import { MODULE_BY_KEY } from '@/data/modules'
import { allRows, listRows, resetRows, saveRows } from '@/data/local-store'
import { judgeThresholdRain } from '@/data/rain-ledger'
import type {
  ActionResult,
  CreateResult,
  EntryRow,
  ModuleMeta,
  OverviewResult,
  PageResult,
} from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

export function filterRows(rows: EntryRow[], filters: Record<string, string>): EntryRow[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
}

export function listEntries(key: string, filters: Record<string, string> = {}): PageResult {
  const matched = filterRows(listRows(key), filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

export function runAction(key: string, id: number, action: string): ActionResult {
  const meta = moduleMeta(key)
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const current = String(rows[index].status)
  if (current === target) {
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }
  if (meta.sequential) {
    // 状态按 statuses 登记的次序逐级推进，跨级的一律拦下。
    const currentIndex = meta.statuses.indexOf(current)
    const targetIndex = meta.statuses.indexOf(target)
    if (targetIndex !== currentIndex + 1) {
      return {
        ok: false,
        message: `${meta.entity}状态须按「${meta.statuses.join(' → ')}」逐级推进，不能从「${current}」跨到「${target}」`,
      }
    }
  }
  const lastStatus = meta.statuses[meta.statuses.length - 1]
  // 各模块最后一个「X状态」字段与流转状态保持一致，落库那份与明细不打架。
  const statusField = meta.fields.find((field) => field.endsWith('状态'))
  const updated: EntryRow = {
    ...rows[index],
    ...(statusField ? { [statusField]: target } : {}),
    status: target,
    pending: target !== lastStatus,
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }
  const next = [...rows]
  next[index] = updated
  saveRows(key, next)
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  for (const row of listRows(key)) {
    lines.push([row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status].join(','))
  }
  return { filename: `${meta.name}-清单.csv`, content: `\uFEFF${lines.join('\n')}` }
}

export function downloadEntries(key: string): void {
  const { filename, content } = exportEntries(key)
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

export function loadOverview(): OverviewResult {
  const rows = allRows()
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    const entries = rows[meta.key] ?? []
    return {
      name: meta.name,
      created: entries.length,
      pending: entries.filter((row) => row.pending).length,
      abnormal: entries.filter((row) => row.abnormal).length,
    }
  })
  const cards = [
    { label: '业务模块', value: modules.length },
    { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) },
    { label: '待处理', value: modules.reduce((sum, item) => sum + item.pending, 0) },
    { label: '异常量', value: modules.reduce((sum, item) => sum + item.abnormal, 0) },
  ]
  return { cards, modules }
}

// ---- 雨量站登记：判定口径只认 data/rain-ledger.ts 那一份（站网台账版） ----

export type RainSubmission = {
  站号: string
  站点名称: string
  所属流域: string
  设备型号: string
  阈值雨量: string
  通信方式: string
  校核日期: string
}

function nextId(rows: EntryRow[]): number {
  return rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
}

/**
 * 登记雨量站。
 * - 阈值雨量按站网台账口径判定：整数、非负、不超上限；取到极值的一律退回核对（标异常）；
 * - 同一站号重复提交不另起记录，核销清单也不重复挂；
 * - 提交结论同步落到隐患核销清单，那边随之多一条待复核记录。
 */
export function createRainEntry(input: RainSubmission): CreateResult {
  const meta = moduleMeta('rain')
  for (const field of ['站号', '站点名称', '所属流域'] as const) {
    if (!input[field].trim()) {
      return { ok: false, created: false, message: `${field}不能为空` }
    }
  }
  const verdict = judgeThresholdRain(input.阈值雨量)
  if (verdict.kind === 'invalid') {
    return { ok: false, created: false, message: verdict.message }
  }
  const rows = listRows('rain')
  const stationNo = input.站号.trim()
  if (rows.some((row) => String(row['站号']) === stationNo)) {
    return { ok: true, created: false, message: `站号 ${stationNo} 已登记，同一站号重复提交不另起记录` }
  }
  const extreme = verdict.kind === 'extreme'
  const conclusion = extreme ? verdict.message : '阈值雨量判定通过'
  const entry: EntryRow = {
    id: nextId(rows),
    status: '待安装',
    pending: true,
    abnormal: extreme,
    站号: stationNo,
    站点名称: input.站点名称.trim(),
    所属流域: input.所属流域.trim(),
    设备型号: input.设备型号.trim(),
    阈值雨量: verdict.value,
    通信方式: input.通信方式.trim(),
    校核日期: input.校核日期 || new Date().toISOString().slice(0, 10),
    站点状态: '待安装',
    判定备注: extreme ? verdict.message : '',
  }
  saveRows('rain', [...rows, entry])
  syncClearance(entry, conclusion)
  return {
    ok: true,
    created: true,
    message: `${meta.entity}已登记，${conclusion}，结论已同步隐患核销清单（待复核）`,
  }
}

/** 把雨量站登记结论落到隐患核销清单：同一站号只挂一条待复核，不重复起单。 */
function syncClearance(station: EntryRow, conclusion: string): void {
  const rows = listRows('clearance')
  const owner = `${station['站点名称']}（${station['站号']}）`
  if (rows.some((row) => String(row['所属隐患点']) === owner)) {
    return
  }
  const id = nextId(rows)
  const entry: EntryRow = {
    id,
    status: '待复核',
    pending: true,
    abnormal: Boolean(station.abnormal),
    核销编号: `CLEA-${String(id).padStart(4, '0')}`,
    所属隐患点: owner,
    核销依据: `雨量站登记结论同步；所属流域：${station['所属流域']}`,
    复核人: '待指派',
    复核日期: '',
    核销结论: conclusion,
    归档日期: '',
    核销状态: '待复核',
  }
  saveRows('clearance', [...rows, entry])
}
