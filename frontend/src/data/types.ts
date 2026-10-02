/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: string | number | boolean
}

export type ModuleMeta = {
  key: string
  name: string
  entity: string
  desc: string
  fields: string[]
  statuses: string[]
  actions: string[]
  actionTargets: Record<string, string>
  // 为 true 时状态必须按 statuses 次序逐级推进，跨级动作直接拦下（雨量站网在用）
  strictFlow?: boolean
  metrics: string[]
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
}

export type ActionResult = {
  ok: boolean
  message: string
}

// 雨量站登记入参：阈值雨量先按字符串进来，统一走 rain-rules.ts 判定后落整数。
export type RainSubmission = {
  站号: string
  站点名称: string
  所属流域: string
  设备型号: string
  阈值雨量: string
  通信方式: string
  校核日期: string
}

export type SubmitResult = {
  ok: boolean
  // 同一站号重复提交时为 false：不另起记录，也不算失败
  created: boolean
  message: string
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}
