<template>
  <section class="page" data-module="rain">
    <header class="page-head">
      <div>
        <h2>雨量站网管理</h2>
        <p class="page-desc">维护雨量站，围绕站号、站点名称、所属流域、设备型号做登记、筛选与状态流转。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记雨量站</button>
        <button class="btn" type="button" @click="exportRows">导出雨量站网清单</button>
      </div>
    </header>

    <form v-if="showCreate" class="create-panel" @submit.prevent="submitCreate">
      <p class="create-hint">
        阈值雨量按站网台账口径填整数（0–500mm），不再要求一位小数；取到极值 500mm 的记录一律退回核对。
      </p>
      <div class="create-grid">
        <label v-for="field in createFields" :key="field.key" class="filter-item">
          <span>{{ field.label }}</span>
          <input
            v-model="createForm[field.key]"
            :type="field.type"
            :placeholder="field.hint"
          />
        </label>
      </div>
      <div class="create-actions">
        <button class="btn primary" type="submit">提交登记</button>
        <button class="btn ghost" type="button" @click="closeCreate">取消</button>
      </div>
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
          <td>{{ row.status }}</td>
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
      <span v-if="notice" class="notice-text">{{ notice }}</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  createRainEntry,
  downloadEntries,
  listEntries,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('rain')
const columns = ["站号", "站点名称", "所属流域", "设备型号", "阈值雨量", "通信方式", "校核日期", "站点状态"]
const actions = ["提交安装", "登记故障", "办理撤除"]
const statuses = ["待安装", "运行正常", "设备故障", "已撤除"]

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const notice = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)

// 统计卡、状态分布、列表三处取的是同一份行数据，不各读各的。
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

type CreateField = { key: keyof typeof createForm.value; label: string; type: string; hint: string }

const showCreate = ref(false)
const createForm = ref({
  站号: '',
  站点名称: '',
  所属流域: '',
  设备型号: '',
  阈值雨量: '',
  通信方式: '',
  校核日期: '',
})
const createFields: CreateField[] = [
  { key: '站号', label: '站号', type: 'text', hint: '如 RAIN-0005' },
  { key: '站点名称', label: '站点名称', type: 'text', hint: '如 梨坪沟雨量站' },
  { key: '所属流域', label: '所属流域', type: 'text', hint: '如 岷江上游流域' },
  { key: '设备型号', label: '设备型号', type: 'text', hint: '如 JDZ-1 翻斗式雨量计' },
  { key: '阈值雨量', label: '阈值雨量', type: 'text', hint: '整数，单位 mm' },
  { key: '通信方式', label: '通信方式', type: 'text', hint: '如 GPRS / 北斗短报文' },
  { key: '校核日期', label: '校核日期', type: 'date', hint: '' },
]

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

function resetCreateForm() {
  createForm.value = {
    站号: '',
    站点名称: '',
    所属流域: '',
    设备型号: '',
    阈值雨量: '',
    通信方式: '',
    校核日期: today(),
  }
}

function openCreate() {
  errorMessage.value = ''
  notice.value = ''
  resetCreateForm()
  showCreate.value = true
}

function closeCreate() {
  showCreate.value = false
}

function submitCreate() {
  errorMessage.value = ''
  notice.value = ''
  const result = createRainEntry({ ...createForm.value })
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  notice.value = result.message
  if (result.created) {
    closeCreate()
  }
  reload()
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  notice.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  notice.value = result.message
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
