import type { EntryRow } from './types'

/**
 * 雨量站「阈值雨量」判定口径 —— 全应用只有这一份，登记、重判、导出都从这里走。
 *
 * 现行口径以站网台账登记版为准：
 *   - 阈值雨量按整数上报、按整数判定（站点本来就只报整数）；
 *   - 允许区间 [RAIN_THRESHOLD_MIN, RAIN_THRESHOLD_MAX] mm，负数与超上限一律拒收；
 *   - 取到极值（= RAIN_THRESHOLD_MAX）的记录不拒收，但一律退回核对：标记异常并进入待复核。
 *
 * 口径冲突说明：旧版曾按「必须一位小数」卡格式，把合法整数站点挡在门外，却放行了负数，
 * 造成落库值与明细对不上。两处口径顶上时，一律以本文件（站网台账版）为准，
 * 旧的「一位小数」口径已废止，不再参与任何判定。
 */
export const RAIN_THRESHOLD_MIN = 0
export const RAIN_THRESHOLD_MAX = 500

export type ThresholdVerdict =
  | { kind: 'ok'; value: number }
  | { kind: 'extreme'; value: number; message: string }
  | { kind: 'invalid'; message: string }

/** 按站网台账口径判定一个阈值雨量录入值。 */
export function judgeThresholdRain(raw: unknown): ThresholdVerdict {
  const text = String(raw ?? '').trim()
  if (text === '') {
    return { kind: 'invalid', message: '阈值雨量不能为空' }
  }
  const value = Number(text)
  if (!Number.isFinite(value)) {
    return { kind: 'invalid', message: `阈值雨量「${text}」不是数字，按站网台账口径应填整数` }
  }
  if (!Number.isInteger(value)) {
    return { kind: 'invalid', message: `阈值雨量「${text}」不符合站网台账口径：按整数填报，不再要求一位小数` }
  }
  if (value < RAIN_THRESHOLD_MIN) {
    return { kind: 'invalid', message: `阈值雨量不能为负数，站网台账口径下限为 ${RAIN_THRESHOLD_MIN}mm` }
  }
  if (value > RAIN_THRESHOLD_MAX) {
    return { kind: 'invalid', message: `阈值雨量超出站网台账口径上限 ${RAIN_THRESHOLD_MAX}mm` }
  }
  if (value === RAIN_THRESHOLD_MAX) {
    return {
      kind: 'extreme',
      value,
      message: `阈值雨量取到台账极值 ${RAIN_THRESHOLD_MAX}mm，按口径一律退回核对`,
    }
  }
  return { kind: 'ok', value }
}

/**
 * 存量站点按现行口径重判一遍：非法值与极值记录标成异常并写清判定备注，
 * 同时把「站点状态」字段与流转状态对齐，保证落库那份与明细一致。
 * 幂等，可反复执行；返回是否有改动，由调用方决定要不要落盘。
 */
export function rejudgeRainRows(rows: EntryRow[]): { rows: EntryRow[]; changed: boolean } {
  let changed = false
  const judged = rows.map((row) => {
    const verdict = judgeThresholdRain(row['阈值雨量'])
    const abnormal = verdict.kind !== 'ok'
    const note = verdict.kind === 'ok' ? '' : verdict.message
    const syncedStatus = String(row.status)
    if (
      row.abnormal === abnormal &&
      (row['判定备注'] ?? '') === note &&
      String(row['站点状态'] ?? '') === syncedStatus
    ) {
      return row
    }
    changed = true
    return { ...row, abnormal, 判定备注: note, 站点状态: syncedStatus }
  })
  return { rows: judged, changed }
}
