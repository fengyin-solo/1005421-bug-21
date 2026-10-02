import type { EntryRow } from './types'

// 雨量站判定规则：全系统只有这一份，页面、迁移、核销联动都从这里取，不许另抄。
//
// 口径优先级（两处口径顶上了按这份来）：阈值雨量一律以「站网台账」那一版为准 ——
// 整数毫米。页面录入侧不再单独搞一套格式（此前按一位小数卡格式、把按整数报阈值的
// 合法站点挡在门外的做法已废止）。凡冲突，以台账口径判。
//
// 现行口径：
//   - 整数毫米；「50」「50.0」这类能归一成整数的录入都接受，落库统一存整数；
//   - 负数、归一不成整数的小数、超出台账上限的，一律格式错，不准入库；
//   - 取到极值（下限 0 或上限 500）的记录可以登记，但一律退回核对（abnormal 标记）；
//   - 状态按 待安装 → 运行正常 → 设备故障 → 已撤除 逐级推进，跨级拦截。

export const RAIN_STATUS_FLOW: readonly string[] = ['待安装', '运行正常', '设备故障', '已撤除']

export const THRESHOLD_MIN = 0
export const THRESHOLD_MAX = 500

// 所属流域只有这一份：登记下拉、筛选、核销联动多处读取时都取它。
export const WATERSHEDS: readonly string[] = [
  '岷江流域',
  '沱江流域',
  '嘉陵江流域',
  '渠江流域',
  '涪江流域',
  '青衣江流域',
]

export type ThresholdVerdict =
  | { code: 'ok'; value: number }
  | { code: 'extreme'; value: number; reason: string }
  | { code: 'invalid'; reason: string }

// 阈值雨量判定：站网台账口径（整数毫米）。这是唯一的判定入口。
export function judgeThreshold(input: string | number | boolean | undefined): ThresholdVerdict {
  const text = String(input ?? '').trim()
  if (text === '') {
    return { code: 'invalid', reason: '阈值雨量不能为空' }
  }
  const value = Number(text)
  if (!Number.isFinite(value)) {
    return { code: 'invalid', reason: '阈值雨量按站网台账口径应为整数毫米' }
  }
  if (!Number.isInteger(value)) {
    return { code: 'invalid', reason: '站网台账按整数毫米登记，不接收小数' }
  }
  if (value < 0) {
    return { code: 'invalid', reason: '阈值雨量不能为负数' }
  }
  if (value > THRESHOLD_MAX) {
    return { code: 'invalid', reason: `阈值雨量超出台账上限 ${THRESHOLD_MAX}mm` }
  }
  if (value === THRESHOLD_MIN || value === THRESHOLD_MAX) {
    return { code: 'extreme', value, reason: `阈值雨量取到极值 ${value}mm，退回核对` }
  }
  return { code: 'ok', value }
}

// 存量站点按现行口径重判一遍：能归一的归一成整数，不合格或取到极值的标 abnormal（退回核对）。
export function rejudgeRainRows(rows: EntryRow[]): EntryRow[] {
  return rows.map((row) => {
    const verdict = judgeThreshold(row['阈值雨量'])
    if (verdict.code === 'invalid') {
      return { ...row, abnormal: true }
    }
    return { ...row, 阈值雨量: verdict.value, abnormal: verdict.code === 'extreme' }
  })
}
