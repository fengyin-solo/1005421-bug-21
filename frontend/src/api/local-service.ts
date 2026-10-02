import { MODULE_BY_KEY } from '@/data/modules'
import { allRows, listRows, resetRows, saveRows } from '@/data/local-store'
import { WATERSHEDS, judgeThreshold } from '@/data/rain-rules'
import type {
  ActionResult,
  EntryRow,
  ModuleMeta,
  OverviewResult,
  PageResult,
  RainSubmission,
  SubmitResult,
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
  // 严格流转的模块（雨量站网）：状态按 statuses 次序逐级推进，跨级的拦下
  if (meta.strictFlow) {
    const fromIndex = meta.statuses.indexOf(current)
    const toIndex = meta.statuses.indexOf(target)
    if (toIndex !== fromIndex + 1) {
      return {
        ok: false,
        message: `${meta.entity}状态须按「${meta.statuses.join(' → ')}」逐级推进，不能从「${current}」跨到「${target}」`,
      }
    }
  }
  const lastStatus = meta.statuses[meta.statuses.length - 1]
  const negative = NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb))
  const updated: EntryRow = {
    ...rows[index],
    status: target,
    pending: target !== lastStatus,
    // 严格流转模块保留「退回核对」标记，不因普通流转动作抹掉
    abnormal: meta.strictFlow ? Boolean(rows[index].abnormal) || negative : negative,
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

// 所属流域只有 rain-rules.ts 里那一份，多处读取时都从这里取。
export function listWatersheds(): string[] {
  return [...WATERSHEDS]
}

function nextId(rows: EntryRow[]): number {
  return rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
}

// 雨量站登记：阈值雨量按 rain-rules.ts 那一份判（站网台账口径）；
// 同一站号重复提交不另起记录；登记结论同步落隐患核销清单，那边多一条待核站。
export function submitRainStation(input: RainSubmission): SubmitResult {
  const stationNo = input.站号.trim()
  const stationName = input.站点名称.trim()
  const watershed = input.所属流域.trim()
  if (!stationNo) {
    return { ok: false, created: false, message: '站号不能为空' }
  }
  if (!stationName) {
    return { ok: false, created: false, message: '站点名称不能为空' }
  }
  if (!WATERSHEDS.includes(watershed)) {
    return { ok: false, created: false, message: '所属流域要取站网台账登记的那一份' }
  }
  const verdict = judgeThreshold(input.阈值雨量)
  if (verdict.code === 'invalid') {
    return { ok: false, created: false, message: `阈值雨量格式错：${verdict.reason}` }
  }
  const rows = listRows('rain')
  if (rows.some((row) => String(row['站号']).trim() === stationNo)) {
    return { ok: true, created: false, message: `站号 ${stationNo} 已登记，本次不另起记录` }
  }
  const extreme = verdict.code === 'extreme'
  const row: EntryRow = {
    id: nextId(rows),
    status: '待安装',
    pending: true,
    abnormal: extreme,
    站号: stationNo,
    站点名称: stationName,
    所属流域: watershed,
    设备型号: input.设备型号.trim(),
    阈值雨量: verdict.value,
    通信方式: input.通信方式.trim(),
    校核日期: input.校核日期.trim(),
    站点状态: '待安装',
  }
  saveRows('rain', [...rows, row])
  appendClearance(row, extreme ? verdict.reason : '')
  return {
    ok: true,
    created: true,
    message: extreme
      ? `雨量站 ${stationNo} 已登记，${verdict.reason}，结论已落隐患核销清单`
      : `雨量站 ${stationNo} 已登记，结论已落隐患核销清单待核`,
  }
}

// 登记结论落隐患核销清单：新增一条「待复核」核销单，即清单那边的待核站。
function appendClearance(station: EntryRow, note: string): void {
  const rows = listRows('clearance')
  const id = nextId(rows)
  const entry: EntryRow = {
    id,
    status: '待复核',
    pending: true,
    abnormal: Boolean(station.abnormal),
    核销编号: `CLEA-${String(id).padStart(4, '0')}`,
    所属隐患点: `雨量站·${station['站点名称']}`,
    核销依据: `雨量站登记结论：站号 ${station['站号']}，所属流域 ${station['所属流域']}，阈值雨量 ${station['阈值雨量']}mm`,
    复核人: '待指派',
    复核日期: '',
    核销结论: note || '待核站',
    归档日期: '',
    核销状态: '待复核',
  }
  saveRows('clearance', [...rows, entry])
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
