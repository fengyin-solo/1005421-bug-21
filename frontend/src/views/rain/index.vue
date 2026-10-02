<template>
  <section class="page" data-module="rain">
    <header class="page-head">
      <div>
        <h2>雨量站网管理</h2>
        <p class="page-desc">
          维护雨量站，围绕站号、站点名称、所属流域、设备型号做登记、筛选与状态流转；阈值雨量以站网台账口径（整数毫米）判定。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记雨量站</button>
        <button class="btn" type="button" @click="exportRows">导出雨量站网清单</button>
      </div>
    </header>

    <form v-if="showCreate" class="filter-bar create-panel" @submit.prevent="submitCreate">
      <label class="filter-item">
        <span>站号</span>
        <input v-model="form.站号" placeholder="如 RAIN-0004" />
      </label>
      <label class="filter-item">
        <span>站点名称</span>
        <input v-model="form.站点名称" placeholder="站点名称" />
      </label>
      <label class="filter-item">
        <span>所属流域</span>
        <select v-model="form.所属流域">
          <option v-for="item in watersheds" :key="item" :value="item">{{ item }}</option>
        </select>
      </label>
      <label class="filter-item">
        <span>设备型号</span>
        <input v-model="form.设备型号" placeholder="设备型号" />
      </label>
      <label class="filter-item">
        <span>阈值雨量（整数毫米）</span>
        <input v-model="form.阈值雨量" placeholder="站网台账口径：整数毫米" />
      </label>
      <label class="filter-item">
        <span>通信方式</span>
        <input v-model="form.通信方式" placeholder="如 4G / 北斗短报文" />
      </label>
      <label class="filter-item">
        <span>校核日期</span>
        <input v-model="form.校核日期" type="date" />
      </label>
      <button class="btn primary" type="submit">提交登记</button>
      <button class="btn ghost" type="button" @click="showCreate = false">收起</button>
    </form>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>
            {{ row.status }}
            <span v-if="row.abnormal" class="error-text">（退回核对）</span>
          </td>
          <td class="row-actions">
            <button
              v-for="action in actions"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无雨量站网数据，可先登记雨量站</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条雨量站网记录</span>
      <span v-if="noticeMessage" class="ok-text">{{ noticeMessage }}</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  listEntries,
  listWatersheds,
  moduleMeta,
  runAction as applyAction,
  submitRainStation,
} from '@/api/local-service'
import type { EntryRow, RainSubmission } from '@/data/types'

const meta = moduleMeta('rain')
const columns = ["站号", "站点名称", "所属流域", "设备型号", "阈值雨量", "通信方式", "校核日期", "站点状态"]
const actions = ["提交安装", "登记故障", "办理撤除"]
const statuses = ["待安装", "运行正常", "设备故障", "已撤除"]
// 所属流域只有这一份来源，登记下拉与列表、面板读的都是它
const watersheds = listWatersheds()

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const noticeMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const showCreate = ref(false)

const blankForm = (): RainSubmission => ({
  站号: '',
  站点名称: '',
  所属流域: watersheds[0] ?? '',
  设备型号: '',
  阈值雨量: '',
  通信方式: '',
  校核日期: new Date().toISOString().slice(0, 10),
})
const form = ref<RainSubmission>(blankForm())

// 统计卡与下方列表取的是同一份数据（同一次 listEntries 结果），不另开一路
const stats = computed(() => {
  const thresholds = rows.value
    .map((row) => Number(row['阈值雨量']))
    .filter((value) => Number.isFinite(value))
  return [
    { label: '运行正常站点', value: rows.value.filter((row) => row.status === '运行正常').length },
    { label: '故障站点', value: rows.value.filter((row) => row.status === '设备故障').length },
    { label: '阈值雨量最小值', value: thresholds.length ? Math.min(...thresholds) : '—' },
  ]
})
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = ''
  noticeMessage.value = ''
  showCreate.value = !showCreate.value
}

function submitCreate() {
  errorMessage.value = ''
  noticeMessage.value = ''
  const result = submitRainStation(form.value)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  noticeMessage.value = result.message
  if (result.created) {
    form.value = blankForm()
    showCreate.value = false
  }
  reload()
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  noticeMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  noticeMessage.value = result.message
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '雨量站网列表读取失败'
  }
}

onMounted(reload)
</script>
